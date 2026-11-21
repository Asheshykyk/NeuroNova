import { createHash } from 'node:crypto';
import {
  buildMerkleTree, computeCommitmentStructHashHex, EvidenceAnchorABI, generateMerkleProof,
  GENESIS_CHECKPOINT_DIGEST,
  GENESIS_CHECKPOINT_HASH, getEthereumAddress, hashLeaf, signBatchCommitment, buildCheckpoint
} from '@trusttrace/core';
import {
  MERKLE_ROOT_3, MERKLE_TREE_3, TEST_BATCH_1, TEST_BATCH_1_STRUCT_HASH,
  TEST_EIP712_DOMAIN, TEST_EVENTS, TEST_SIGNED_BATCH_1
} from '../../../packages/core/src/test-vectors.ts';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { matchCommitment, verifyMerkle, verifyVaultSignature } from './core.js';
import type { BatchCommitment } from '@trusttrace/core/types';
import type { BatchEvidence, EvidenceEvent, TrustedBatchConfig } from './core.js';
import { RPC_REQUEST_TIMEOUT_MS } from './rpc.js';
import type { ConnectEvidenceAnchor } from './rpc.js';
import { run } from './index.js';
import { verifyBundle, verifyEvidence } from './verify.js';
import type { ParsedBundle, StageResult } from './types.js';

const verified = (stage: StageResult['stage']): StageResult => ({ stage, status: 'VERIFIED', message: 'fixture passed' });
const fixtureBundle: ParsedBundle = { path: 'fixture.json' };

afterEach(() => {
  vi.useRealTimers();
});

describe('verification failure handling', () => {
  it('returns UNVERIFIABLE for a missing bundle', async () => {
    const result = await verifyBundle({ bundlePath: '/not-present/evidence.json', rpcUrl: 'http://127.0.0.1:8545' });
    expect(result.status).toBe('UNVERIFIABLE');
    expect(result.reasonCode).toBe('BUNDLE_NOT_FOUND');
  });

  it('returns UNVERIFIABLE for malformed bundle input', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'trusttrace-verifier-'));
    const path = join(directory, 'bad.json');
    await writeFile(path, '{bad json');
    const result = await verifyBundle({ bundlePath: path, rpcUrl: 'http://127.0.0.1:8545' });
    expect(result.status).toBe('UNVERIFIABLE');
    expect(result.reasonCode).toBe('BUNDLE_JSON_INVALID');
  });

  it('returns TAMPERED only when a sufficient stage reports a mismatch', async () => {
    const result = await verifyBundle({ bundlePath: fixtureBundle.path, rpcUrl: 'http://127.0.0.1:8545' }, {
      parseBundle: async () => ({ ...verified('bundle-parsing'), bundle: fixtureBundle }),
      verifyVaultSignature: async () => verified('vault-signature'),
      matchCommitment: async () => verified('commitment-matching'),
      validateRawBytes: async () => ({ stage: 'raw-byte-validation', status: 'TAMPERED', reasonCode: 'PAYLOAD_HASH_MISMATCH', message: 'fixture mismatch' })
    });
    expect(result.status).toBe('TAMPERED');
    expect(result.reasonCode).toBe('PAYLOAD_HASH_MISMATCH');
  });

  it('does not return VERIFIED when direct RPC fails', async () => {
    const result = await verifyBundle({ bundlePath: fixtureBundle.path, rpcUrl: 'http://127.0.0.1:8545' }, {
      parseBundle: async () => ({ ...verified('bundle-parsing'), bundle: fixtureBundle }),
      validateRawBytes: async () => verified('raw-byte-validation'),
      verifyMerkle: async () => verified('merkle-verification'),
      verifyPublicCheckpoint: async () => verified('public-checkpoint-verification'),
      matchCommitment: async () => verified('commitment-matching'),
      verifyVaultSignature: async () => verified('vault-signature'),
      lookupCheckpoint: async () => ({ stage: 'direct-rpc', status: 'UNVERIFIABLE', reasonCode: 'RPC_UNAVAILABLE', message: 'fixture RPC unavailable' })
    });
    expect(result.status).toBe('UNVERIFIABLE');
    expect(result.reasonCode).toBe('RPC_UNAVAILABLE');
  });

  it('converts an unexpected stage exception to an explicit UNVERIFIABLE result', async () => {
    const result = await verifyBundle({ bundlePath: fixtureBundle.path, rpcUrl: 'http://127.0.0.1:8545' }, {
      parseBundle: async () => ({ ...verified('bundle-parsing'), bundle: fixtureBundle }),
      verifyVaultSignature: async () => { throw new Error('sensitive provider detail'); },
    });
    expect(result).toMatchObject({
      status: 'UNVERIFIABLE', reasonCode: 'VERIFIER_INTERNAL_ERROR',
      message: 'Verification stage failed unexpectedly; no integrity verdict was produced.'
    });
    expect(JSON.stringify(result)).not.toContain('sensitive provider detail');
  });

  it('uses a usage exit code when required CLI arguments are absent', async () => {
    const errors: string[] = [];
    await expect(run(['verify'], () => undefined, (value) => errors.push(value))).resolves.toBe(64);
    expect(errors[0]).toContain('--bundle');
  });

  it('prints help and returns the success exit code', async () => {
    const output: string[] = [];
    await expect(run(['--help'], (value) => output.push(value), () => undefined)).resolves.toBe(0);
    expect(output[0]).toContain('bundle adapters are unavailable');
  });

  it('redacts RPC URL credentials and query values from JSON output', async () => {
    const output: string[] = [];
    const rpcUrlWithCredentials = 'https://user:password@rpc.example.invalid/cyprus1?apiKey=secret';
    await expect(run([
      'verify', '--bundle', '/not-present/evidence.json', '--rpc-url', rpcUrlWithCredentials, '--json'
    ], (value) => output.push(value), () => undefined)).resolves.toBe(2);
    const result = JSON.parse(output[0]) as { rpcUrl: string };
    expect(result.rpcUrl).toBe('[redacted]');
    expect(output[0]).not.toContain('password');
    expect(output[0]).not.toContain('secret');
  });
});

