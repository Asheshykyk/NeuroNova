// Temporary declarations for the exports consumed from the source-only core
// package. Runtime imports resolve to the real package via the workspace link.
import type { BatchCommitment, CanonicalEvent, EIP712Domain } from '@trusttrace/core/types';
import type { KeyObject } from 'node:crypto';

export const EvidenceAnchorABI: readonly object[];
export const GENESIS_CHECKPOINT_HASH: string;
export const GENESIS_CHECKPOINT_DIGEST: string;
export interface AgentChunk {
  sourceId: string | Uint8Array | Buffer;
  deliveryId: string;
  payload: Uint8Array | Buffer | string;
  streamId?: string;
  fileIdentity?: string;
  fileGeneration?: string;
  byteOffset?: bigint | number;
  observedAt?: bigint | number;
}
export function encodeAgentChunkPreimage(chunk: AgentChunk): Buffer;
export function parseAgentPublicKey(key: KeyObject | string | Buffer | Uint8Array): KeyObject;
export function verifyAgentChunk(
  chunk: AgentChunk,
  signature: Buffer | Uint8Array | string,
  publicKey: KeyObject | string | Buffer | Uint8Array
): boolean;
export function formatSourceId(sourceId: CanonicalEvent['sourceId']): Buffer;
export function hashLeaf(event: CanonicalEvent): Buffer;
export function computeCommitmentStructHashHex(commitment: BatchCommitment): string;
export function validateSequenceContinuity(previous: BatchCommitment | null, current: BatchCommitment): {
  valid: boolean;
  reason?: string;
};
export function verifyMerkleProof(leaf: Buffer, leafIndex: number, leafCount: number, siblings: string[], root: string): boolean;
export function verifyCommitmentSignature(domain: EIP712Domain, commitment: BatchCommitment, signature: string, signer: string): boolean;
export interface CheckpointInput {
  previousCheckpointDigest: string | Uint8Array | Buffer;
  localChainId: bigint | number;
  localBlockNumber: bigint | number;
  localBlockHash: string | Uint8Array | Buffer;
  latestBatchRoot: string | Uint8Array | Buffer;
  latestSequence: bigint | number;
  contractAddress: string;
}
export function buildCheckpoint(input: CheckpointInput): {
  digest: Buffer;
  digestHex: string;
};
export function checkCheckpoint(checkpoint: CheckpointInput, expectedDigest: string | Uint8Array | Buffer): boolean;
export function verifyCheckpointContinuity(
  current: CheckpointInput,
  previousDigest: string | Uint8Array | Buffer
): boolean;
