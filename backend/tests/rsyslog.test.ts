import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { EvidenceStore } from '../src/storage/evidenceStore.ts';
import { createApp } from '../src/api/app.ts';
import { OctetCountedFrameParser, processRsyslogFrame, RsyslogReceiver } from '../src/ingestion/rsyslogReceiver.ts';

const testDir = path.dirname(fileURLToPath(import.meta.url));

function validEvent(overrides: Record<string, unknown> = {}) {
  return {
    sourceId: 'host-agent-cyprus-01',
    streamId: 'auth.log',
    fileIdentity: '/var/log/auth.log',
    byteOffset: '1048576',
    observedAt: '1732145400000000000',
    rawEvent: 'Nov 20 22:15:01 Accepted publickey for root',
    ...overrides
  };
}

function frame(body: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(body), 'utf8');
  return Buffer.concat([Buffer.from(`${json.length} `, 'ascii'), json]);
}

async function waitForPersistence(directory: string, expectedCount: number): Promise<void> {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const segmentNames = fs.existsSync(directory)
      ? fs.readdirSync(directory).filter((name) => /^evidence-\d{12}\.jsonl$/.test(name))
      : [];
    let count = 0;
    for (const name of segmentNames) {
      const content = fs.readFileSync(path.join(directory, name), 'utf8');
      count += content.split('\n').filter((line) => line.length > 0).length;
    }
    if (count >= expectedCount) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function waitForOpen(server: RsyslogReceiver): Promise<void> {
  if (server.server.listening) return;
  await server.start();
}

async function connect(port: number): Promise<net.Socket> {
  const socket = net.createConnection({ host: '127.0.0.1', port });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  return socket;
}

function send(socket: net.Socket, chunk: Buffer): Promise<void> {
  return new Promise((resolve, reject) => socket.write(chunk, (error) => error ? reject(error) : resolve()));
}

test('complete valid octet-counted frame is persisted', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-rsyslog-valid-'));
  const store = await EvidenceStore.open({ directory });
  context.after(() => store.close());
  const receiver = new RsyslogReceiver({ host: '127.0.0.1', port: 0, maxFrameBytes: 1024 * 1024, store });
  await waitForOpen(receiver);
  context.after(() => receiver.close());

  const address = receiver.server.address();
  assert.ok(address && typeof address === 'object');
  const socket = await connect(address.port);
  context.after(() => socket.destroy());

  await send(socket, frame(validEvent()));
  await new Promise((resolve) => setTimeout(resolve, 50));
  await socket.destroy();

  const segmentNames = fs.readdirSync(directory).filter((name) => /^evidence-\d{12}\.jsonl$/.test(name));
  assert.equal(segmentNames.length, 1);
  const lines = fs.readFileSync(path.join(directory, segmentNames[0]), 'utf8').trim().split('\n');
  const record = JSON.parse(lines[0]);
  assert.equal(record.observationSource, 'rsyslog-tcp');
  assert.equal(record.streamId, 'auth.log');
  assert.equal(record.fileIdentity, '/var/log/auth.log');
  assert.equal(record.byteOffset, '1048576');
  assert.equal(record.observedAt, '1732145400000000000');
  assert.deepEqual(Buffer.from(record.rawEventBytesBase64, 'base64'), Buffer.from(validEvent().rawEvent, 'utf8'));
});

