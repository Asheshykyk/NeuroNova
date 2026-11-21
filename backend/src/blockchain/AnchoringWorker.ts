import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import type { EvidenceBatchManager } from '../batching/EvidenceBatchManager.ts';
import type { EvidenceAnchorClient, AnchorStatusRecord } from './types.ts';

const LOCK_STALE_MS = 120_000;
const LOCK_UPDATE_MS = 30_000;

export interface AnchoringWorkerOptions {
  directory: string;
  batchManager: EvidenceBatchManager;
  client: EvidenceAnchorClient;
  maxAttempts?: number;
  now?: () => Date;
}

export class AnchoringWorker {
  private readonly directory: string;
  private readonly statusDirectory: string;
  private readonly statusFile: string;
  private readonly batchManager: EvidenceBatchManager;
  private readonly client: EvidenceAnchorClient;
  private readonly maxAttempts: number;
  private readonly now: () => Date;

  constructor(options: AnchoringWorkerOptions) {
    this.directory = path.resolve(options.directory);
    this.statusDirectory = path.join(this.directory, 'batches');
    this.statusFile = path.join(this.statusDirectory, 'anchor-status.jsonl');
    this.batchManager = options.batchManager;
    this.client = options.client;
    this.maxAttempts = options.maxAttempts ?? 5;
    if (!Number.isSafeInteger(this.maxAttempts) || this.maxAttempts < 1) {
      throw new RangeError('maxAttempts must be a positive integer');
    }
    this.now = options.now ?? (() => new Date());
    fs.mkdirSync(this.statusDirectory, { recursive: true });
  }

  listStatuses(): AnchorStatusRecord[] {
    this.repairStatusTail();
    return this.readStatusRecords();
  }

  async processEligibleBatches(): Promise<AnchorStatusRecord[]> {
    const release = await lockfile.lock(this.directory, {
      retries: { retries: 20, minTimeout: 50, maxTimeout: 500 },
      stale: LOCK_STALE_MS,
      update: LOCK_UPDATE_MS,
      realpath: false
    });

    try {
      const chainId = await this.client.chainId();
      const latest = this.getLatestStatuses();
      const updated: AnchorStatusRecord[] = [];

      for (const batch of this.batchManager.listBatchRecords()) {
        const previous = latest.get(batch.batchId);
        if (previous?.status === 'confirmed') continue;

        const anchored = await this.client.isBatchAnchored(batch.commitmentHash);
        if (anchored) {
          const record = await this.appendStatus({
            batchId: batch.batchId,
            commitmentHash: batch.commitmentHash,
            status: 'confirmed',
            chainId: chainId.toString(),
            transactionHash: previous?.transactionHash ?? null,
            blockNumber: previous?.blockNumber ?? null,
            attempt: previous?.attempt ?? 0,
            error: null
          });
          latest.set(batch.batchId, record);
          updated.push(record);
          continue;
        }

        if (previous?.status === 'submitted' && previous.transactionHash) {
          const receipt = await this.client.getTransactionReceipt(previous.transactionHash);
          if (!receipt) continue;
          if (receipt.status === 1) {
            const record = await this.appendStatus({
              batchId: batch.batchId,
              commitmentHash: batch.commitmentHash,
              status: 'confirmed',
              chainId: chainId.toString(),
              transactionHash: previous.transactionHash,
              blockNumber: receipt.blockNumber?.toString() ?? null,
              attempt: previous.attempt,
              error: null
            });
            latest.set(batch.batchId, record);
            updated.push(record);
          } else if (receipt.status === 0) {
            const record = await this.appendStatus({
              batchId: batch.batchId,
              commitmentHash: batch.commitmentHash,
              status: 'failed',
              chainId: chainId.toString(),
              transactionHash: previous.transactionHash,
              blockNumber: receipt.blockNumber?.toString() ?? null,
              attempt: previous.attempt,
              error: 'Transaction reverted'
            });
            latest.set(batch.batchId, record);
            updated.push(record);
          }
          continue;
        }

        if (previous?.status === 'failed' && previous.attempt >= this.maxAttempts) continue;

        const attempt = (previous?.attempt ?? 0) + 1;
        const batchForAnchoring = await this.batchManager.getBatchForAnchoring(batch.batchId);
        if (!batchForAnchoring?.signedCommitment) {
          const record = await this.appendStatus({
            batchId: batch.batchId,
            commitmentHash: batch.commitmentHash,
            status: 'failed',
            chainId: chainId.toString(),
            transactionHash: null,
            blockNumber: null,
            attempt,
            error: 'Vault signature is required before anchoring'
          });
          latest.set(batch.batchId, record);
          updated.push(record);
          continue;
        }

        try {
          const transaction = await this.client.submitBatch(
            batchForAnchoring.commitment,
            batchForAnchoring.signedCommitment.signature
          );
          const record = await this.appendStatus({
            batchId: batch.batchId,
            commitmentHash: batch.commitmentHash,
            status: 'submitted',
            chainId: chainId.toString(),
            transactionHash: transaction.transactionHash,
            blockNumber: null,
            attempt,
            error: null
          });
          latest.set(batch.batchId, record);
          updated.push(record);
        } catch (error) {
          const record = await this.appendStatus({
            batchId: batch.batchId,
            commitmentHash: batch.commitmentHash,
            status: 'failed',
            chainId: chainId.toString(),
            transactionHash: null,
            blockNumber: null,
            attempt,
            error: error instanceof Error ? error.message : String(error)
          });
          latest.set(batch.batchId, record);
          updated.push(record);
        }
      }

      return updated;
    } finally {
      await release();
    }
  }

