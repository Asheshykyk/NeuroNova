import crypto from 'node:crypto';
import type { BatchCommitment } from './types.ts';
import { hashCommitmentHex, GENESIS_CHECKPOINT_HASH } from './commitment.ts';

/**
 * Domain separation byte for aggregate public checkpoint digest.
 * Distinguishes public checkpoints from leaf preimages (0x00),
 * internal Merkle nodes (0x01), EIP-712 digests (0x19 0x01),
 * agent chunks (0xAA), and heartbeats (0xAB).
 */
export const CHECKPOINT_DOMAIN_TAG = 0xCC;

export const GENESIS_CHECKPOINT_DIGEST = '0x0000000000000000000000000000000000000000000000000000000000000000';

export interface CheckpointInput {
  /** 32-byte digest of the previous checkpoint (or 0x0...0 for genesis) */
  previousCheckpointDigest: string | Uint8Array | Buffer;
  /** Chain ID where local batches were anchored (e.g. 31337 for local Hardhat) */
  localChainId: bigint | number;
  /** Local block number corresponding to the anchored state snapshot */
  localBlockNumber: bigint | number;
  /** 32-byte block hash of the local block */
  localBlockHash: string | Uint8Array | Buffer;
  /** 32-byte Merkle root of the latest anchored batch */
  latestBatchRoot: string | Uint8Array | Buffer;
  /** Strictly monotonic ending sequence number of the latest batch */
  latestSequence: bigint | number;
  /** Deployed contract address on the local chain */
  contractAddress: string;
}

export interface CheckpointResult {
  digest: Buffer;
  digestHex: string;
  preimage: Buffer;
  preimageHex: string;
  checkpoint: {
    previousCheckpointDigest: string;
    localChainId: string;
    localBlockNumber: string;
    localBlockHash: string;
    latestBatchRoot: string;
    latestSequence: string;
    contractAddress: string;
  };
}

export interface LocalChainAnalysis {
  valid: boolean;
  error?: string;
  latestBatchRoot?: string;
  latestSequence?: bigint;
  totalLeaves?: bigint;
  batchCount?: number;
}

function normalizeBytes32(input: string | Uint8Array | Buffer, fieldName: string): Buffer {
  if (Buffer.isBuffer(input)) {
    if (input.length !== 32) throw new RangeError(`${fieldName} must be exactly 32 bytes, got ${input.length}`);
    return input;
  }
  if (input instanceof Uint8Array) {
    if (input.length !== 32) throw new RangeError(`${fieldName} must be exactly 32 bytes, got ${input.length}`);
    return Buffer.from(input);
  }
  if (typeof input === 'string') {
    const clean = input.startsWith('0x') ? input.slice(2) : input;
    if (clean.length !== 64) {
      throw new RangeError(`${fieldName} hex string must be exactly 64 hex characters (32 bytes), got ${clean.length}`);
    }
    return Buffer.from(clean, 'hex');
  }
  throw new TypeError(`Invalid ${fieldName} type: expected 32-byte hex string or Buffer`);
}

function normalizeAddress(addr: string): Buffer {
  const clean = addr.startsWith('0x') ? addr.slice(2) : addr;
  if (clean.length !== 40) {
    throw new RangeError(`contractAddress must be exactly 40 hex characters (20 bytes), got ${clean.length}`);
  }
  return Buffer.from(clean, 'hex');
}

/**
 * Encodes the canonical 165-byte preimage for a cross-chain public checkpoint:
 *
 * preimage = 0xCC (1B)
 *   || previousCheckpointDigest (32B)
 *   || localChainId (32B uint256 BE)
 *   || localBlockNumber (8B uint64 BE)
 *   || localBlockHash (32B)
 *   || latestBatchRoot (32B)
 *   || latestSequence (8B uint64 BE)
 *   || contractAddress (20B)
 */
export function buildCheckpointPreimage(input: CheckpointInput): Buffer {
  const tagBuf = Buffer.from([CHECKPOINT_DOMAIN_TAG]);
  const prevDigestBuf = normalizeBytes32(input.previousCheckpointDigest, 'previousCheckpointDigest');

  const chainIdBigInt = BigInt(input.localChainId);
  const chainIdBuf = Buffer.alloc(32, 0);
  const chainIdHex = chainIdBigInt.toString(16).padStart(64, '0');
  Buffer.from(chainIdHex, 'hex').copy(chainIdBuf);

  const blockNumberBigInt = BigInt(input.localBlockNumber);
  const blockNumberBuf = Buffer.alloc(8, 0);
  blockNumberBuf.writeBigUInt64BE(blockNumberBigInt, 0);

  const blockHashBuf = normalizeBytes32(input.localBlockHash, 'localBlockHash');
  const batchRootBuf = normalizeBytes32(input.latestBatchRoot, 'latestBatchRoot');

  const seqBigInt = BigInt(input.latestSequence);
  const seqBuf = Buffer.alloc(8, 0);
  seqBuf.writeBigUInt64BE(seqBigInt, 0);

  const addrBuf = normalizeAddress(input.contractAddress);

  return Buffer.concat([
    tagBuf,
    prevDigestBuf,
    chainIdBuf,
    blockNumberBuf,
    blockHashBuf,
    batchRootBuf,
    seqBuf,
    addrBuf
  ]);
}

