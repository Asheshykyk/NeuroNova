import {
  computeCommitmentStructHashHex,
  computeLeafHashHex,
  formatSourceIdHex,
  getProof,
  verifyCommitmentSignature,
  verifyProof,
  type BatchCommitment,
  type EIP712Domain
} from '@trusttrace/core';
import type { EvidenceStore } from '../storage/evidenceStore.ts';
import type { EvidenceBatchManager } from '../batching/EvidenceBatchManager.ts';
import type { EvidenceAnchorClient } from '../blockchain/types.ts';
import type { AnchoringWorker } from '../blockchain/AnchoringWorker.ts';
import type { EvidenceVerificationResult, ReconciliationResult } from './types.ts';

export interface EvidenceVerifierOptions {
  store: EvidenceStore;
  batchManager: EvidenceBatchManager;
  anchorClient: EvidenceAnchorClient | null;
  anchoringWorker?: AnchoringWorker;
  eip712Domain?: EIP712Domain;
  expectedVaultSigner?: string;
}

function sameCommitment(left: BatchCommitment, right: BatchCommitment): boolean {
  return left.sourceId.toLowerCase() === right.sourceId.toLowerCase()
    && left.sequenceStart === right.sequenceStart
    && left.sequenceEnd === right.sequenceEnd
    && left.leafCount === right.leafCount
    && left.merkleRoot.toLowerCase() === right.merkleRoot.toLowerCase()
    && left.previousCheckpointHash.toLowerCase() === right.previousCheckpointHash.toLowerCase();
}

export class EvidenceVerifier {
  private readonly store: EvidenceStore;
  private readonly batchManager: EvidenceBatchManager;
  private readonly anchorClient: EvidenceAnchorClient | null;
  private readonly anchoringWorker: AnchoringWorker | undefined;
  private readonly eip712Domain: EIP712Domain | undefined;
  private readonly expectedVaultSigner: string | undefined;

  constructor(options: EvidenceVerifierOptions) {
    this.store = options.store;
    this.batchManager = options.batchManager;
    this.anchorClient = options.anchorClient;
    this.anchoringWorker = options.anchoringWorker;
    this.eip712Domain = options.eip712Domain;
    this.expectedVaultSigner = options.expectedVaultSigner;
  }

