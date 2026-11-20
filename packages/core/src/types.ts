/**
 * TRUSTTRACE Cryptographic & Blockchain Core Types
 * The Big Hack 2.0 | Problem B3
 * 
 * OWNED BY: Person 1 (branch feature/crypto-contract)
 */

/**
 * Event envelope input for canonical leaf hashing.
 * 
 * LOCKED SPECIFICATION:
 * leafHash = SHA256(0x00 || version || sourceId || vaultSequence || rawEventLength || rawEventBytes);
 * 
 * ASSUMPTIONS:
 * - A1: widths (version 1B, sourceId 32B, vaultSequence u64 BE, rawEventLength u32 BE)
 * - A2: sourceId is bytes32 (padded or hex string)
 */
export interface CanonicalEvent {
  /** 1-byte version identifier (A1: version 1B) */
  version: number;
  /** 32-byte source identifier (A1 & A2: sourceId 32B / bytes32) */
  sourceId: string | Uint8Array | Buffer;
  /** 64-bit big-endian monotonic vault sequence (A1: vaultSequence u64 BE) */
  vaultSequence: bigint | number;
  /** Raw event payload (A1: rawEventLength u32 BE is byte length of rawEventBytes) */
  rawEventBytes: Uint8Array | Buffer | string;
}

/**
 * On-chain & off-chain Batch Commitment structure.
 * 
 * LOCKED SPECIFICATION:
 * commitment binds sourceId, sequenceStart, sequenceEnd, leafCount, merkleRoot, previousCheckpointHash.
 * 
 * ASSUMPTIONS:
 * - A1: sequenceStart, sequenceEnd, leafCount are uint64
 * - A2: sourceId is bytes32
 * - A3: previousCheckpointHash = struct hash of previous commitment, genesis zero, first batch starts at seq 1
 * - A4: same contract on Amoy, checkpoint digest in merkleRoot field
 */
export interface BatchCommitment {
  /** Source identifier (bytes32 hex string starting with 0x) */
  sourceId: string;
  /** Inclusive starting sequence number (uint64) */
  sequenceStart: bigint;
  /** Inclusive ending sequence number (uint64) */
  sequenceEnd: bigint;
  /** Total number of leaves in the batch (uint64) */
  leafCount: bigint;
  /** 32-byte Merkle root or aggregate checkpoint digest (A4) (bytes32 hex string starting with 0x) */
  merkleRoot: string;
  /** 32-byte struct hash of previous commitment, or 0x0...0 for genesis (A3) */
  previousCheckpointHash: string;
}

/**
 * Single step in a Merkle inclusion proof.
 * 
 * LOCKED SPECIFICATION:
 * odd node promoted unchanged (never duplicated);
 * When a node is promoted at a level without a sibling, position is 'promoted' and sibling is null.
 */
export interface MerkleProofStep {
  /** Sibling position relative to current path ('left' if sibling is on left, 'right' if sibling is on right, 'promoted' if odd node promoted without sibling) */
  position: 'left' | 'right' | 'promoted';
  /** 32-byte hex string of sibling hash, or null if promoted */
  sibling: string | null;
}

/**
 * Complete Merkle inclusion proof for a single leaf in a batch.
 */
export interface MerkleProof {
  /** 0-based leaf index inside the batch */
  leafIndex: number;
  /** Total number of leaves in the batch (needed so verifier knows which levels have no sibling) */
  leafCount: number;
  /** 32-byte leaf hash (0x...) */
  leafHash: string;
  /** 32-byte expected Merkle root (0x...) */
  root: string;
  /** Ordered list of sibling hashes along the path (omits levels where odd node was promoted) */
  siblings: string[];
  /** Ordered list of steps from leaf to root */
  steps: MerkleProofStep[];
}

/**
 * EIP-712 Domain Separator parameters.
 */
export interface EIP712Domain {
  name: string;
  version: string;
  chainId: bigint | number;
  verifyingContract: string;
}

/**
 * Complete signed batch commitment payload produced by Vault and submitted by Relayer.
 * 
 * LOCKED SPECIFICATION:
 * EIP-712 signer key exists ONLY in the vault; relayer is a separate key.
 */
export interface SignedBatchCommitment {
  /** The batch commitment data */
  commitment: BatchCommitment;
  /** 65-byte EIP-712 signature (0x + 130 hex chars) */
  signature: string;
  /** Vault signer address that produced the signature */
  signer: string;
  /** EIP-712 struct hash of the commitment */
  structHash: string;
  /** EIP-712 signing digest (keccak256("\x19\x01" || domainSeparator || structHash)) */
  digest: string;
}

/**
 * Contract Source registration status.
 * 
 * ASSUMPTIONS:
 * - A5: owner registers/revokes sources, no overwrite/delete function.
 */
export interface SourceRecord {
  signer: string;
  registered: boolean;
  revoked: boolean;
  lastSequenceEnd: bigint;
  lastCheckpointHash: string;
  batchCount: bigint;
}