/**
 * Computes the SHA-256 cross-chain checkpoint digest.
 */
export function buildCheckpoint(input: CheckpointInput): CheckpointResult {
  const preimage = buildCheckpointPreimage(input);
  const digest = crypto.createHash('sha256').update(preimage).digest();

  const prevDigestBuf = normalizeBytes32(input.previousCheckpointDigest, 'previousCheckpointDigest');
  const blockHashBuf = normalizeBytes32(input.localBlockHash, 'localBlockHash');
  const batchRootBuf = normalizeBytes32(input.latestBatchRoot, 'latestBatchRoot');

  return {
    digest,
    digestHex: '0x' + digest.toString('hex'),
    preimage,
    preimageHex: '0x' + preimage.toString('hex'),
    checkpoint: {
      previousCheckpointDigest: '0x' + prevDigestBuf.toString('hex'),
      localChainId: BigInt(input.localChainId).toString(),
      localBlockNumber: BigInt(input.localBlockNumber).toString(),
      localBlockHash: '0x' + blockHashBuf.toString('hex'),
      latestBatchRoot: '0x' + batchRootBuf.toString('hex'),
      latestSequence: BigInt(input.latestSequence).toString(),
      contractAddress: '0x' + normalizeAddress(input.contractAddress).toString('hex').toLowerCase()
    }
  };
}

/**
 * Verifies a checkpoint input against an expected digest.
 */
export function checkCheckpoint(
  checkpoint: CheckpointInput,
  expectedDigest: string | Uint8Array | Buffer
): boolean {
  try {
    const expectedBuf = normalizeBytes32(expectedDigest, 'expectedDigest');
    const result = buildCheckpoint(checkpoint);
    return crypto.timingSafeEqual(result.digest, expectedBuf);
  } catch {
    return false;
  }
}

/**
 * Verifies checkpoint continuity: confirms that current.previousCheckpointDigest
 * strictly matches the preceding checkpoint's digest.
 */
export function verifyCheckpointContinuity(
  current: CheckpointInput,
  previousDigest: string | Uint8Array | Buffer
): boolean {
  try {
    const prevBuf = normalizeBytes32(previousDigest, 'previousDigest');
    const currentPrevBuf = normalizeBytes32(current.previousCheckpointDigest, 'previousCheckpointDigest');
    return crypto.timingSafeEqual(prevBuf, currentPrevBuf);
  } catch {
    return false;
  }
}

/**
 * Analyzes an ordered series of local BatchCommitments to verify full
 * sequence continuity, leaf contiguity, and previousCheckpointHash chaining.
 * 
 * Used by Person 4's CLI Verifier and Dashboard to validate the local chain
 * before cross-checking with the public Quai Orchard checkpoint.
 */
export function checkLocalChain(batches: BatchCommitment[]): LocalChainAnalysis {
  if (batches.length === 0) {
    return {
      valid: false,
      error: 'Empty local chain: no batches provided'
    };
  }

  let expectedNextSequence = 1n;
  let expectedPreviousHash = GENESIS_CHECKPOINT_HASH.toLowerCase();
  let totalLeaves = 0n;

  for (let i = 0; i < batches.length; i++) {
    const b = batches[i];
    const seqStart = BigInt(b.sequenceStart);
    const seqEnd = BigInt(b.sequenceEnd);
    const leafCount = BigInt(b.leafCount);
    const prevHash = b.previousCheckpointHash.toLowerCase();

    // 1. Sequence start continuity
    if (seqStart !== expectedNextSequence) {
      return {
        valid: false,
        error: `Sequence continuity broken at batch index ${i}: expected sequenceStart ${expectedNextSequence}, got ${seqStart}`
      };
    }

    // 2. Sequence range
    if (seqEnd < seqStart) {
      return {
        valid: false,
        error: `Invalid sequence range at batch index ${i}: sequenceEnd ${seqEnd} < sequenceStart ${seqStart}`
      };
    }

    // 3. Leaf count contiguity
    const expectedLeaves = seqEnd - seqStart + 1n;
    if (leafCount !== expectedLeaves) {
      return {
        valid: false,
        error: `Leaf count mismatch at batch index ${i}: expected ${expectedLeaves}, got ${leafCount}`
      };
    }

    // 4. previousCheckpointHash chaining
    if (prevHash !== expectedPreviousHash) {
      return {
        valid: false,
        error: `previousCheckpointHash mismatch at batch index ${i}: expected ${expectedPreviousHash}, got ${prevHash}`
      };
    }

    totalLeaves += leafCount;
    expectedNextSequence = seqEnd + 1n;
    expectedPreviousHash = hashCommitmentHex(b).toLowerCase();
  }

  const lastBatch = batches[batches.length - 1];
  return {
    valid: true,
    latestBatchRoot: lastBatch.merkleRoot,
    latestSequence: BigInt(lastBatch.sequenceEnd),
    totalLeaves,
    batchCount: batches.length
  };
}
