import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { BatchCommitment } from '@trusttrace/core';
import { EvidenceBatchManager } from '../src/batching/EvidenceBatchManager.ts';
import { EvidenceStore } from '../src/storage/evidenceStore.ts';
import { EvidenceVerifier } from '../src/verification/EvidenceVerifier.ts';
import type { EvidenceAnchorClient, AnchorReceipt, AnchoringTransaction } from '../src/blockchain/types.ts';
import { AnchoringWorker } from '../src/blockchain/AnchoringWorker.ts';

const sourceId = '0x' + '44'.repeat(32);
const privateKey = '0x' + '02'.repeat(32);
const contractAddress = '0x' + '55'.repeat(20);

class VerificationAnchorClient implements EvidenceAnchorClient {
  anchored = false;
  chainError: Error | null = null;
  anchoredError: Error | null = null;
  submitError: Error | null = null;
  chainCommitment: BatchCommitment | null = null;

  async chainId(): Promise<bigint> { if (this.chainError) throw this.chainError; return 31337n; }
  async isBatchAnchored(_commitmentHash: string): Promise<boolean> { if (this.anchoredError) throw this.anchoredError; return this.anchored; }
  async getBatch(_commitmentHash: string): Promise<BatchCommitment | null> { return this.chainCommitment; }
  async submitBatch(_commitment: BatchCommitment, _signature: string): Promise<AnchoringTransaction> { if (this.submitError) throw this.submitError; return { transactionHash: '0x' + '66'.repeat(32) }; }
  async getTransactionReceipt(_transactionHash: string): Promise<AnchorReceipt | null> { return null; }
}

async function setup(directory: string, batch = true) {
  const store = await EvidenceStore.open({ directory });
  await store.append({ sourceId, rawEventBytes: Buffer.from('verified-evidence') });
  const batchManager = new EvidenceBatchManager(store, {
    directory,
    batchMaxLeaves: 10,
    vaultSignerPrivateKey: privateKey,
    eip712Domain: {
      name: 'EvidenceAnchor',
      version: '1',
      chainId: 31337n,
      verifyingContract: contractAddress
    }
  });
  if (batch) await batchManager.generateNextBatches();
  const client = new VerificationAnchorClient();
  const worker = new AnchoringWorker({ directory, batchManager, client, maxAttempts: 2 });
  const verifier = new EvidenceVerifier({
    store,
    batchManager,
    anchorClient: client,
    anchoringWorker: worker,
    eip712Domain: {
      name: 'EvidenceAnchor',
      version: '1',
      chainId: 31337n,
      verifyingContract: contractAddress
    }
  });
  return { store, batchManager, client, worker, verifier };
}

test('valid evidence produces ANCHOR_PENDING until chain confirmation', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-verification-valid-'));
  const { store, verifier } = await setup(directory);
  context.after(() => store.close());
  const result = await verifier.verifyEvidence(sourceId, 1);
  assert.equal(result.verdict, 'ANCHOR_PENDING');
  assert.equal(result.batchId !== null, true);
});

test('invalid Merkle mapping produces UNVERIFIABLE', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-verification-proof-'));
  const { store, batchManager, verifier } = await setup(directory);
  context.after(() => store.close());
  const batch = batchManager.listBatchRecords()[0];
  batch.evidenceMappings[0].leafHash = '0x' + '77'.repeat(32);

  const batchFile = path.join(directory, 'batches', 'batches.jsonl');
  fs.writeFileSync(batchFile, JSON.stringify({
    ...batch,
    evidenceMappings: batch.evidenceMappings
  }) + '\n');

  const result = await verifier.verifyEvidence(sourceId, 1);
  assert.equal(result.verdict, 'UNVERIFIABLE');
});

test('missing batch distinguishes VAULT_PERSISTED', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-verification-missing-batch-'));
  const { store, verifier } = await setup(directory, false);
  context.after(() => store.close());
  const result = await verifier.verifyEvidence(sourceId, 1);
  assert.equal(result.verdict, 'VAULT_PERSISTED');
  assert.equal(result.batchId, null);
});

test('confirmed on-chain commitment produces ANCHORED', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-verification-anchored-'));
  const { store, batchManager, client, verifier } = await setup(directory);
  context.after(() => store.close());
  const batch = batchManager.listBatchRecords()[0];
  client.anchored = true;
  client.chainCommitment = {
    sourceId: batch.sourceId,
    sequenceStart: BigInt(batch.sequenceStart),
    sequenceEnd: BigInt(batch.sequenceEnd),
    leafCount: BigInt(batch.leafCount),
    merkleRoot: batch.merkleRoot,
    previousCheckpointHash: batch.previousCheckpointHash
  };
  const result = await verifier.verifyEvidence(sourceId, 1);
  assert.equal(result.verdict, 'ANCHORED');
});

test('failed anchoring transaction is distinguished as ANCHOR_FAILED', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-verification-failed-'));
  const { store, client, worker, verifier } = await setup(directory);
  context.after(() => store.close());
  client.submitError = new Error('RPC rejected transaction');
  await worker.processEligibleBatches();
  const result = await verifier.verifyEvidence(sourceId, 1);
  assert.equal(result.verdict, 'ANCHOR_FAILED');
  assert.match(result.detail, /RPC rejected transaction|Anchoring failed/i);
});

test('RPC failure is UNVERIFIABLE and not CHAIN_MISMATCH', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-verification-rpc-'));
  const { store, client, verifier } = await setup(directory);
  context.after(() => store.close());
  client.chainError = new Error('RPC unavailable');
  const result = await verifier.verifyEvidence(sourceId, 1);
  assert.equal(result.verdict, 'UNVERIFIABLE');
  assert.match(result.detail, /RPC|blockchain/i);
});

test('actual on-chain commitment mismatch produces CHAIN_MISMATCH', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-verification-mismatch-'));
  const { store, batchManager, client, verifier } = await setup(directory);
  context.after(() => store.close());
  const batch = batchManager.listBatchRecords()[0];
  client.anchored = true;
  client.chainCommitment = {
    sourceId: batch.sourceId,
    sequenceStart: 1n,
    sequenceEnd: 2n,
    leafCount: 2n,
    merkleRoot: '0x' + '88'.repeat(32),
    previousCheckpointHash: batch.previousCheckpointHash
  };
  const result = await verifier.verifyEvidence(sourceId, 1);
  assert.equal(result.verdict, 'CHAIN_MISMATCH');
});

test('reconciliation reports pending and RPC failures safely', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-verification-reconcile-'));
  const { store, verifier } = await setup(directory);
  context.after(() => store.close());

  const pending = await verifier.reconcile();
  assert.equal(pending[0].verdict, 'ANCHOR_PENDING');

  const mismatchDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-verification-reconcile-rpc-'));
  const mismatchSetup = await setup(mismatchDirectory);
  context.after(() => mismatchSetup.store.close());
  mismatchSetup.client.chainError = new Error('network down');
  const unavailable = await mismatchSetup.verifier.reconcile();
  assert.equal(unavailable[0].verdict, 'UNVERIFIABLE');
});
