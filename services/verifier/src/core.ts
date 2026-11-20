import { createHash } from 'node:crypto';
import {
  computeCommitmentStructHashHex, formatSourceId, GENESIS_CHECKPOINT_HASH, hashLeaf,
  validateSequenceContinuity, verifyCommitmentSignature, verifyMerkleProof
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
  return bytes32.test(value.sourceId) && bytes32.test(value.merkleRoot)
    && bytes32.test(value.previousCheckpointHash) && uint64(value.sequenceStart)
    && uint64(value.sequenceEnd) && uint64(value.leafCount);
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
  if (evidence.events.length === 0) {
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
  const { sequenceStart, sequenceEnd, leafCount, previousCheckpointHash } = commitment;
  const continuity = previousCommitment || sequenceStart === 1n
    ? validateSequenceContinuity(previousCommitment ?? null, commitment).valid
    : previousCheckpointHash.toLowerCase() !== GENESIS_CHECKPOINT_HASH;
  if (sequenceStart === 0n || sequenceEnd < sequenceStart || leafCount !== sequenceEnd - sequenceStart + 1n
      || !continuity || commitmentHash(commitment) !== evidence.commitmentHash.toLowerCase()) {
    return result(stage, 'Commitment fields, continuity reference, or struct hash disagree.', 'COMMITMENT_MISMATCH', 'TAMPERED');
  }
  return result(stage, 'Commitment fields and struct hash match.');
}

export function verifyMerkle(evidence: BatchEvidence): StageResult {
  const stage = 'merkle-verification';
  const { commitment } = evidence;
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
    if (!Array.isArray(event.siblings) || !event.siblings.every((hash) => bytes32.test(hash))) {
      return result(stage, 'Inclusion proof is missing or malformed.', 'REQUIRED_EVIDENCE_MISSING', 'UNVERIFIABLE');
    }
    if (seen.has(sequence)) {
      return result(stage, 'The same sequence was supplied more than once.', 'BUNDLE_FORMAT_UNSUPPORTED', 'UNVERIFIABLE');
    }
    if (sourceId !== commitment.sourceId.toLowerCase() || sequence < commitment.sequenceStart || sequence > commitment.sequenceEnd
        || !verifyMerkleProof(leaf, Number(sequence - commitment.sequenceStart), Number(commitment.leafCount),
          [...event.siblings], commitment.merkleRoot)) {
      return result(stage, 'Event does not match the committed source, sequence, or Merkle root.', 'PROOF_INVALID', 'TAMPERED');
    }
    seen.add(sequence);
  }
  return result(stage, 'Canonical event leaves match their inclusion proofs.');
}

export function verifyVaultSignature(evidence: BatchEvidence, trusted?: TrustedBatchConfig): StageResult {
  const stage = 'vault-signature';
  if (!trusted || !address.test(trusted.signer) || /^0x0{40}$/i.test(trusted.signer)
      || !address.test(trusted.domain.verifyingContract) || /^0x0{40}$/i.test(trusted.domain.verifyingContract)
      || !trusted.domain.name || !trusted.domain.version
      || (typeof trusted.domain.chainId === 'number' && !Number.isSafeInteger(trusted.domain.chainId))
      || trusted.domain.chainId <= 0 || trusted.domain.chainId >= (1n << 256n)) {
    return result(stage, 'An independently trusted Vault signer and deployment domain are required.', 'TRUSTED_CONFIG_MISSING', 'UNVERIFIABLE');
  }
  if (!evidence.signature) {
    return result(stage, 'Vault signature is missing.', 'REQUIRED_EVIDENCE_MISSING', 'UNVERIFIABLE');
  }
  if (!/^0x[0-9a-f]{130}$/i.test(evidence.signature)
      || !verifyCommitmentSignature(trusted.domain, evidence.commitment, evidence.signature, trusted.signer)) {
    return result(stage, 'Vault signature does not match the trusted signer and domain.', 'SIGNATURE_INVALID', 'TAMPERED');
  }
  return result(stage, 'Vault EIP-712 signature matches the trusted signer and domain.');
}
