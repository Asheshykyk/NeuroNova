import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { verifyProof } from '@trusttrace/core';
import { EvidenceBatchManager } from '../src/batching/EvidenceBatchManager.ts';
import { EvidenceStore } from '../src/storage/evidenceStore.ts';

const sourceId = '0x' + '11'.repeat(32);

async function openStore(directory: string): Promise<EvidenceStore> {
  return EvidenceStore.open({ directory });
}

async function appendEvidence(store: EvidenceStore, count: number): Promise<void> {
  for (let index = 1; index <= count; index += 1) {
    await store.append({
      sourceId,
      rawEventBytes: Buffer.from(`event-${index}`),
      deliveryId: `delivery-${index}`
    });
  }
}

test('batch generation is deterministic and creates correct Merkle proofs', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-batching-'));
  const store = await openStore(directory);
  context.after(() => store.close());
  await appendEvidence(store, 3);

  const manager = new EvidenceBatchManager(store, { directory, batchMaxLeaves: 2 });
  const first = await manager.generateNextBatches();
  assert.equal(first.length, 2);
  assert.deepEqual(first.map((batch) => batch.sequenceStart), ['1', '3']);
  assert.deepEqual(first.map((batch) => batch.sequenceEnd), ['2', '3']);
  assert.equal(first[0].leafCount, '2');
  assert.equal(first[1].leafCount, '1');
  assert.equal(first[1].previousCheckpointHash, first[0].commitmentHash);

  const second = await manager.generateNextBatches();
  assert.deepEqual(second, []);

  for (const batch of first) {
    const anchored = await manager.getBatchForAnchoring(batch.batchId);
    assert.ok(anchored);
    assert.equal(anchored.commitment.sourceId, sourceId);
    assert.equal(anchored.proofs.length, Number(batch.leafCount));
    for (const proof of anchored.proofs) {
      assert.equal(verifyProof(proof), true);
    }
  }
});

test('batch state survives restart and duplicate evidence is not batched twice', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-batching-restart-'));
  let store = await openStore(directory);
  await appendEvidence(store, 2);
  let manager = new EvidenceBatchManager(store, { directory, batchMaxLeaves: 10 });
  const generated = await manager.generateNextBatches();
  assert.equal(generated.length, 1);
  store.close();

  store = await openStore(directory);
  context.after(() => store.close());
  manager = new EvidenceBatchManager(store, { directory, batchMaxLeaves: 10 });
  assert.equal(manager.listBatchRecords().length, 1);
  assert.deepEqual(await manager.generateNextBatches(), []);
});

test('incomplete batch JSONL tail is recovered safely', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-batching-partial-'));
  const store = await openStore(directory);
  context.after(() => store.close());
  await appendEvidence(store, 1);

  const batchDirectory = path.join(directory, 'batches');
  fs.mkdirSync(batchDirectory, { recursive: true });
  fs.writeFileSync(path.join(batchDirectory, 'batches.jsonl'), '{"recordType":"batch"');

  const manager = new EvidenceBatchManager(store, { directory, batchMaxLeaves: 10 });
  const generated = await manager.generateNextBatches();
  assert.equal(generated.length, 1);
  assert.equal(manager.listBatchRecords().length, 1);
  assert.deepEqual(await manager.generateNextBatches(), []);
});

test('empty evidence produces no batch', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-batching-empty-'));
  const store = await openStore(directory);
  context.after(() => store.close());
  const manager = new EvidenceBatchManager(store, { directory });
  assert.deepEqual(await manager.generateNextBatches(), []);
  assert.deepEqual(manager.listBatchRecords(), []);
});
