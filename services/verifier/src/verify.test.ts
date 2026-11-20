import { createHash } from 'node:crypto';
import {
  buildMerkleTree, computeCommitmentStructHashHex, EvidenceAnchorABI, generateMerkleProof,
  GENESIS_CHECKPOINT_HASH, getEthereumAddress, hashLeaf, signBatchCommitment
} from '@trusttrace/core';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from './index.js';
import type { BatchEvidence, TrustedBatchConfig } from './core.js';
import type { ConnectEvidenceAnchor } from './rpc.js';
import { verifyBundle, verifyEvidence } from './verify.js';
import type { ParsedBundle, StageResult } from './types.js';

const verified = (stage: StageResult['stage']): StageResult => ({ stage, status: 'VERIFIED', message: 'fixture passed' });
const fixtureBundle: ParsedBundle = { path: 'fixture.json' };

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
      matchCommitment: async () => verified('commitment-matching'),
      verifyVaultSignature: async () => verified('vault-signature'),
      lookupCheckpoint: async () => ({ stage: 'direct-rpc', status: 'UNVERIFIABLE', reasonCode: 'RPC_UNAVAILABLE', message: 'fixture RPC unavailable' })
    });
    expect(result.status).toBe('UNVERIFIABLE');
    expect(result.reasonCode).toBe('RPC_UNAVAILABLE');
  });

  it('uses a usage exit code when required CLI arguments are absent', async () => {
    const errors: string[] = [];
    await expect(run(['verify'], () => undefined, (value) => errors.push(value))).resolves.toBe(64);
    expect(errors[0]).toContain('--bundle');
  });
});

const rpcUrl = 'https://rpc.example.invalid/cyprus1';
const options = { bundlePath: 'normalized fixture', rpcUrl };

function fixture() {
  const key = '0x' + '01'.repeat(32);
  const sourceId = '0x' + '61'.repeat(32);
  const trusted: TrustedBatchConfig = {
    signer: getEthereumAddress(key),
    domain: { name: 'EvidenceAnchor', version: '1', chainId: 15000n, verifyingContract: '0x00' + '12'.repeat(19) }
  };
  const events = [Buffer.from([0xff, 0x00, 0x0a]), Buffer.from([0x7b, 0x0d, 0x0a])].map((rawEventBytes, index) => ({
    version: 1, sourceId, vaultSequence: BigInt(index + 1), rawEventBytes,
    payloadHash: '0x' + createHash('sha256').update(rawEventBytes).digest('hex')
  }));
  const tree = buildMerkleTree(events.map(hashLeaf));
  const commitment = {
    sourceId, sequenceStart: 1n, sequenceEnd: 2n, leafCount: 2n,
    merkleRoot: '0x' + tree.root.toString('hex'), previousCheckpointHash: GENESIS_CHECKPOINT_HASH
  };
  const evidence: BatchEvidence = {
    events: events.map((event, index) => ({ ...event, siblings: generateMerkleProof(tree.layers, index).siblings })),
    commitment, commitmentHash: computeCommitmentStructHashHex(commitment),
    signature: signBatchCommitment(key, trusted.domain, commitment).signature
  };
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
        expect(hash).toBe(evidence.commitmentHash);
        return method === 'isBatchAnchored' ? true : [
          commitment.sourceId, commitment.sequenceStart, commitment.sequenceEnd, commitment.leafCount,
          commitment.merkleRoot, commitment.previousCheckpointHash
        ];
      }
    };
  };
  return { evidence, trusted, connect };
}

describe('normalized evidence verification', () => {
  it('verifies exact binary evidence, local proofs, and a matching ABI lookup', async () => {
    const { evidence, trusted, connect } = fixture();
    const result = await verifyEvidence(evidence, { ...options, trusted, connect });
    expect(result.status).toBe('VERIFIED');
    expect(result.stages.map(({ stage }) => stage)).toEqual([
      'bundle-parsing', 'raw-byte-validation', 'commitment-matching', 'merkle-verification', 'vault-signature', 'direct-rpc'
    ]);
    expect(result.stages[0]).not.toHaveProperty('bundle');
  });

  it('detects tampered raw event bytes', async () => {
    const { evidence, trusted } = fixture();
    evidence.events[0].rawEventBytes[0] ^= 1;
    await expect(verifyEvidence(evidence, { ...options, trusted })).resolves.toMatchObject({
      status: 'TAMPERED', reasonCode: 'PAYLOAD_HASH_MISMATCH'
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

  it('rejects ZIP input before treating archive members as evidence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'trusttrace-verifier-'));
    const path = join(directory, 'unsupported.zip');
    await writeFile(path, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    await expect(verifyBundle({ bundlePath: path, rpcUrl })).resolves.toMatchObject({
      status: 'UNVERIFIABLE', reasonCode: 'BUNDLE_SCHEMA_UNAVAILABLE'
    });
  });
});
