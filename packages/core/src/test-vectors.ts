/**
 * TRUSTTRACE Frozen Test Vectors
 * The Big Hack 2.0 | Problem B3
 * 
 * Phase 0 Interface Freeze Deliverable for all workstreams:
 * - Person 1: Crypto & Smart Contract
 * - Person 2: Evidence Vault & API
 * - Person 3: Host Lab & Agent
 * - Person 4: Dashboard & Auditor CLI
 * 
 * All implementations across languages and services MUST produce identical values.
 */

import { computeLeafHashHex, encodeLeafPreimage } from './canonical.ts';
import { buildMerkleTree, generateMerkleProof, computeMerkleRootHex } from './merkle.ts';
import {
  computeCommitmentStructHashHex,
  computeDomainSeparatorHex,
  computeEIP712DigestHex,
  GENESIS_CHECKPOINT_HASH
} from './commitment.ts';
import { signBatchCommitment, getEthereumAddress } from './signer.ts';
import type { CanonicalEvent, BatchCommitment, EIP712Domain } from './types.ts';

// Standard Frozen Constants
export const FROZEN_SOURCE_ID = 'source-01';
export const FROZEN_SOURCE_ID_HEX = '0x736f757263652d30310000000000000000000000000000000000000000000000';
export const FROZEN_VERSION = 1;

// Test Events
export const TEST_EVENTS: CanonicalEvent[] = [
  {
    version: FROZEN_VERSION,
    sourceId: FROZEN_SOURCE_ID,
    vaultSequence: 1n,
    rawEventBytes: '{"event":"sshd_auth_failure","user":"root","ip":"192.168.1.10"}'
  },
  {
    version: FROZEN_VERSION,
    sourceId: FROZEN_SOURCE_ID,
    vaultSequence: 2n,
    rawEventBytes: '{"event":"sshd_auth_failure","user":"admin","ip":"192.168.1.10"}'
  },
  {
    version: FROZEN_VERSION,
    sourceId: FROZEN_SOURCE_ID,
    vaultSequence: 3n,
    rawEventBytes: '{"event":"sshd_auth_success","user":"ubuntu","ip":"192.168.1.50"}'
  },
  {
    version: FROZEN_VERSION,
    sourceId: FROZEN_SOURCE_ID,
    vaultSequence: 4n,
    rawEventBytes: '{"event":"sudo_command","user":"ubuntu","command":"/bin/systemctl restart nginx"}'
  },
  {
    version: FROZEN_VERSION,
    sourceId: FROZEN_SOURCE_ID,
    vaultSequence: 5n,
    rawEventBytes: '{"event":"session_closed","user":"ubuntu","duration":184}'
  }
];

// Computed Leaf Hashes
export const TEST_LEAF_HASHES: string[] = TEST_EVENTS.map(e => computeLeafHashHex(e));

// Merkle Trees
// 1 Leaf: Root is the leaf itself
export const MERKLE_TREE_1 = buildMerkleTree([TEST_LEAF_HASHES[0]]);
export const MERKLE_ROOT_1 = '0x' + MERKLE_TREE_1.root.toString('hex');

// 2 Leaves: Balanced pair
export const MERKLE_TREE_2 = buildMerkleTree([TEST_LEAF_HASHES[0], TEST_LEAF_HASHES[1]]);
export const MERKLE_ROOT_2 = '0x' + MERKLE_TREE_2.root.toString('hex');

// 3 Leaves: LOCKED: odd node promoted unchanged (never duplicated)
export const MERKLE_TREE_3 = buildMerkleTree([TEST_LEAF_HASHES[0], TEST_LEAF_HASHES[1], TEST_LEAF_HASHES[2]]);
export const MERKLE_ROOT_3 = '0x' + MERKLE_TREE_3.root.toString('hex');
export const PROOF_LEAF_2_TREE_3 = generateMerkleProof(MERKLE_TREE_3.layers, 2);

