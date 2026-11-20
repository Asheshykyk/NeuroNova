/**
 * Standalone Contract Verification Test
 * 
 * Simulates and verifies the complete EvidenceAnchor state machine, EIP-712 hashing,
 * signature validation, sequence continuity rules, and duplicate detection.
 * Executes natively in Node.js without requiring Hardhat or external dependencies.
 */

import assert from 'node:assert';
import crypto from 'node:crypto';
import {
  computeCommitmentStructHashHex,
  computeDomainSeparatorHex,
  computeEIP712Digest,
  GENESIS_CHECKPOINT_HASH
} from '../../packages/core/src/commitment.ts';
import {
  buildMerkleTree,
  generateMerkleProof
} from '../../packages/core/src/merkle.ts';
import {
  getEthereumAddress,
  recoverSignerAddress,
  signBatchCommitment
} from '../../packages/core/src/signer.ts';
import type { BatchCommitment, EIP712Domain } from '../../packages/core/src/types.ts';
import {
  TEST_BATCH_1,
  TEST_BATCH_2,
  TEST_LEAF_HASHES,
  TEST_VAULT_SIGNER_KEY
} from '../../packages/core/src/test-vectors.ts';

// Simulated EvidenceAnchor Contract State
class EvidenceAnchorSimulator {
  owner: string;
  domain: EIP712Domain;
  sources = new Map<string, {
    signer: string;
    registered: boolean;
    revoked: boolean;
    lastSequenceEnd: bigint;
    lastCheckpointHash: string;
    batchCount: bigint;
  }>();
  anchoredBatches = new Set<string>();
  batches = new Map<string, BatchCommitment>();

  constructor(owner: string, domain: EIP712Domain) {
    this.owner = owner;
    this.domain = domain;
  }

  // ASSUMPTION A5: Owner registers/revokes sources, no overwrite/delete function
  registerSource(caller: string, sourceId: string, signer: string) {
    assert.strictEqual(caller.toLowerCase(), this.owner.toLowerCase(), 'Caller is not contract owner');
    const cleanSource = sourceId.toLowerCase();
    assert.ok(!this.sources.get(cleanSource)?.registered, 'Source already registered; overwrite not permitted (A5)');

    this.sources.set(cleanSource, {
      signer: signer.toLowerCase(),
      registered: true,
      revoked: false,
      lastSequenceEnd: 0n,
      lastCheckpointHash: GENESIS_CHECKPOINT_HASH,
      batchCount: 0n
    });
  }

  revokeSource(caller: string, sourceId: string) {
    assert.strictEqual(caller.toLowerCase(), this.owner.toLowerCase(), 'Caller is not contract owner');
    const cleanSource = sourceId.toLowerCase();
    const src = this.sources.get(cleanSource);
    assert.ok(src && src.registered, 'Source not registered');
    assert.ok(!src.revoked, 'Source is already revoked');
    src.revoked = true;
  }

