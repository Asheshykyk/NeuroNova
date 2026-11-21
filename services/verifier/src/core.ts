import { createHash } from 'node:crypto';
import {
  computeCommitmentStructHashHex, formatSourceId, GENESIS_CHECKPOINT_DIGEST,
  GENESIS_CHECKPOINT_HASH, hashLeaf,
  validateSequenceContinuity, verifyCommitmentSignature, verifyMerkleProof,
  buildCheckpoint, checkCheckpoint, verifyCheckpointContinuity
} from '@trusttrace/core';
import type { BatchCommitment, CanonicalEvent, EIP712Domain } from '@trusttrace/core/types';
import type { StageResult } from './types.js';

export interface EvidenceEvent extends Omit<CanonicalEvent, 'rawEventBytes' | 'vaultSequence'> {
  rawEventBytes: Uint8Array;
  vaultSequence: bigint;
  payloadHash: string;
  siblings: readonly string[];
}

/** Internal inputs for a future approved export adapter. */
export interface BatchEvidence {
  events: readonly EvidenceEvent[];
  commitment: BatchCommitment;
  signature: string;
  commitmentHash: string;
  previousCommitment?: BatchCommitment;
  rawMerkleRoot?: string;
  publicCheckpoint?: {
    previousCheckpointDigest: string;
    localChainId: bigint | number;
    localBlockNumber: bigint | number;
    localBlockHash: string;
    latestBatchRoot: string;
    latestSequence: bigint | number;
    contractAddress: string;
  };
}

export interface TrustedBatchConfig {
  signer: string;
  domain: EIP712Domain;
}

export const bytes32 = /^0x[0-9a-f]{64}$/i;
const address = /^0x[0-9a-f]{40}$/i;
const maxUint64 = (1n << 64n) - 1n;

function uint64(value: bigint): boolean {
  return typeof value === 'bigint' && value >= 0n && value <= maxUint64;
}

export function isCommitment(value: BatchCommitment): boolean {
  return typeof value === 'object' && value !== null
    && typeof value.sourceId === 'string' && bytes32.test(value.sourceId)
    && typeof value.merkleRoot === 'string' && bytes32.test(value.merkleRoot)
    && typeof value.previousCheckpointHash === 'string' && bytes32.test(value.previousCheckpointHash)
    && uint64(value.sequenceStart)
    && uint64(value.sequenceEnd) && uint64(value.leafCount);
}

function unsignedIntegerInRange(value: bigint | number, bits: number, minimum = 0n): boolean {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return false;
  if (typeof value !== 'number' && typeof value !== 'bigint') return false;
  const integer = BigInt(value);
  return integer >= minimum && integer < (1n << BigInt(bits));
}

export function commitmentHash(commitment: BatchCommitment): string {
  return computeCommitmentStructHashHex(commitment).toLowerCase();
}

export function result(stage: StageResult['stage'], message: string, reasonCode?: StageResult['reasonCode'],
  status: StageResult['status'] = 'VERIFIED'): StageResult {
  return { stage, status, message, ...(reasonCode && { reasonCode }) };
}

export function validateRawBytes(evidence: BatchEvidence): StageResult {
  const stage = 'raw-byte-validation';
  if (!Array.isArray(evidence.events) || evidence.events.length === 0) {
    return result(stage, 'No raw events were supplied.', 'REQUIRED_EVIDENCE_MISSING', 'UNVERIFIABLE');
  }
  for (const event of evidence.events) {
    if (!(event.rawEventBytes instanceof Uint8Array) || !bytes32.test(event.payloadHash)
        || !uint64(event.vaultSequence) || !Number.isInteger(event.version) || event.version < 0 || event.version > 255) {
      return result(stage, 'An event is missing supported raw bytes or metadata.', 'REQUIRED_EVIDENCE_MISSING', 'UNVERIFIABLE');
    }
    const digest = '0x' + createHash('sha256').update(event.rawEventBytes).digest('hex');
    if (digest !== event.payloadHash.toLowerCase()) {
      return result(stage, 'Preserved event bytes differ from the recorded payload hash.', 'PAYLOAD_HASH_MISMATCH', 'TAMPERED');
    }
  }
  return result(stage, 'Preserved event payload hashes match.');
}

