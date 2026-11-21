import type { BatchCommitment } from '@trusttrace/core';

export type VerificationVerdict =
  | 'VAULT_PERSISTED'
  | 'ANCHOR_PENDING'
  | 'ANCHORED'
  | 'ANCHOR_FAILED'
  | 'UNVERIFIABLE'
  | 'CHAIN_MISMATCH';

export interface EvidenceVerificationResult {
  verdict: VerificationVerdict;
  sourceId: string;
  vaultSequence: string;
  batchId: string | null;
  merkleRoot: string | null;
  commitmentHash: string | null;
  transactionHash: string | null;
  blockNumber: string | null;
  detail: string;
}

export interface ReconciliationResult {
  batchId: string;
  commitmentHash: string;
  verdict: 'ANCHORED' | 'ANCHOR_PENDING' | 'ANCHOR_FAILED' | 'UNVERIFIABLE' | 'CHAIN_MISMATCH';
  localCommitment: BatchCommitment;
  chainCommitment: BatchCommitment | null;
  detail: string;
}
