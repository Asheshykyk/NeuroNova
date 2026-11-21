import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/api/app.ts';
import { EvidenceStore } from '../src/storage/evidenceStore.ts';
import { EvidenceBatchManager } from '../src/batching/EvidenceBatchManager.ts';
import { RsyslogReceiver } from '../src/ingestion/rsyslogReceiver.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const vectorPath = path.join(rootDir, 'vectors/agent-chunk.json');
const vector = JSON.parse(fs.readFileSync(vectorPath, 'utf8'));

test('Prompt 5c.2: End-to-end ingestion hookup (signed chunk + TCP rsyslog -> batch Merkle root)', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-p5c2-'));
  const databasePath = path.join(directory, 'evidence-index.sqlite3');

  const store = await EvidenceStore.open({
    directory,
    databasePath,
    trustedAgentPublicKeyProvider: () => vector.keyPair.publicKeyRaw
  });
  context.after(() => store.close());
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const batchManager = new EvidenceBatchManager(store, {
    directory,
    batchMaxLeaves: 10
  });

  // 1. Start Ingestion Receiver on port 3000 and Rsyslog receiver on TCP port 5140
  const app = createApp({
    store,
    batchManager,
    trustedAgentPublicKeyProvider: () => vector.keyPair.publicKeyRaw
  });

  const httpServer = app.listen(3000, '127.0.0.1');
  context.after(() => new Promise<void>((resolve, reject) => {
    httpServer.close((err) => err ? reject(err) : resolve());
  }));

  await new Promise<void>((resolve, reject) => {
    httpServer.once('listening', resolve);
    httpServer.once('error', reject);
  });
  console.log('[Backend] Ingestion Receiver listening on http://127.0.0.1:3000');

  const rsyslogReceiver = new RsyslogReceiver({
    host: '127.0.0.1',
    port: 5140,
    maxFrameBytes: 1024 * 1024,
    store,
    onError: (err) => console.error('[Rsyslog Error]', err)
  });
  await rsyslogReceiver.start();
  context.after(() => rsyslogReceiver.close());
  console.log('[Rsyslog] TCP receiver listening on 127.0.0.1:5140');

  // 2. Ingest real SSH auth log chunk emitted by Host Agent (HTTP POST /api/v1/logs/ingest)
  const chunk = vector.chunk;
  const ingestPayload = {
    sourceId: chunk.sourceId,
    deliveryId: chunk.deliveryId,
    streamId: chunk.streamId,
    fileIdentity: chunk.fileIdentity,
    fileGeneration: chunk.fileGeneration,
    byteOffset: String(chunk.byteOffset),
    observedAt: String(chunk.observedAt),
    rawEventBase64: Buffer.from(chunk.payload, 'utf8').toString('base64'),
    signature: vector.signatureHex
  };

  const httpRes = await fetch('http://127.0.0.1:3000/api/v1/logs/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ingestPayload)
  });

  assert.equal(httpRes.status, 201, 'Host agent chunk must return HTTP 201');
  const receipt = await httpRes.json() as any;
  assert.equal(receipt.status, 'accepted');
  assert.equal(receipt.vaultSequence, '1', 'First sequence must be 1');
  assert.equal(receipt.deliveryId, chunk.deliveryId);
  assert.equal(receipt.duplicate, false);

  // 3. Ingest parallel rsyslog stream over TCP port 5140
  const rsyslogLogLine = '<86>Nov 20 22:15:01 web-server-1 sshd[12345]: Accepted publickey for root from 192.168.1.50 port 54321 ssh2: RSA SHA256:abc123xyz\n';
  const rsyslogBody = JSON.stringify({
    sourceId: chunk.sourceId,
    streamId: chunk.streamId,
    fileIdentity: chunk.fileIdentity,
    fileGeneration: chunk.fileGeneration,
    byteOffset: '1048702',
    observedAt: String(BigInt(chunk.observedAt) + 1_000_000_000n),
    rawEventBase64: Buffer.from(rsyslogLogLine, 'utf8').toString('base64')
  });
  const rsyslogFrame = Buffer.concat([
    Buffer.from(`${Buffer.byteLength(rsyslogBody, 'utf8')} `, 'ascii'),
    Buffer.from(rsyslogBody, 'utf8')
  ]);

  const tcpClient = net.connect(5140, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    tcpClient.once('connect', () => {
      tcpClient.write(rsyslogFrame, () => {
        tcpClient.end();
        resolve();
      });
    });
    tcpClient.once('error', reject);
  });

  // Wait for TCP rsyslog frame to be processed into JSONL
  let persistedRecords: ReturnType<typeof store.readPersistedEvidence> = [];
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    persistedRecords = store.readPersistedEvidence();
    if (persistedRecords.length >= 2) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(persistedRecords.length, 2, 'Must have 2 persisted records (agent chunk + rsyslog)');
  assert.equal(persistedRecords[0].record.vaultSequence, '1');
  assert.equal(persistedRecords[0].record.observationSource, 'host-agent');
  assert.equal(persistedRecords[1].record.vaultSequence, '2');
  assert.equal(persistedRecords[1].record.observationSource, 'rsyslog-tcp');

  // 4. Trigger batch construction and confirm both streams appear in the resulting Merkle batch
  const batches = await batchManager.generateNextBatches();
  assert.equal(batches.length, 1, 'Must create exactly 1 batch');
  const batch = batches[0];
  assert.equal(batch.leafCount, '2', 'Batch must contain both leaves');
  assert.equal(batch.sequenceStart, '1');
  assert.equal(batch.sequenceEnd, '2');
  assert.ok(batch.merkleRoot.startsWith('0x'));

  // 5. Verify batch and events via REST API
  const batchesRes = await fetch('http://127.0.0.1:3000/api/v1/batches');
  assert.equal(batchesRes.status, 200);
  const batchesJson = await batchesRes.json() as any;
  assert.equal(batchesJson.items.length, 1);
  assert.equal(batchesJson.items[0].batchId, batch.batchId);
  assert.equal(batchesJson.items[0].merkleRoot, batch.merkleRoot);
  assert.equal(batchesJson.items[0].leafCount, 2);

  const eventsRes = await fetch('http://127.0.0.1:3000/api/v1/events?limit=50');
  assert.equal(eventsRes.status, 200);
  const eventsJson = await eventsRes.json() as any;
  assert.equal(eventsJson.items.length, 2);
  assert.equal(eventsJson.items[0].batchId, batch.batchId);
  assert.equal(eventsJson.items[1].batchId, batch.batchId);
  console.log(`[Success] Verified end-to-end ingestion and Merkle batch creation for batch ${batch.batchId} with root ${batch.merkleRoot}`);
});
