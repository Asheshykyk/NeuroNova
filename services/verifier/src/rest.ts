import { createHash } from 'node:crypto';
import { GENESIS_CHECKPOINT_HASH, hashLeaf, recoverCommitmentSigner, verifyMerkleProof } from '@trusttrace/core';
import type { BatchCommitment } from '@trusttrace/core/types';
import { bytes32, commitmentHash, result } from './core.js';
import { LOCAL_VAULT_TRUST, lookupLocalBatch } from './rpc.js';
import type { ConnectEvidenceAnchor } from './rpc.js';
import type { ReasonCode, StageName, StageResult } from './types.js';

const address = /^0x[0-9a-f]{40}$/i;
const signaturePattern = /^0x[0-9a-f]{130}$/i;
const maxUInt64 = 0xffffffffffffffffn;
const maxPages = 20;
const pageSize = 50;
const maxResponseBytes = 16 * 1024 * 1024;

type Wire = Record<string, unknown>;
interface RestOptions { baseUrl: string; sourceId: string; sequence: string; rpcUrl?: string }

class RestError extends Error {
  constructor(readonly reason: ReasonCode, message: string) { super(message); }
}

function invalid(message: string): never {
  throw new RestError('REST_RESPONSE_INVALID', message);
}

function object(value: unknown): Wire {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid('Expected a REST object.');
  return value as Wire;
}

function hash(value: unknown): string {
  if (typeof value !== 'string' || !bytes32.test(value)) invalid('Invalid bytes32 REST field.');
  return value.toLowerCase();
}

function uint(value: unknown, positive = false): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,19})$/.test(value)) invalid('Invalid decimal uint64 REST field.');
  const integer = BigInt(value);
  if (integer > maxUInt64 || (positive && integer === 0n)) invalid('REST integer is out of range.');
  return integer;
}

