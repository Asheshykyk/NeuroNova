import type { BatchCommitment, EIP712Domain } from './types.ts';
import { keccak256, keccak256Hex } from './keccak.ts';
import { formatSourceId } from './canonical.ts';

/**
 * Canonical EIP-712 Type Definitions
 * 
 * SPECIFICATION:
 * Define the BatchCommitment EIP-712 type in core with field order and types written once.
 */
export const BATCH_COMMITMENT_TYPE_NAME = 'BatchCommitment' as const;

/**
 * Single source of truth for BatchCommitment EIP-712 fields.
 * Field order and types written once:
 */
export const BATCH_COMMITMENT_FIELDS = [
  { name: 'sourceId', type: 'bytes32' },
  { name: 'sequenceStart', type: 'uint64' },
  { name: 'sequenceEnd', type: 'uint64' },
  { name: 'leafCount', type: 'uint64' },
  { name: 'merkleRoot', type: 'bytes32' },
  { name: 'previousCheckpointHash', type: 'bytes32' }
] as const;

/**
 * EIP-712 Types object for ethers.signTypedData(domain, BATCH_COMMITMENT_EIP712_TYPES, value):
 */
export const BATCH_COMMITMENT_EIP712_TYPES = {
  [BATCH_COMMITMENT_TYPE_NAME]: [...BATCH_COMMITMENT_FIELDS]
} as const;

/**
 * Canonical EIP-712 type string derived from the single source of truth:
 */
export const BATCH_COMMITMENT_TYPE = `${BATCH_COMMITMENT_TYPE_NAME}(${BATCH_COMMITMENT_FIELDS.map(
  (f) => `${f.type} ${f.name}`
).join(',')})`;

export const EIP712_DOMAIN_TYPE = 'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)';

/**
 * Precomputed Type Hashes
 */
export const EIP712_DOMAIN_TYPEHASH = keccak256(Buffer.from(EIP712_DOMAIN_TYPE, 'utf-8'));
export const BATCH_COMMITMENT_TYPEHASH = keccak256(Buffer.from(BATCH_COMMITMENT_TYPE, 'utf-8'));

/**
 * Standard 32-byte zero hash representing Genesis previousCheckpointHash.
 * ASSUMPTION A3: genesis zero
 */
export const GENESIS_CHECKPOINT_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Default EIP-712 domain name and version for EvidenceAnchor.
 */
export const DEFAULT_DOMAIN_NAME = 'EvidenceAnchor';
export const DEFAULT_DOMAIN_VERSION = '1';

/**
 * Encodes a 32-byte word (left-padded for numbers/addresses, right-padded for bytes/strings).
 */
function toBytes32(hexOrBuf: string | Buffer): Buffer {
  if (Buffer.isBuffer(hexOrBuf)) {
    if (hexOrBuf.length !== 32) throw new Error(`Expected 32 bytes Buffer, got ${hexOrBuf.length}`);
    return hexOrBuf;
  }
  const clean = hexOrBuf.startsWith('0x') ? hexOrBuf.slice(2) : hexOrBuf;
  if (clean.length !== 64) throw new Error(`Expected 32 bytes hex (64 chars), got ${clean.length}`);
  return Buffer.from(clean, 'hex');
}

function uint64ToBytes32(val: bigint | number): Buffer {
  const b = BigInt(val);
  const buf = Buffer.alloc(32, 0);
  buf.writeBigUInt64BE(b, 24); // Left-padded uint64
  return buf;
}

function uint256ToBytes32(val: bigint | number): Buffer {
  const b = BigInt(val);
  const buf = Buffer.alloc(32, 0);
  const hex = b.toString(16).padStart(64, '0');
  return Buffer.from(hex, 'hex');
}

function addressToBytes32(addr: string): Buffer {
  const clean = addr.startsWith('0x') ? addr.slice(2) : addr;
  if (clean.length !== 40) throw new Error(`Invalid address length: ${addr}`);
  const buf = Buffer.alloc(32, 0);
  Buffer.from(clean, 'hex').copy(buf, 12); // Address is left-padded with 12 zero bytes
  return buf;
}

/**
 * Computes the EIP-712 Domain Separator.
 * 
 * keccak256(abi.encode(
 *   EIP712_DOMAIN_TYPEHASH,
 *   keccak256(bytes(name)),
 *   keccak256(bytes(version)),
 *   chainId,
 *   verifyingContract
 * ))
 */
export function computeDomainSeparator(domain: EIP712Domain): Buffer {
  const nameHash = keccak256(Buffer.from(domain.name, 'utf-8'));
  const versionHash = keccak256(Buffer.from(domain.version, 'utf-8'));
  const chainIdBuf = uint256ToBytes32(domain.chainId);
  const contractBuf = addressToBytes32(domain.verifyingContract);

  const encoded = Buffer.concat([
    EIP712_DOMAIN_TYPEHASH,
    nameHash,
    versionHash,
    chainIdBuf,
    contractBuf
  ]);

  return keccak256(encoded);
}

export function computeDomainSeparatorHex(domain: EIP712Domain): string {
  return '0x' + computeDomainSeparator(domain).toString('hex');
}