test('frame split across TCP chunks is reconstructed', async (context) => {
  const frames: Buffer[] = [];
  const parser = new OctetCountedFrameParser(1024 * 1024, (body) => frames.push(body), (error) => assert.fail(error.message));
  const complete = frame(validEvent());
  const splitAt = 7;
  parser.feed(complete.subarray(0, splitAt));
  parser.feed(complete.subarray(splitAt, splitAt + 5));
  parser.feed(complete.subarray(splitAt + 5));
  assert.equal(frames.length, 1);
  const store = await EvidenceStore.open({ directory: fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-rsyslog-split-')) });
  context.after(() => store.close());
  await processRsyslogFrame(store, frames[0]);
});

test('multiple frames in one TCP chunk are processed separately', async () => {
  const frames: Buffer[] = [];
  const parser = new OctetCountedFrameParser(1024 * 1024, (body) => frames.push(body), (error) => assert.fail(error.message));
  const first = frame(validEvent({ byteOffset: '1' }));
  const second = frame(validEvent({ byteOffset: '2' }));
  parser.feed(Buffer.concat([first, second]));
  assert.equal(frames.length, 2);
});

test('incorrect length prefix and oversized frames fail safely', () => {
  const errors: string[] = [];
  const parser = new OctetCountedFrameParser(16, () => {}, (error) => errors.push(error.message));
  parser.feed(Buffer.from('not-a-length '));
  parser.feed(Buffer.from('32 abcdefghijklmnop'));
  assert.ok(errors.length >= 1);
});

test('invalid JSON, missing fields and invalid decimal strings are rejected', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-rsyslog-invalid-'));
  const store = await EvidenceStore.open({ directory });
  try {
    await assert.rejects(processRsyslogFrame(store, Buffer.from('{bad json')), /valid JSON/);
    await assert.rejects(processRsyslogFrame(store, Buffer.from(JSON.stringify({ sourceId: 'host-agent-cyprus-01' }))), /streamId/);
    await assert.rejects(processRsyslogFrame(store, Buffer.from(JSON.stringify(validEvent({ byteOffset: '12x' })))), /decimal string/);
    await assert.rejects(processRsyslogFrame(store, Buffer.from(JSON.stringify(validEvent({ observedAt: '-1' })))), /decimal string/);
  } finally {
    store.close();
  }
});

test('raw event bytes are preserved exactly without adding LF', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-rsyslog-raw-'));
  const store = await EvidenceStore.open({ directory });
  try {
    const rawEvent = 'line with ünicode and trailing space ';
    await processRsyslogFrame(store, Buffer.from(JSON.stringify(validEvent({ rawEvent }))));
    const segmentNames = fs.readdirSync(directory).filter((name) => /^evidence-\d{12}\.jsonl$/.test(name));
    const record = JSON.parse(fs.readFileSync(path.join(directory, segmentNames[0]), 'utf8').trim());
    assert.deepEqual(Buffer.from(record.rawEventBytesBase64, 'base64'), Buffer.from(rawEvent, 'utf8'));
  } finally {
    store.close();
  }
});

test('multiple observations of the same log line allocate distinct records', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-rsyslog-multi-'));
  const store = await EvidenceStore.open({ directory });
  try {
    const body = Buffer.from(JSON.stringify(validEvent()));
    await processRsyslogFrame(store, body);
    await processRsyslogFrame(store, body);

    const segmentNames = fs.readdirSync(directory).filter((name) => /^evidence-\d{12}\.jsonl$/.test(name));
    const lines = fs.readFileSync(path.join(directory, segmentNames[0]), 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).vaultSequence, '1');
    assert.equal(JSON.parse(lines[1]).vaultSequence, '2');
  } finally {
    store.close();
  }
});

test('octet-count prefix uses UTF-8 byte length for multibyte JSON', () => {
  const body = Buffer.from(JSON.stringify(validEvent({ rawEvent: 'üñîcode — exact bytes' })), 'utf8');
  const framed = frame(validEvent({ rawEvent: 'üñîcode — exact bytes' }));
  const separator = framed.indexOf(0x20);
  const prefix = framed.subarray(0, separator).toString('ascii');

  assert.equal(Number(prefix), body.length);
  assert.equal(Number(prefix), Buffer.byteLength(body.toString('utf8'), 'utf8'));
});

test('one frame sent across multiple TCP writes is persisted once', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-rsyslog-tcp-split-'));
  const store = await EvidenceStore.open({ directory });
  context.after(() => store.close());
  const receiver = new RsyslogReceiver({ host: '127.0.0.1', port: 0, maxFrameBytes: 1024 * 1024, store });
  await receiver.start();
  context.after(() => receiver.close());

  const address = receiver.server.address();
  assert.ok(address && typeof address === 'object');
  const socket = await connect(address.port);
  context.after(() => socket.destroy());

  const complete = frame(validEvent({ byteOffset: '3000' }));
  await send(socket, complete.subarray(0, 5));
  await send(socket, complete.subarray(5, 17));
  await send(socket, complete.subarray(17));
  await waitForPersistence(directory, 1);

  const segmentNames = fs.readdirSync(directory).filter((name) => /^evidence-\d{12}\.jsonl$/.test(name));
  let count = 0;
  for (const name of segmentNames) {
    count += fs.readFileSync(path.join(directory, name), 'utf8').split('\n').filter((line) => line.length > 0).length;
  }
  assert.equal(count, 1);
});

test('multiple frames sent in one TCP write are each persisted once', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-rsyslog-tcp-combined-'));
  const store = await EvidenceStore.open({ directory });
  context.after(() => store.close());
  const receiver = new RsyslogReceiver({ host: '127.0.0.1', port: 0, maxFrameBytes: 1024 * 1024, store });
  await receiver.start();
  context.after(() => receiver.close());

  const address = receiver.server.address();
  assert.ok(address && typeof address === 'object');
  const socket = await connect(address.port);
  context.after(() => socket.destroy());

  const combined = Buffer.concat([
    frame(validEvent({ byteOffset: '4000' })),
    frame(validEvent({ byteOffset: '4001' }))
  ]);
  await send(socket, combined);
  await waitForPersistence(directory, 2);

  const segmentNames = fs.readdirSync(directory).filter((name) => /^evidence-\d{12}\.jsonl$/.test(name));
  let count = 0;
  for (const name of segmentNames) {
    count += fs.readFileSync(path.join(directory, name), 'utf8').split('\n').filter((line) => line.length > 0).length;
  }
  assert.equal(count, 2);
});