  async verifyEvidence(sourceId: string, vaultSequence: bigint | number | string): Promise<EvidenceVerificationResult> {
    const normalizedSourceId = formatSourceIdHex(sourceId);
    const sequence = BigInt(vaultSequence);
    const persisted = this.store.readPersistedEvidence().find(({ record }) =>
      record.sourceId === normalizedSourceId && BigInt(record.vaultSequence) === sequence
    );

    if (!persisted) {
      return this.result(normalizedSourceId, sequence, null, 'UNVERIFIABLE', 'Evidence record not found in vault JSONL');
    }

    const batch = this.batchManager.listBatchRecords().find((candidate) =>
      candidate.sourceId === normalizedSourceId
      && candidate.evidenceMappings.some((mapping) => BigInt(mapping.vaultSequence) === sequence)
    );

    if (!batch) {
      return this.result(normalizedSourceId, sequence, null, 'VAULT_PERSISTED', 'Evidence is persisted in vault JSONL and is not yet included in a batch');
    }

    const mappingIndex = batch.evidenceMappings.findIndex((mapping) => BigInt(mapping.vaultSequence) === sequence);
    const mapping = batch.evidenceMappings[mappingIndex];
    const leafHash = computeLeafHashHex({
      version: 1,
      sourceId: normalizedSourceId,
      vaultSequence: sequence,
      rawEventBytes: persisted.rawBytes
    });

    if (leafHash !== mapping.leafHash) {
      return this.result(normalizedSourceId, sequence, batch, 'UNVERIFIABLE', 'Evidence bytes do not match the persisted batch mapping');
    }

    const anchoredBatch = await this.batchManager.getBatchForAnchoring(batch.batchId);
    if (!anchoredBatch) {
      return this.result(normalizedSourceId, sequence, batch, 'UNVERIFIABLE', 'Batch cannot be reconstructed');
    }

    const proof = anchoredBatch.proofs[mappingIndex];
    if (!proof || !verifyProof(proof)) {
      return this.result(normalizedSourceId, sequence, batch, 'UNVERIFIABLE', 'Merkle inclusion proof verification failed');
    }

    if (anchoredBatch.signedCommitment && this.eip712Domain) {
      const signed = anchoredBatch.signedCommitment;
      const signer = this.expectedVaultSigner ?? signed.signer;
      if (!verifyCommitmentSignature(this.eip712Domain, anchoredBatch.commitment, signed.signature, signer)) {
        return this.result(normalizedSourceId, sequence, batch, 'UNVERIFIABLE', 'Signed batch commitment verification failed');
      }
    }

    if (!this.anchorClient) {
      const statuses = this.batchManager.listBatchRecords();
      void statuses;
      return this.result(normalizedSourceId, sequence, batch, 'ANCHOR_PENDING', 'Batch exists but no blockchain client is configured');
    }

    try {
      const chainId = await this.anchorClient.chainId();
      if (this.eip712Domain && chainId !== BigInt(this.eip712Domain.chainId)) {
        return this.result(normalizedSourceId, sequence, batch, 'CHAIN_MISMATCH', `Configured chain ID ${this.eip712Domain.chainId} does not match RPC chain ID ${chainId}`);
      }

      const anchored = await this.anchorClient.isBatchAnchored(batch.commitmentHash);
      if (!anchored) {
        return this.result(normalizedSourceId, sequence, batch, 'ANCHOR_PENDING', 'Batch is not confirmed on-chain');
      }

      const chainCommitment = await this.anchorClient.getBatch(batch.commitmentHash);
      if (!chainCommitment) {
        return this.result(normalizedSourceId, sequence, batch, 'UNVERIFIABLE', 'On-chain batch could not be read after isBatchAnchored returned true');
      }
      if (!sameCommitment(anchoredBatch.commitment, chainCommitment)) {
        return this.result(normalizedSourceId, sequence, batch, 'CHAIN_MISMATCH', 'Local commitment differs from the commitment stored on-chain');
      }

      return this.result(normalizedSourceId, sequence, batch, 'ANCHORED', 'Evidence proof, commitment and on-chain confirmation verified');
    } catch (error) {
      return this.result(normalizedSourceId, sequence, batch, 'UNVERIFIABLE', `RPC or blockchain verification unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async reconcile(): Promise<ReconciliationResult[]> {
    if (!this.anchorClient) {
      return this.batchManager.listBatchRecords().map((batch) => {
        const localCommitment = this.localCommitment(batch);
        return {
          batchId: batch.batchId,
          commitmentHash: batch.commitmentHash,
          verdict: 'UNVERIFIABLE' as const,
          localCommitment,
          chainCommitment: null,
          detail: 'No blockchain client is configured'
        };
      });
    }

    const results: ReconciliationResult[] = [];
    for (const batch of this.batchManager.listBatchRecords()) {
      const localCommitment = this.localCommitment(batch);
      try {
        const chainId = await this.anchorClient.chainId();
        if (this.eip712Domain && chainId !== BigInt(this.eip712Domain.chainId)) {
          results.push({ batchId: batch.batchId, commitmentHash: batch.commitmentHash, verdict: 'CHAIN_MISMATCH', localCommitment, chainCommitment: null, detail: 'RPC chain ID differs from the configured EIP-712 chain ID' });
          continue;
        }

        const anchored = await this.anchorClient.isBatchAnchored(batch.commitmentHash);
        if (!anchored) {
          results.push({ batchId: batch.batchId, commitmentHash: batch.commitmentHash, verdict: 'ANCHOR_PENDING', localCommitment, chainCommitment: null, detail: 'Batch is not anchored on-chain' });
          continue;
        }

        const chainCommitment = await this.anchorClient.getBatch(batch.commitmentHash);
        if (!chainCommitment) {
          results.push({ batchId: batch.batchId, commitmentHash: batch.commitmentHash, verdict: 'UNVERIFIABLE', localCommitment, chainCommitment: null, detail: 'On-chain batch could not be read' });
        } else if (!sameCommitment(localCommitment, chainCommitment)) {
          results.push({ batchId: batch.batchId, commitmentHash: batch.commitmentHash, verdict: 'CHAIN_MISMATCH', localCommitment, chainCommitment, detail: 'Local and on-chain commitments differ' });
        } else {
          results.push({ batchId: batch.batchId, commitmentHash: batch.commitmentHash, verdict: 'ANCHORED', localCommitment, chainCommitment, detail: 'Local and on-chain commitments match' });
        }
      } catch (error) {
        results.push({ batchId: batch.batchId, commitmentHash: batch.commitmentHash, verdict: 'UNVERIFIABLE', localCommitment, chainCommitment: null, detail: `RPC or blockchain reconciliation unavailable: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
    return results;
  }

  private localCommitment(batch: ReturnType<EvidenceBatchManager['listBatchRecords']>[number]): BatchCommitment {
    return {
      sourceId: formatSourceIdHex(batch.sourceId),
      sequenceStart: BigInt(batch.sequenceStart),
      sequenceEnd: BigInt(batch.sequenceEnd),
      leafCount: BigInt(batch.leafCount),
      merkleRoot: batch.merkleRoot,
      previousCheckpointHash: batch.previousCheckpointHash
    };
  }

  private result(
    sourceId: string,
    sequence: bigint,
    batch: ReturnType<EvidenceBatchManager['listBatchRecords']>[number] | null,
    verdict: EvidenceVerificationResult['verdict'],
    detail: string
  ): EvidenceVerificationResult {
    const status = batch ? this.anchoringWorker?.getLatestStatuses().get(batch.batchId) : undefined;
    if (batch && status?.status === 'failed' && verdict !== 'ANCHORED' && verdict !== 'CHAIN_MISMATCH') {
      verdict = 'ANCHOR_FAILED';
      detail = status.error ? `Anchoring failed: ${status.error}` : 'Anchoring failed';
    }
    if (batch && status?.status === 'submitted' && verdict !== 'ANCHORED' && verdict !== 'CHAIN_MISMATCH' && verdict !== 'ANCHOR_FAILED') {
      verdict = 'ANCHOR_PENDING';
    }
    return {
      verdict,
      sourceId,
      vaultSequence: sequence.toString(),
      batchId: batch?.batchId ?? null,
      merkleRoot: batch?.merkleRoot ?? null,
      commitmentHash: batch?.commitmentHash ?? null,
      transactionHash: status?.transactionHash ?? null,
      blockNumber: status?.blockNumber ?? null,
      detail
    };
  }
}
