import assert from 'node:assert';
import {
  buildMerkleTree,
  computeMerkleRootHex,
  generateMerkleProof,
  hashInternalNode,
  NODE_DOMAIN_TAG,
  verifyMerkleProof
} from '../src/merkle.ts';
import {
  MERKLE_ROOT_1,
  MERKLE_ROOT_2,
  MERKLE_ROOT_3,
  MERKLE_ROOT_4,
  MERKLE_ROOT_5,
  MERKLE_TREE_3,
  PROOF_LEAF_2_TREE_3,
  TEST_LEAF_HASHES
} from '../src/test-vectors.ts';

export function runMerkleTests() {
  console.log('--- Running Merkle Tree & Inclusion Proof Tests ---');

  // Test 1: Node domain tag must be 0x01
  assert.strictEqual(NODE_DOMAIN_TAG, 0x01, 'LOCKED: NODE_DOMAIN_TAG must be 0x01');

  // Test 2: Internal node hashing
  const nodeHash = hashInternalNode(TEST_LEAF_HASHES[0], TEST_LEAF_HASHES[1]);
  assert.strictEqual(nodeHash.length, 32, 'Internal node hash must be 32 bytes');

  // Test 3: Single-leaf tree (leaf is root)
  const tree1 = buildMerkleTree([TEST_LEAF_HASHES[0]]);
  assert.strictEqual(
    '0x' + tree1.root.toString('hex'),
    TEST_LEAF_HASHES[0],
    'Single-leaf Merkle root must equal the leaf hash itself'
  );
  assert.strictEqual('0x' + tree1.root.toString('hex'), MERKLE_ROOT_1);

  // Test 4: 2-leaf tree
  const tree2 = buildMerkleTree(TEST_LEAF_HASHES.slice(0, 2));
  assert.strictEqual('0x' + tree2.root.toString('hex'), MERKLE_ROOT_2);

  // Test 5: LOCKED odd node promotion (3 leaves: odd node promoted unchanged, never duplicated)
  const tree3 = buildMerkleTree(TEST_LEAF_HASHES.slice(0, 3));
  assert.strictEqual('0x' + tree3.root.toString('hex'), MERKLE_ROOT_3);
  // Layer 1 must contain: [hash(0, 1), leaf 2 promoted]
  assert.strictEqual(tree3.layers[1].length, 2, 'Layer 1 must have 2 nodes');
  assert.strictEqual(
    '0x' + tree3.layers[1][1].toString('hex'),
    TEST_LEAF_HASHES[2],
    'LOCKED: Odd node (index 2) must be promoted unchanged without duplication'
  );

  // Test 6: 4-leaf tree & 5-leaf tree
  const tree4 = buildMerkleTree(TEST_LEAF_HASHES.slice(0, 4));
  assert.strictEqual('0x' + tree4.root.toString('hex'), MERKLE_ROOT_4);
  const tree5 = buildMerkleTree(TEST_LEAF_HASHES);
  assert.strictEqual('0x' + tree5.root.toString('hex'), MERKLE_ROOT_5);

  // Test 7: Proof generation & verification for all leaves in 3-leaf tree
  for (let i = 0; i < 3; i++) {
    const proof = generateMerkleProof(tree3.layers, i);
    assert.strictEqual(proof.leafIndex, i);
    const valid = verifyMerkleProof(proof.leafHash, proof.steps, MERKLE_ROOT_3);
    assert.strictEqual(valid, true, `Proof verification failed for leaf index ${i} in 3-leaf tree`);
  }

  // Test 8: Promoted step in proof for odd leaf
  const oddProof = generateMerkleProof(tree3.layers, 2);
  assert.strictEqual(
    oddProof.steps[0].position,
    'promoted',
    'Proof step 0 for odd node must have position promoted'
  );
  assert.strictEqual(
    oddProof.steps[0].sibling,
    null,
    'Promoted proof step must have null sibling'
  );

  // Test 9: Proof generation & verification for all leaves in 5-leaf tree
  for (let i = 0; i < 5; i++) {
    const proof = generateMerkleProof(tree5.layers, i);
    const valid = verifyMerkleProof(proof.leafHash, proof.steps, MERKLE_ROOT_5);
    assert.strictEqual(valid, true, `Proof verification failed for leaf index ${i} in 5-leaf tree`);
  }

  // Test 10: Negative test - Proof fails if leaf hash is altered
  const fakeLeafHash = '0x1111111111111111111111111111111111111111111111111111111111111111';
  const invalidLeafProof = verifyMerkleProof(fakeLeafHash, oddProof.steps, MERKLE_ROOT_3);
  assert.strictEqual(invalidLeafProof, false, 'Altered leaf hash must fail verification');

  // Test 11: Negative test - Proof fails if expected root is altered
  const fakeRoot = '0x2222222222222222222222222222222222222222222222222222222222222222';
  const invalidRootProof = verifyMerkleProof(oddProof.leafHash, oddProof.steps, fakeRoot);
  assert.strictEqual(invalidRootProof, false, 'Altered expected root must fail verification');

  console.log('✓ Merkle Tree & Inclusion Proof tests passed (11/11)');
}
