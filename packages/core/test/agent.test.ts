import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  encodeAgentChunkPreimage,
  signAgentChunk,
  signAgentChunkHex,
  verifyAgentChunk,
  generateAgentKeyPair,
  parseAgentPrivateKey,
  parseAgentPublicKey,
  AGENT_CHUNK_DOMAIN_TAG
} from '../src/agent.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const vectorPath = path.resolve(__dirname, '../../../vectors/agent-chunk.json');
const vector = JSON.parse(fs.readFileSync(vectorPath, 'utf-8'));

export function runAgentChunkTests(): void {
  console.log('--- Running Host Agent Ed25519 Chunk Signing Tests ---');

  // 1. Domain tag
  assert.equal(AGENT_CHUNK_DOMAIN_TAG, 0xaa, 'AGENT_CHUNK_DOMAIN_TAG must be 0xAA');

  // 2. Validate against vector
  const preimage = encodeAgentChunkPreimage(vector.chunk);
  assert.equal('0x' + preimage.toString('hex'), vector.preimageHex, 'Preimage must match vector hex');
  assert.equal(preimage.length, vector.preimageLength, 'Preimage length must match vector length');

  const seed = Buffer.from(vector.seed.slice(2), 'hex');
  const pair = generateAgentKeyPair(seed);
  assert.equal(pair.publicKeyHex, vector.keyPair.publicKeyRaw, 'Public key must match vector');
  assert.equal(pair.privateKeyHex, vector.keyPair.privateKeyRaw, 'Private key must match vector');

  const sigHex = signAgentChunkHex(vector.chunk, pair.privateKey);
  assert.equal(sigHex, vector.signatureHex, 'Deterministic signature must match vector hex');

  const valid = verifyAgentChunk(vector.chunk, sigHex, pair.publicKey);
  assert.equal(valid, true, 'Vector signature must verify successfully');

  // 3. Raw 32-byte hex keys verification
  const validWithRawPub = verifyAgentChunk(vector.chunk, vector.signatureHex, vector.keyPair.publicKeyRaw);
  assert.equal(validWithRawPub, true, 'Verification with raw 32-byte hex public key must succeed');

  // 4. Random keypair generation and signing roundtrip
  const randomPair = generateAgentKeyPair();
  const chunk2 = {
    sourceId: 'victim-workstation-02',
    deliveryId: 'chunk-999',
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

  // 6. Negative: tampered deliveryId rejection
  const tamperedDeliveryChunk = {
    ...chunk2,
    deliveryId: 'chunk-1000'
  };
  assert.equal(
    verifyAgentChunk(tamperedDeliveryChunk, sig2, randomPair.publicKey),
    false,
    'Must reject chunk with tampered deliveryId'
  );

  // 7. Negative: tampered sourceId rejection
  const tamperedSourceChunk = {
    ...chunk2,
    sourceId: 'attacker-machine'
  };
  assert.equal(
    verifyAgentChunk(tamperedSourceChunk, sig2, randomPair.publicKey),
    false,
    'Must reject chunk with tampered sourceId'
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

  console.log('✓ Host Agent Ed25519 Chunk Signing tests passed (9/9)');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runAgentChunkTests();
}
