import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/api/app.ts';
import { EvidenceStore } from '../src/storage/evidenceStore.ts';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const vector = JSON.parse(fs.readFileSync(path.resolve(testDir, '../../vectors/agent-heartbeat.json'), 'utf8'));

async function openHeartbeatStore(directory: string, now?: () => Date): Promise<EvidenceStore> {
  return EvidenceStore.open({
    directory,
    now,
    trustedAgentPublicKeyProvider: () => vector.keyPair.publicKeyRaw
  });
}

async function startServer(store: EvidenceStore, historyProvider?: (sourceId: string) => string[]) {
  const app = createApp({
    store,
    trustedAgentPublicKeyProvider: () => vector.keyPair.publicKeyRaw,
    trustedAgentPublicKeyHistoryProvider: historyProvider
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address() as AddressInfo;
  let closePromise: Promise<void> | undefined;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => {
      if (!closePromise) {
        closePromise = server.listening
          ? new Promise<void>((resolve, reject) => {
              server.close((error) => error ? reject(error) : resolve());
            })
          : Promise.resolve();
      }
      return closePromise;
    }
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
  const store = await openHeartbeatStore(directory);
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
  const store = await openHeartbeatStore(directory);
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
  const store = await openHeartbeatStore(directory);
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
  const store = await openHeartbeatStore(directory);
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
  assert.equal((await post(server.baseUrl, replayBody)).status, 200);

  const outOfOrderBody = await signRequest(validRequest({
    heartbeatSequence: '3',
    observedAt: '1732145400000000000',
    lastByteOffset: '1048576',
    status: 'OK'
  }));
  assert.equal((await post(server.baseUrl, outOfOrderBody)).status, 409);
});

test('same sequence with changed signed payload is rejected', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-heartbeat-conflict-'));
  const store = await openHeartbeatStore(directory);
  context.after(() => store.close());
  const server = await startServer(store);
  context.after(server.close);

  assert.equal((await post(server.baseUrl, validRequest())).status, 200);
  const changed = await signRequest(validRequest({
    heartbeatSequence: '1',
    observedAt: '1732145400000000000',
    lastByteOffset: '1048576',
    status: 'DEGRADED'
  }));
  assert.equal((await post(server.baseUrl, changed)).status, 409);
});

test('heartbeat persistence survives EvidenceStore restart', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-heartbeat-restart-'));
  let store = await openHeartbeatStore(directory);
  let server = await startServer(store);

  assert.equal((await post(server.baseUrl, validRequest())).status, 200);
  await server.close();
  store.close();

  store = await openHeartbeatStore(directory);
  context.after(() => store.close());
  server = await startServer(store);
  context.after(server.close);

  const replay = await post(server.baseUrl, validRequest());
  assert.equal(replay.status, 200);

  const seq2 = await signRequest(validRequest({
    heartbeatSequence: '2',
    observedAt: '1732145500000000000',
    lastByteOffset: '2097152',
    status: 'DEGRADED'
  }));
  assert.equal((await post(server.baseUrl, seq2)).status, 200);
});

test('existing SQLite heartbeat row migrates to explicitly marked JSONL', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-heartbeat-migration-'));
  const databasePath = path.join(directory, 'evidence-index.sqlite3');
  const db = new Database(databasePath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_heartbeats (
      source_id TEXT PRIMARY KEY,
      heartbeat_sequence TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      last_byte_offset TEXT NOT NULL,
      status TEXT NOT NULL,
      vault_received_at TEXT NOT NULL
    );
  `);
  db.prepare(`
    INSERT INTO agent_heartbeats (
      source_id, heartbeat_sequence, observed_at, last_byte_offset, status, vault_received_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    'host-agent-cyprus-01',
    '5',
    '1732145400000000000',
    '1048576',
    'OK',
    '2026-11-21T06:11:41.031Z'
  );
  db.close();

  const store = await EvidenceStore.open({
    directory,
    databasePath,
    trustedAgentPublicKeyProvider: () => vector.keyPair.publicKeyRaw
  });
  context.after(() => store.close());

  const heartbeatFiles = fs.readdirSync(path.join(directory, 'heartbeats'))
    .filter((name) => /^heartbeat-\d{12}\.jsonl$/.test(name));
  assert.equal(heartbeatFiles.length, 1);
  const record = JSON.parse(fs.readFileSync(path.join(directory, 'heartbeats', heartbeatFiles[0]), 'utf8').trim());
  assert.equal(record.heartbeatSequence, '5');
  assert.equal(record.vaultReceivedAt, '2026-11-21T06:11:41.031Z');
  assert.equal(record.signature, null);
  assert.equal(record.migration.status, 'migrated');
  assert.equal(record.migration.originalSignaturePreserved, false);

  const nextBody = await signRequest(validRequest({
    heartbeatSequence: '6',
    observedAt: '1732145500000000000',
    lastByteOffset: '2097152',
    status: 'DEGRADED'
  }));
  const server = await startServer(store, () => [vector.keyPair.publicKeyRaw]);
  context.after(server.close);
  const next = await post(server.baseUrl, nextBody);
  assert.equal(next.status, 200);
  assert.equal(next.json.heartbeatSequence, '6');
});

test('native heartbeat signature can be verified with trusted key history after key rotation', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-heartbeat-key-history-'));
  const oldKey = vector.keyPair.publicKeyRaw;
  const store = await EvidenceStore.open({
    directory,
    trustedAgentPublicKeyProvider: () => oldKey,
    trustedAgentPublicKeyHistoryProvider: () => [oldKey]
  });
  context.after(() => store.close());
  const server = await startServer(store, () => [oldKey]);
  context.after(server.close);

  assert.equal((await post(server.baseUrl, validRequest())).status, 200);
  await server.close();
  store.close();

  const reopened = await EvidenceStore.open({
    directory,
    trustedAgentPublicKeyProvider: () => vector.keyPair.publicKeyRaw,
    trustedAgentPublicKeyHistoryProvider: () => [vector.keyPair.publicKeyRaw]
  });
  context.after(() => reopened.close());
  const reopenedServer = await startServer(reopened, () => [vector.keyPair.publicKeyRaw]);
  context.after(reopenedServer.close);

  const retry = await post(reopenedServer.baseUrl, validRequest());
  assert.equal(retry.status, 200);
});

test('agent becomes unavailable after 15 seconds', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-heartbeat-liveness-'));
  let now = new Date('2026-11-21T03:42:52.865Z');
  const store = await openHeartbeatStore(directory, () => now);
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