/**
 * Computes the EIP-712 struct hash of a BatchCommitment.
 * 
 * LOCKED SPECIFICATION:
 * commitment binds sourceId, sequenceStart, sequenceEnd, leafCount, merkleRoot, previousCheckpointHash.
 * 
 * ASSUMPTIONS:
 * - A1 widths: sequenceStart, sequenceEnd, leafCount are uint64
 * - A2: sourceId is bytes32
 * - A3: previousCheckpointHash = struct hash of previous commitment, genesis zero, first batch starts at seq 1
 * - A4: same contract on Amoy, checkpoint digest in merkleRoot field
 * 
 * ABI Encoding:
 * abi.encode(
 *   BATCH_COMMITMENT_TYPEHASH,
 *   commitment.sourceId,
 *   uint256(commitment.sequenceStart),
 *   uint256(commitment.sequenceEnd),
 *   uint256(commitment.leafCount),
 *   commitment.merkleRoot,
 *   commitment.previousCheckpointHash
 * )
 */
export function computeCommitmentStructHash(commitment: BatchCommitment): Buffer {
  const sourceIdBuf = formatSourceId(commitment.sourceId);
  const startBuf = uint64ToBytes32(commitment.sequenceStart);
  const endBuf = uint64ToBytes32(commitment.sequenceEnd);
  const countBuf = uint64ToBytes32(commitment.leafCount);
  const rootBuf = toBytes32(commitment.merkleRoot);
  const prevBuf = toBytes32(commitment.previousCheckpointHash);

  const encoded = Buffer.concat([
    BATCH_COMMITMENT_TYPEHASH,
    sourceIdBuf,
    startBuf,
    endBuf,
    countBuf,
    rootBuf,
    prevBuf
  ]);

  return keccak256(encoded);
}

export function computeCommitmentStructHashHex(commitment: BatchCommitment): string {
  return '0x' + computeCommitmentStructHash(commitment).toString('hex');
}

/**
 * Prompt 1 Canonical API Aliases
 */
export const hashCommitment = computeCommitmentStructHash;
export const hashCommitmentHex = computeCommitmentStructHashHex;

/**
 * Computes the complete EIP-712 digest to be signed by the Vault Signer:
 * 
 * digest = keccak256("\x19\x01" || domainSeparator || structHash)
 */
export function computeEIP712Digest(domain: EIP712Domain, commitment: BatchCommitment): Buffer {
  const domainSep = computeDomainSeparator(domain);
  const structHash = computeCommitmentStructHash(commitment);

  const preimage = Buffer.concat([
    Buffer.from([0x19, 0x01]),
    domainSep,
    structHash
  ]);

  return keccak256(preimage);
}

export function computeEIP712DigestHex(domain: EIP712Domain, commitment: BatchCommitment): string {
  return '0x' + computeEIP712Digest(domain, commitment).toString('hex');
}

/**
 * Validates sequence continuity and checkpoint chaining between consecutive batches.
 * 
 * LOCKED SPECIFICATION:
 * Contract validates sequence continuity, duplicate batches.
 * 
 * ASSUMPTIONS:
 * - A3: previousCheckpointHash = struct hash of previous commitment, genesis zero, first batch starts at seq 1;
 */
export function validateSequenceContinuity(
  prevCommitment: BatchCommitment | null,
  currentCommitment: BatchCommitment
): { valid: boolean; reason?: string } {
  // Range check
  if (currentCommitment.sequenceStart <= 0n) {
    return { valid: false, reason: 'sequenceStart must be >= 1' };
  }
  if (currentCommitment.sequenceEnd < currentCommitment.sequenceStart) {
    return { valid: false, reason: 'sequenceEnd must be >= sequenceStart' };
  }
  const expectedCount = currentCommitment.sequenceEnd - currentCommitment.sequenceStart + 1n;
  if (currentCommitment.leafCount !== expectedCount) {
    return {
      valid: false,
      reason: `leafCount mismatch: expected ${expectedCount}, got ${currentCommitment.leafCount}`
    };
  }

  // ASSUMPTION A3: Genesis batch checks
  if (prevCommitment === null) {
    if (currentCommitment.sequenceStart !== 1n) {
      return {
        valid: false,
        reason: `First batch must start at sequence 1 (A3), got ${currentCommitment.sequenceStart}`
      };
    }
    const cleanPrev = currentCommitment.previousCheckpointHash.toLowerCase();
    if (cleanPrev !== GENESIS_CHECKPOINT_HASH.toLowerCase()) {
      return {
        valid: false,
        reason: `Genesis previousCheckpointHash must be zero (A3), got ${currentCommitment.previousCheckpointHash}`
      };
    }
    return { valid: true };
  }

  // Source ID must match
  if (formatSourceId(prevCommitment.sourceId).toString('hex') !== formatSourceId(currentCommitment.sourceId).toString('hex')) {
    return { valid: false, reason: 'sourceId does not match previous batch' };
  }

  // Sequence continuity: sequenceStart == prev.sequenceEnd + 1
  const expectedStart = prevCommitment.sequenceEnd + 1n;
  if (currentCommitment.sequenceStart !== expectedStart) {
    return {
      valid: false,
      reason: `Sequence continuity broken: expected start ${expectedStart}, got ${currentCommitment.sequenceStart}`
    };
  }

  // ASSUMPTION A3: previousCheckpointHash must equal struct hash of previous commitment
  const expectedCheckpointHash = computeCommitmentStructHashHex(prevCommitment).toLowerCase();
  const actualPrev = currentCommitment.previousCheckpointHash.toLowerCase();
  if (actualPrev !== expectedCheckpointHash) {
    return {
      valid: false,
      reason: `previousCheckpointHash mismatch (A3): expected ${expectedCheckpointHash}, got ${actualPrev}`
    };
  }

  return { valid: true };
}
