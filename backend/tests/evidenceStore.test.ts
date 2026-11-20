import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { combineLockReleaseError, EvidenceStore, writeCompleteRecordAndSync } from '../src/storage/evidenceStore.ts';

function temporaryDirectory(testName: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `trusttrace-${testName}-`));
  return directory;
}

test('partial writes are completed before fsync', async () => {
  const bytes = Buffer.from([1, 2, 3, 4, 5]);
  let offset = 0;
  let synced = false;
  const handle = {
    async write(buffer: Buffer, writeOffset: number, length: number) {
      const bytesWritten = Math.min(2, length);
      offset = writeOffset + bytesWritten;
      return { bytesWritten };
    },
    async sync() {
      synced = true;
    },
    async close() {}
  };

  await writeCompleteRecordAndSync(handle, bytes);
  assert.equal(offset, bytes.length);
  assert.equal(synced, true);
});

test('preserves exact binary bytes and assigns monotonic sequences', async () => {
  const directory = temporaryDirectory('evidence-binary');
  const raw = Buffer.from([0, 255, 10, 13, 32, 65, 66]);
  const store = await EvidenceStore.open({ directory, now: () => new Date('2026-11-20T19:54:36.428Z') });

  try {
    const first = await store.append({ sourceId: 'source-01', rawEventBytes: raw, deliveryId: 'delivery-1' });
    const second = await store.append({ sourceId: 'source-01', rawEventBytes: Buffer.from([1, 2, 3]) });

    assert.equal(first.vaultSequence, 1n);
    assert.equal(second.vaultSequence, 2n);
    assert.equal(first.receiptTimestamp, '2026-11-20T19:54:36.428Z');

    const segmentPath = path.join(directory, first.segmentName);
    const record = JSON.parse(fs.readFileSync(segmentPath, 'utf8').trim().split('\n')[0]);
    assert.equal(record.sourceId, '0x736f757263652d30310000000000000000000000000000000000000000000000');
    assert.equal(record.rawEventLength, raw.length);
    assert.deepEqual(Buffer.from(record.rawEventBytesBase64, 'base64'), raw);
  } finally {
    store.close();
  }
});

test('same deliveryId returns original duplicate receipt; conflict fails', async () => {
  const directory = temporaryDirectory('evidence-duplicate');
  const store = await EvidenceStore.open({ directory });

  try {
    const raw = Buffer.from([0, 1, 2, 255]);
    const first = await store.append({ sourceId: 'source-01', rawEventBytes: raw, deliveryId: 'same-delivery' });
    const duplicate = await store.append({ sourceId: 'source-01', rawEventBytes: Buffer.from(raw), deliveryId: 'same-delivery' });

    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.vaultSequence, first.vaultSequence);

    await assert.rejects(
      store.append({ sourceId: 'source-01', rawEventBytes: Buffer.from([9]), deliveryId: 'same-delivery' }),
      /distinct raw event bytes/
    );

    await assert.rejects(
      store.append({ sourceId: 'source-02', rawEventBytes: raw, deliveryId: 'same-delivery' }),
      /another sourceId/
    );

    const distinct = await store.append({ sourceId: 'source-01', rawEventBytes: Buffer.from([9]) });
    assert.equal(distinct.vaultSequence, 2n);
  } finally {
    store.close();
  }
});

test('restarts rebuild SQLite index and sequence state from JSONL', async () => {
  const directory = temporaryDirectory('evidence-restart');
  const databasePath = path.join(directory, 'index.sqlite3');

  const firstStore = await EvidenceStore.open({ directory, databasePath });
  const first = await firstStore.append({ sourceId: 'source-01', rawEventBytes: Buffer.from([1, 2, 3]) });
  firstStore.close();

  fs.rmSync(databasePath, { force: true });
  fs.rmSync(`${databasePath}-wal`, { force: true });
  fs.rmSync(`${databasePath}-shm`, { force: true });

  const reopened = await EvidenceStore.open({ directory, databasePath });
  try {
    const next = await reopened.append({ sourceId: 'source-01', rawEventBytes: Buffer.from([4, 5, 6]) });
    assert.equal(next.vaultSequence, first.vaultSequence + 1n);

    const db = new Database(databasePath, { readonly: true });
    try {
      const rows = db.prepare('SELECT vault_sequence, source_id, raw_event_length FROM evidence_records ORDER BY vault_sequence').all();
      assert.equal(rows.length, 2);
      assert.equal((rows[0] as { raw_event_length: number }).raw_event_length, 3);
      assert.equal(Object.prototype.hasOwnProperty.call(rows[0], 'raw_event_bytes'), false);
    } finally {
      db.close();
    }
  } finally {
    reopened.close();
  }
});