export function matchCommitment(evidence: BatchEvidence): StageResult {
  const stage = 'commitment-matching';
  const { commitment, previousCommitment } = evidence;
  if (!isCommitment(commitment) || !bytes32.test(evidence.commitmentHash)
      || (previousCommitment && !isCommitment(previousCommitment))) {
    return result(stage, 'Commitment fields are missing or malformed.', 'REQUIRED_EVIDENCE_MISSING', 'UNVERIFIABLE');
  }
  const { sequenceStart, sequenceEnd, leafCount } = commitment;
  if (sequenceStart === 0n || sequenceEnd < sequenceStart || leafCount !== sequenceEnd - sequenceStart + 1n) {
    return result(stage, 'Commitment range or leaf count is not supported.', 'BUNDLE_FORMAT_UNSUPPORTED', 'UNVERIFIABLE');
  }
  if (sequenceStart > 1n && !previousCommitment) {
    return result(stage, 'The preceding source-local commitment is required to verify continuity.', 'REQUIRED_EVIDENCE_MISSING', 'UNVERIFIABLE');
  }
  if ((previousCommitment && commitment.previousCheckpointHash.toLowerCase() !== commitmentHash(previousCommitment))
      || (!previousCommitment && sequenceStart === 1n
        && commitment.previousCheckpointHash.toLowerCase() !== GENESIS_CHECKPOINT_HASH.toLowerCase())) {
    return result(stage, 'The signed previous-commitment hash does not match its required predecessor.', 'COMMITMENT_MISMATCH', 'TAMPERED');
  }
  const continuity = validateSequenceContinuity(previousCommitment ?? null, commitment).valid;
  if (!continuity) {
    return result(stage, 'Source-local commitment continuity cannot be established from the supplied sequence.', 'REQUIRED_EVIDENCE_MISSING', 'UNVERIFIABLE');
  }
  if (commitmentHash(commitment) !== evidence.commitmentHash.toLowerCase()) {
    return result(stage, 'Commitment fields, continuity reference, or struct hash disagree.', 'COMMITMENT_MISMATCH', 'TAMPERED');
  }
  return result(stage, 'Commitment fields and struct hash match.');
}

export function verifyMerkle(evidence: BatchEvidence): StageResult {
  const stage = 'merkle-verification';
  const { commitment } = evidence;
  if (!Array.isArray(evidence.events) || evidence.events.length === 0) {
    return result(stage, 'No event inclusion proofs were supplied.', 'REQUIRED_EVIDENCE_MISSING', 'UNVERIFIABLE');
  }
  if (!evidence.rawMerkleRoot || !bytes32.test(evidence.rawMerkleRoot)) {
    return result(stage, 'The separate raw-event Merkle root is missing.', 'REQUIRED_EVIDENCE_MISSING', 'UNVERIFIABLE');
  }
  if (commitment.leafCount > BigInt(Number.MAX_SAFE_INTEGER)) {
    return result(stage, 'Batch exceeds supported proof geometry.', 'BUNDLE_FORMAT_UNSUPPORTED', 'UNVERIFIABLE');
  }
  const seen = new Set<bigint>();
  for (const event of evidence.events) {
    let sourceId: string;
    let leaf: Buffer;
    try {
      sourceId = '0x' + formatSourceId(event.sourceId).toString('hex');
      leaf = hashLeaf(event);
    } catch {
      return result(stage, 'Event canonical encoding is unavailable.', 'BUNDLE_FORMAT_UNSUPPORTED', 'UNVERIFIABLE');
    }
    const sequence = event.vaultSequence;
    if (!Array.isArray(event.siblings) || (event.siblings.length === 0 && commitment.leafCount !== 1n)) {
      return result(stage, 'An inclusion proof is missing.', 'REQUIRED_EVIDENCE_MISSING', 'UNVERIFIABLE');
    }
    if (!event.siblings.every((hash: unknown) => typeof hash === 'string' && bytes32.test(hash))) {
      return result(stage, 'Inclusion proof is missing or malformed.', 'REQUIRED_EVIDENCE_MISSING', 'UNVERIFIABLE');
    }
    if (seen.has(sequence)) {
      return result(stage, 'The same sequence was supplied more than once.', 'BUNDLE_FORMAT_UNSUPPORTED', 'UNVERIFIABLE');
    }
    if (sourceId !== commitment.sourceId.toLowerCase() || sequence < commitment.sequenceStart || sequence > commitment.sequenceEnd
        || !verifyMerkleProof(leaf, Number(sequence - commitment.sequenceStart), Number(commitment.leafCount),
          [...event.siblings], evidence.rawMerkleRoot)) {
      return result(stage, 'Event does not match the committed source, sequence, or Merkle root.', 'PROOF_INVALID', 'TAMPERED');
    }
    seen.add(sequence);
  }
  const orderedSequences = [...seen].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  for (let index = 1; index < orderedSequences.length; index += 1) {
    if (orderedSequences[index] !== orderedSequences[index - 1] + 1n) {
      return result(stage, 'Supplied event proofs omit a source-local sequence; completeness cannot be established.', 'REQUIRED_EVIDENCE_MISSING', 'UNVERIFIABLE');
    }
  }
  return result(stage, 'Canonical event leaves match their inclusion proofs.');
}

