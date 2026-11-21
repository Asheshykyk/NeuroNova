import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { BatchCommitment } from '@trusttrace/core';
import { EvidenceBatchManager } from '../src/batching/EvidenceBatchManager.ts';
import { AnchoringWorker } from '../src/blockchain/AnchoringWorker.ts';
import type { EvidenceAnchorClient, AnchorReceipt, AnchoringTransaction } from '../src/blockchain/types.ts';
import { EvidenceStore } from '../src/storage/evidenceStore.ts';

const sourceId = '0x' + '22'.repeat(32);
const privateKey = '0x' + '01'.repeat(32);

class MockAnchorClient implements EvidenceAnchorClient {
  anchored = new Set<string>();
  receipts = new Map<string, AnchorReceipt | null>();
  submitted: Array<{ commitment: BatchCommitment; signature: string }> = [];
  submitError: Error | null = null;

  async chainId(): Promise<bigint> { return 31337n; }
  async isBatchAnchored(commitmentHash: string): Promise<boolean> { return this.anchored.has(commitmentHash); }
  async getBatch(_commitmentHash: string): Promise<BatchCommitment | null> { return null; }
  async submitBatch(commitment: BatchCommitment, signature: string): Promise<AnchoringTransaction> {
    if (this.submitError) throw this.submitError;
    this.submitted.push({ commitment, signature });
    const hash = '0x' + 'aa'.repeat(32);
    return { transactionHash: hash };
  }
  async getTransactionReceipt(transactionHash: string): Promise<AnchorReceipt | null> {
    return this.receipts.get(transactionHash) ?? null;
  }
}

async function setup(directory: string) {
  const store = await EvidenceStore.open({ directory });
  await store.append({ sourceId, rawEventBytes: Buffer.from('raw-evidence-never-to-chain') });
  const batchManager = new EvidenceBatchManager(store, {
    directory,
    batchMaxLeaves: 10,
    vaultSignerPrivateKey: privateKey,
    eip712Domain: {
      name: 'EvidenceAnchor',
      version: '1',
      chainId: 31337n,
      verifyingContract: '0x' + '33'.repeat(20)
    }
  });
  await batchManager.generateNextBatches();
  return { store, batchManager };
}

test('anchoring worker submits commitment and signature, never raw evidence', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-anchor-submit-'));
  const { store, batchManager } = await setup(directory);
  context.after(() => store.close());
  const client = new MockAnchorClient();
  const worker = new AnchoringWorker({ directory, batchManager, client });

  const updates = await worker.processEligibleBatches();
  assert.equal(updates.length, 1);
  assert.equal(updates[0].status, 'submitted');
  assert.equal(updates[0].transactionHash, '0x' + 'aa'.repeat(32));
  assert.equal(updates[0].blockNumber, null);
  assert.equal(client.submitted.length, 1);
  assert.equal(client.submitted[0].commitment.sourceId, sourceId);
  assert.equal(client.submitted[0].signature.length, 132);
});

test('pending transaction recovers and becomes confirmed after restart', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-anchor-restart-'));
  const { store, batchManager } = await setup(directory);
  context.after(() => store.close());
  const firstClient = new MockAnchorClient();
  const firstWorker = new AnchoringWorker({ directory, batchManager, client: firstClient });
  await firstWorker.processEligibleBatches();

  const txHash = '0x' + 'aa'.repeat(32);
  const secondClient = new MockAnchorClient();
  secondClient.receipts.set(txHash, { transactionHash: txHash, blockNumber: 42n, status: 1 });
  const secondWorker = new AnchoringWorker({ directory, batchManager, client: secondClient });
  const updates = await secondWorker.processEligibleBatches();
  assert.equal(updates.length, 1);
  assert.equal(updates[0].status, 'confirmed');
  assert.equal(updates[0].blockNumber, '42');
  assert.equal(secondClient.submitted.length, 0);
});

test('reverted transaction becomes failed and retries up to the configured limit', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-anchor-failed-'));
  const { store, batchManager } = await setup(directory);
  context.after(() => store.close());
  const client = new MockAnchorClient();
  client.submitError = new Error('temporary RPC failure');
  const worker = new AnchoringWorker({ directory, batchManager, client, maxAttempts: 2 });

  await worker.processEligibleBatches();
  let latest = worker.getLatestStatuses();
  let batchId = Array.from(latest.keys())[0];
  assert.equal(latest.get(batchId)?.status, 'failed');
  assert.equal(latest.get(batchId)?.attempt, 1);

  await worker.processEligibleBatches();
  latest = worker.getLatestStatuses();
  batchId = Array.from(latest.keys())[0];
  assert.equal(latest.get(batchId)?.attempt, 2);

  await worker.processEligibleBatches();
  latest = worker.getLatestStatuses();
  assert.equal(latest.get(batchId)?.attempt, 2);
});

test('contract duplicate is reported as confirmed without resubmission', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-anchor-duplicate-'));
  const { store, batchManager } = await setup(directory);
  context.after(() => store.close());
  const batch = batchManager.listBatchRecords()[0];
  const client = new MockAnchorClient();
  client.anchored.add(batch.commitmentHash);
  const worker = new AnchoringWorker({ directory, batchManager, client });

  const updates = await worker.processEligibleBatches();
  assert.equal(updates.length, 1);
  assert.equal(updates[0].status, 'confirmed');
  assert.equal(client.submitted.length, 0);
});
