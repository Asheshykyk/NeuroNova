import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createApp } from '../src/api/app.ts';
import { EvidenceStore } from '../src/storage/evidenceStore.ts';
import { EvidenceBatchManager } from '../src/batching/EvidenceBatchManager.ts';

async function start(directory: string) {
  const store = await EvidenceStore.open({ directory });
  const batchManager = new EvidenceBatchManager(store, { directory, batchMaxLeaves: 2 });
  const app = createApp({ store, batchManager });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address() as AddressInfo;
  let closePromise: Promise<void> | undefined;
  const close = () => {
    if (!closePromise) {
      closePromise = server.listening
        ? new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
        : Promise.resolve();
    }
    return closePromise;
  };
  return { baseUrl: `http://127.0.0.1:${address.port}`, store, batchManager, close };
}

async function getJson(baseUrl: string, route: string) {
  const response = await fetch(baseUrl + route);
  return { status: response.status, json: await response.json() as any };
}

test('sources and events read JSONL with source filtering and cursor pagination', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-read-events-'));
  const api = await start(directory);
  context.after(() => api.close());
  context.after(() => api.store.close());

  const sourceA = '0x' + '11'.repeat(32);
  const sourceB = '0x' + '22'.repeat(32);
  const rawA1 = Buffer.from('a1');
  await api.store.append({ sourceId: sourceA, rawEventBytes: rawA1, observedAt: 1732145500000000000n, observationSource: 'host-agent' });
  await api.store.append({ sourceId: sourceA, rawEventBytes: Buffer.from('a2'), observationSource: 'host-agent' });
  await api.store.append({ sourceId: sourceB, rawEventBytes: Buffer.from('b1'), observationSource: 'rsyslog-tcp' });

  const sources = await getJson(api.baseUrl, '/api/v1/sources');
  assert.equal(sources.status, 200);
  assert.equal(sources.json.items.length, 2);
  assert.deepEqual(sources.json.items.map((item: any) => item.sourceId).sort(), [sourceA, sourceB].sort());

  const filtered = await getJson(api.baseUrl, `/api/v1/events?sourceId=${sourceA}&limit=1`);
  assert.equal(filtered.status, 200);
  assert.equal(filtered.json.items.length, 1);
  assert.equal(filtered.json.items[0].sourceId, sourceA);
  assert.equal(filtered.json.items[0].hostTimestamp, '2024-11-20T23:31:40.000Z');
  assert.equal(filtered.json.items[0].payloadSha256, '0x' + crypto.createHash('sha256').update(rawA1).digest('hex'));
  assert.equal(typeof filtered.json.nextCursor, 'string');

  const next = await getJson(api.baseUrl, `/api/v1/events?sourceId=${sourceA}&limit=1&cursor=${filtered.json.nextCursor}`);
  assert.equal(next.status, 200);
  assert.equal(next.json.items.length, 1);
  assert.equal(next.json.items[0].vaultSequence, '2');
});

test('event detail uses source and sequence identity and missing record returns 404', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-read-detail-'));
  const api = await start(directory);
  context.after(() => api.close());
  context.after(() => api.store.close());
  const sourceId = '0x' + '33'.repeat(32);
  const rawEvent = Buffer.from('event-detail');
  await api.store.append({ sourceId, rawEventBytes: rawEvent, observedAt: 1732145500000000000n });

  const detail = await getJson(api.baseUrl, `/api/v1/events/${sourceId}/1`);
  assert.equal(detail.status, 200);
  assert.equal(detail.json.sourceId, sourceId);
  assert.equal(detail.json.vaultSequence, '1');
  assert.equal(detail.json.rawPayloadBase64, rawEvent.toString('base64'));
  assert.equal(detail.json.hostTimestamp, '2024-11-20T23:31:40.000Z');
  assert.equal(detail.json.payloadSha256, '0x' + crypto.createHash('sha256').update(rawEvent).digest('hex'));
  assert.equal(detail.json.correlationStatus, null);

  const missing = await getJson(api.baseUrl, `/api/v1/events/${sourceId}/999`);
  assert.equal(missing.status, 404);
  assert.equal(missing.json.code, 'EVENT_NOT_FOUND');
});

test('batches checkpoints and gaps have stable schemas', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-read-batches-'));
  const api = await start(directory);
  context.after(() => api.close());
  context.after(() => api.store.close());
  const sourceId = '0x' + '44'.repeat(32);
  await api.store.append({ sourceId, rawEventBytes: Buffer.from('one') });
  await api.store.append({ sourceId, rawEventBytes: Buffer.from('three') });
  await api.batchManager.generateNextBatches();

  const batches = await getJson(api.baseUrl, `/api/v1/batches?sourceId=${sourceId}`);
  assert.equal(batches.status, 200);
  assert.equal(Array.isArray(batches.json.items), true);
  assert.equal(batches.json.nextCursor, null);

  const checkpoints = await getJson(api.baseUrl, '/api/v1/checkpoints');
  assert.equal(checkpoints.status, 200);
  assert.deepEqual(checkpoints.json, { items: [], nextCursor: null });

  const gaps = await getJson(api.baseUrl, `/api/v1/gaps?sourceId=${sourceId}`);
  assert.equal(gaps.status, 200);
  assert.equal(Array.isArray(gaps.json.items), true);
});

test('malformed cursors and limits are rejected with machine-readable errors', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-read-errors-'));
  const api = await start(directory);
  context.after(() => api.close());
  context.after(() => api.store.close());

  const cursor = await getJson(api.baseUrl, '/api/v1/events?cursor=not-a-valid-cursor');
  assert.equal(cursor.status, 400);
  assert.equal(cursor.json.code, 'INVALID_CURSOR');

  const limit = await getJson(api.baseUrl, '/api/v1/events?limit=0');
  assert.equal(limit.status, 400);
  assert.equal(limit.json.code, 'INVALID_LIMIT');

  const source = await getJson(api.baseUrl, '/api/v1/events?sourceId=0xZZ');
  assert.equal(source.status, 400);
  assert.equal(source.json.code, 'INVALID_SOURCE_ID');

  const malformedSequence = await getJson(api.baseUrl, '/api/v1/events/not-a-number?sourceId=' + ('0x' + '55'.repeat(32)));
  assert.equal(malformedSequence.status, 400);
  assert.equal(malformedSequence.json.code, 'INVALID_VAULT_SEQUENCE');

  const negativeSequence = await getJson(api.baseUrl, '/api/v1/events/-1?sourceId=' + ('0x' + '55'.repeat(32)));
  assert.equal(negativeSequence.status, 400);
  assert.equal(negativeSequence.json.code, 'INVALID_VAULT_SEQUENCE');
});