export function verifyPublicCheckpoint(evidence: BatchEvidence): StageResult {
  const stage = 'public-checkpoint-verification';
  if (!evidence.publicCheckpoint) {
    return result(stage, 'Public checkpoint linkage evidence is missing.', 'REQUIRED_EVIDENCE_MISSING', 'UNVERIFIABLE');
  }
  const checkpoint = evidence.publicCheckpoint;
  if (!evidence.rawMerkleRoot || !bytes32.test(evidence.rawMerkleRoot)
      || !bytes32.test(checkpoint.previousCheckpointDigest)
      || !bytes32.test(checkpoint.localBlockHash)
      || !bytes32.test(checkpoint.latestBatchRoot)
      || !address.test(checkpoint.contractAddress)
      || !unsignedIntegerInRange(checkpoint.localChainId, 256, 1n)
      || !unsignedIntegerInRange(checkpoint.localBlockNumber, 64)
      || !unsignedIntegerInRange(checkpoint.latestSequence, 64, 1n)) {
    return result(stage, 'Public checkpoint evidence is missing or malformed.', 'REQUIRED_EVIDENCE_MISSING', 'UNVERIFIABLE');
  }
  if (checkpoint.latestBatchRoot.toLowerCase() !== evidence.rawMerkleRoot.toLowerCase()
      || BigInt(checkpoint.latestSequence) !== evidence.commitment.sequenceEnd) {
    return result(stage, 'Public checkpoint does not link the local batch evidence.', 'COMMITMENT_MISMATCH', 'TAMPERED');
  }
  try {
    const checkpointInput = { ...checkpoint, latestBatchRoot: evidence.rawMerkleRoot };
    const previousCheckpointDigest = evidence.previousCommitment?.merkleRoot ?? GENESIS_CHECKPOINT_DIGEST;
    if (!verifyCheckpointContinuity(checkpointInput, previousCheckpointDigest)) {
      return result(stage, 'Public checkpoint does not link to the preceding checkpoint digest.', 'COMMITMENT_MISMATCH', 'TAMPERED');
    }
    const resultValue = buildCheckpoint(checkpointInput);
    if (!checkCheckpoint(checkpointInput, evidence.commitment.merkleRoot)) {
      return result(stage, 'Public checkpoint digest differs from the committed BatchCommitment root.', 'COMMITMENT_MISMATCH', 'TAMPERED');
    }
    return result(stage, `Canonical public checkpoint digest matches the committed root: ${resultValue.digestHex}`);
  } catch {
    return result(stage, 'Public checkpoint fields cannot be safely normalized.', 'BUNDLE_FORMAT_UNSUPPORTED', 'UNVERIFIABLE');
  }
}

export function verifyVaultSignature(evidence: BatchEvidence, trusted?: TrustedBatchConfig): StageResult {
  const stage = 'vault-signature';
  if (!isCommitment(evidence.commitment)) {
    return result(stage, 'A supported BatchCommitment is required before signature verification.', 'REQUIRED_EVIDENCE_MISSING', 'UNVERIFIABLE');
  }
  const domain = trusted?.domain;
  const chainId = domain?.chainId;
  if (!trusted || typeof trusted.signer !== 'string' || !domain
      || typeof domain.name !== 'string' || !domain.name
      || typeof domain.version !== 'string' || !domain.version
      || typeof domain.verifyingContract !== 'string' || !address.test(trusted.signer)
      || /^0x0{40}$/i.test(trusted.signer)
      || !address.test(domain.verifyingContract) || /^0x0{40}$/i.test(domain.verifyingContract)
      || (typeof chainId !== 'number' && typeof chainId !== 'bigint')
      || (typeof chainId === 'number' && (!Number.isSafeInteger(chainId) || chainId <= 0))
      || (typeof chainId === 'bigint' && (chainId <= 0n || chainId >= (1n << 256n)))) {
    return result(stage, 'An independently trusted Vault signer and deployment domain are required.', 'TRUSTED_CONFIG_MISSING', 'UNVERIFIABLE');
  }
  if (typeof evidence.signature !== 'string' || !evidence.signature) {
    return result(stage, 'Vault signature is missing.', 'REQUIRED_EVIDENCE_MISSING', 'UNVERIFIABLE');
  }
  if (!/^0x[0-9a-f]{130}$/i.test(evidence.signature)
      || !verifyCommitmentSignature(domain, evidence.commitment, evidence.signature, trusted.signer)) {
    return result(stage, 'Vault signature does not match the trusted signer and domain.', 'SIGNATURE_INVALID', 'TAMPERED');
  }
  return result(stage, 'Vault EIP-712 signature matches the trusted signer and domain.');
}
