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

  // 3. Assert all 7 tamper cases fail verification
  for (const tc of chunkVector.tamperCases) {
    const isTamperedValid = verifyAgentChunk(tc.tamperedChunk, chunkVector.signatureHex, pair.publicKey);
    assert.equal(isTamperedValid, false, `Tampering ${tc.field} must cause verification to fail`);
  }

  // 4. Raw 32-byte hex keys verification
  const validWithRawPub = verifyAgentChunk(chunkVector.chunk, chunkVector.signatureHex, chunkVector.keyPair.publicKeyRaw);
  assert.equal(validWithRawPub, true, 'Verification with raw 32-byte hex public key must succeed');

  // 5. Random keypair generation and signing roundtrip with UUID
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

  // 6. Negative: corrupted signature rejection
  const corruptedSig = Buffer.from(sig2);
  corruptedSig[0] ^= 0xff;
  assert.equal(
    verifyAgentChunk(chunk2, corruptedSig, randomPair.publicKey),
    false,
    'Must reject chunk with corrupted signature bytes'
  );

  // 7. Negative: wrong key verification
  assert.equal(
    verifyAgentChunk(chunk2, sig2, pair.publicKey),
    false,
    'Must reject signature verified against wrong public key'
  );

  // 8. Heartbeat vector verification
  const hbPreimage = encodeAgentHeartbeatPreimage(hbVector.heartbeat);
  assert.equal('0x' + hbPreimage.toString('hex'), hbVector.preimageHex, 'Heartbeat preimage must match vector hex');
  assert.equal(hbPreimage.length, hbVector.preimageLength, 'Heartbeat preimage length must match vector length');

  const hbSigHex = signAgentHeartbeatHex(hbVector.heartbeat, pair.privateKey);
  assert.equal(hbSigHex, hbVector.signatureHex, 'Deterministic heartbeat signature must match vector hex');

  const hbValid = verifyAgentHeartbeat(hbVector.heartbeat, hbSigHex, pair.publicKey);
  assert.equal(hbValid, true, 'Heartbeat signature must verify successfully');

  // 9. Assert all 4 heartbeat tamper cases fail verification
  for (const tc of hbVector.tamperCases) {
    const isTamperedHbValid = verifyAgentHeartbeat(tc.tamperedHeartbeat, hbVector.signatureHex, pair.publicKey);
    assert.equal(isTamperedHbValid, false, `Tampering heartbeat ${tc.field} must cause verification to fail`);
  }

  // 10. Random heartbeat roundtrip
  const randomHb = {
    sourceId: 'host-agent-cyprus-01',
    heartbeatSequence: 42n,
    observedAt: 1732145600000000000n,
    lastByteOffset: 2097152n,
    status: 'OK'
  };
  const randomHbSig = signAgentHeartbeat(randomHb, randomPair.privateKey);
  assert.equal(verifyAgentHeartbeat(randomHb, randomHbSig, randomPair.publicKey), true, 'Random heartbeat must verify');

  console.log('✓ Host Agent Ed25519 Chunk & Heartbeat Signing tests passed (all 7 chunk & 4 heartbeat tamper fields verified)');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runAgentChunkTests();
}
