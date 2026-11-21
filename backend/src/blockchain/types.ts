import type { BatchCommitment } from '@trusttrace/core';

export type AnchorStatus = 'submitted' | 'confirmed' | 'failed';

export interface AnchorStatusRecord {
  recordVersion: 1;
  recordType: 'anchor_status';
  batchId: string;
  commitmentHash: string;
  status: AnchorStatus;
  chainId: string;
  transactionHash: string | null;
  blockNumber: string | null;
  updatedAt: string;
  attempt: number;
  error: string | null;
}

export interface AnchorReceipt {
  transactionHash: string;
  blockNumber: bigint | null;
  status: number | null;
}

export interface AnchoringTransaction {
  transactionHash: string;
}

export interface EvidenceAnchorClient {
  chainId(): Promise<bigint>;
  isBatchAnchored(commitmentHash: string): Promise<boolean>;
  getBatch(commitmentHash: string): Promise<BatchCommitment | null>;
  submitBatch(commitment: BatchCommitment, signature: string): Promise<AnchoringTransaction>;
  getTransactionReceipt(transactionHash: string): Promise<AnchorReceipt | null>;
}
