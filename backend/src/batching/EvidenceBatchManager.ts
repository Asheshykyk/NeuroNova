import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import {
  buildMerkleTree,
  computeCommitmentStructHashHex,
  computeLeafHashHex,
  formatSourceIdHex,
  GENESIS_CHECKPOINT_HASH,
  getProof,
  signBatchCommitment,
  verifyCommitmentSignature,
  type BatchCommitment,
  type EIP712Domain,
  type MerkleProof,
  type SignedBatchCommitment
} from '@trusttrace/core';
import type { EvidenceStore } from '../storage/evidenceStore.ts';
import type { EvidenceBatchManagerOptions, EvidenceBatchRecord, AnchoringBatch } from './types.ts';

const DEFAULT_BATCH_MAX_LEAVES = 256;
const LOCK_STALE_MS = 120_000;
const LOCK_UPDATE_MS = 30_000;

export class EvidenceBatchManager {
  private readonly store: EvidenceStore;
  private readonly evidenceDirectory: string;
  private readonly batchDirectory: string;
  private readonly batchFile: string;
  private readonly batchMaxLeaves: number;
  private readonly vaultSignerPrivateKey: string | Buffer | undefined;
  private readonly eip712Domain: EIP712Domain | undefined;
  private readonly now: () => Date;

  constructor(store: EvidenceStore, options: EvidenceBatchManagerOptions) {
    if (!Number.isSafeInteger(options.batchMaxLeaves ?? DEFAULT_BATCH_MAX_LEAVES) || (options.batchMaxLeaves ?? DEFAULT_BATCH_MAX_LEAVES) < 1) {
      throw new RangeError('batchMaxLeaves must be a positive integer');
    }
    this.store = store;
    this.evidenceDirectory = path.resolve(options.directory);
    this.batchDirectory = path.join(this.evidenceDirectory, 'batches');
    this.batchFile = path.join(this.batchDirectory, 'batches.jsonl');
    this.batchMaxLeaves = options.batchMaxLeaves ?? DEFAULT_BATCH_MAX_LEAVES;
    this.vaultSignerPrivateKey = options.vaultSignerPrivateKey;
    this.eip712Domain = options.eip712Domain;
    this.now = options.now ?? (() => new Date());
    fs.mkdirSync(this.batchDirectory, { recursive: true });
  }