test('incomplete frame is reported and never persisted', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-rsyslog-incomplete-'));
  const store = await EvidenceStore.open({ directory });
  context.after(() => store.close());
  const errors: string[] = [];
  const receiver = new RsyslogReceiver({
    host: '127.0.0.1',
    port: 0,
    maxFrameBytes: 1024 * 1024,
    store,
    onError: (error) => errors.push(error.message)
  });
  await receiver.start();
  context.after(() => receiver.close());

  const address = receiver.server.address();
  assert.ok(address && typeof address === 'object');
  const socket = await connect(address.port);
  context.after(() => socket.destroy());

  const body = Buffer.from(JSON.stringify(validEvent()), 'utf8');
  await send(socket, Buffer.concat([Buffer.from(`${body.length} `, 'ascii'), body.subarray(0, Math.floor(body.length / 2))]));
  socket.end();
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.ok(errors.some((message) => /Incomplete octet-counted frame/.test(message)));
  const segmentNames = fs.readdirSync(directory).filter((name) => /^evidence-\d{12}\.jsonl$/.test(name));
  assert.equal(segmentNames.length, 0);
});

test('Host Agent and rsyslog observations remain separate correlated records', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-rsyslog-cross-'));
  const store = await EvidenceStore.open({ directory });
  context.after(() => store.close());

  const chunkVector = JSON.parse(fs.readFileSync(path.resolve(testDir, '../../vectors/agent-chunk.json'), 'utf8'));
  const app = createApp({
    store,
    trustedAgentPublicKeyProvider: () => chunkVector.keyPair.publicKeyRaw
  });
  const httpServer = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    httpServer.once('listening', resolve);
    httpServer.once('error', reject);
  });
  context.after(() => new Promise<void>((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve())));
  const httpAddress = httpServer.address() as AddressInfo;

  const raw = Buffer.from(chunkVector.chunk.payload, 'utf8');
  const httpResponse = await fetch(`http://127.0.0.1:${httpAddress.port}/api/v1/logs/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sourceId: chunkVector.chunk.sourceId,
      deliveryId: chunkVector.chunk.deliveryId,
      streamId: chunkVector.chunk.streamId,
      fileIdentity: chunkVector.chunk.fileIdentity,
      fileGeneration: chunkVector.chunk.fileGeneration,
      byteOffset: chunkVector.chunk.byteOffset,
      observedAt: chunkVector.chunk.observedAt,
      rawEventBase64: raw.toString('base64'),
      signature: chunkVector.signatureHex
    })
  });
  assert.equal(httpResponse.status, 201);

  await processRsyslogFrame(store, Buffer.from(JSON.stringify({
    sourceId: chunkVector.chunk.sourceId,
    streamId: chunkVector.chunk.streamId,
    fileIdentity: chunkVector.chunk.fileIdentity,
    byteOffset: chunkVector.chunk.byteOffset,
    observedAt: chunkVector.chunk.observedAt,
    rawEvent: chunkVector.chunk.payload
  })));

  const segmentNames = fs.readdirSync(directory).filter((name) => /^evidence-\d{12}\.jsonl$/.test(name));
  const records = segmentNames.flatMap((name) =>
    fs.readFileSync(path.join(directory, name), 'utf8').split('\n').filter((line) => line.length > 0).map((line) => JSON.parse(line))
  );

  assert.equal(records.length, 2);
  assert.deepEqual(new Set(records.map((record) => record.observationSource)), new Set(['host-agent', 'rsyslog-tcp']));
  assert.equal(new Set(records.map((record) => record.vaultSequence)).size, 2);
  assert.equal(records[0].deliveryId, chunkVector.chunk.deliveryId);
  assert.deepEqual(records.map((record) => Buffer.from(record.rawEventBytesBase64, 'base64')), [raw, raw]);
});

test('rsyslog socket closes all connections and stops listening', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-rsyslog-close-'));
  const store = await EvidenceStore.open({ directory });
  const receiver = new RsyslogReceiver({ host: '127.0.0.1', port: 0, maxFrameBytes: 1024, store });
  await receiver.start();
  const address = receiver.server.address();
  assert.ok(address && typeof address === 'object');
  const socket = await connect(address.port);

  const clientClosed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
  await receiver.close();
  await clientClosed;
  assert.equal(receiver.server.listening, false);
  assert.equal(socket.destroyed, true);
  store.close();
});
