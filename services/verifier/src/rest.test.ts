import { EvidenceAnchorABI } from '@trusttrace/core/abi';
import { Interface } from 'quais';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashLeaf } from '@trusttrace/core/canonical';
import { computeCommitmentStructHashHex, GENESIS_CHECKPOINT_HASH } from '@trusttrace/core/commitment';
import { buildMerkleTree, generateMerkleProof } from '@trusttrace/core/merkle';
import { getEthereumAddress, signBatchCommitment } from '@trusttrace/core/signer';
import { run } from './index.js';
import { verifyRest } from './rest.js';
import { LOCAL_VAULT_TRUST, type ConnectEvidenceAnchor } from './rpc.js';

const sourceId = '0x' + 'ab'.repeat(32);
const options = { baseUrl: 'http://localhost:3000/api/v1', sourceId, sequence: '1' };
// Select the published Hardhat development account by the frozen registry address.
const config = readFileSync(new URL('../../../blockchain/hardhat.config.cjs', import.meta.url), 'utf8');
const fixtureKey = [...config.matchAll(/'(0x[0-9a-f]{64})'/gi)].map((m) => m[1]).find(
  (key) => getEthereumAddress(key).toLowerCase() === LOCAL_VAULT_TRUST.signer.toLowerCase(),
);
if (!fixtureKey) throw new Error('Frozen local development signer fixture is unavailable.');

function fixture() {
  const raw = Buffer.from([0xff, 0x00, 0x0a]);
  const leaf = hashLeaf({ version: 1, sourceId, vaultSequence: 1n, rawEventBytes: raw });
  const secondLeaf = hashLeaf({ version: 1, sourceId, vaultSequence: 2n, rawEventBytes: Buffer.from([0x80]) });
  const tree = buildMerkleTree([leaf, secondLeaf]);
  const commitment = {
    sourceId, sequenceStart: 1n, sequenceEnd: 2n, leafCount: 2n,
    merkleRoot: '0x' + tree.root.toString('hex'), previousCheckpointHash: GENESIS_CHECKPOINT_HASH,
  };
  const signed = signBatchCommitment(fixtureKey!, LOCAL_VAULT_TRUST.domain, commitment);
  const batch = {
    batchId: signed.structHash, commitmentHash: signed.structHash, sourceId, startSequence: '1', endSequence: '2',
    leafCount: 2, merkleRoot: commitment.merkleRoot, previousBatchRoot: commitment.previousCheckpointHash,
    commitment: { ...commitment, sequenceStart: '1', sequenceEnd: '2', leafCount: '2' },
    vaultSignature: signed.signature as string | null, vaultSignerAddress: signed.signer,
    anchorStatus: 'ANCHOR_PENDING', transactionHash: null, chainId: null, blockNumber: null,
  };
  const detail = {
    eventId: 'opaque', sourceId, vaultSequence: '1', batchId: batch.batchId, signature: null,
    payloadSha256: '0x' + createHash('sha256').update(raw).digest('hex'), rawPayloadBase64: raw.toString('base64'),
    merkleProof: generateMerkleProof(tree.layers, 0),
  };
  return { batch, detail, commitment };
}

function serve(data: ReturnType<typeof fixture>, paged = false) {
  const request = vi.fn(async (input: URL | string) => {
    const url = new URL(input);
    if (url.pathname === `/api/v1/events/${sourceId}/1`) return Response.json(data.detail);
    expect(url.pathname).toBe('/api/v1/batches');
    expect(url.searchParams.get('sourceId')).toBe(sourceId);
    if (paged && !url.searchParams.has('cursor')) return Response.json({ items: [], nextCursor: 'opaque+/cursor' });
    if (paged) expect(url.searchParams.get('cursor')).toBe('opaque+/cursor');
    return Response.json({ items: [data.batch], nextCursor: null });
  });
  vi.stubGlobal('fetch', request);
  return request;
}
const statusOf = (v: Awaited<ReturnType<typeof verifyRest>>, stage: string) => v.tier1.stages.find((s) => s.stage === stage);

afterEach(() => vi.unstubAllGlobals());

