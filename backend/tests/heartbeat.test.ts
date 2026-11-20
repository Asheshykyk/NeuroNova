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
const vector = JSON.parse(fs.readFileSync(path.resolve(testDir, '../../vectors/agent-heartbeat.json'), 'utf8'));

async function startServer(store: EvidenceStore) {
  const app = createApp({
    store,
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

function validRequest(overrides: Record<string, unknown> = {}) {
  const heartbeat = vector.heartbeat;
  return {
    sourceId: heartbeat.sourceId,
    heartbeatSequence: heartbeat.heartbeatSequence,
    observedAt: heartbeat.observedAt,
    lastByteOffset: heartbeat.lastByteOffset,
    status: heartbeat.status,
    signature: vector.signatureHex,
    ...overrides
  };
}

async function post(baseUrl: string, body: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}/api/v1/agents/heartbeat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: response.status, json: await response.json() };
}

async function signRequest(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { signAgentHeartbeatHex } = await import('@trusttrace/core/agent');
  const chunk = {
    sourceId: String(body.sourceId),
    heartbeatSequence: BigInt(String(body.heartbeatSequence)),
    observedAt: BigInt(String(body.observedAt)),
    lastByteOffset: BigInt(String(body.lastByteOffset)),
    status: String(body.status)
  };
  return {
    ...body,
    signature: signAgentHeartbeatHex(chunk, Buffer.from(vector.seed.slice(2), 'hex'))
  };
}

test('valid heartbeat is accepted and persisted without evidence sequence allocation', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-heartbeat-valid-'));
  const store = await EvidenceStore.open({ directory });
  context.after(() => store.close());
  const server = await startServer(store);
  context.after(server.close);

  const result = await post(server.baseUrl, validRequest());
  assert.equal(result.status, 200);
  assert.equal(result.json.sourceId, vector.heartbeat.sourceId);
  assert.equal(result.json.heartbeatSequence, '1');
  assert.equal(result.json.availability, 'available');

  const evidenceFiles = fs.readdirSync(directory).filter((name) => /^evidence-\d{12}\.jsonl$/.test(name));
  assert.equal(evidenceFiles.length, 0);

  const evidence = await store.append({ sourceId: vector.heartbeat.sourceId, rawEventBytes: Buffer.from([1, 2, 3]) });
  assert.equal(evidence.vaultSequence, 1n);
});

test('invalid signature and all heartbeat tamper fields are rejected', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-heartbeat-tamper-'));
  const store = await EvidenceStore.open({ directory });
  context.after(() => store.close());
  const server = await startServer(store);
  context.after(server.close);

  assert.equal((await post(server.baseUrl, validRequest({ signature: `0x${'00'.repeat(64)}` }))).status, 401);

  const tamperCases: Array<[string, Record<string, unknown>]> = [
    ['sourceId', { sourceId: 'attacker-source-99' }],
    ['heartbeatSequence', { heartbeatSequence: '2' }],
    ['observedAt', { observedAt: '1732145500000000000' }],
    ['lastByteOffset', { lastByteOffset: '2097152' }],
    ['status', { status: 'DEGRADED' }]
  ];

  for (const [field, override] of tamperCases) {
    const result = await post(server.baseUrl, validRequest(override));
    assert.equal(result.status, 401, `tampering ${field} must return 401`);
  }
});

test('malformed integers and signature lengths are rejected', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-heartbeat-validation-'));
  const store = await EvidenceStore.open({ directory });
  context.after(() => store.close());
  const server = await startServer(store);
  context.after(server.close);

  assert.equal((await post(server.baseUrl, validRequest({ heartbeatSequence: '1x' }))).status, 400);
  assert.equal((await post(server.baseUrl, validRequest({ observedAt: '-1' }))).status, 400);
  assert.equal((await post(server.baseUrl, validRequest({ lastByteOffset: 'oops' }))).status, 400);
  assert.equal((await post(server.baseUrl, validRequest({ signature: '0x1234' }))).status, 400);
});

test('replayed and out-of-order heartbeats are rejected', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-heartbeat-order-'));
  const store = await EvidenceStore.open({ directory });
  context.after(() => store.close());
  const server = await startServer(store);
  context.after(server.close);

  assert.equal((await post(server.baseUrl, validRequest())).status, 200);

  const replayBody = await signRequest(validRequest({
    heartbeatSequence: '1',
    observedAt: '1732145400000000000',
    lastByteOffset: '1048576',
    status: 'OK'
  }));
  assert.equal((await post(server.baseUrl, replayBody)).status, 409);

  const outOfOrderBody = await signRequest(validRequest({
    heartbeatSequence: '3',
    observedAt: '1732145400000000000',
    lastByteOffset: '1048576',
    status: 'OK'
  }));
  assert.equal((await post(server.baseUrl, outOfOrderBody)).status, 409);
});

test('heartbeat persistence survives EvidenceStore restart', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-heartbeat-restart-'));
  let store = await EvidenceStore.open({ directory });
  let server = await startServer(store);

  assert.equal((await post(server.baseUrl, validRequest())).status, 200);
  await server.close();
  store.close();

  store = await EvidenceStore.open({ directory });
  context.after(() => store.close());
  server = await startServer(store);
  context.after(server.close);

  const replay = await post(server.baseUrl, validRequest());
  assert.equal(replay.status, 409);

  const seq2 = await signRequest(validRequest({
    heartbeatSequence: '2',
    observedAt: '1732145500000000000',
    lastByteOffset: '2097152',
    status: 'DEGRADED'
  }));
  assert.equal((await post(server.baseUrl, seq2)).status, 200);
});

test('agent becomes unavailable after 15 seconds', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-heartbeat-liveness-'));
  let now = new Date('2026-11-21T03:42:52.865Z');
  const store = await EvidenceStore.open({ directory, now: () => now });
  context.after(() => store.close());
  const server = await startServer(store);
  context.after(server.close);

  const first = await post(server.baseUrl, validRequest());
  assert.equal(first.status, 200);
  assert.equal(first.json.availability, 'available');

  now = new Date(now.getTime() + 15_001);
  const status = await store.getHeartbeatReceipt(vector.heartbeat.sourceId);
  assert.equal(status?.availability, 'unavailable');
});
