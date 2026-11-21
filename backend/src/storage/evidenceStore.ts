import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import crypto from 'node:crypto';
import { formatSourceIdHex } from '@trusttrace/core/canonical';
import { encodeAgentHeartbeatPreimage, verifyAgentHeartbeat } from '@trusttrace/core/agent';
import { SqliteEvidenceIndex } from './sqliteEvidenceIndex.ts';
import type {
  AppendEvidenceRequest,
  EvidenceJsonlRecord,
  EvidenceReceipt,
  EvidenceIndexStatus,
  HeartbeatJsonlRecord,
  HeartbeatReceipt,
  PersistedHeartbeat,
  SourceIdInput
} from './types.ts';

export interface EvidenceStoreOptions {
  directory: string;
  databasePath?: string;
  segmentMaxBytes?: number;
  now?: () => Date;
  trustedAgentPublicKeyProvider?: (sourceId: string) => string | undefined;
  trustedAgentPublicKeyHistoryProvider?: (sourceId: string) => string[];
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
  private readonly trustedAgentPublicKeyProvider: ((sourceId: string) => string | undefined) | undefined;
  private readonly trustedAgentPublicKeyHistoryProvider: ((sourceId: string) => string[]) | undefined;
  private readonly heartbeatDirectory: string;
  private readonly latestHeartbeatBySource = new Map<string, bigint>();
  private readonly heartbeatRecordsById = new Map<string, HeartbeatJsonlRecord>();
  private readonly heartbeatRecordsBySourceSequence = new Map<string, HeartbeatJsonlRecord>();
  private index: SqliteEvidenceIndex | null;
  private readonly lastSequenceBySource = new Map<string, bigint>();
  private readonly deliveryRecords = new Map<string, {
    sourceId: string;
    rawBytes: Buffer;
    streamId: string;
    fileIdentity: string;
    fileGeneration: string;
    byteOffset: bigint;
    observedAt: bigint;
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
    this.trustedAgentPublicKeyProvider = options.trustedAgentPublicKeyProvider;
    this.trustedAgentPublicKeyHistoryProvider = options.trustedAgentPublicKeyHistoryProvider;
    this.heartbeatDirectory = path.join(this.directory, 'heartbeats');

    if (!Number.isSafeInteger(this.segmentMaxBytes) || this.segmentMaxBytes < 1) {
      throw new RangeError('segmentMaxBytes must be a positive integer');
    }

    fs.mkdirSync(this.directory, { recursive: true });
    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true });
    fs.mkdirSync(this.heartbeatDirectory, { recursive: true });

    this.repairSegmentTails();
    const recovered = this.readJsonlRecords();
    this.index = null;

    this.rebuildIndex(recovered);
    this.activeSegmentName = this.findLatestSegmentName(recovered);
    this.recoverHeartbeats();
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
          if (
            existing.streamId !== (request.streamId ?? '') ||
            existing.fileIdentity !== (request.fileIdentity ?? '') ||
            existing.fileGeneration !== (request.fileGeneration ?? '') ||
            existing.byteOffset !== (request.byteOffset ?? 0n) ||
            existing.observedAt !== (request.observedAt ?? 0n)
          ) {
            throw new Error(`Delivery ID conflict: ${deliveryId} has already been used with different signed metadata`);
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
        ...(request.deliveryId === undefined ? {} : { deliveryId: this.validateDeliveryId(request.deliveryId) }),
        ...(request.streamId === undefined ? {} : { streamId: request.streamId }),
        ...(request.fileIdentity === undefined ? {} : { fileIdentity: request.fileIdentity }),
        ...(request.fileGeneration === undefined ? {} : { fileGeneration: request.fileGeneration }),
        ...(request.byteOffset === undefined ? {} : { byteOffset: request.byteOffset.toString() }),
        ...(request.observedAt === undefined ? {} : { observedAt: request.observedAt.toString() }),
        ...(request.observationSource === undefined ? {} : { observationSource: request.observationSource })
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
        duplicate: false,
        ...(request.deliveryId === undefined ? {} : { deliveryId: record.deliveryId }),
        ...(request.streamId === undefined ? {} : { streamId: request.streamId }),
        ...(request.fileIdentity === undefined ? {} : { fileIdentity: request.fileIdentity }),
        ...(request.fileGeneration === undefined ? {} : { fileGeneration: request.fileGeneration }),
        ...(request.byteOffset === undefined ? {} : { byteOffset: request.byteOffset }),
        ...(request.observedAt === undefined ? {} : { observedAt: request.observedAt }),
        ...(request.observationSource === undefined ? {} : { observationSource: request.observationSource })
      };

      // JSONL and fsync have succeeded. Durable state is authoritative now.
      this.lastSequenceBySource.set(sourceId, vaultSequence);
      if (record.deliveryId) {
        this.deliveryRecords.set(record.deliveryId, {
          sourceId,
          rawBytes: Buffer.from(rawBytes),
          streamId: request.streamId ?? '',
          fileIdentity: request.fileIdentity ?? '',
          fileGeneration: request.fileGeneration ?? '',
          byteOffset: request.byteOffset ?? 0n,
          observedAt: request.observedAt ?? 0n,
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

  async acceptHeartbeat(
    sourceId: string,
    heartbeatSequence: bigint,
    observedAt: bigint,
    lastByteOffset: bigint,
    status: string,
    signature: string,
    publicKey: string
  ): Promise<HeartbeatReceipt> {
    const release = await lockfile.lock(this.heartbeatDirectory, {
      retries: { retries: 20, minTimeout: 50, maxTimeout: 500 },
      stale: LOCK_STALE_MS,
      update: LOCK_UPDATE_MS,
      realpath: false
    });

    let receipt: HeartbeatReceipt | undefined;
    try {
      this.recoverHeartbeats();

      const normalizedSourceId = formatSourceIdHex(sourceId);
      const heartbeatObject = { sourceId, heartbeatSequence, observedAt, lastByteOffset, status };
      const canonicalPreimage = encodeAgentHeartbeatPreimage(heartbeatObject);
      const heartbeatId = '0x' + crypto.createHash('sha256').update(canonicalPreimage).digest('hex');
      const canonicalHex = '0x' + canonicalPreimage.toString('hex');
      const normalizedSignature = signature.toLowerCase();

      const keys = this.trustedAgentPublicKeyHistoryProvider?.(sourceId) ?? [];
      if (publicKey && !keys.includes(publicKey)) keys.unshift(publicKey);
      if (keys.length === 0) {
        throw Object.assign(new Error('No trusted public key is configured for sourceId'), { statusCode: 503 });
      }
      const signatureVerified = keys.some((key) => verifyAgentHeartbeat(heartbeatObject, normalizedSignature, key));
      if (!signatureVerified) {
        throw Object.assign(new Error('Invalid agent heartbeat signature'), { statusCode: 401 });
      }

      const exactDuplicate = this.heartbeatRecordsBySourceSequence.get(`${normalizedSourceId}|${heartbeatSequence.toString()}`);
      if (exactDuplicate) {
        if (
          exactDuplicate.signature === normalizedSignature &&
          exactDuplicate.sourceIdBytes32 === normalizedSourceId &&
          exactDuplicate.heartbeatSequence === heartbeatSequence.toString() &&
          exactDuplicate.observedAt === observedAt.toString() &&
          exactDuplicate.lastByteOffset === lastByteOffset.toString() &&
          exactDuplicate.status === status
        ) {
          receipt = this.toHeartbeatReceipt(exactDuplicate);
        } else {
          throw Object.assign(
            new Error('Heartbeat conflict: the same source and sequence has different signed payload or signature'),
            { statusCode: 409 }
          );
        }
      }

      if (receipt) {
        try {
          await release();
        } catch (releaseError) {
          throw releaseError;
        }
        return receipt;
      }

      const latest = this.latestHeartbeatBySource.get(normalizedSourceId) ?? 0n;
      if (heartbeatSequence <= latest) {
        throw Object.assign(new Error(`Heartbeat replay: sequence ${heartbeatSequence} is not greater than latest ${latest}`), { statusCode: 409 });
      }
      if (heartbeatSequence !== latest + 1n) {
        throw Object.assign(new Error(`Heartbeat out-of-order sequence: expected ${latest + 1n}, got ${heartbeatSequence}`), { statusCode: 409 });
      }

      const vaultReceivedAt = this.now().toISOString();
      const record: HeartbeatJsonlRecord = {
        recordVersion: 1,
        recordType: 'heartbeat',
        heartbeatId,
        sourceId,
        sourceIdBytes32: normalizedSourceId,
        heartbeatSequence: heartbeatSequence.toString(),
        observedAt: observedAt.toString(),
        lastByteOffset: lastByteOffset.toString(),
        status,
        signature: normalizedSignature,
        signedPayloadCanonicalHex: canonicalHex,
        vaultReceivedAt,
        migration: {
          status: 'native',
          originalSignaturePreserved: true,
          migratedAt: null,
          migrationSource: null
        }
      };

      await this.appendHeartbeatJsonl(record);

      this.latestHeartbeatBySource.set(normalizedSourceId, heartbeatSequence);
      this.heartbeatRecordsById.set(heartbeatId, record);
      this.heartbeatRecordsBySourceSequence.set(`${normalizedSourceId}|${heartbeatSequence.toString()}`, record);

      if (this.index) {
        try {
          this.index.acceptHeartbeatRecord(record);
        } catch (error) {
          this.markIndexDegraded(error);
        }
      }

      receipt = this.toHeartbeatReceipt(record);
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
    if (!receipt) throw new Error('Heartbeat acknowledgement receipt unavailable');
    return receipt;
  }

  private heartbeatSegmentNames(): string[] {
    return fs.readdirSync(this.heartbeatDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^heartbeat-\d{12}\.jsonl$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  }

  private heartbeatIdFor(record: { sourceId: string; heartbeatSequence: bigint | string; observedAt: bigint | string; lastByteOffset: bigint | string; status: string }): string {
    const preimage = encodeAgentHeartbeatPreimage({
      sourceId: record.sourceId,
      heartbeatSequence: BigInt(record.heartbeatSequence),
      observedAt: BigInt(record.observedAt),
      lastByteOffset: BigInt(record.lastByteOffset),
      status: record.status
    });
    return '0x' + crypto.createHash('sha256').update(preimage).digest('hex');
  }

  private toHeartbeatReceipt(record: HeartbeatJsonlRecord): HeartbeatReceipt {
    const receiptTime = Date.parse(record.vaultReceivedAt);
    const available = Number.isFinite(receiptTime)
      && this.now().getTime() - receiptTime <= 15_000
      && this.now().getTime() >= receiptTime;
    return {
      sourceId: record.sourceId,
      heartbeatSequence: BigInt(record.heartbeatSequence),
      observedAt: BigInt(record.observedAt),
      lastByteOffset: BigInt(record.lastByteOffset),
      status: record.status,
      vaultReceivedAt: record.vaultReceivedAt,
      availability: available ? 'available' : 'unavailable'
    };
  }

  private async appendHeartbeatJsonl(record: HeartbeatJsonlRecord): Promise<void> {
    const names = this.heartbeatSegmentNames();
    let segmentName = names.length > 0 ? names[names.length - 1] : 'heartbeat-000000000001.jsonl';
    let segmentPath = path.join(this.heartbeatDirectory, segmentName);

    if (fs.existsSync(segmentPath)) {
      const size = fs.statSync(segmentPath).size;
      if (size >= 64 * 1024 * 1024) {
        const match = /^(heartbeat)-(\d{12})\.jsonl$/.exec(segmentName);
        const next = match ? Number(match[2]) + 1 : 1;
        segmentName = `heartbeat-${next.toString().padStart(12, '0')}.jsonl`;
        segmentPath = path.join(this.heartbeatDirectory, segmentName);
      }
    }

    const line = Buffer.from(JSON.stringify(record) + '\n', 'utf8');
    const segmentWasCreated = !fs.existsSync(segmentPath);
    const handle = await fsPromises.open(segmentPath, 'a');
    try {
      if (segmentWasCreated) {
        await fsyncDirectory(this.heartbeatDirectory);
      }
      await writeCompleteRecordAndSync(handle, line);
    } finally {
      await handle.close();
    }
  }

  private recoverHeartbeats(): void {
    this.latestHeartbeatBySource.clear();
    this.heartbeatRecordsById.clear();
    this.heartbeatRecordsBySourceSequence.clear();

    const names = this.heartbeatSegmentNames();
    if (names.length === 0) {
      this.migrateSqliteHeartbeats();
      return;
    }

    for (let index = 0; index < names.length - 1; index += 1) {
      const segmentPath = path.join(this.heartbeatDirectory, names[index]);
      const bytes = fs.readFileSync(segmentPath);
      if (bytes.length === 0 || bytes[bytes.length - 1] !== 0x0a) {
        throw new Error(`Earlier heartbeat segment is incomplete or corrupt: ${names[index]}`);
      }
    }

    const finalName = names[names.length - 1];
    const finalPath = path.join(this.heartbeatDirectory, finalName);
    const bytes = fs.readFileSync(finalPath);
    if (bytes.length > 0 && bytes[bytes.length - 1] !== 0x0a) {
      const lastNewline = bytes.lastIndexOf(0x0a);
      fs.truncateSync(finalPath, lastNewline + 1);
      const finalFd = fs.openSync(finalPath, 'r+');
      try { fs.fsyncSync(finalFd); } finally { fs.closeSync(finalFd); }
    }

    const records: HeartbeatJsonlRecord[] = [];
    for (const name of this.heartbeatSegmentNames()) {
      const content = fs.readFileSync(path.join(this.heartbeatDirectory, name));
      let offset = 0;
      while (offset < content.length) {
        const newline = content.indexOf(0x0a, offset);
        if (newline < 0) throw new Error(`Incomplete heartbeat record in ${name}`);
        if (newline === offset) {
          offset = newline + 1;
          continue;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(content.subarray(offset, newline).toString('utf8'));
        } catch (error) {
          throw new Error(`Invalid heartbeat JSONL in ${name}`, { cause: error });
        }
        const record = parsed as HeartbeatJsonlRecord;
        if (record.recordType !== 'heartbeat' || record.recordVersion !== 1) {
          throw new Error(`Invalid heartbeat record in ${name}`);
        }
        if (!record.signature && record.migration.status !== 'migrated') {
          throw new Error(`Native heartbeat record lacks signature in ${name}`);
        }
        records.push(record);
        offset = newline + 1;
      }
    }

    for (const record of records) {
      const normalizedSourceId = formatSourceIdHex(record.sourceId);
      if (record.sourceIdBytes32 !== normalizedSourceId) {
        throw new Error(`Heartbeat sourceIdBytes32 mismatch for ${record.sourceId}`);
      }
      const seq = BigInt(record.heartbeatSequence);
      const latest = this.latestHeartbeatBySource.get(normalizedSourceId) ?? 0n;
      if (record.migration.status === 'migrated') {
        if (latest !== 0n || seq < 1n) {
          throw new Error(`Migrated heartbeat sequence invalid for ${normalizedSourceId}: got ${seq}, previous ${latest}`);
        }
      } else if (seq !== latest + 1n) {
        throw new Error(`Heartbeat sequence gap or reuse for ${normalizedSourceId}: expected ${latest + 1n}, got ${seq}`);
      }

      if (record.migration.status === 'native') {
        if (!record.signature) throw new Error(`Native heartbeat record lacks signature: ${record.heartbeatId}`);
        const keys = this.trustedAgentPublicKeyHistoryProvider?.(record.sourceId) ?? [];
        const currentKey = this.trustedAgentPublicKeyProvider?.(record.sourceId);
        if (currentKey && !keys.includes(currentKey)) keys.unshift(currentKey);
        if (keys.length === 0) throw new Error(`Trusted public key unavailable for native heartbeat source ${record.sourceId}`);
        const heartbeatObject = {
          sourceId: record.sourceId,
          heartbeatSequence: seq,
          observedAt: BigInt(record.observedAt),
          lastByteOffset: BigInt(record.lastByteOffset),
          status: record.status
        };
        const verified = keys.some((key) => verifyAgentHeartbeat(heartbeatObject, record.signature!, key));
        if (!verified) {
          throw new Error(`Native heartbeat signature cannot be verified with trusted key history: ${record.heartbeatId}`);
        }
      } else if (record.migration.status !== 'migrated' || record.migration.originalSignaturePreserved) {
        throw new Error(`Invalid heartbeat migration metadata: ${record.heartbeatId}`);
      }

      const recomputedId = this.heartbeatIdFor(record);
      if (recomputedId !== record.heartbeatId) {
        throw new Error(`HeartbeatId mismatch for sequence ${record.heartbeatSequence}`);
      }

      this.latestHeartbeatBySource.set(normalizedSourceId, seq);
      this.heartbeatRecordsById.set(record.heartbeatId, record);
      this.heartbeatRecordsBySourceSequence.set(`${normalizedSourceId}|${seq.toString()}`, record);
    }

    if (this.index) {
      try {
        this.index.rebuildHeartbeatRecords(records);
      } catch (error) {
        this.markIndexDegraded(error);
      }
    }
  }

  private migrateSqliteHeartbeats(): void {
    if (!this.index) return;
    const existing = this.index.getLatestHeartbeats();
    if (existing.length === 0) return;

    const migratedAt = this.now().toISOString();
    const records: HeartbeatJsonlRecord[] = [];
    for (const heartbeat of existing) {
      const normalizedSourceId = formatSourceIdHex(heartbeat.sourceId);
      const heartbeatObject = {
        sourceId: heartbeat.sourceId,
        heartbeatSequence: heartbeat.heartbeatSequence,
        observedAt: heartbeat.observedAt,
        lastByteOffset: heartbeat.lastByteOffset,
        status: heartbeat.status
      };
      const preimage = encodeAgentHeartbeatPreimage(heartbeatObject);
      const record: HeartbeatJsonlRecord = {
        recordVersion: 1,
        recordType: 'heartbeat',
        heartbeatId: '0x' + crypto.createHash('sha256').update(preimage).digest('hex'),
        sourceId: heartbeat.sourceId,
        sourceIdBytes32: normalizedSourceId,
        heartbeatSequence: heartbeat.heartbeatSequence.toString(),
        observedAt: heartbeat.observedAt.toString(),
        lastByteOffset: heartbeat.lastByteOffset.toString(),
        status: heartbeat.status,
        signature: null,
        signedPayloadCanonicalHex: '0x' + preimage.toString('hex'),
        vaultReceivedAt: heartbeat.vaultReceivedAt,
        migration: {
          status: 'migrated',
          originalSignaturePreserved: false,
          migratedAt,
          migrationSource: 'sqlite-agent-heartbeats'
        }
      };
      records.push(record);

    }

    const segmentPath = path.join(this.heartbeatDirectory, 'heartbeat-000000000001.jsonl');
    const content = Buffer.from(records.map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');
    const segmentWasCreated = !fs.existsSync(segmentPath);
    const fd = fs.openSync(segmentPath, 'w');
    try {
      let offset = 0;
      while (offset < content.length) {
        const bytesWritten = fs.writeSync(fd, content, offset, content.length - offset, null);
        if (bytesWritten <= 0) {
          throw new Error('Heartbeat migration JSONL write made no progress');
        }
        offset += bytesWritten;
      }
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }

    if (segmentWasCreated) {
      try {
        const dirFd = fs.openSync(this.heartbeatDirectory, 'r');
        try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
      } catch (error) {
        if (process.platform !== 'win32') throw error;
      }
    }

    for (const record of records) {
      const normalizedSourceId = record.sourceIdBytes32;
      const seq = BigInt(record.heartbeatSequence);
      this.latestHeartbeatBySource.set(normalizedSourceId, seq);
      this.heartbeatRecordsById.set(record.heartbeatId, record);
      this.heartbeatRecordsBySourceSequence.set(`${normalizedSourceId}|${seq.toString()}`, record);
    }

    try {
      this.index.rebuildHeartbeatRecords(records);
    } catch (error) {
      this.markIndexDegraded(error);
    }
  }

  getHeartbeat(sourceId: string): PersistedHeartbeat | null {
    const normalizedSourceId = formatSourceIdHex(sourceId);
    const latest = this.latestHeartbeatBySource.get(normalizedSourceId);
    if (latest === undefined) {
      if (!this.index) return null;
      return this.index.getHeartbeat(normalizedSourceId);
    }
    const record = this.heartbeatRecordsBySourceSequence.get(`${normalizedSourceId}|${latest.toString()}`);
    if (!record) return null;
    return {
      sourceId: record.sourceId,
      heartbeatSequence: BigInt(record.heartbeatSequence),
      observedAt: BigInt(record.observedAt),
      lastByteOffset: BigInt(record.lastByteOffset),
      status: record.status,
      vaultReceivedAt: record.vaultReceivedAt
    };
  }

  getHeartbeatReceipt(sourceId: string): HeartbeatReceipt | null {
    const heartbeat = this.getHeartbeat(sourceId);
    if (!heartbeat) return null;

    const receiptTime = Date.parse(heartbeat.vaultReceivedAt);
    const available = Number.isFinite(receiptTime)
      && this.now().getTime() - receiptTime <= 15_000
      && this.now().getTime() >= receiptTime;

    return {
      ...heartbeat,
      availability: available ? 'available' : 'unavailable'
    };
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

  readPersistedEvidence(): Array<{ record: EvidenceJsonlRecord; rawBytes: Buffer }> {
    this.repairSegmentTails();
    return this.readJsonlRecords().map(({ record, rawBytes }) => ({ record, rawBytes }));
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
    if (record.streamId !== undefined && typeof record.streamId !== 'string') {
      throw new Error('Invalid evidence record: invalid streamId');
    }
    if (record.fileIdentity !== undefined && typeof record.fileIdentity !== 'string') {
      throw new Error('Invalid evidence record: invalid fileIdentity');
    }
    if (record.fileGeneration !== undefined && typeof record.fileGeneration !== 'string') {
      throw new Error('Invalid evidence record: invalid fileGeneration');
    }
    for (const field of ['byteOffset', 'observedAt'] as const) {
      if (record[field] !== undefined) {
        if (typeof record[field] !== 'string' || !/^\d+$/.test(record[field] as string)) {
          throw new Error(`Invalid evidence record: invalid ${field}`);
        }
      }
    }
    if (record.observationSource !== undefined &&
        record.observationSource !== 'host-agent' &&
        record.observationSource !== 'rsyslog-tcp') {
      throw new Error('Invalid evidence record: invalid observationSource');
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
        const streamId = record.streamId ?? '';
        const fileIdentity = record.fileIdentity ?? '';
        const fileGeneration = record.fileGeneration ?? '';
        const byteOffset = record.byteOffset === undefined ? 0n : BigInt(record.byteOffset);
        const observedAt = record.observedAt === undefined ? 0n : BigInt(record.observedAt);
        const existing = this.deliveryRecords.get(record.deliveryId);
        if (existing) {
          if (
            existing.sourceId !== record.sourceId ||
            !existing.rawBytes.equals(rawBytes) ||
            existing.streamId !== streamId ||
            existing.fileIdentity !== fileIdentity ||
            existing.fileGeneration !== fileGeneration ||
            existing.byteOffset !== byteOffset ||
            existing.observedAt !== observedAt
          ) {
            throw new Error(`Conflicting duplicate deliveryId in JSONL: ${record.deliveryId}`);
          }
        } else {
          const receipt: EvidenceReceipt = {
            sourceId: record.sourceId,
            vaultSequence,
            receiptTimestamp: record.receiptTimestamp,
            rawEventLength: record.rawEventLength,
            segmentName: recovered.segmentName,
            duplicate: false,
            deliveryId: record.deliveryId,
            streamId,
            fileIdentity,
            fileGeneration,
            byteOffset,
            observedAt
          };
          this.deliveryRecords.set(record.deliveryId, {
            sourceId: record.sourceId,
            rawBytes: Buffer.from(rawBytes),
            streamId,
            fileIdentity,
            fileGeneration,
            byteOffset,
            observedAt,
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
