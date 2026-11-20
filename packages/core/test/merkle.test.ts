import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildTree,
  computeMerkleRootHex,
  getProof,
  hashNode,
  NODE_DOMAIN_TAG,
  verifyProof
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function runMerkleTests() {
  console.log('--- Running Merkle Tree & Inclusion Proof Tests ---');

  // Test 1: Node domain tag must be 0x01
  assert.strictEqual(NODE_DOMAIN_TAG, 0x01, 'LOCKED: NODE_DOMAIN_TAG must be 0x01');

  // Test 2: Internal node hashing
  const nodeHash = hashNode(TEST_LEAF_HASHES[0], TEST_LEAF_HASHES[1]);
  assert.strictEqual(nodeHash.length, 32, 'Internal node hash must be 32 bytes');

  // Test 3: Single-leaf tree (leaf is root)
  const tree1 = buildTree([TEST_LEAF_HASHES[0]]);
  assert.strictEqual(
    '0x' + tree1.root.toString('hex'),
    TEST_LEAF_HASHES[0],
    'Single-leaf Merkle root must equal the leaf hash itself'
  );

  // Test 4: 2-leaf tree
  const tree2 = buildTree(TEST_LEAF_HASHES.slice(0, 2));
  assert.strictEqual('0x' + tree2.root.toString('hex'), MERKLE_ROOT_2);

  // Test 5: LOCKED odd node promotion (3 leaves: odd node promoted unchanged, never duplicated)
  const tree3 = buildTree(TEST_LEAF_HASHES.slice(0, 3));
  assert.strictEqual('0x' + tree3.root.toString('hex'), MERKLE_ROOT_3);
  assert.strictEqual(tree3.layers[1].length, 2, 'Layer 1 must have 2 nodes');
  assert.strictEqual(
    '0x' + tree3.layers[1][1].toString('hex'),
    TEST_LEAF_HASHES[2],
    'LOCKED: Odd node (index 2) must be promoted unchanged without duplication'
  );

  // Test 6: 4-leaf tree & 5-leaf tree
  const tree4 = buildTree(TEST_LEAF_HASHES.slice(0, 4));
  assert.strictEqual('0x' + tree4.root.toString('hex'), MERKLE_ROOT_4);
  const tree5 = buildTree(TEST_LEAF_HASHES);
  assert.strictEqual('0x' + tree5.root.toString('hex'), MERKLE_ROOT_5);

  // Test 7: Proof generation & verification for all leaves in 3-leaf tree
  for (let i = 0; i < 3; i++) {
    const proof = getProof(tree3.layers, i);
    assert.strictEqual(proof.leafIndex, i);
    assert.strictEqual(proof.leafCount, 3);
    const valid = verifyProof(proof, MERKLE_ROOT_3);
    assert.strictEqual(valid, true, `Proof verification failed for leaf index ${i} in 3-leaf tree`);
  }

  // Test 8: Promoted step in proof for odd leaf
  const oddProof = getProof(tree3.layers, 2);
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
  assert.strictEqual(
    oddProof.siblings.length,
    1,
    'Odd promoted leaf at level 0 consumes no sibling for that level'
  );

  // Test 9: Proof generation & verification for all leaves in 5-leaf tree
  for (let i = 0; i < 5; i++) {
    const proof = getProof(tree5.layers, i);
    const valid = verifyProof(proof, MERKLE_ROOT_5);
    assert.strictEqual(valid, true, `Proof verification failed for leaf index ${i} in 5-leaf tree`);
  }

  // Test 10: Negative test - Proof fails if leaf hash is altered
  const fakeLeafHash = '0x1111111111111111111111111111111111111111111111111111111111111111';
  const invalidLeafProof = verifyProof({ ...oddProof, leafHash: fakeLeafHash }, MERKLE_ROOT_3);
  assert.strictEqual(invalidLeafProof, false, 'Altered leaf hash must fail verification');

  // Test 11: Negative test - Proof fails if expected root is altered
  const fakeRoot = '0x2222222222222222222222222222222222222222222222222222222222222222';
  const invalidRootProof = verifyProof(oddProof, fakeRoot);
  assert.strictEqual(invalidRootProof, false, 'Altered expected root must fail verification');

  // Test 12: Load and verify frozen vectors from vectors/merkle.json
  const vectorPaths = [
    path.resolve(__dirname, '../vectors/merkle.json'),
    path.resolve(__dirname, '../../../vectors/merkle.json')
  ];
  let vectorsContent: string | null = null;
  for (const vp of vectorPaths) {
    if (fs.existsSync(vp)) {
      vectorsContent = fs.readFileSync(vp, 'utf-8');
      break;
    }
  }
  assert.ok(vectorsContent, 'vectors/merkle.json must exist');
  const merkleVectors = JSON.parse(vectorsContent);

  const testCounts = [1, 2, 3, 4, 5, 7];
  for (const n of testCounts) {
    const v = merkleVectors[n];
    assert.ok(v, `Vector for n=${n} must exist in merkle.json`);
    assert.strictEqual(v.leafCount, n);
    assert.strictEqual(v.proofs.length, n, `Expected ${n} proofs for n=${n}`);

    // Verify all positive proofs
    for (const proof of v.proofs) {
      const valid = verifyProof(proof, v.root);
      assert.strictEqual(valid, true, `Proof for n=${n}, idx=${proof.leafIndex} must verify`);
    }

    // Verify negative cases (modified leaf, wrong leafCount)
    assert.strictEqual(v.negativeCases.length, 2, `Expected 2 negative cases for n=${n}`);
    for (const neg of v.negativeCases) {
      const valid = verifyProof(neg.proof, v.root);
      assert.strictEqual(
        valid,
        neg.expectedValid,
        `Negative case '${neg.name}' for n=${n} must fail verification`
      );
    }
  }
  console.log('✓ Validated all vectors in vectors/merkle.json (1, 2, 3, 4, 5, 7 leaves + negative cases)');

  // Test 13: Prompt 1 API - verifyProof(leaf, index, leafCount, proof, root) positional arguments
  const p1Leaf = TEST_LEAF_HASHES[2];
  const p1Proof = PROOF_LEAF_2_TREE_3.siblings;
  const p1Valid = verifyProof(p1Leaf, 2, 3, p1Proof, MERKLE_ROOT_3);
  assert.strictEqual(p1Valid, true, 'verifyProof with Prompt 1 positional arguments must succeed');

  const p1Invalid = verifyProof(p1Leaf, 2, 999, p1Proof, MERKLE_ROOT_3);
  assert.strictEqual(p1Invalid, false, 'verifyProof with wrong leafCount must fail');

  console.log('✓ Merkle Tree & Inclusion Proof tests passed (13/13)');
}