const rpcUrl = 'https://rpc.example.invalid/cyprus1';
const options = { bundlePath: 'normalized fixture', rpcUrl };

function fixture(eventCount = 2, sequenceStart = 1n, previousCommitment?: BatchCommitment) {
  const key = '0x' + '01'.repeat(32);
  const sourceId = '0x' + '61'.repeat(32);
  const trusted: TrustedBatchConfig = {
    signer: getEthereumAddress(key),
    domain: {
      name: 'EvidenceAnchor',
      version: '1',
      chainId: 15000n,
      verifyingContract: '0x00a89d7494cb3d16858a74e5cae1a965d14df5a2',
    }
  };
  const rawEvents = [
    Buffer.from([0xff, 0x00, 0x0a]),
    Buffer.from([0x7b, 0x0d, 0x0a]),
    Buffer.from([0x00, 0x80, 0xff]),
  ];
  const events = rawEvents.slice(0, eventCount).map((rawEventBytes, index) => ({
    version: 1, sourceId, vaultSequence: sequenceStart + BigInt(index), rawEventBytes,
    payloadHash: '0x' + createHash('sha256').update(rawEventBytes).digest('hex')
  }));
  const sequenceEnd = sequenceStart + BigInt(events.length) - 1n;
  const tree = buildMerkleTree(events.map(hashLeaf));
  const rawMerkleRoot = '0x' + tree.root.toString('hex');
  const publicCheckpoint = {
    previousCheckpointDigest: previousCommitment?.merkleRoot ?? GENESIS_CHECKPOINT_DIGEST,
    localChainId: 31337,
    localBlockNumber: 82,
    localBlockHash: '0x' + '22'.repeat(32),
    latestBatchRoot: rawMerkleRoot,
    latestSequence: sequenceEnd,
    contractAddress: '0x0012345678901234567890123456789012345678',
  };
  const publicDigest = buildCheckpoint(publicCheckpoint).digestHex;
  const commitment = {
    sourceId, sequenceStart, sequenceEnd, leafCount: BigInt(events.length),
    merkleRoot: publicDigest,
    previousCheckpointHash: previousCommitment
      ? computeCommitmentStructHashHex(previousCommitment)
      : GENESIS_CHECKPOINT_HASH
  };
  const evidence: BatchEvidence = {
    events: events.map((event, index) => ({ ...event, siblings: generateMerkleProof(tree.layers, index).siblings })),
    commitment, commitmentHash: computeCommitmentStructHashHex(commitment),
    signature: signBatchCommitment(key, trusted.domain, commitment).signature,
    rawMerkleRoot,
    publicCheckpoint,
    ...(previousCommitment && { previousCommitment }),
  };
  const previousHash = previousCommitment && computeCommitmentStructHashHex(previousCommitment);
  const connect: ConnectEvidenceAnchor = (url, contract, abi) => {
    expect(url).toBe(rpcUrl);
    expect(contract).toBe(trusted.domain.verifyingContract);
    expect(abi).toBe(EvidenceAnchorABI);
    expect(abi).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'isBatchAnchored', stateMutability: 'view' }),
      expect.objectContaining({ name: 'getBatch', stateMutability: 'view' })
    ]));
    return {
      getNetwork: async () => ({ chainId: 15000n }),
      read: async (method, hash) => {
        if (method === 'getSource') {
          expect(hash).toBe(commitment.sourceId);
          return [
            trusted.signer, true, false, commitment.sequenceEnd,
            evidence.commitmentHash, 1n
          ];
        }
        if (method === 'isBatchAnchored') {
          expect([evidence.commitmentHash, previousHash]).toContain(hash);
          return true;
        }
        if (method === 'getLatest') {
          expect(hash).toBe(commitment.sourceId);
          return [[
            commitment.sourceId, commitment.sequenceStart, commitment.sequenceEnd, commitment.leafCount,
            commitment.merkleRoot, commitment.previousCheckpointHash
          ], evidence.commitmentHash];
        }
        if (method === 'getBatch') {
          if (hash === evidence.commitmentHash) {
            return [
              commitment.sourceId, commitment.sequenceStart, commitment.sequenceEnd, commitment.leafCount,
              commitment.merkleRoot, commitment.previousCheckpointHash
            ];
          }
          if (previousCommitment && hash === previousHash) {
            return [
              previousCommitment.sourceId, previousCommitment.sequenceStart, previousCommitment.sequenceEnd,
              previousCommitment.leafCount, previousCommitment.merkleRoot, previousCommitment.previousCheckpointHash
            ];
          }
          throw new Error(`Unexpected batch hash: ${hash}`);
        }
        throw new Error(`Unexpected RPC method: ${method}`);
      }
    };
  };
  return { evidence, trusted, connect };
}