  async generateNextBatches(): Promise<EvidenceBatchRecord[]> {
    const release = await lockfile.lock(this.evidenceDirectory, {
      retries: { retries: 20, minTimeout: 50, maxTimeout: 500 },
      stale: LOCK_STALE_MS,
      update: LOCK_UPDATE_MS,
      realpath: false
    });

    try {
      this.repairBatchFileTail();
      const existing = this.readBatchRecords();
      const persisted = this.store.readPersistedEvidence();
      const mappedSequences = new Map<string, Set<bigint>>();
      const lastBatchBySource = new Map<string, EvidenceBatchRecord>();

      for (const batch of existing) {
        lastBatchBySource.set(batch.sourceId, batch);
        if (!mappedSequences.has(batch.sourceId)) mappedSequences.set(batch.sourceId, new Set());
        for (const mapping of batch.evidenceMappings) {
          mappedSequences.get(batch.sourceId)?.add(BigInt(mapping.vaultSequence));
        }
      }

      const evidenceBySource = new Map<string, Array<{ record: typeof persisted[number]['record']; rawBytes: Buffer }>>();
      for (const item of persisted) {
        if (!evidenceBySource.has(item.record.sourceId)) evidenceBySource.set(item.record.sourceId, []);
        evidenceBySource.get(item.record.sourceId)?.push(item);
      }

      const created: EvidenceBatchRecord[] = [];
      const sourceIds = Array.from(evidenceBySource.keys()).sort();
      for (const sourceId of sourceIds) {
        const mapped = mappedSequences.get(sourceId) ?? new Set<bigint>();
        const unbatched = (evidenceBySource.get(sourceId) ?? [])
          .filter(({ record }) => !mapped.has(BigInt(record.vaultSequence)))
          .sort((a, b) => BigInt(a.record.vaultSequence) < BigInt(b.record.vaultSequence) ? -1 : 1);

        if (unbatched.length === 0) continue;

        let expectedSequence = lastBatchBySource.get(sourceId)
          ? BigInt(lastBatchBySource.get(sourceId)!.sequenceEnd) + 1n
          : 1n;
        let previousCheckpointHash = lastBatchBySource.get(sourceId)?.commitmentHash ?? GENESIS_CHECKPOINT_HASH;

        while (unbatched.some(({ record }) => BigInt(record.vaultSequence) === expectedSequence)) {
          const batchItems = unbatched
            .filter(({ record }) => {
              const sequence = BigInt(record.vaultSequence);
              return sequence >= expectedSequence && sequence < expectedSequence + BigInt(this.batchMaxLeaves);
            })
            .slice(0, this.batchMaxLeaves);

          if (batchItems.length === 0) break;
          if (BigInt(batchItems[0].record.vaultSequence) !== expectedSequence) break;

          const leafHashes: Buffer[] = [];
          const mappings: { vaultSequence: string; leafHash: string }[] = [];
          for (const item of batchItems) {
            const sequence = BigInt(item.record.vaultSequence);
            if (sequence !== expectedSequence + BigInt(mappings.length)) break;
            const leafHash = computeLeafHashHex({
              version: 1,
              sourceId,
              vaultSequence: sequence,
              rawEventBytes: item.rawBytes
            });
            leafHashes.push(Buffer.from(leafHash.slice(2), 'hex'));
            mappings.push({ vaultSequence: sequence.toString(), leafHash });
          }

          if (leafHashes.length !== batchItems.length) break;

          const sequenceStart = BigInt(batchItems[0].record.vaultSequence);
          const sequenceEnd = BigInt(batchItems[batchItems.length - 1].record.vaultSequence);
          const tree = buildMerkleTree(leafHashes);
          const merkleRoot = '0x' + tree.root.toString('hex');
          const commitment: BatchCommitment = {
            sourceId: formatSourceIdHex(sourceId),
            sequenceStart,
            sequenceEnd,
            leafCount: BigInt(leafHashes.length),
            merkleRoot,
            previousCheckpointHash
          };
          const commitmentHash = computeCommitmentStructHashHex(commitment);
          let signedCommitment: SignedBatchCommitment | null = null;
          if (this.vaultSignerPrivateKey && this.eip712Domain) {
            signedCommitment = signBatchCommitment(this.vaultSignerPrivateKey, this.eip712Domain, commitment);
          }

          const batchId = commitmentHash;
          const record: EvidenceBatchRecord = {
            recordVersion: 1,
            recordType: 'batch',
            batchId,
            sourceId,
            sequenceStart: sequenceStart.toString(),
            sequenceEnd: sequenceEnd.toString(),
            leafCount: leafHashes.length.toString(),
            merkleRoot,
            previousCheckpointHash,
            commitmentHash,
            evidenceMappings: mappings,
            createdAt: this.now().toISOString()
          };

          await this.appendBatchRecord(record);
          existing.push(record);
          created.push(record);
          for (const mapping of mappings) mapped.add(BigInt(mapping.vaultSequence));
          previousCheckpointHash = commitmentHash;
          expectedSequence = sequenceEnd + 1n;
        }
      }

      return created;
    } finally {
      await release();
    }
  }

  listBatchRecords(): EvidenceBatchRecord[] {
    this.repairBatchFileTail();
    return this.readBatchRecords();
  }

  async getBatchForAnchoring(batchId: string): Promise<AnchoringBatch | null> {
    const batch = this.listBatchRecords().find((record) => record.batchId === batchId);
    if (!batch) return null;

    const persisted = this.store.readPersistedEvidence();
    const rawBySequence = new Map(persisted
      .filter(({ record }) => record.sourceId === batch.sourceId)
      .map(({ record, rawBytes }) => [BigInt(record.vaultSequence), { record, rawBytes }]));

    const leafHashes: Buffer[] = [];
    const proofs: MerkleProof[] = [];
    for (let index = 0; index < batch.evidenceMappings.length; index += 1) {
      const mapping = batch.evidenceMappings[index];
      const item = rawBySequence.get(BigInt(mapping.vaultSequence));
      if (!item) throw new Error(`Evidence missing for batch ${batchId} at sequence ${mapping.vaultSequence}`);
      const leafHash = computeLeafHashHex({
        version: 1,
        sourceId: batch.sourceId,
        vaultSequence: BigInt(mapping.vaultSequence),
        rawEventBytes: item.rawBytes
      });
      if (leafHash !== mapping.leafHash) throw new Error(`Evidence leaf mismatch for batch ${batchId} at sequence ${mapping.vaultSequence}`);
      leafHashes.push(Buffer.from(leafHash.slice(2), 'hex'));
    }

    const tree = buildMerkleTree(leafHashes);
    if ('0x' + tree.root.toString('hex') !== batch.merkleRoot) {
      throw new Error(`Merkle root mismatch while reconstructing batch ${batchId}`);
    }
    for (let index = 0; index < leafHashes.length; index += 1) {
      proofs.push(getProof(tree.layers, index));
    }

    const commitment: BatchCommitment = {
      sourceId: formatSourceIdHex(batch.sourceId),
      sequenceStart: BigInt(batch.sequenceStart),
      sequenceEnd: BigInt(batch.sequenceEnd),
      leafCount: BigInt(batch.leafCount),
      merkleRoot: batch.merkleRoot,
      previousCheckpointHash: batch.previousCheckpointHash
    };
    const commitmentHash = computeCommitmentStructHashHex(commitment);
    if (commitmentHash !== batch.commitmentHash) throw new Error(`Commitment mismatch while reconstructing batch ${batchId}`);

    let signedCommitment: SignedBatchCommitment | null = null;
    if (this.vaultSignerPrivateKey && this.eip712Domain) {
      signedCommitment = signBatchCommitment(this.vaultSignerPrivateKey, this.eip712Domain, commitment);
      if (!verifyCommitmentSignature(this.eip712Domain, commitment, signedCommitment.signature, signedCommitment.signer)) {
        throw new Error(`Signed commitment verification failed for batch ${batchId}`);
      }
    }

    return { commitment, batchId, signedCommitment, proofs };
  }

