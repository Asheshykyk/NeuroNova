import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/api/app.ts';
import { EvidenceStore } from '../src/storage/evidenceStore.ts';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const vector = JSON.parse(fs.readFileSync(path.resolve(testDir, '../../vectors/agent-chunk.json'), 'utf8'));

interface TestServer {
  baseUrl: string;
  close: () => Promise<void>;
}

async function startServer(store: EvidenceStore | { append(request: unknown): Promise<unknown> }): Promise<TestServer> {
  const app = createApp({
    store: store as EvidenceStore,
    trustedAgentPublicKeyProvider: () => vector.keyPair.publicKeyRaw
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })
  };
}

function validRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const chunk = vector.chunk;
  return {
    sourceId: chunk.sourceId,
    deliveryId: chunk.deliveryId,
    streamId: chunk.streamId,
    fileGeneration: chunk.fileGeneration,
    byteOffset: String(chunk.byteOffset),
    observedAt: String(chunk.observedAt),
    rawEventBase64: Buffer.from(chunk.payload, 'utf8').toString('base64'),
    signature: vector.signatureHex,
    ...overrides
  };
}

function countJsonlRecords(directory: string): number {
  return fs.readdirSync(directory)
    .filter((name) => /^evidence-\d{12}\.jsonl$/.test(name))
    .reduce((count, name) => {
      const bytes = fs.readFileSync(path.join(directory, name));
      return count + bytes.toString('utf8').split('\n').filter((line) => line.length > 0).length;
    }, 0);
}

