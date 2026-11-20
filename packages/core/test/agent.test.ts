import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  encodeAgentChunkPreimage,
  signAgentChunk,
  signAgentChunkHex,
  verifyAgentChunk,
  encodeAgentHeartbeatPreimage,
  signAgentHeartbeat,
  signAgentHeartbeatHex,
  verifyAgentHeartbeat,
  generateAgentKeyPair,
  AGENT_CHUNK_DOMAIN_TAG,
  AGENT_HEARTBEAT_DOMAIN_TAG
} from '../src/agent.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const chunkVectorPath = path.resolve(__dirname, '../../../vectors/agent-chunk.json');
const chunkVector = JSON.parse(fs.readFileSync(chunkVectorPath, 'utf-8'));

const hbVectorPath = path.resolve(__dirname, '../../../vectors/agent-heartbeat.json');
const hbVector = JSON.parse(fs.readFileSync(hbVectorPath, 'utf-8'));

export function runAgentChunkTests(): void {
  console.log('--- Running Host Agent Ed25519 Chunk & Heartbeat Signing Tests ---');

  // 1. Domain tags
  assert.equal(AGENT_CHUNK_DOMAIN_TAG, 0xaa, 'AGENT_CHUNK_DOMAIN_TAG must be 0xAA');
  assert.equal(AGENT_HEARTBEAT_DOMAIN_TAG, 0xab, 'AGENT_HEARTBEAT_DOMAIN_TAG must be 0xAB');

  // 2. Validate Chunk against vector (with UUID deliveryId and metadata)
  const preimage = encodeAgentChunkPreimage(chunkVector.chunk);
  assert.equal('0x' + preimage.toString('hex'), chunkVector.preimageHex, 'Preimage must match vector hex');
  assert.equal(preimage.length, chunkVector.preimageLength, 'Preimage length must match vector length');

  const seed = Buffer.from(chunkVector.seed.slice(2), 'hex');
  const pair = generateAgentKeyPair(seed);
  assert.equal(pair.publicKeyHex, chunkVector.keyPair.publicKeyRaw, 'Public key must match vector');
  assert.equal(pair.privateKeyHex, chunkVector.keyPair.privateKeyRaw, 'Private key must match vector');

  const sigHex = signAgentChunkHex(chunkVector.chunk, pair.privateKey);
  assert.equal(sigHex, chunkVector.signatureHex, 'Deterministic signature must match vector hex');

  const valid = verifyAgentChunk(chunkVector.chunk, sigHex, pair.publicKey);
  assert.equal(valid, true, 'Vector signature must verify successfully');

  // 3. Raw 32-byte hex keys verification
  const validWithRawPub = verifyAgentChunk(chunkVector.chunk, chunkVector.signatureHex, chunkVector.keyPair.publicKeyRaw);
  assert.equal(validWithRawPub, true, 'Verification with raw 32-byte hex public key must succeed');

  // 4. Random keypair generation and signing roundtrip with UUID
  const randomPair = generateAgentKeyPair();
  const chunk2 = {
    sourceId: 'victim-workstation-02',
    deliveryId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', // UUID format
    streamId: 'auth.log',
    fileIdentity: 'inode:999999',
    byteOffset: 2048n,
    observedAt: 1732145500000000000n,
    payload: Buffer.from('CRITICAL: root password changed via sudo')
  };
  const sig2 = signAgentChunk(chunk2, randomPair.privateKey);
  assert.equal(sig2.length, 64, 'Signature must be exactly 64 bytes');
  assert.equal(verifyAgentChunk(chunk2, sig2, randomPair.publicKey), true, 'Roundtrip signature must verify');

  // 5. Negative: tampered payload rejection
  const tamperedPayloadChunk = {
    ...chunk2,
    payload: Buffer.from('CRITICAL: root password changed via sudo - TAMPERED')
  };
  assert.equal(
    verifyAgentChunk(tamperedPayloadChunk, sig2, randomPair.publicKey),
    false,
    'Must reject chunk with tampered payload'
  );

  // 6. Negative: tampered deliveryId (UUID) rejection
  const tamperedDeliveryChunk = {
    ...chunk2,
    deliveryId: '00000000-0000-0000-0000-000000000000'
  };
  assert.equal(
    verifyAgentChunk(tamperedDeliveryChunk, sig2, randomPair.publicKey),
    false,
    'Must reject chunk with tampered deliveryId'
  );

  // 7. Negative: tampered metadata (byteOffset) rejection
  const tamperedOffsetChunk = {
    ...chunk2,
    byteOffset: 999999n
  };
  assert.equal(
    verifyAgentChunk(tamperedOffsetChunk, sig2, randomPair.publicKey),
    false,
    'Must reject chunk with tampered byteOffset'
  );

  // 8. Negative: corrupted signature rejection
  const corruptedSig = Buffer.from(sig2);
  corruptedSig[0] ^= 0xff;
  assert.equal(
    verifyAgentChunk(chunk2, corruptedSig, randomPair.publicKey),
    false,
    'Must reject chunk with corrupted signature bytes'
  );

  // 9. Negative: wrong key verification
  assert.equal(
    verifyAgentChunk(chunk2, sig2, pair.publicKey),
    false,
    'Must reject signature verified against wrong public key'
  );

  // 10. Heartbeat vector verification
  const hbPreimage = encodeAgentHeartbeatPreimage(hbVector.heartbeat);
  assert.equal('0x' + hbPreimage.toString('hex'), hbVector.preimageHex, 'Heartbeat preimage must match vector hex');
  assert.equal(hbPreimage.length, hbVector.preimageLength, 'Heartbeat preimage length must match vector length');

  const hbSigHex = signAgentHeartbeatHex(hbVector.heartbeat, pair.privateKey);
  assert.equal(hbSigHex, hbVector.signatureHex, 'Deterministic heartbeat signature must match vector hex');

  const hbValid = verifyAgentHeartbeat(hbVector.heartbeat, hbSigHex, pair.publicKey);
  assert.equal(hbValid, true, 'Heartbeat signature must verify successfully');

  // 11. Heartbeat roundtrip and tamper resistance
  const randomHb = {
    sourceId: 'host-agent-cyprus-01',
    heartbeatSequence: 42n,
    observedAt: 1732145600000000000n,
    lastByteOffset: 2097152n,
    status: 'OK'
  };
  const randomHbSig = signAgentHeartbeat(randomHb, randomPair.privateKey);
  assert.equal(verifyAgentHeartbeat(randomHb, randomHbSig, randomPair.publicKey), true, 'Random heartbeat must verify');

  const tamperedSeqHb = { ...randomHb, heartbeatSequence: 43n };
  assert.equal(verifyAgentHeartbeat(tamperedSeqHb, randomHbSig, randomPair.publicKey), false, 'Must reject tampered heartbeat sequence');

  const tamperedStatusHb = { ...randomHb, status: 'DEGRADED' };
  assert.equal(verifyAgentHeartbeat(tamperedStatusHb, randomHbSig, randomPair.publicKey), false, 'Must reject tampered heartbeat status');

  console.log('✓ Host Agent Ed25519 Chunk & Heartbeat Signing tests passed (13/13)');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runAgentChunkTests();
}