// 4 Leaves: Full balanced binary tree
export const MERKLE_TREE_4 = buildMerkleTree(TEST_LEAF_HASHES.slice(0, 4));
export const MERKLE_ROOT_4 = '0x' + MERKLE_TREE_4.root.toString('hex');

// 5 Leaves: Odd node promoted at multiple layers
export const MERKLE_TREE_5 = buildMerkleTree(TEST_LEAF_HASHES);
export const MERKLE_ROOT_5 = '0x' + MERKLE_TREE_5.root.toString('hex');

// Standard Test EIP-712 Domain
export const TEST_EIP712_DOMAIN: EIP712Domain = {
  name: 'EvidenceAnchor',
  version: '1',
  chainId: 31337n, // Hardhat default local chainId
  verifyingContract: '0x5FbDB2315678afecb367f032d93F642f64180aa3'
};
export const TEST_DOMAIN_SEPARATOR = computeDomainSeparatorHex(TEST_EIP712_DOMAIN);

// Test Vault Signer Key (for deterministic test vectors only)
export const TEST_VAULT_SIGNER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
export const TEST_VAULT_SIGNER_ADDRESS = getEthereumAddress(TEST_VAULT_SIGNER_KEY);

// Separate Relayer Address (relayer msg.sender != vault signer)
export const TEST_RELAYER_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

// Batch 1 (Genesis Batch: seq 1..3)
// ASSUMPTION A3: previousCheckpointHash = struct hash of previous commitment, genesis zero, first batch starts at seq 1
export const TEST_BATCH_1: BatchCommitment = {
  sourceId: FROZEN_SOURCE_ID_HEX,
  sequenceStart: 1n,
  sequenceEnd: 3n,
  leafCount: 3n,
  merkleRoot: MERKLE_ROOT_3,
  previousCheckpointHash: GENESIS_CHECKPOINT_HASH
};
export const TEST_BATCH_1_STRUCT_HASH = computeCommitmentStructHashHex(TEST_BATCH_1);
export const TEST_SIGNED_BATCH_1 = signBatchCommitment(TEST_VAULT_SIGNER_KEY, TEST_EIP712_DOMAIN, TEST_BATCH_1);

// Batch 2 (Chained Continuation: seq 4..5)
// ASSUMPTION A3: previousCheckpointHash is struct hash of Batch 1
export const TEST_BATCH_2: BatchCommitment = {
  sourceId: FROZEN_SOURCE_ID_HEX,
  sequenceStart: 4n,
  sequenceEnd: 5n,
  leafCount: 2n,
  merkleRoot: '0x' + buildMerkleTree([TEST_LEAF_HASHES[3], TEST_LEAF_HASHES[4]]).root.toString('hex'),
  previousCheckpointHash: TEST_BATCH_1_STRUCT_HASH
};
export const TEST_BATCH_2_STRUCT_HASH = computeCommitmentStructHashHex(TEST_BATCH_2);
export const TEST_SIGNED_BATCH_2 = signBatchCommitment(TEST_VAULT_SIGNER_KEY, TEST_EIP712_DOMAIN, TEST_BATCH_2);

// Polygon Amoy Checkpoint Batch
// ASSUMPTION A4: same contract on Amoy, checkpoint digest in merkleRoot field
export const TEST_AMOY_CHECKPOINT_DIGEST = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
export const TEST_AMOY_BATCH: BatchCommitment = {
  sourceId: FROZEN_SOURCE_ID_HEX,
  sequenceStart: 1n,
  sequenceEnd: 100n,
  leafCount: 100n,
  merkleRoot: TEST_AMOY_CHECKPOINT_DIGEST, // Checkpoint digest stored in merkleRoot field (A4)
  previousCheckpointHash: GENESIS_CHECKPOINT_HASH
};
export const TEST_AMOY_STRUCT_HASH = computeCommitmentStructHashHex(TEST_AMOY_BATCH);