  private repairBatchFileTail(): void {
    if (!fs.existsSync(this.batchFile)) return;
    const bytes = fs.readFileSync(this.batchFile);
    const newline = bytes.lastIndexOf(0x0a);
    if (newline === bytes.length - 1) return;
    fs.truncateSync(this.batchFile, newline < 0 ? 0 : newline + 1);
  }

  private readBatchRecords(): EvidenceBatchRecord[] {
    if (!fs.existsSync(this.batchFile)) return [];
    const records: EvidenceBatchRecord[] = [];
    const bytes = fs.readFileSync(this.batchFile);
    let offset = 0;
    while (offset < bytes.length) {
      const newline = bytes.indexOf(0x0a, offset);
      if (newline < 0) throw new Error(`Incomplete batch JSONL line in ${this.batchFile}`);
      const line = bytes.subarray(offset, newline);
      if (line.length > 0) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line.toString('utf8'));
        } catch (error) {
          throw new Error(`Invalid batch JSONL record in ${this.batchFile}`, { cause: error });
        }
        records.push(this.validateBatchRecord(parsed));
      }
      offset = newline + 1;
    }
    return records;
  }

  private validateBatchRecord(value: unknown): EvidenceBatchRecord {
    if (typeof value !== 'object' || value === null) throw new Error('Invalid batch record: expected an object');
    const record = value as Partial<EvidenceBatchRecord>;
    if (record.recordVersion !== 1 || record.recordType !== 'batch') throw new Error('Invalid batch record: unsupported record type');
    for (const field of ['batchId', 'sourceId', 'sequenceStart', 'sequenceEnd', 'leafCount', 'merkleRoot', 'previousCheckpointHash', 'commitmentHash', 'createdAt'] as const) {
      if (typeof record[field] !== 'string') throw new Error(`Invalid batch record: ${field} must be a string`);
    }
    if (!/^\d+$/.test(record.sequenceStart!) || !/^\d+$/.test(record.sequenceEnd!) || !/^\d+$/.test(record.leafCount!)) {
      throw new Error('Invalid batch record: sequence and leaf count fields must be decimal strings');
    }
    if (!/^0x[0-9a-f]{64}$/.test(record.merkleRoot!) || !/^0x[0-9a-f]{64}$/.test(record.commitmentHash!) || !/^0x[0-9a-f]{64}$/.test(record.previousCheckpointHash!)) {
      throw new Error('Invalid batch record: hashes must be 32-byte hex strings');
    }
    if (!Array.isArray(record.evidenceMappings)) throw new Error('Invalid batch record: evidenceMappings must be an array');
    for (const mapping of record.evidenceMappings) {
      if (!mapping || typeof mapping.vaultSequence !== 'string' || !/^\d+$/.test(mapping.vaultSequence) || typeof mapping.leafHash !== 'string') {
        throw new Error('Invalid batch record: invalid evidence mapping');
      }
      if (!/^0x[0-9a-f]{64}$/.test(mapping.leafHash)) throw new Error('Invalid batch record: invalid leaf hash');
    }
    return record as EvidenceBatchRecord;
  }

  private async appendBatchRecord(record: EvidenceBatchRecord): Promise<void> {
    const line = Buffer.from(JSON.stringify(record) + '\n', 'utf8');
    const handle = await fsPromises.open(this.batchFile, 'a');
    try {
      let offset = 0;
      while (offset < line.length) {
        const written = await handle.write(line, offset, line.length - offset, null);
        if (written.bytesWritten === 0) throw new Error('Failed to append batch JSONL record');
        offset += written.bytesWritten;
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}