test('truncates an incomplete final JSONL line and does not reuse its sequence', async () => {
  const directory = temporaryDirectory('evidence-crash-tail');
  const store = await EvidenceStore.open({ directory });
  const first = await store.append({ sourceId: 'source-01', rawEventBytes: Buffer.from([7, 8]) });
  store.close();

  const segmentPath = path.join(directory, first.segmentName);
  fs.appendFileSync(segmentPath, '{"recordVersion":1,"vaultSequence":"2"');

  const reopened = await EvidenceStore.open({ directory });
  try {
    const next = await reopened.append({ sourceId: 'source-01', rawEventBytes: Buffer.from([9, 10]) });
    assert.equal(next.vaultSequence, 2n);
  } finally {
    reopened.close();
  }
});

test('creates a new segment only after the configured segment byte limit', async () => {
  const directory = temporaryDirectory('evidence-segments');
  const store = await EvidenceStore.open({ directory, segmentMaxBytes: 350 });

  try {
    const first = await store.append({ sourceId: 'source-01', rawEventBytes: Buffer.alloc(100, 1) });
    const second = await store.append({ sourceId: 'source-01', rawEventBytes: Buffer.alloc(100, 2) });

    assert.notEqual(first.segmentName, second.segmentName);
  } finally {
    store.close();
  }
});

test('earlier incomplete segment fails closed', async () => {
  const directory = temporaryDirectory('evidence-earlier-corruption');
  const store = await EvidenceStore.open({ directory, segmentMaxBytes: 100 });
  const first = await store.append({ sourceId: 'source-01', rawEventBytes: Buffer.alloc(40, 1) });
  await store.append({ sourceId: 'source-01', rawEventBytes: Buffer.alloc(40, 2) });
  store.close();

  const earlierPath = path.join(directory, first.segmentName);
  const bytes = fs.readFileSync(earlierPath);
  fs.truncateSync(earlierPath, bytes.length - 1);

  await assert.rejects(
    EvidenceStore.open({ directory, segmentMaxBytes: 100 }),
    /Earlier evidence segment has an incomplete/
  );
});

test('two store instances serialize sequence allocation', async () => {
  const directory = temporaryDirectory('evidence-concurrent');
  const firstStore = await EvidenceStore.open({ directory });
  const secondStore = await EvidenceStore.open({ directory });

  try {
    const receipts = await Promise.all([
      firstStore.append({ sourceId: 'source-01', rawEventBytes: Buffer.from([1]) }),
      secondStore.append({ sourceId: 'source-01', rawEventBytes: Buffer.from([2]) })
    ]);

    assert.equal(new Set(receipts.map((receipt) => receipt.vaultSequence.toString())).size, 2);
    assert.deepEqual(receipts.map((receipt) => receipt.vaultSequence).sort(), [1n, 2n]);
  } finally {
    firstStore.close();
    secondStore.close();
  }
});

test('SQLite failure after JSONL persistence does not reuse sequence', async () => {
  const directory = temporaryDirectory('evidence-sqlite-failure');
  const store = await EvidenceStore.open({ directory });

  store.close();
  const receipt = await store.append({ sourceId: 'source-01', rawEventBytes: Buffer.from([10, 11]) });
  assert.equal(receipt.vaultSequence, 1n);

  const reopened = await EvidenceStore.open({ directory });
  try {
    const next = await reopened.append({ sourceId: 'source-01', rawEventBytes: Buffer.from([12, 13]) });
    assert.equal(next.vaultSequence, 2n);
  } finally {
    reopened.close();
  }
});