describe('REST Auditor', () => {
  it('verifies the signed batch, exact bytes and proof while keeping pending anchors and missing Tier 2 unverifiable', async () => {
    const fetch = serve(fixture(), true);
    const connect = vi.fn<ConnectEvidenceAnchor>();
    const result = await verifyRest(options, connect);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(connect).not.toHaveBeenCalled();
    for (const stage of ['vault-signature', 'raw-byte-validation', 'merkle-verification', 'commitment-matching']) {
      expect(statusOf(result, stage)?.status).toBe('VERIFIED');
    }
    expect(statusOf(result, 'direct-rpc')?.reasonCode).toBe('CONTRACT_LOOKUP_UNAVAILABLE');
    expect(result).toMatchObject({ status: 'UNVERIFIABLE', reasonCode: 'REQUIRED_EVIDENCE_MISSING',
      tier2: { status: 'UNVERIFIABLE', reasonCode: 'REQUIRED_EVIDENCE_MISSING' } });
  });

  it('treats unsigned batches as missing evidence, with local consistency checks still available', async () => {
    const data = fixture();
    data.batch.vaultSignature = null;
    serve(data);
    const result = await verifyRest(options);
    expect(statusOf(result, 'vault-signature')).toMatchObject({ status: 'UNVERIFIABLE', reasonCode: 'REQUIRED_EVIDENCE_MISSING' });
    expect(statusOf(result, 'merkle-verification')?.status).toBe('VERIFIED');
  });

  it('accepts the prior backend response shape without claiming signature verification', async () => {
    const data = fixture();
    const { commitment, vaultSignature, vaultSignerAddress, ...old } = data.batch;
    Object.assign(data, { batch: old });
    serve(data);
    const result = await verifyRest(options);
    expect(statusOf(result, 'vault-signature')?.status).toBe('UNVERIFIABLE');
    expect(statusOf(result, 'commitment-matching')?.status).toBe('VERIFIED');
  });

  it('rejects a signature from the wrong signer even when REST claims the expected signer', async () => {
    const data = fixture();
    data.batch.vaultSignature = signBatchCommitment(Buffer.alloc(32, 1), LOCAL_VAULT_TRUST.domain, data.commitment).signature;
    serve(data);
    expect(await verifyRest(options)).toMatchObject({ status: 'TAMPERED', reasonCode: 'SIGNATURE_INVALID' });
  });

  it('distinguishes cryptographically invalid signatures from malformed input', async () => {
    const data = fixture();
    data.batch.vaultSignature = '0x' + '00'.repeat(65);
    serve(data);
    expect(await verifyRest(options)).toMatchObject({ status: 'TAMPERED', reasonCode: 'SIGNATURE_INVALID' });
    data.batch.vaultSignature = 'bad hex';
    serve(data);
    const result = await verifyRest(options);
    expect(result.status).toBe('UNVERIFIABLE');
    expect(statusOf(result, 'vault-signature')?.reasonCode).toBe('REST_RESPONSE_INVALID');
  });

  it('distinguishes a forged signer label from authentic recovered signer evidence', async () => {
    const data = fixture();
    data.batch.vaultSignerAddress = '0x' + '22'.repeat(20);
    serve(data);
    const result = await verifyRest(options);
    expect(result.status).toBe('UNVERIFIABLE');
    expect(statusOf(result, 'vault-signature')?.status).toBe('VERIFIED');
    expect(statusOf(result, 'commitment-matching')?.reasonCode).toBe('REST_INCONSISTENT');
  });

  it('detects altered bytes against the authenticated leaf and does not overclaim when unsigned', async () => {
    const data = fixture();
    data.detail.rawPayloadBase64 = Buffer.from([0xff, 0x00]).toString('base64');
    serve(data);
    expect(await verifyRest(options)).toMatchObject({ status: 'TAMPERED', reasonCode: 'PAYLOAD_HASH_MISMATCH' });
    data.batch.vaultSignature = null;
    serve(data);
    const result = await verifyRest(options);
    expect(result.status).toBe('UNVERIFIABLE');
    expect(statusOf(result, 'raw-byte-validation')?.reasonCode).toBe('REST_INCONSISTENT');
  });

  it('rejects an altered sibling against an authenticated root', async () => {
    const data = fixture();
    data.detail.merkleProof.siblings[0] = GENESIS_CHECKPOINT_HASH;
    data.detail.merkleProof.steps[0].sibling = GENESIS_CHECKPOINT_HASH;
    serve(data);
    expect(await verifyRest(options)).toMatchObject({ status: 'TAMPERED', reasonCode: 'PROOF_INVALID' });
  });

  it('reports forged outer commitment fields as a REST inconsistency', async () => {
    const data = fixture();
    data.batch.merkleRoot = GENESIS_CHECKPOINT_HASH;
    serve(data);
    const result = await verifyRest(options);
    expect(result.status).toBe('UNVERIFIABLE');
    expect(statusOf(result, 'commitment-matching')?.reasonCode).toBe('REST_INCONSISTENT');
  });

  it('rejects malformed response data', async () => {
    const data = fixture();
    data.detail.rawPayloadBase64 = 'bad base64';
    serve(data);
    const result = await verifyRest(options);
    expect(result.tier1.reasonCode).toBe('REST_RESPONSE_INVALID');
    expect(result.status).toBe('UNVERIFIABLE');
  });

  it('keeps a claimed anchor unverifiable when RPC is unavailable', async () => {
    const data = fixture();
    data.batch.anchorStatus = 'ANCHORED';
    serve(data);
    const connect: ConnectEvidenceAnchor = () => ({
      getNetwork: async () => { throw new Error('connection refused'); },
      read: vi.fn(),
    });
    const result = await verifyRest(options, connect);
    expect(statusOf(result, 'direct-rpc')?.reasonCode).toBe('RPC_UNAVAILABLE');
    expect(result).toMatchObject({ status: 'UNVERIFIABLE', reasonCode: 'REQUIRED_EVIDENCE_MISSING' });
  });

  it('verifies Tier 1 via direct RPC for an already anchored revoked source while Tier 2 remains unavailable', async () => {
    const data = fixture();
    data.batch.anchorStatus = 'ANCHORED';
    serve(data);
    const hash = computeCommitmentStructHashHex(data.commitment);
    const read = vi.fn(async (method) => {
      if (method === 'getSource') return [LOCAL_VAULT_TRUST.signer, true, true, 2n, hash, 1n];
      if (method === 'isBatchAnchored') return true;
      if (method === 'getLatest') return [data.commitment, hash];
      return data.commitment;
    });
    const result = await verifyRest(options, () => ({ getNetwork: async () => ({ chainId: 31337n }), read }));
    expect(read).toHaveBeenCalledWith('isBatchAnchored', hash);
    expect(read).toHaveBeenCalledWith('getBatch', hash);
    expect(result).toMatchObject({
      status: 'UNVERIFIABLE', reasonCode: 'REQUIRED_EVIDENCE_MISSING', tier1: { status: 'VERIFIED' },
      tier2: { status: 'UNVERIFIABLE' },
    });
  });

  it('uses read-only EVM RPC calls against the frozen Tier 1 contract', async () => {
    const data = fixture();
    data.batch.anchorStatus = 'ANCHORED';
    const serveRest = serve(data);
    const abi = new Interface(EvidenceAnchorABI);
    const hash = data.batch.commitmentHash;
    const commitment = Object.values(data.commitment);
    const results = {
      getSource: [LOCAL_VAULT_TRUST.signer, true, false, 2n, hash, 1n],
      isBatchAnchored: [true],
      getLatest: [commitment, hash],
      getBatch: [commitment],
    };
    const reads: string[] = [];
    const rpcUrl = 'http://localhost:8545/';
    vi.stubGlobal('fetch', async (input: URL | string, init?: RequestInit) => {
      if (input !== rpcUrl) return serveRest(input);
      expect(init?.method).toBe('POST');
      const request = JSON.parse(String(init?.body));
      if (request.method === 'eth_chainId') {
        return Response.json({ jsonrpc: '2.0', id: 1, result: '0x7a69' });
      }
      expect(request.method).toBe('eth_call');
      const [call, block] = request.params;
      expect(call.to).toBe(LOCAL_VAULT_TRUST.domain.verifyingContract);
      expect(block).toBe('latest');
      const parsed = abi.parseTransaction({ data: call.data });
      if (!parsed || !(parsed.name in results)) throw new Error('Unexpected contract call');
      const method = parsed.name as keyof typeof results;
      reads.push(method);
      return Response.json({ jsonrpc: '2.0', id: 1, result: abi.encodeFunctionResult(method, results[method]) });
    });
    expect(await verifyRest({ ...options, rpcUrl })).toMatchObject({
      status: 'UNVERIFIABLE', reasonCode: 'REQUIRED_EVIDENCE_MISSING', tier1: { status: 'VERIFIED' },
    });
    expect(reads).toEqual(['getSource', 'isBatchAnchored', 'getLatest', 'getBatch']);
  });

  it('emits separate Tier results via the JSON command with exit 2', async () => {
    serve(fixture());
    const out = vi.fn();
    expect(await run(['verify-rest', '--base-url', options.baseUrl, '--source-id', sourceId, '--sequence', '1', '--json'], out)).toBe(2);
    expect(JSON.parse(out.mock.calls[0][0])).toMatchObject({
      scope: 'vault-rest', status: 'UNVERIFIABLE', tier1: { status: 'UNVERIFIABLE' }, tier2: { status: 'UNVERIFIABLE' },
    });
  });
});
