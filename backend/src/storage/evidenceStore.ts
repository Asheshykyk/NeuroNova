import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import { formatSourceIdHex } from '@trusttrace/core/canonical';
import { SqliteEvidenceIndex } from './sqliteEvidenceIndex.ts';
import type {
  AppendEvidenceRequest,
  EvidenceJsonlRecord,
  EvidenceReceipt,
  EvidenceIndexStatus,
  SourceIdInput
} from './types.ts';

export interface EvidenceStoreOptions {
  directory: string;
  databasePath?: string;
  segmentMaxBytes?: number;
  now?: () => Date;
}

interface RecoveredRecord {
  record: EvidenceJsonlRecord;
  rawBytes: Buffer;
  segmentName: string;
  lineOffset: number;
}

const DEFAULT_SEGMENT_MAX_BYTES = 64 * 1024 * 1024;
const LOCK_STALE_MS = 120_000;
const LOCK_UPDATE_MS = 30_000;

export function combineLockReleaseError(operationError: unknown, releaseError: unknown): Error {
  const primary = operationError instanceof Error
    ? operationError
    : new Error(String(operationError));
  const diagnostic = new Error(
    `${primary.message}; additionally, lock release failed: ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`,
    { cause: primary }
  );
  Object.defineProperty(diagnostic, 'releaseError', {
    value: releaseError,
    enumerable: true
  });
  return diagnostic;
}

export interface WritableFileHandle {
  write(buffer: Buffer, offset: number, length: number, position: number | null): Promise<{ bytesWritten: number }>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export async function writeCompleteRecordAndSync(handle: WritableFileHandle, record: Buffer): Promise<void> {
  let offset = 0;
  while (offset < record.length) {
    const result = await handle.write(record, offset, record.length - offset, null);
    if (result.bytesWritten <= 0) {
      throw new Error('Evidence JSONL write made no progress');
    }
    offset += result.bytesWritten;
  }
  await handle.sync();
}

async function fsyncDirectory(directory: string): Promise<void> {
  let handle: FileHandle | null = null;
  try {
    handle = await fsPromises.open(directory, 'r');
    await handle.sync();
  } catch (error) {
    if (process.platform !== 'win32') throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EPERM' && code !== 'EINVAL' && code !== 'ENOTSUP') throw error;
  } finally {
    if (handle) await handle.close();
  }
}

export class EvidenceStore {
  private readonly directory: string;
  private readonly databasePath: string;
  private readonly segmentMaxBytes: number;
  private readonly now: () => Date;
  private index: SqliteEvidenceIndex | null;
  private readonly lastSequenceBySource = new Map<string, bigint>();
  private readonly deliveryRecords = new Map<string, {
    sourceId: string;
    rawBytes: Buffer;
    receipt: EvidenceReceipt;
  }>();
  private activeSegmentName = '';
  private lastIndexingError: unknown = null;
  private indexStatus: EvidenceIndexStatus = {
    state: 'degraded',
    lastHealthyAt: null,
    lastError: null
  };

  private constructor(options: EvidenceStoreOptions) {
    this.directory = path.resolve(options.directory);
    this.databasePath = path.resolve(options.databasePath ?? path.join(this.directory, 'evidence-index.sqlite3'));
    this.segmentMaxBytes = options.segmentMaxBytes ?? DEFAULT_SEGMENT_MAX_BYTES;
    this.now = options.now ?? (() => new Date());

    if (!Number.isSafeInteger(this.segmentMaxBytes) || this.segmentMaxBytes < 1) {
      throw new RangeError('segmentMaxBytes must be a positive integer');
    }

    fs.mkdirSync(this.directory, { recursive: true });
    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true });

    this.repairSegmentTails();
    const recovered = this.readJsonlRecords();
    this.index = null;