test('recovery works across alternating sources and numbered segments', async () => {
  const directory = temporaryDirectory('evidence-multisegment');
  const store = await EvidenceStore.open({ directory, segmentMaxBytes: 300 });

  const receipts = [
    await store.append({ sourceId: 'source-01', rawEventBytes: Buffer.alloc(80, 1) }),
    await store.append({ sourceId: 'source-02', rawEventBytes: Buffer.alloc(80, 2) }),
    await store.append({ sourceId: 'source-01', rawEventBytes: Buffer.alloc(80, 3) })
  ];
  store.close();

  const reopened = await EvidenceStore.open({ directory, segmentMaxBytes: 300 });
  try {
    const sourceOneNext = await reopened.append({ sourceId: 'source-01', rawEventBytes: Buffer.alloc(20, 4) });
    const sourceTwoNext = await reopened.append({ sourceId: 'source-02', rawEventBytes: Buffer.alloc(20, 5) });
    assert.equal(sourceOneNext.vaultSequence, 3n);
    assert.equal(sourceTwoNext.vaultSequence, 2n);
    assert.ok(receipts.every((receipt) => receipt.segmentName.startsWith('evidence-')));
  } finally {
    reopened.close();
  }
});

test('SQLite constructor failure opens in degraded mode and appends JSONL', async () => {
  const directory = temporaryDirectory('evidence-sqlite-constructor-failure');
  const databasePath = path.join(directory, 'index.sqlite3');
  fs.mkdirSync(databasePath);

  const store = await EvidenceStore.open({ directory, databasePath });
  try {
    assert.equal(store.getIndexStatus().state, 'degraded');
    const receipt = await store.append({
      sourceId: 'source-01',
      rawEventBytes: Buffer.from([31, 32, 33])
    });
    assert.equal(receipt.vaultSequence, 1n);
    assert.equal(store.getIndexStatus().state, 'degraded');

    fs.rmSync(databasePath, { recursive: true, force: true });
    const status = await store.reconcileIndex();
    assert.equal(status.state, 'healthy');
  } finally {
    store.close();
  }
});

test('degraded-mode restart reconstructs sequence and delivery ID from JSONL', async () => {
  const directory = temporaryDirectory('evidence-degraded-restart');
  const databasePath = path.join(directory, 'index.sqlite3');
  fs.mkdirSync(databasePath);

  const first = await EvidenceStore.open({ directory, databasePath });
  const receipt = await first.append({
    sourceId: 'source-01',
    rawEventBytes: Buffer.from([41, 42]),
    deliveryId: 'degraded-delivery'
  });
  first.close();

  fs.rmSync(databasePath, { recursive: true, force: true });
  const reopened = await EvidenceStore.open({ directory, databasePath });
  try {
    const duplicate = await reopened.append({
      sourceId: 'source-01',
      rawEventBytes: Buffer.from([41, 42]),
      deliveryId: 'degraded-delivery'
    });
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.vaultSequence, receipt.vaultSequence);
    assert.equal(reopened.getIndexStatus().state, 'healthy');
  } finally {
    reopened.close();
  }
});

test('lock release error preserves the original append error', () => {
  const operationError = new Error('append fsync failed');
  const releaseError = new Error('lock release failed');
  const combined = combineLockReleaseError(operationError, releaseError);

  assert.match(combined.message, /append fsync failed/);
  assert.match(combined.message, /lock release failed/);
  assert.equal((combined as Error & { releaseError?: unknown }).releaseError, releaseError);
});

test('directory recreation preserves JSONL and rebuilds the missing index', async () => {
  const directory = temporaryDirectory('evidence-directory-recovery');
  const databasePath = path.join(directory, 'index.sqlite3');
  const store = await EvidenceStore.open({ directory, databasePath });
  const receipt = await store.append({ sourceId: 'source-01', rawEventBytes: Buffer.from([21, 22]) });
  store.close();

  fs.rmSync(databasePath, { force: true });
  fs.rmSync(`${databasePath}-wal`, { force: true });
  fs.rmSync(`${databasePath}-shm`, { force: true });

  const reopened = await EvidenceStore.open({ directory, databasePath });
  try {
    const next = await reopened.append({ sourceId: 'source-01', rawEventBytes: Buffer.from([23]) });
    assert.equal(receipt.vaultSequence, 1n);
    assert.equal(next.vaultSequence, 2n);
  } finally {
    reopened.close();
  }
});