  // LOCKED: anchorBatch() validates registered signer, source, sequence continuity, duplicate batches
  // EIP-712 signer key exists ONLY in vault; relayer is a separate key (caller)
  anchorBatch(relayerCaller: string, commitment: BatchCommitment, signatureHex: string): string {
    const cleanSource = commitment.sourceId.toLowerCase();
    const source = this.sources.get(cleanSource);
    assert.ok(source && source.registered, 'Source not registered');
    assert.ok(!source.revoked, 'Source is revoked');

    // Duplicate batch check
    const structHash = computeCommitmentStructHashHex(commitment);
    assert.ok(!this.anchoredBatches.has(structHash), 'Duplicate batch: commitment already anchored');

    // EIP-712 Signer Validation
    const digest = computeEIP712Digest(this.domain, commitment);
    const recoveredSigner = recoverSignerAddress(digest, signatureHex);
    assert.strictEqual(
      recoveredSigner.toLowerCase(),
      source.signer.toLowerCase(),
      'Invalid signer: does not match registered vault signer'
    );

    // Sequence Continuity Validation
    assert.ok(commitment.sequenceStart <= commitment.sequenceEnd, 'Invalid sequence range');
    const expectedLeaves = commitment.sequenceEnd - commitment.sequenceStart + 1n;
    assert.strictEqual(commitment.leafCount, expectedLeaves, 'leafCount mismatch');

    // ASSUMPTION A3: previousCheckpointHash = struct hash of previous commitment, genesis zero, first batch starts at seq 1
    if (source.batchCount === 0n) {
      assert.strictEqual(commitment.sequenceStart, 1n, 'First batch must start at sequence 1 (A3)');
      assert.strictEqual(
        commitment.previousCheckpointHash.toLowerCase(),
        GENESIS_CHECKPOINT_HASH.toLowerCase(),
        'Genesis previousCheckpointHash must be zero (A3)'
      );
    } else {
      assert.strictEqual(
        commitment.sequenceStart,
        source.lastSequenceEnd + 1n,
        'Sequence continuity broken: sequenceStart != lastSequenceEnd + 1'
      );
      assert.strictEqual(
        commitment.previousCheckpointHash.toLowerCase(),
        source.lastCheckpointHash.toLowerCase(),
        'previousCheckpointHash mismatch (A3)'
      );
    }

    // State update (relayer is caller, signer is recoveredSigner)
    this.anchoredBatches.add(structHash);
    this.batches.set(structHash, commitment);
    source.lastSequenceEnd = commitment.sequenceEnd;
    source.lastCheckpointHash = structHash;
    source.batchCount += 1n;

    return structHash;
  }

  // On-chain Merkle proof verification helper simulation
  verifyInclusionProof(leafHash: string, proof: string[], index: bigint, expectedRoot: string): boolean {
    let current = Buffer.from(leafHash.startsWith('0x') ? leafHash.slice(2) : leafHash, 'hex');
    let idx = index;
    for (let i = 0; i < proof.length; i++) {
      const siblingHex = proof[i].startsWith('0x') ? proof[i].slice(2) : proof[i];
      if (siblingHex === '0'.repeat(64)) {
        // Odd node promoted unchanged (never duplicated)
      } else {
        const sibling = Buffer.from(siblingHex, 'hex');
        if (idx % 2n === 1n) {
          // Current is right child, sibling on left
          current = crypto.createHash('sha256').update(Buffer.concat([Buffer.from([0x01]), sibling, current])).digest();
        } else {
          // Current is left child, sibling on right
          current = crypto.createHash('sha256').update(Buffer.concat([Buffer.from([0x01]), current, sibling])).digest();
        }
      }
      idx = idx / 2n;
    }
    const computedRoot = '0x' + current.toString('hex');
    return computedRoot.toLowerCase() === expectedRoot.toLowerCase();
  }
}

console.log('============================================================');
console.log('EvidenceAnchor.sol Standalone Logic & Contract Tests');
console.log('Person 1: Smart Contract Validation (All Rules & Assumptions)');
console.log('============================================================\n');

const owner = '0x1111111111111111111111111111111111111111';
const relayer = '0x2222222222222222222222222222222222222222';
const vaultSignerAddr = getEthereumAddress(TEST_VAULT_SIGNER_KEY);
const sourceId = '0x736f757263652d30310000000000000000000000000000000000000000000000';

const domain: EIP712Domain = {
  name: 'EvidenceAnchor',
  version: '1',
  chainId: 31337n,
  verifyingContract: '0x5FbDB2315678afecb367f032d93F642f64180aa3'
};

const contract = new EvidenceAnchorSimulator(owner, domain);

// Test 1: Register Source (A5)
contract.registerSource(owner, sourceId, vaultSignerAddr);
console.log('✓ Test 1: Source registered successfully (A5)');

// Test 2: Reject source overwrite (A5)
assert.throws(
  () => contract.registerSource(owner, sourceId, relayer),
  /overwrite not permitted/
);
console.log('✓ Test 2: Rejected source overwrite (A5)');

// Test 3: Anchor Genesis Batch 1 with Vault Signer & Separate Relayer (LOCKED & A3)
const batch1: BatchCommitment = { ...TEST_BATCH_1, sourceId };
const signed1 = signBatchCommitment(TEST_VAULT_SIGNER_KEY, domain, batch1);
const structHash1 = contract.anchorBatch(relayer, batch1, signed1.signature);
assert.strictEqual(structHash1, computeCommitmentStructHashHex(batch1));
console.log('✓ Test 3: Genesis Batch 1 anchored by relayer with valid vault signature (A3)');