    this.rebuildIndex(recovered);
    this.activeSegmentName = this.findLatestSegmentName(recovered);
  }

  static async open(options: EvidenceStoreOptions): Promise<EvidenceStore> {
    const directory = path.resolve(options.directory);
    fs.mkdirSync(directory, { recursive: true });
    fs.mkdirSync(path.dirname(path.resolve(options.databasePath ?? path.join(directory, 'evidence-index.sqlite3'))), { recursive: true });

    const release = await lockfile.lock(directory, {
      retries: { retries: 20, minTimeout: 50, maxTimeout: 500 },
      stale: LOCK_STALE_MS,
      update: LOCK_UPDATE_MS,
      realpath: false
    });
    let store: EvidenceStore;
    try {
      store = new EvidenceStore(options);
    } catch (operationError) {
      try {
        await release();
      } catch (releaseError) {
        throw combineLockReleaseError(operationError, releaseError);
      }
      throw operationError;
    }

    try {
      await release();
    } catch (releaseError) {
      throw releaseError;
    }
    return store;
  }

  async append(request: AppendEvidenceRequest): Promise<EvidenceReceipt> {
    const release = await lockfile.lock(this.directory, {
      retries: { retries: 20, minTimeout: 50, maxTimeout: 500 },
      stale: LOCK_STALE_MS,
      update: LOCK_UPDATE_MS,
      realpath: false
    });

    let receipt: EvidenceReceipt;
    try {
      receipt = await this.appendUnlocked(request);
    } catch (operationError) {
      try {
        await release();
      } catch (releaseError) {
        throw combineLockReleaseError(operationError, releaseError);
      }
      throw operationError;
    }

    try {
      await release();
    } catch (releaseError) {
      throw releaseError;
    }
    return receipt;
  }

  private async appendUnlocked(request: AppendEvidenceRequest): Promise<EvidenceReceipt> {
      this.repairSegmentTails();
      const recovered = this.readJsonlRecords();
      this.rebuildIndex(recovered);
      this.activeSegmentName = this.findLatestSegmentName(recovered);

      const sourceId = formatSourceIdHex(request.sourceId);
      const rawBytes = Buffer.isBuffer(request.rawEventBytes)
        ? Buffer.from(request.rawEventBytes)
        : Buffer.from(request.rawEventBytes);

      if (rawBytes.length > 0xffffffff) {
        throw new RangeError('rawEventBytes exceeds the uint32 length limit');
      }

      let duplicateReceipt: EvidenceReceipt | null = null;
      if (request.deliveryId !== undefined) {
        const deliveryId = this.validateDeliveryId(request.deliveryId);
        const existing = this.deliveryRecords.get(deliveryId);
        if (existing) {
          if (existing.sourceId !== sourceId) {
            throw new Error(`Delivery ID conflict: ${deliveryId} is already associated with another sourceId`);
          }
          if (!existing.rawBytes.equals(rawBytes)) {
            throw new Error(`Delivery ID conflict: ${deliveryId} has already been used with distinct raw event bytes`);
          }
          duplicateReceipt = { ...existing.receipt, duplicate: true };
        }
      }

      if (duplicateReceipt) return duplicateReceipt;

      const vaultSequence = (this.lastSequenceBySource.get(sourceId) ?? 0n) + 1n;
      const receiptTimestamp = this.now().toISOString();

      const record: EvidenceJsonlRecord = {
        recordVersion: 1,
        sourceId,
        vaultSequence: vaultSequence.toString(),
        receiptTimestamp,
        rawEventEncoding: 'base64',
        rawEventBytesBase64: rawBytes.toString('base64'),
        rawEventLength: rawBytes.length,
        ...(request.deliveryId === undefined ? {} : { deliveryId: this.validateDeliveryId(request.deliveryId) })
      };

      const segmentName = this.chooseSegment(record);
      const segmentPath = path.join(this.directory, segmentName);
      const segmentWasCreated = !fs.existsSync(segmentPath);
      const lineOffset = fs.existsSync(segmentPath) ? fs.statSync(segmentPath).size : 0;
      const line = Buffer.from(JSON.stringify(record) + '\n', 'utf8');

      const handle = await fsPromises.open(segmentPath, 'a');
      try {
        if (segmentWasCreated) {
          await fsyncDirectory(this.directory);
        }
        await writeCompleteRecordAndSync(handle, line);
      } finally {
        await handle.close();
      }

      const receipt: EvidenceReceipt = {
        sourceId,
        vaultSequence,
        receiptTimestamp,
        rawEventLength: rawBytes.length,
        segmentName,
        duplicate: false
      };

      // JSONL and fsync have succeeded. Durable state is authoritative now.
      this.lastSequenceBySource.set(sourceId, vaultSequence);
      if (record.deliveryId) {
        this.deliveryRecords.set(record.deliveryId, {
          sourceId,
          rawBytes: Buffer.from(rawBytes),
          receipt
        });
      }

      if (this.index) {
        try {
          this.index.add(record, segmentName, lineOffset);
        } catch (error) {
          try {
            this.index?.close();
          } catch {
            // Preserve the original indexing failure.
          }
          this.index = null;
          this.markIndexDegraded(error);
        }
      }

      return receipt;
  }

  close(): void {
    if (this.index) {
      this.index.close();
      this.index = null;
    }
  }

  getIndexStatus(): EvidenceIndexStatus {
    return { ...this.indexStatus, lastError: this.indexStatus.lastError };
  }

  async reconcileIndex(): Promise<EvidenceIndexStatus> {
    const release = await lockfile.lock(this.directory, {
      retries: { retries: 20, minTimeout: 50, maxTimeout: 500 },
      stale: LOCK_STALE_MS,
      update: LOCK_UPDATE_MS,
      realpath: false
    });

    let status: EvidenceIndexStatus;
    try {
      this.repairSegmentTails();
      const recovered = this.readJsonlRecords();
      this.rebuildIndex(recovered);
      status = this.getIndexStatus();
    } catch (operationError) {
      try {
        await release();
      } catch (releaseError) {
        throw combineLockReleaseError(operationError, releaseError);
      }
      throw operationError;
    }

    try {
      await release();
    } catch (releaseError) {
      throw releaseError;
    }
    return status;
  }

  private validateDeliveryId(deliveryId: string): string {
    if (typeof deliveryId !== 'string' || deliveryId.trim().length === 0) {
      throw new Error('deliveryId must be a non-empty string');
    }
    return deliveryId;
  }

  private repairSegmentTails(): void {
    const segmentNames = this.listSegmentNames();
    if (segmentNames.length === 0) return;

    for (let index = 0; index < segmentNames.length - 1; index += 1) {
      const segmentName = segmentNames[index];
      const segmentPath = path.join(this.directory, segmentName);
      const bytes = fs.readFileSync(segmentPath);
      if (bytes.length === 0) {
        throw new Error(`Earlier evidence segment is empty or incomplete: ${segmentName}`);
      }
      if (bytes[bytes.length - 1] !== 0x0a) {
        throw new Error(`Earlier evidence segment has an incomplete or corrupt final record: ${segmentName}`);
      }
    }

    const finalSegmentName = segmentNames[segmentNames.length - 1];
    const finalSegmentPath = path.join(this.directory, finalSegmentName);
    const bytes = fs.readFileSync(finalSegmentPath);
    if (bytes.length > 0 && bytes[bytes.length - 1] === 0x0a) return;

    const lastNewline = bytes.lastIndexOf(0x0a);
    fs.truncateSync(finalSegmentPath, lastNewline + 1);
    const fd = fs.openSync(finalSegmentPath, 'r+');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }

  private readJsonlRecords(): RecoveredRecord[] {
    const recovered: RecoveredRecord[] = [];

    for (const segmentName of this.listSegmentNames()) {
      const segmentPath = path.join(this.directory, segmentName);
      const bytes = fs.readFileSync(segmentPath);
      let lineOffset = 0;

      while (lineOffset < bytes.length) {
        const newlineOffset = bytes.indexOf(0x0a, lineOffset);
        if (newlineOffset < 0) {
          throw new Error(`Incomplete JSONL line remains in segment ${segmentName}`);
        }

        const line = bytes.subarray(lineOffset, newlineOffset);
        if (line.length > 0) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(line.toString('utf8'));
          } catch (error) {
            throw new Error(`Invalid JSONL record in ${segmentName} at byte ${lineOffset}`, { cause: error });
          }

          const record = this.validateRecoveredRecord(parsed);
          const rawBytes = this.decodeRawEvent(record);
          recovered.push({ record, rawBytes, segmentName, lineOffset });
        }

        lineOffset = newlineOffset + 1;
      }
    }

    return recovered;
  }

  private validateRecoveredRecord(value: unknown): EvidenceJsonlRecord {
    if (typeof value !== 'object' || value === null) {
      throw new Error('Invalid evidence record: expected a JSON object');
    }

    const record = value as Partial<EvidenceJsonlRecord>;
    if (record.recordVersion !== 1) throw new Error('Invalid evidence record: unsupported recordVersion');
    if (typeof record.sourceId !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(record.sourceId)) {
      throw new Error('Invalid evidence record: sourceId must be bytes32 hex');
    }
    if (typeof record.vaultSequence !== 'string' || !/^\d+$/.test(record.vaultSequence)) {
      throw new Error('Invalid evidence record: vaultSequence must be an unsigned integer string');
    }
    const vaultSequence = BigInt(record.vaultSequence);
    if (vaultSequence < 1n) throw new Error('Invalid evidence record: vaultSequence must be positive');
    if (typeof record.receiptTimestamp !== 'string' || Number.isNaN(Date.parse(record.receiptTimestamp))) {
      throw new Error('Invalid evidence record: invalid receiptTimestamp');
    }
    if (record.rawEventEncoding !== 'base64' || typeof record.rawEventBytesBase64 !== 'string') {
      throw new Error('Invalid evidence record: rawEventBytesBase64 encoding required');
    }
    if (!Number.isSafeInteger(record.rawEventLength) || (record.rawEventLength as number) < 0) {
      throw new Error('Invalid evidence record: invalid rawEventLength');
    }
    if (record.deliveryId !== undefined) {
      if (typeof record.deliveryId !== 'string' || record.deliveryId.trim().length === 0) {
        throw new Error('Invalid evidence record: invalid deliveryId');
      }
    }

    return record as EvidenceJsonlRecord;
  }

  private decodeRawEvent(record: EvidenceJsonlRecord): Buffer {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(record.rawEventBytesBase64)) {
      throw new Error(`Invalid base64 raw event bytes for source ${record.sourceId} sequence ${record.vaultSequence}`);
    }
    const rawBytes = Buffer.from(record.rawEventBytesBase64, 'base64');
    if (rawBytes.toString('base64') !== record.rawEventBytesBase64) {
      throw new Error(`Non-canonical base64 raw event bytes for source ${record.sourceId} sequence ${record.vaultSequence}`);
    }
    if (rawBytes.length !== record.rawEventLength) {
      throw new Error(`Raw event length mismatch for source ${record.sourceId} sequence ${record.vaultSequence}`);
    }
    return rawBytes;
  }

  private markIndexHealthy(): void {
    this.indexStatus = {
      state: 'healthy',
      lastHealthyAt: new Date().toISOString(),
      lastError: null
    };
  }

  private markIndexDegraded(error: unknown): void {
    this.lastIndexingError = error;
    this.indexStatus = {
      state: 'degraded',
      lastHealthyAt: this.indexStatus.lastHealthyAt,
      lastError: error instanceof Error ? error.message : String(error)
    };
  }

  private initializeIndex(records: RecoveredRecord[]): void {
    try {
      if (!this.index) {
        this.index = new SqliteEvidenceIndex(this.databasePath);
      }
      this.index.rebuild(
        records.map(({ record, segmentName, lineOffset }) => ({ ...record, segmentName, lineOffset })),
        records.map(({ rawBytes }) => rawBytes)
      );
      this.markIndexHealthy();
    } catch (error) {
      if (this.index) {
        try {
          this.index.close();
        } catch {
          // Index closure failure is secondary to initialization failure.
        }
      }
      this.index = null;
      this.markIndexDegraded(error);
    }
  }

  private rebuildIndex(records: RecoveredRecord[]): void {
    this.lastSequenceBySource.clear();
    this.deliveryRecords.clear();

    for (const recovered of records) {
      const { record, rawBytes } = recovered;
      const vaultSequence = BigInt(record.vaultSequence);
      const previous = this.lastSequenceBySource.get(record.sourceId) ?? 0n;
      if (vaultSequence !== previous + 1n) {
        throw new Error(
          `Sequence gap or reuse for source ${record.sourceId}: expected ${previous + 1n}, found ${vaultSequence}`
        );
      }

      if (record.deliveryId) {
        const existing = this.deliveryRecords.get(record.deliveryId);
        if (existing) {
          if (existing.sourceId !== record.sourceId || !existing.rawBytes.equals(rawBytes)) {
            throw new Error(`Conflicting duplicate deliveryId in JSONL: ${record.deliveryId}`);
          }
        } else {
          const receipt: EvidenceReceipt = {
            sourceId: record.sourceId,
            vaultSequence,
            receiptTimestamp: record.receiptTimestamp,
            rawEventLength: record.rawEventLength,
            segmentName: recovered.segmentName,
            duplicate: false
          };
          this.deliveryRecords.set(record.deliveryId, {
            sourceId: record.sourceId,
            rawBytes: Buffer.from(rawBytes),
            receipt
          });
        }
      }

      this.lastSequenceBySource.set(record.sourceId, vaultSequence);
    }

    this.initializeIndex(records);
  }

  private chooseSegment(record: EvidenceJsonlRecord): string {
    const line = Buffer.from(JSON.stringify(record) + '\n', 'utf8');

    if (this.activeSegmentName) {
      const activePath = path.join(this.directory, this.activeSegmentName);
      if (!fs.existsSync(activePath) || fs.statSync(activePath).size + line.length <= this.segmentMaxBytes) {
        return this.activeSegmentName;
      }
    }

    const segmentNames = this.listSegmentNames();
    let nextNumber = 1;
    if (segmentNames.length > 0) {
      const lastNumber = this.parseSegmentNumber(segmentNames[segmentNames.length - 1]);
      nextNumber = lastNumber + 1;
    }

    this.activeSegmentName = `evidence-${nextNumber.toString().padStart(12, '0')}.jsonl`;
    return this.activeSegmentName;
  }

  private findLatestSegmentName(records: RecoveredRecord[]): string {
    const names = this.listSegmentNames();
    if (names.length > 0) return names[names.length - 1];
    return '';
  }

  private listSegmentNames(): string[] {
    return fs.readdirSync(this.directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^evidence-\d{12}\.jsonl$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  }

  private parseSegmentNumber(segmentName: string): number {
    const match = /^evidence-(\d{12})\.jsonl$/.exec(segmentName);
    if (!match) throw new Error(`Invalid evidence segment name: ${segmentName}`);
    return Number(match[1]);
  }
}
