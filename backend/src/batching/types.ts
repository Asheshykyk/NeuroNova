import type { BatchCommitment, MerkleProof, SignedBatchCommitment } from '@trusttrace/core';

export interface EvidenceBatchEvidenceMapping {
  vaultSequence: string;
  leafHash: string;
}

export interface EvidenceBatchRecord {
  recordVersion: 1;
  recordType: 'batch';
  batchId: string;
  sourceId: string;
  sequenceStart: string;
  sequenceEnd: string;
  leafCount: string;
  merkleRoot: string;
  previousCheckpointHash: string;
  commitmentHash: string;
  evidenceMappings: EvidenceBatchEvidenceMapping[];
  createdAt: string;
}

export interface AnchoringBatch {
  commitment: BatchCommitment;
  batchId: string;
  signedCommitment: SignedBatchCommitment | null;
  proofs: MerkleProof[];
}

export interface EvidenceBatchManagerOptions {
  directory: string;
  batchMaxLeaves?: number;
  vaultSignerPrivateKey?: string | Buffer;
  eip712Domain?: {
    name: string;
    version: string;
    chainId: bigint | number;
    verifyingContract: string;
  };
  now?: () => Date;
}