// Test 4: Reject Duplicate Batch Replay (LOCKED)
assert.throws(
  () => contract.anchorBatch(relayer, batch1, signed1.signature),
  /Duplicate batch/
);
console.log('✓ Test 4: Rejected duplicate batch replay (LOCKED)');

// Test 5: Anchor Chained Batch 2 (Continuity & A3)
const batch2: BatchCommitment = {
  ...TEST_BATCH_2,
  sourceId,
  previousCheckpointHash: structHash1
};
const signed2 = signBatchCommitment(TEST_VAULT_SIGNER_KEY, domain, batch2);
const structHash2 = contract.anchorBatch(relayer, batch2, signed2.signature);
assert.strictEqual(structHash2, computeCommitmentStructHashHex(batch2));
console.log('✓ Test 5: Chained Batch 2 anchored successfully with sequence continuity (A3)');

// Test 6: Reject Sequence Gap
const gapBatch: BatchCommitment = {
  ...TEST_BATCH_2,
  sourceId,
  sequenceStart: 7n, // Gap: expected 6
  sequenceEnd: 8n,
  previousCheckpointHash: structHash2
};
const gapSigned = signBatchCommitment(TEST_VAULT_SIGNER_KEY, domain, gapBatch);
assert.throws(
  () => contract.anchorBatch(relayer, gapBatch, gapSigned.signature),
  /Sequence continuity broken/
);
console.log('✓ Test 6: Rejected sequence gap (LOCKED continuity)');

// Test 7: Reject Invalid Signer (unauthorized key)
const fakeKey = '0x0000000000000000000000000000000000000000000000000000000000000001';
const batch3: BatchCommitment = {
  sourceId,
  sequenceStart: 6n,
  sequenceEnd: 6n,
  leafCount: 1n,
  merkleRoot: '0x' + '00'.repeat(32),
  previousCheckpointHash: structHash2
};
const fakeSigned = signBatchCommitment(fakeKey, domain, batch3);
assert.throws(
  () => contract.anchorBatch(relayer, batch3, fakeSigned.signature),
  /Invalid signer/
);
console.log('✓ Test 7: Rejected unauthorized signer (LOCKED)');

// Test 8: Polygon Amoy Mode (A4: checkpoint digest in merkleRoot field)
const amoySource = '0x616d6f792d303100000000000000000000000000000000000000000000000000';
contract.registerSource(owner, amoySource, vaultSignerAddr);
const checkpointDigest = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
const amoyBatch: BatchCommitment = {
  sourceId: amoySource,
  sequenceStart: 1n,
  sequenceEnd: 100n,
  leafCount: 100n,
  merkleRoot: checkpointDigest, // Checkpoint digest in merkleRoot (A4)
  previousCheckpointHash: GENESIS_CHECKPOINT_HASH
};
const amoySigned = signBatchCommitment(TEST_VAULT_SIGNER_KEY, domain, amoyBatch);
const amoyHash = contract.anchorBatch(relayer, amoyBatch, amoySigned.signature);
assert.ok(amoyHash);
console.log('✓ Test 8: Anchored Polygon Amoy checkpoint batch (A4)');

// Test 9: On-chain Merkle Proof Verification with Odd Promotion (LOCKED)
const leaves = TEST_LEAF_HASHES.slice(0, 3);
const { root, layers } = buildMerkleTree(leaves);
const proof = generateMerkleProof(layers, 2); // Leaf 2 is promoted odd node
const proofArray = proof.steps.map(s => s.sibling || '0x' + '00'.repeat(32));
const rootHex = '0x' + root.toString('hex');
const proofValid = contract.verifyInclusionProof(proof.leafHash, proofArray, 2n, rootHex);
assert.strictEqual(proofValid, true, 'Merkle inclusion proof verification failed');
console.log('✓ Test 9: Verified on-chain Merkle proof with odd node promotion (LOCKED)');

console.log('\n============================================================');
console.log('ALL CONTRACT STANDALONE TESTS PASSED! (9/9 checks)');
console.log('============================================================');