describe('normalized evidence verification', () => {
  it('returns VERIFIED only when exact evidence checks and a mocked direct-RPC response pass', async () => {
    const { evidence, trusted, connect } = fixture();
    const result = await verifyEvidence(evidence, { ...options, trusted, connect });
    expect(result.status).toBe('VERIFIED');
    expect(result.stages.map(({ stage }) => stage)).toEqual([
      'bundle-parsing', 'vault-signature', 'commitment-matching', 'raw-byte-validation',
      'merkle-verification', 'public-checkpoint-verification', 'direct-rpc'
    ]);
    expect(result.stages[0]).not.toHaveProperty('bundle');
  });

  it('validates the shared-core frozen Merkle vector', () => {
    const events: EvidenceEvent[] = TEST_EVENTS.slice(0, 3).map((event, index) => {
      const rawEventBytes = Buffer.from(event.rawEventBytes as string);
      return {
        ...event,
        rawEventBytes,
        payloadHash: '0x' + createHash('sha256').update(rawEventBytes).digest('hex'),
        siblings: generateMerkleProof(MERKLE_TREE_3.layers, index).siblings,
      };
    });
    const evidence: BatchEvidence = {
      events,
      commitment: TEST_BATCH_1,
      commitmentHash: TEST_BATCH_1_STRUCT_HASH,
      signature: TEST_SIGNED_BATCH_1.signature,
      rawMerkleRoot: MERKLE_ROOT_3,
    };
    const trusted = { signer: TEST_SIGNED_BATCH_1.signer, domain: TEST_EIP712_DOMAIN };
    expect(verifyMerkle(evidence)).toMatchObject({ status: 'VERIFIED' });
    expect(verifyVaultSignature(evidence, trusted)).toMatchObject({ status: 'VERIFIED' });
  });

  it('detects tampered raw event bytes', async () => {
    const { evidence, trusted } = fixture();
    evidence.events[0].rawEventBytes[0] ^= 1;
    await expect(verifyEvidence(evidence, { ...options, trusted })).resolves.toMatchObject({
      status: 'TAMPERED', reasonCode: 'PAYLOAD_HASH_MISMATCH'
    });
  });

  it('does not claim TAMPERED for inconsistent evidence before authenticating the signer', async () => {
    const { evidence } = fixture();
    evidence.events[0].rawEventBytes[0] ^= 1;
    await expect(verifyEvidence(evidence, options)).resolves.toMatchObject({
      status: 'UNVERIFIABLE', reasonCode: 'TRUSTED_CONFIG_MISSING'
    });
  });

  it('detects tampered bytes even when their reported payload hash is replaced', async () => {
    const { evidence, trusted } = fixture();
    const event = evidence.events[0];
    event.rawEventBytes[0] ^= 1;
    event.payloadHash = '0x' + createHash('sha256').update(event.rawEventBytes).digest('hex');
    await expect(verifyEvidence(evidence, { ...options, trusted })).resolves.toMatchObject({
      status: 'TAMPERED', reasonCode: 'PROOF_INVALID'
    });
  });

  it('detects altered Merkle siblings', async () => {
    const { evidence, trusted } = fixture();
    evidence.events[0].siblings = ['0x' + '00'.repeat(32)];
    await expect(verifyEvidence(evidence, { ...options, trusted })).resolves.toMatchObject({
      status: 'TAMPERED', reasonCode: 'PROOF_INVALID'
    });
  });

  it('returns UNVERIFIABLE when Merkle proof material is missing', async () => {
    const { evidence, trusted } = fixture();
    evidence.events[0].siblings = [];
    await expect(verifyEvidence(evidence, { ...options, trusted })).resolves.toMatchObject({
      status: 'UNVERIFIABLE', reasonCode: 'REQUIRED_EVIDENCE_MISSING'
    });
  });

  it('returns UNVERIFIABLE for an incomplete evidence bundle with no events', async () => {
    const { evidence, trusted } = fixture();
    const incompleteEvidence: BatchEvidence = { ...evidence, events: [] };
    await expect(verifyEvidence(incompleteEvidence, { ...options, trusted })).resolves.toMatchObject({
      status: 'UNVERIFIABLE', reasonCode: 'REQUIRED_EVIDENCE_MISSING'
    });
  });

  it('accepts a valid single-leaf proof with no siblings', async () => {
    const { evidence, trusted, connect } = fixture(1);
    expect(evidence.events[0].siblings).toEqual([]);
    await expect(verifyEvidence(evidence, { ...options, trusted, connect })).resolves.toMatchObject({
      status: 'VERIFIED'
    });
  });

  it('returns UNVERIFIABLE when the supplied event range omits a source-local sequence', async () => {
    const { evidence, trusted } = fixture(3);
    const incompleteEvidence: BatchEvidence = {
      ...evidence,
      events: [evidence.events[0], evidence.events[2]],
    };
    await expect(verifyEvidence(incompleteEvidence, { ...options, trusted })).resolves.toMatchObject({
      status: 'UNVERIFIABLE', reasonCode: 'REQUIRED_EVIDENCE_MISSING'
    });
  });

  it('requires a preceding commitment for a non-genesis source-local range', () => {
    const { evidence } = fixture();
    const nonGenesis: BatchEvidence = {
      ...evidence,
      commitment: {
        ...evidence.commitment,
        sequenceStart: 3n,
        sequenceEnd: 4n,
        leafCount: 2n,
        previousCheckpointHash: '0x' + '33'.repeat(32),
      },
    };
    nonGenesis.commitmentHash = computeCommitmentStructHashHex(nonGenesis.commitment);
    expect(matchCommitment(nonGenesis)).toMatchObject({
      status: 'UNVERIFIABLE', reasonCode: 'REQUIRED_EVIDENCE_MISSING'
    });
  });

  it('verifies a non-genesis batch against its source-local predecessor', async () => {
    const previousCommitment = fixture().evidence.commitment;
    const { evidence, trusted, connect } = fixture(2, 3n, previousCommitment);
    await expect(verifyEvidence(evidence, { ...options, trusted, connect })).resolves.toMatchObject({
      status: 'VERIFIED'
    });
  });

  it('rejects a preceding commitment that differs from the direct-RPC record', async () => {
    const previousCommitment = fixture().evidence.commitment;
    const { evidence, trusted, connect } = fixture(2, 3n, previousCommitment);
    const previousHash = computeCommitmentStructHashHex(previousCommitment);
    const alteredPrevious = { ...previousCommitment, merkleRoot: '0x' + '99'.repeat(32) };
    const mismatchedConnect: ConnectEvidenceAnchor = (url, address, abi) => {
      const reader = connect(url, address, abi);
      return {
        getNetwork: () => reader.getNetwork(),
        read: async (method, ...args) => {
          if (method === 'getBatch' && args[0] === previousHash) {
            return [
              alteredPrevious.sourceId, alteredPrevious.sequenceStart, alteredPrevious.sequenceEnd,
              alteredPrevious.leafCount, alteredPrevious.merkleRoot, alteredPrevious.previousCheckpointHash
            ];
          }
          return reader.read(method, ...args);
        }
      };
    };
    await expect(verifyEvidence(evidence, { ...options, trusted, connect: mismatchedConnect })).resolves.toMatchObject({
      status: 'TAMPERED', reasonCode: 'COMMITMENT_MISMATCH'
    });
  });

  it('rejects an event whose source ID differs from the signed batch source', async () => {
    const { evidence, trusted } = fixture();
    evidence.events[0].sourceId = '0x' + '62'.repeat(32);
    await expect(verifyEvidence(evidence, { ...options, trusted })).resolves.toMatchObject({
      status: 'TAMPERED', reasonCode: 'PROOF_INVALID'
    });
  });

  it('detects an invalid Vault signature', async () => {
    const { evidence, trusted } = fixture();
    evidence.signature = '0x' + '00'.repeat(65);
    await expect(verifyEvidence(evidence, { ...options, trusted })).resolves.toMatchObject({
      status: 'TAMPERED', reasonCode: 'SIGNATURE_INVALID'
    });
  });

  it('requires a trusted signer outside of the evidence', async () => {
    const { evidence, trusted } = fixture();
    await expect(verifyEvidence(evidence, { ...options, trusted: { ...trusted, signer: '' } })).resolves.toMatchObject({
      status: 'UNVERIFIABLE', reasonCode: 'TRUSTED_CONFIG_MISSING'
    });
  });

  it('requires source registration before trusting a configured signer', async () => {
    const { evidence, trusted } = fixture();
    const connect: ConnectEvidenceAnchor = () => ({
      getNetwork: async () => ({ chainId: 15000n }),
      read: async (method) => method === 'getSource'
        ? [trusted.signer, false, false, 0n, '0x' + '00'.repeat(32), 0n]
        : []
    });
    await expect(verifyEvidence(evidence, { ...options, trusted, connect })).resolves.toMatchObject({
      status: 'UNVERIFIABLE', reasonCode: 'CONTRACT_LOOKUP_UNAVAILABLE'
    });
  });

  it('does not trust an active source with a different registered signer', async () => {
    const { evidence, trusted } = fixture();
    const differentSigner = getEthereumAddress('0x' + '02'.repeat(32));
    const connect: ConnectEvidenceAnchor = () => ({
      getNetwork: async () => ({ chainId: 15000n }),
      read: async (method) => method === 'getSource'
        ? [differentSigner, true, false, evidence.commitment.sequenceEnd, evidence.commitmentHash, 1n]
        : []
    });
    await expect(verifyEvidence(evidence, { ...options, trusted, connect })).resolves.toMatchObject({
      status: 'UNVERIFIABLE', reasonCode: 'TRUSTED_CONFIG_MISMATCH'
    });
  });

  it('rejects a public checkpoint digest that does not link the raw Merkle evidence', async () => {
    const { evidence, trusted } = fixture();
    evidence.publicCheckpoint!.latestBatchRoot = '0x' + '44'.repeat(32);
    await expect(verifyEvidence(evidence, { ...options, trusted })).resolves.toMatchObject({
      status: 'TAMPERED', reasonCode: 'COMMITMENT_MISMATCH'
    });
  });

  it('rejects a checkpoint that does not link to the previous public checkpoint digest', async () => {
    const { evidence, trusted } = fixture();
    evidence.publicCheckpoint!.previousCheckpointDigest = '0x' + '44'.repeat(32);
    await expect(verifyEvidence(evidence, { ...options, trusted })).resolves.toMatchObject({
      status: 'TAMPERED', reasonCode: 'COMMITMENT_MISMATCH'
    });
  });

  it('returns UNVERIFIABLE for malformed checkpoint integers instead of throwing', async () => {
    const { evidence, trusted } = fixture();
    evidence.publicCheckpoint!.localBlockNumber = Number.MAX_SAFE_INTEGER + 1;
    await expect(verifyEvidence(evidence, { ...options, trusted })).resolves.toMatchObject({
      status: 'UNVERIFIABLE', reasonCode: 'REQUIRED_EVIDENCE_MISSING'
    });
  });

  it('fails closed when the provider is unavailable', async () => {
    const { evidence, trusted } = fixture();
    const connect: ConnectEvidenceAnchor = () => ({
      getNetwork: async () => { throw new Error('RPC timed out'); },
      read: async () => { throw new Error('Should not be called'); }
    });
    await expect(verifyEvidence(evidence, { ...options, trusted, connect })).resolves.toMatchObject({
      status: 'UNVERIFIABLE', reasonCode: 'RPC_UNAVAILABLE'
    });
  });

  it('returns UNVERIFIABLE when an RPC request exceeds its deadline', async () => {
    vi.useFakeTimers();
    const { evidence, trusted } = fixture();
    const getNetwork = vi.fn(() => new Promise<{ chainId: bigint }>(() => undefined));
    const connect: ConnectEvidenceAnchor = () => ({
      getNetwork,
      read: async () => { throw new Error('Should not be called'); }
    });
    const pending = verifyEvidence(evidence, { ...options, trusted, connect });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    expect(getNetwork).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(RPC_REQUEST_TIMEOUT_MS);
    await expect(pending).resolves.toMatchObject({
      status: 'UNVERIFIABLE', reasonCode: 'RPC_UNAVAILABLE'
    });
  });

  it('fails closed on an incomplete anchored batch response', async () => {
    const { evidence, trusted } = fixture();
    const connect: ConnectEvidenceAnchor = () => ({
      getNetwork: async () => ({ chainId: 15000n }),
      read: async (method) => method === 'isBatchAnchored' ? true : []
    });
    await expect(verifyEvidence(evidence, { ...options, trusted, connect })).resolves.toMatchObject({
      status: 'UNVERIFIABLE', reasonCode: 'RPC_RESPONSE_INVALID'
    });
  });

  it('returns TAMPERED when the on-chain commitment differs', async () => {
    const { evidence, trusted } = fixture();
    const mismatched = { ...evidence.commitment, merkleRoot: '0x' + '11'.repeat(32) };
    const connect: ConnectEvidenceAnchor = () => ({
      getNetwork: async () => ({ chainId: 15000n }),
      read: async (method, hash) => {
        if (method === 'getSource') {
          return [trusted.signer, true, false, mismatched.sequenceEnd,
            evidence.commitmentHash, 1n];
        }
        if (method === 'isBatchAnchored') return true;
        if (method === 'getLatest') {
          return [[mismatched.sourceId, mismatched.sequenceStart, mismatched.sequenceEnd,
            mismatched.leafCount, mismatched.merkleRoot, mismatched.previousCheckpointHash],
          evidence.commitmentHash];
        }
        if (method === 'getBatch') {
          expect(hash).toBe(evidence.commitmentHash);
          return [mismatched.sourceId, mismatched.sequenceStart, mismatched.sequenceEnd,
            mismatched.leafCount, mismatched.merkleRoot, mismatched.previousCheckpointHash];
        }
        throw new Error(`Unexpected RPC method: ${method}`);
      }
    });
    await expect(verifyEvidence(evidence, { ...options, trusted, connect })).resolves.toMatchObject({
      status: 'TAMPERED', reasonCode: 'COMMITMENT_MISMATCH'
    });
  });

  it('rejects ZIP input before treating archive members as evidence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'trusttrace-verifier-'));
    const path = join(directory, 'unsupported.zip');
    await writeFile(path, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    await expect(verifyBundle({ bundlePath: path, rpcUrl })).resolves.toMatchObject({
      status: 'UNVERIFIABLE', reasonCode: 'BUNDLE_SCHEMA_UNAVAILABLE'
    });
  });
});