async function post(baseUrl: string, body: Record<string, unknown>): Promise<{ status: number; json: any }> {
  const response = await fetch(`${baseUrl}/api/v1/logs/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: response.status, json: await response.json() };
}

test('valid signed event is accepted and retried identically', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-ingest-valid-'));
  const store = await EvidenceStore.open({ directory });
  context.after(() => store.close());
  const server = await startServer(store);
  context.after(server.close);

  const first = await post(server.baseUrl, validRequest());
  assert.equal(first.status, 201);
  assert.equal(first.json.status, 'accepted');
  assert.equal(first.json.sourceId, vector.chunk.sourceId);
  assert.equal(first.json.deliveryId, vector.chunk.deliveryId);
  assert.equal(first.json.vaultSequence, '1');
  assert.equal(first.json.duplicate, false);

  const retry = await post(server.baseUrl, validRequest());
  assert.equal(retry.status, 200);
  assert.equal(retry.json.duplicate, true);
  assert.equal(retry.json.vaultSequence, '1');

  const segmentName = fs.readdirSync(directory).find((name) => /^evidence-\d{12}\.jsonl$/.test(name));
  assert.ok(segmentName);
  const record = JSON.parse(fs.readFileSync(path.join(directory, segmentName!), 'utf8').trim());
  assert.equal(record.fileGeneration, vector.chunk.fileGeneration);
  const persistedPayload = Buffer.from(record.rawEventBytesBase64, 'base64');
  assert.deepEqual(persistedPayload, Buffer.from(vector.chunk.payload, 'utf8'));
  assert.equal(persistedPayload.at(-1), 0x0a);
});

test('invalid and tampered signatures are rejected', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-ingest-tamper-'));
  const store = await EvidenceStore.open({ directory });
  context.after(() => store.close());
  const server = await startServer(store);
  context.after(server.close);

  const invalidSignature = await post(server.baseUrl, validRequest({ signature: `0x${'00'.repeat(64)}` }));
  assert.equal(invalidSignature.status, 401);

  const tamperFields: Array<[string, Record<string, unknown>]> = [
    ['sourceId', { sourceId: 'attacker-source-99' }],
    ['deliveryId', { deliveryId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' }],
    ['streamId', { streamId: 'syslog' }],
    ['fileGeneration', { fileGeneration: 'dev:2049:ino:999999' }],
    ['byteOffset', { byteOffset: '2097152' }],
    ['observedAt', { observedAt: '1732145500000000000' }],
    ['payload', { rawEventBase64: Buffer.from('Nov 20 22:15:01 - TAMPERED', 'utf8').toString('base64') }]
  ];

  for (const [field, override] of tamperFields) {
    const result = await post(server.baseUrl, validRequest(override));
    assert.equal(result.status, 401, `tampering ${field} must return 401`);
  }
});

test('malformed Base64, decimal strings and signature lengths are rejected', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-ingest-validation-'));
  const store = await EvidenceStore.open({ directory });
  context.after(() => store.close());
  const server = await startServer(store);
  context.after(server.close);

  assert.equal((await post(server.baseUrl, validRequest({ rawEventBase64: '%%%not-base64%%%' }))).status, 400);
  assert.equal((await post(server.baseUrl, validRequest({ byteOffset: '12oops' }))).status, 400);
  assert.equal((await post(server.baseUrl, validRequest({ observedAt: '-1' }))).status, 400);
  assert.equal((await post(server.baseUrl, validRequest({ signature: '0x1234' }))).status, 400);
});

test('conflicting delivery ID reuse is rejected', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-ingest-conflict-'));
  const store = await EvidenceStore.open({ directory });
  context.after(() => store.close());
  const server = await startServer(store);
  context.after(server.close);

  const first = await post(server.baseUrl, validRequest());
  assert.equal(first.status, 201);

  const conflict = await post(server.baseUrl, validRequest({ streamId: 'syslog' }));
  assert.equal(conflict.status, 401, 'signature tampering is rejected before delivery conflict handling');

  // Re-signing a conflicting stream with the server-held key would exercise storage conflict handling.
  const { signAgentChunkHex } = await import('@trusttrace/core/agent');
  const conflictingChunk = {
    sourceId: vector.chunk.sourceId,
    deliveryId: vector.chunk.deliveryId,
    streamId: 'syslog',
    fileGeneration: vector.chunk.fileGeneration,
    byteOffset: BigInt(vector.chunk.byteOffset),
    observedAt: BigInt(vector.chunk.observedAt),
    payload: Buffer.from(vector.chunk.payload, 'utf8')
  };
  const conflictingRequest = validRequest({
    streamId: 'syslog',
    signature: signAgentChunkHex(conflictingChunk, Buffer.from(vector.seed.slice(2), 'hex'))
  });
  const storageConflict = await post(server.baseUrl, conflictingRequest);
  assert.equal(storageConflict.status, 409);
});

test('concurrent identical retries allocate one sequence and one record', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-ingest-concurrent-'));
  const store = await EvidenceStore.open({ directory });
  context.after(() => store.close());
  const server = await startServer(store);
  context.after(server.close);

  const request = validRequest();
  const results = await Promise.all([
    post(server.baseUrl, request),
    post(server.baseUrl, request),
    post(server.baseUrl, request),
    post(server.baseUrl, request)
  ]);

  for (const result of results) {
    assert.ok(result.status === 200 || result.status === 201);
    assert.equal(result.json.deliveryId, vector.chunk.deliveryId);
    assert.equal(result.json.vaultSequence, '1');
  }

  const successful = results.filter((result) => result.status === 200 || result.status === 201);
  assert.equal(successful.length, 4);
  assert.equal(successful.filter((result) => result.status === 201).length, 1);
  assert.equal(countJsonlRecords(directory), 1);
});

test('identical retry and conflicting reuse recover after EvidenceStore restart', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-ingest-restart-'));
  const firstStore = await EvidenceStore.open({ directory });
  const firstServer = await startServer(firstStore);

  const first = await post(firstServer.baseUrl, validRequest());
  assert.equal(first.status, 201);
  assert.equal(first.json.vaultSequence, '1');

  await firstServer.close();
  firstStore.close();

  const reopenedStore = await EvidenceStore.open({ directory });
  context.after(() => reopenedStore.close());
  const reopenedServer = await startServer(reopenedStore);
  context.after(reopenedServer.close);

  const retry = await post(reopenedServer.baseUrl, validRequest());
  assert.equal(retry.status, 200);
  assert.equal(retry.json.duplicate, true);
  assert.equal(retry.json.vaultSequence, '1');
  assert.equal(countJsonlRecords(directory), 1);

  const { signAgentChunkHex } = await import('@trusttrace/core/agent');
  const conflictingChunk = {
    sourceId: vector.chunk.sourceId,
    deliveryId: vector.chunk.deliveryId,
    streamId: 'syslog',
    fileGeneration: vector.chunk.fileGeneration,
    byteOffset: BigInt(vector.chunk.byteOffset),
    observedAt: BigInt(vector.chunk.observedAt),
    payload: Buffer.from(vector.chunk.payload, 'utf8')
  };
  const conflict = await post(reopenedServer.baseUrl, validRequest({
    streamId: 'syslog',
    signature: signAgentChunkHex(conflictingChunk, Buffer.from(vector.seed.slice(2), 'hex'))
  }));
  assert.equal(conflict.status, 409);
  assert.equal(countJsonlRecords(directory), 1);
});

test('storage failure never returns successful acknowledgement', async (context) => {
  const failingStore = {
    append: async () => {
      throw new Error('durable JSONL persistence failed');
    }
  };
  const server = await startServer(failingStore);
  context.after(server.close);

  const result = await post(server.baseUrl, validRequest());
  assert.equal(result.status, 500);
  assert.notEqual(result.status, 201);
  assert.notEqual(result.status, 200);
});