  getLatestStatuses(): Map<string, AnchorStatusRecord> {
    const latest = new Map<string, AnchorStatusRecord>();
    for (const record of this.listStatuses()) latest.set(record.batchId, record);
    return latest;
  }

  private repairStatusTail(): void {
    if (!fs.existsSync(this.statusFile)) return;
    const bytes = fs.readFileSync(this.statusFile);
    const newline = bytes.lastIndexOf(0x0a);
    if (newline === bytes.length - 1) return;
    fs.truncateSync(this.statusFile, newline < 0 ? 0 : newline + 1);
  }

  private readStatusRecords(): AnchorStatusRecord[] {
    if (!fs.existsSync(this.statusFile)) return [];
    const records: AnchorStatusRecord[] = [];
    const bytes = fs.readFileSync(this.statusFile);
    let offset = 0;
    while (offset < bytes.length) {
      const newline = bytes.indexOf(0x0a, offset);
      if (newline < 0) throw new Error(`Incomplete anchor status JSONL line in ${this.statusFile}`);
      const line = bytes.subarray(offset, newline);
      if (line.length > 0) {
        const parsed = JSON.parse(line.toString('utf8')) as AnchorStatusRecord;
        if (parsed.recordVersion !== 1 || parsed.recordType !== 'anchor_status') {
          throw new Error('Invalid anchor status record');
        }
        records.push(parsed);
      }
      offset = newline + 1;
    }
    return records;
  }

  private async appendStatus(input: Omit<AnchorStatusRecord, 'recordVersion' | 'recordType' | 'updatedAt'>): Promise<AnchorStatusRecord> {
    const record: AnchorStatusRecord = {
      recordVersion: 1,
      recordType: 'anchor_status',
      ...input,
      updatedAt: this.now().toISOString()
    };
    const line = Buffer.from(JSON.stringify(record) + '\n', 'utf8');
    const handle = await fsPromises.open(this.statusFile, 'a');
    try {
      let offset = 0;
      while (offset < line.length) {
        const written = await handle.write(line, offset, line.length - offset, null);
        if (written.bytesWritten === 0) throw new Error('Failed to append anchor status JSONL record');
        offset += written.bytesWritten;
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
    return record;
  }
}
