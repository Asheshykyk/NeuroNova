import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  computeCommitmentStructHashHex,
  computeLeafHashHex,
  formatSourceIdHex,
  getEthereumAddress,
  type BatchCommitment,
  type EIP712Domain
} from '@trusttrace/core';
import { EvidenceStore } from '../src/storage/evidenceStore.ts';
import { EvidenceBatchManager } from '../src/batching/EvidenceBatchManager.ts';
import { AnchoringWorker } from '../src/blockchain/AnchoringWorker.ts';
import { EthersEvidenceAnchorClient } from '../src/blockchain/EthersEvidenceAnchorClient.ts';
import type { EvidenceAnchorClient, AnchorReceipt, AnchoringTransaction } from '../src/blockchain/types.ts';

const sourceId = '0x1111111111111111111111111111111111111111111111111111111111111111';
const vaultSignerPrivateKey = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const relayerPrivateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

class LocalAnchorSimulator implements EvidenceAnchorClient {
  public readonly chainIdValue: bigint;
  private readonly batches = new Map<string, BatchCommitment>();
  private readonly receipts = new Map<string, AnchorReceipt>();

  constructor(chainId: bigint = 31337n) {
    this.chainIdValue = chainId;
  }

  async chainId(): Promise<bigint> {
    return this.chainIdValue;
  }

  async isBatchAnchored(commitmentHash: string): Promise<boolean> {
    return this.batches.has(commitmentHash);
  }

  async getBatch(commitmentHash: string): Promise<BatchCommitment | null> {
    return this.batches.get(commitmentHash) ?? null;
  }

  async submitBatch(commitment: BatchCommitment, _signature: string): Promise<AnchoringTransaction> {
    const hash = computeCommitmentStructHashHex(commitment);
    this.batches.set(hash, { ...commitment });
    const txHash = '0x' + Buffer.from(hash.slice(2), 'hex').reverse().toString('hex');
    this.receipts.set(txHash, {
      transactionHash: txHash,
      blockNumber: 100n,
      status: 1
    });
    return { transactionHash: txHash };
  }

  async getTransactionReceipt(transactionHash: string): Promise<AnchorReceipt | null> {
    return this.receipts.get(transactionHash) ?? null;
  }
}

test('liveAnchor pipeline: validates contract configuration, batch commitment, and on-chain root query', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-live-anchor-'));
  const store = await EvidenceStore.open({ directory });
  context.after(() => {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  // 1. Ingest real evidence
  const rawLine = 'Nov 21 07:12:00 host-01 sshd[1234]: Accepted publickey for testuser from 192.168.1.50 port 54321 ssh2\n';
  await store.append({
    sourceId,
    rawEventBytes: Buffer.from(rawLine, 'utf8'),
    observedAt: 1700550000000000000n,
    deliveryId: '550e8400-e29b-41d4-a716-446655440001',
    streamId: 'auth.log',
    fileIdentity: 'auth.log',
    fileGeneration: 'dev:1:ino:100',
    byteOffset: 0n,
    observationSource: 'host-agent'
  });

  const contractAddress = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
  const eip712Domain: EIP712Domain = {
    name: 'EvidenceAnchor',
    version: '1',
    chainId: 31337n,
    verifyingContract: contractAddress
  };

  const batchManager = new EvidenceBatchManager(store, {
    directory,
    batchMaxLeaves: 10,
    vaultSignerPrivateKey,
    eip712Domain
  });

  const batches = await batchManager.generateNextBatches();
  assert.equal(batches.length, 1);
  const batch = batches[0];
  assert.equal(batch.sourceId, sourceId);
  assert.equal(BigInt(batch.leafCount), 1n);
  assert.ok(batch.merkleRoot.startsWith('0x'));

  // 2. Test Anchor Client (Live RPC if active, simulator otherwise)
  let client: EvidenceAnchorClient;
  const rpcUrl = process.env.LOCAL_RPC_URL || 'http://127.0.0.1:8545';
  let isLiveRpc = false;

  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      signal: AbortSignal.timeout(1000)
    });
    if (res.ok) {
      client = new EthersEvidenceAnchorClient({
        rpcUrl,
        contractAddress,
        relayerPrivateKey
      });
      isLiveRpc = true;
    } else {
      client = new LocalAnchorSimulator(31337n);
    }
  } catch {
    client = new LocalAnchorSimulator(31337n);
  }

  const worker = new AnchoringWorker({ directory, batchManager, client });
  const updates = await worker.processEligibleBatches();
  assert.equal(updates.length, 1);
  assert.ok(updates[0].transactionHash);

  // 3. Confirm on-chain batch lookup
  const isAnchored = await client.isBatchAnchored(batch.commitmentHash);
  assert.equal(isAnchored, true);

  const onChainBatch = await client.getBatch(batch.commitmentHash);
  assert.ok(onChainBatch);
  assert.equal(onChainBatch.merkleRoot, batch.merkleRoot);
  assert.equal(onChainBatch.sourceId, sourceId);
  assert.equal(onChainBatch.sequenceStart, 1n);
  assert.equal(onChainBatch.sequenceEnd, 1n);

  console.log(`[liveAnchor.test] Verified batch ${batch.commitmentHash} anchoring (${isLiveRpc ? 'Live JSON-RPC' : 'Local Anchor Simulator'})`);
});
