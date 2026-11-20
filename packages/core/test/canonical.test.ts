import assert from 'node:assert';
import {
  computeLeafHash,
  computeLeafHashHex,
  encodeLeafPreimage,
  formatSourceId,
  LEAF_DOMAIN_TAG
} from '../src/canonical.ts';
import { TEST_EVENTS, TEST_LEAF_HASHES } from '../src/test-vectors.ts';

export function runCanonicalTests() {
  console.log('--- Running Canonical Event Hashing Tests ---');

  // Test 1: Leaf domain tag must be 0x00
  assert.strictEqual(LEAF_DOMAIN_TAG, 0x00, 'LOCKED: LEAF_DOMAIN_TAG must be 0x00');

  // Test 2: Preimage length check (1B tag + 1B ver + 32B sourceId + 8B seq + 4B len + N payload)
  const event0 = TEST_EVENTS[0];
  const preimage0 = encodeLeafPreimage(event0);
  const rawBytesLen = Buffer.byteLength(event0.rawEventBytes as string, 'utf-8');
  const expectedPreimageLen = 1 + 1 + 32 + 8 + 4 + rawBytesLen;
  assert.strictEqual(
    preimage0.length,
    expectedPreimageLen,
    `Preimage length must equal ${expectedPreimageLen}, got ${preimage0.length}`
  );

  // Test 3: Tag and Version bytes
  assert.strictEqual(preimage0[0], 0x00, 'Preimage byte 0 must be 0x00 domain tag');
  assert.strictEqual(preimage0[1], 0x01, 'Preimage byte 1 must be version 1 (A1)');

  // Test 4: Big-endian sequence encoding (uint64 BE)
  const seqFromPreimage = preimage0.readBigUInt64BE(34);
  assert.strictEqual(seqFromPreimage, 1n, 'Preimage bytes 34..41 must encode vaultSequence 1n (A1)');

  // Test 5: Big-endian length encoding (uint32 BE)
  const lenFromPreimage = preimage0.readUInt32BE(42);
  assert.strictEqual(lenFromPreimage, rawBytesLen, 'Preimage bytes 42..45 must encode rawEventLength (A1)');

  // Test 6: Deterministic leaf hash matches test vector
  for (let i = 0; i < TEST_EVENTS.length; i++) {
    const computed = computeLeafHashHex(TEST_EVENTS[i]);
    assert.strictEqual(
      computed,
      TEST_LEAF_HASHES[i],
      `Leaf hash for event ${i} must match frozen test vector`
    );
  }

  // Test 7: Tamper sensitivity - changing 1 byte in event changes hash
  const tamperedEvent = {
    ...event0,
    rawEventBytes: (event0.rawEventBytes as string).replace('192.168.1.10', '192.168.1.11')
  };
  const tamperedHash = computeLeafHashHex(tamperedEvent);
  assert.notStrictEqual(tamperedHash, TEST_LEAF_HASHES[0], 'Tampered raw payload must produce different leaf hash');

  // Test 8: Sequence sensitivity - different vaultSequence changes hash
  const seqTamperedEvent = { ...event0, vaultSequence: 2n };
  assert.notStrictEqual(
    computeLeafHashHex(seqTamperedEvent),
    TEST_LEAF_HASHES[0],
    'Different vaultSequence must produce different leaf hash'
  );

  console.log('✓ Canonical Event Hashing tests passed (8/8)');
}