export function restBaseUrl(value: string): URL {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Expected an HTTP(S) Vault API base URL without credentials, query, or fragment.');
  }
  url.pathname = url.pathname.replace(/\/*$/, '/');
  return url;
}

export function restIdentity(sourceId: string, sequence: string) {
  return { sourceId: hash(sourceId), vaultSequence: uint(sequence, true) };
}

async function get(base: URL, path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(new URL(path, base), { signal, redirect: 'error' });
  if (!response.ok || !response.body) throw new RestError('REST_UNAVAILABLE', `Vault request failed (HTTP ${response.status}).`);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxResponseBytes) invalid('Vault response exceeds the size limit.');
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, length)));
  } catch {
    return invalid('Vault response is not valid UTF-8 JSON.');
  }
}

async function findBatch(base: URL, sourceId: string, batchId: string, signal: AbortSignal): Promise<Wire> {
  const cursors = new Set<string>();
  const query = new URLSearchParams({ sourceId, limit: String(pageSize) });
  for (let page = 0; page < maxPages; page++) {
    const { items, nextCursor } = object(await get(base, `batches?${query}`, signal));
    if (!Array.isArray(items) || items.length > pageSize
        || (nextCursor !== null && (typeof nextCursor !== 'string' || !nextCursor || nextCursor.length > 2048))) {
      invalid('Invalid batch page.');
    }
    const matches = items.map(object).filter((item) => hash(item.batchId) === batchId);
    if (matches.length > 1) invalid('Duplicate matching batch.');
    if (matches[0]) return matches[0];
    if (nextCursor === null) break;
    if (cursors.has(nextCursor)) invalid('Vault repeated a batch cursor.');
    cursors.add(nextCursor);
    query.set('cursor', nextCursor);
  }
  throw new RestError('REQUIRED_EVIDENCE_MISSING', 'Matching batch was not found within the pagination limit.');
}

function readCommitment(item: Wire, nested: boolean): BatchCommitment {
  if (!nested && (typeof item.leafCount !== 'number' || !Number.isSafeInteger(item.leafCount))) {
    invalid('Invalid batch leaf count.');
  }
  const commitment = {
    sourceId: hash(item.sourceId),
    sequenceStart: uint(nested ? item.sequenceStart : item.startSequence, true),
    sequenceEnd: uint(nested ? item.sequenceEnd : item.endSequence, true),
    leafCount: uint(nested ? item.leafCount : String(item.leafCount), true),
    merkleRoot: hash(item.merkleRoot),
    previousCheckpointHash: hash(nested ? item.previousCheckpointHash : item.previousBatchRoot),
  };
  if (commitment.sequenceEnd - commitment.sequenceStart + 1n !== commitment.leafCount) invalid('Invalid batch range.');
  return commitment;
}

function nullableReference(value: unknown, validate: (value: unknown) => unknown) {
  if (value !== null) validate(value);
}

function readProof(value: unknown) {
  const proof = object(value);
  if (typeof proof.leafIndex !== 'number' || !Number.isSafeInteger(proof.leafIndex) || proof.leafIndex < 0
      || typeof proof.leafCount !== 'number' || !Number.isSafeInteger(proof.leafCount) || proof.leafCount < 1
      || proof.leafIndex >= proof.leafCount || !Array.isArray(proof.siblings) || proof.siblings.length > 64
      || !Array.isArray(proof.steps) || proof.steps.length > 64) invalid('Invalid Merkle proof shape.');
  const siblings = proof.siblings.map(hash);
  const steps = proof.steps.map((value) => {
    const { position, sibling } = object(value);
    if (position === 'promoted' && sibling === null) return { position, sibling };
    if (position !== 'left' && position !== 'right') invalid('Invalid Merkle step.');
    return { position, sibling: hash(sibling) };
  });
  return { leafIndex: proof.leafIndex, leafCount: proof.leafCount, leafHash: hash(proof.leafHash), root: hash(proof.root), siblings, steps };
}

function proofGeometryMatches(proof: ReturnType<typeof readProof>, index: bigint, count: bigint) {
  if (BigInt(proof.leafIndex) !== index || BigInt(proof.leafCount) !== count) return false;
  let siblingIndex = 0;
  let stepIndex = 0;
  while (count > 1n) {
    const promoted = count % 2n === 1n && index === count - 1n;
    const position = promoted ? 'promoted' : index % 2n === 1n ? 'left' : 'right';
    const step = proof.steps[stepIndex++];
    if (!step || step.position !== position || step.sibling !== (promoted ? null : proof.siblings[siblingIndex++])) return false;
    index /= 2n;
    count = (count + 1n) / 2n;
  }
  return siblingIndex === proof.siblings.length && stepIndex === proof.steps.length;
}

const unavailable = (stage: StageName, reason: ReasonCode, message: string) => result(stage, message, reason, 'UNVERIFIABLE');

function verifySignature(commitment: BatchCommitment | undefined, batch: Wire): StageResult {
  const stage = 'vault-signature';
  if (!commitment || batch.vaultSignature == null) {
    return unavailable(stage, 'REQUIRED_EVIDENCE_MISSING', 'Vault signed commitment or signature is missing.');
  }
  if (typeof batch.vaultSignature !== 'string' || !signaturePattern.test(batch.vaultSignature)) {
    return unavailable(stage, 'REST_RESPONSE_INVALID', 'Vault signature is malformed.');
  }
  let signer: string;
  try {
    signer = recoverCommitmentSigner(LOCAL_VAULT_TRUST.domain, commitment, batch.vaultSignature);
  } catch {
    return result(stage, 'Vault signature failed cryptographic recovery under the trusted Tier 1 domain.', 'SIGNATURE_INVALID', 'TAMPERED');
  }
  if (signer.toLowerCase() !== LOCAL_VAULT_TRUST.signer.toLowerCase()) {
    return result(stage, 'Recovered signer differs from the trusted Tier 1 Vault signer.', 'SIGNATURE_INVALID', 'TAMPERED');
  }
  return result(stage, 'Recovered Vault signer matches the frozen Tier 1 deployment.');
}

export async function verifyRest(options: RestOptions, connect?: ConnectEvidenceAnchor) {
  const stages: StageResult[] = [];
  const tier2 = unavailable('public-checkpoint-verification', 'REQUIRED_EVIDENCE_MISSING',
    'The REST API does not supply an authenticated Tier 2 checkpoint and its preimage.');
  let batchId: string | undefined;

  try {
    const base = restBaseUrl(options.baseUrl);
    const { sourceId, vaultSequence } = restIdentity(options.sourceId, options.sequence);
    const signal = AbortSignal.timeout(15_000);
    const detail = object(await get(base, `events/${sourceId}/${vaultSequence}`, signal));
    if (hash(detail.sourceId) !== sourceId || uint(detail.vaultSequence, true) !== vaultSequence) {
      throw new RestError('REST_INCONSISTENT', 'Event detail identity differs from the request.');
    }
    if (detail.batchId === null || detail.merkleProof === null) {
      throw new RestError('REQUIRED_EVIDENCE_MISSING', 'Event has no batch or inclusion proof.');
    }
    batchId = hash(detail.batchId);
    const proof = readProof(detail.merkleProof);
    const batch = await findBatch(base, sourceId, batchId, signal);
    const metadata = readCommitment(batch, false);
    const nested = batch.commitment == null ? undefined : readCommitment(object(batch.commitment), true);
    const reportedHash = hash(batch.commitmentHash);
    nullableReference(batch.transactionHash, hash);
    nullableReference(batch.chainId, uint);
    nullableReference(batch.blockNumber, uint);
    if (batch.anchorStatus !== 'ANCHOR_PENDING' && batch.anchorStatus !== 'ANCHOR_FAILED' && batch.anchorStatus !== 'ANCHORED') {
      invalid('Invalid Tier 1 anchor status.');
    }
    if (typeof detail.rawPayloadBase64 !== 'string') invalid('Missing raw event bytes.');
    const raw = Buffer.from(detail.rawPayloadBase64, 'base64');
    if (raw.toString('base64') !== detail.rawPayloadBase64) invalid('Invalid canonical Base64 payload.');
    const payloadMatches = hash(detail.payloadSha256) === '0x' + createHash('sha256').update(raw).digest('hex');
    stages.push(result('rest-fetch', 'Event detail and matching batch fetched.'));

    const signature = verifySignature(nested, batch);
    stages.push(signature);
    const computedHash = commitmentHash(metadata);
    const index = vaultSequence - metadata.sequenceStart;
    const reportedSignerMatches = batch.vaultSignerAddress == null || (
      typeof batch.vaultSignerAddress === 'string' && address.test(batch.vaultSignerAddress)
      && (signature.status !== 'VERIFIED' || batch.vaultSignerAddress.toLowerCase() === LOCAL_VAULT_TRUST.signer.toLowerCase())
    );
    const consistent = metadata.sourceId === sourceId && index >= 0n && vaultSequence <= metadata.sequenceEnd
      && computedHash === reportedHash && (!nested || commitmentHash(nested) === reportedHash)
      && (metadata.sequenceStart !== 1n || metadata.previousCheckpointHash === GENESIS_CHECKPOINT_HASH)
      && reportedSignerMatches;
    stages.push(consistent
      ? result('commitment-matching', 'Local batch fields and struct hash agree.')
      : unavailable('commitment-matching', 'REST_INCONSISTENT', 'REST commitment fields, identity, or reported signer disagree.'));

    const leaf = hashLeaf({ version: 1, sourceId, vaultSequence, rawEventBytes: raw });
    const leafMatches = '0x' + leaf.toString('hex') === proof.leafHash;
    const proofMetadataMatches = consistent && proof.root === metadata.merkleRoot
      && proofGeometryMatches(proof, index, metadata.leafCount);
    const proofMatches = proofMetadataMatches
      && verifyMerkleProof(leaf, proof.leafIndex, proof.leafCount, proof.siblings, metadata.merkleRoot);
    const authenticated = signature.status === 'VERIFIED' && proofMetadataMatches;
    const authenticatedLeaf = authenticated
      && verifyMerkleProof(Buffer.from(proof.leafHash.slice(2), 'hex'), proof.leafIndex, proof.leafCount, proof.siblings, metadata.merkleRoot);

    stages.push(payloadMatches && leafMatches
      ? result('raw-byte-validation', 'Exact payload SHA-256 and canonical v1 leaf match the reported values.')
      : authenticatedLeaf && !leafMatches
        ? result('raw-byte-validation', 'Raw bytes do not reproduce the leaf authenticated by the signed root.', 'PAYLOAD_HASH_MISMATCH', 'TAMPERED')
        : unavailable('raw-byte-validation', 'REST_INCONSISTENT', 'Raw bytes disagree with reported payload or leaf metadata.'));
    stages.push(proofMatches && leafMatches
      ? result('merkle-verification', 'Canonical leaf and inclusion proof match the independently fetched local batch root.')
      : authenticated && !proofMatches
        ? result('merkle-verification', 'The supplied proof does not link the event bytes to the authenticated batch root.', 'PROOF_INVALID', 'TAMPERED')
        : unavailable('merkle-verification', 'REST_INCONSISTENT', 'Local batch and inclusion proof do not agree.'));

    const canReadAnchor = stages.every(({ status }) => status === 'VERIFIED') && nested && batch.anchorStatus === 'ANCHORED';
    if (canReadAnchor && (batch.chainId === null || uint(batch.chainId) === BigInt(LOCAL_VAULT_TRUST.domain.chainId))) {
      stages.push(await lookupLocalBatch({ commitment: nested, commitmentHash: reportedHash }, options.rpcUrl, connect));
    } else {
      stages.push(unavailable('direct-rpc', 'CONTRACT_LOOKUP_UNAVAILABLE',
        'Tier 1 RPC requires verified local evidence and a reported anchor for the trusted deployment.'));
    }
  } catch (error) {
    const reason = error instanceof RestError ? error.reason : 'REST_UNAVAILABLE';
    stages.push(unavailable('rest-fetch', reason, error instanceof RestError ? error.message : 'Vault REST request could not be completed.'));
  }

  const tier1Failure = stages.find(({ status }) => status === 'TAMPERED') ?? stages.find(({ status }) => status !== 'VERIFIED');
  const verdict = tier1Failure?.status === 'TAMPERED' ? tier1Failure : tier2;
  return {
    scope: 'vault-rest', sourceId: options.sourceId, vaultSequence: options.sequence, batchId,
    status: verdict.status, reasonCode: verdict.reasonCode, message: verdict.message,
    tier1: { status: tier1Failure?.status ?? 'VERIFIED', reasonCode: tier1Failure?.reasonCode, stages },
    tier2,
  };
}
