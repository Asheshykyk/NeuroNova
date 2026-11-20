import crypto from 'node:crypto';
import type { CanonicalEvent } from './types.ts';

/**
 * Domain separator byte for leaf hashing.
 * LOCKED SPECIFICATION: 0x00
 */
export const LEAF_DOMAIN_TAG = 0x00;

/**
 * Normalizes a sourceId into a 32-byte Buffer.
 * 
 * ASSUMPTION A1: sourceId 32B
 * ASSUMPTION A2: sourceId bytes32
 * 
 * If a 32-byte hex string ('0x...') is supplied, decodes it directly.
 * If an ASCII string <= 32 bytes is supplied, UTF-8 encodes and zero-pads to 32 bytes.
 * If a Uint8Array / Buffer is supplied, ensures length is exactly 32 bytes.
 */
export function formatSourceId(sourceId: string | Uint8Array | Buffer): Buffer {
  if (Buffer.isBuffer(sourceId)) {
    if (sourceId.length !== 32) {
      throw new Error(`sourceId buffer must be exactly 32 bytes, got ${sourceId.length}`);
    }
    return sourceId;
  }

  if (sourceId instanceof Uint8Array) {
    if (sourceId.length !== 32) {
      throw new Error(`sourceId Uint8Array must be exactly 32 bytes, got ${sourceId.length}`);
    }
    return Buffer.from(sourceId);
  }

  if (typeof sourceId === 'string') {
    if (sourceId.startsWith('0x') && sourceId.length === 66) {
      return Buffer.from(sourceId.slice(2), 'hex');
    }
    const buf = Buffer.alloc(32, 0);
    const written = buf.write(sourceId, 0, 'utf-8');
    if (Buffer.byteLength(sourceId, 'utf-8') > 32) {
      throw new Error(`sourceId string exceeds 32 bytes: ${sourceId}`);
    }
    return buf;
  }

  throw new TypeError('Invalid sourceId type: expected string, Buffer, or Uint8Array');
}

/**
 * Converts sourceId to standard 0x-prefixed 32-byte hex string.
 * ASSUMPTION A2: sourceId bytes32
 */
export function formatSourceIdHex(sourceId: string | Uint8Array | Buffer): string {
  return '0x' + formatSourceId(sourceId).toString('hex');
}

/**
 * Normalizes raw event bytes into a Buffer.
 */
export function formatRawEventBytes(raw: Uint8Array | Buffer | string): Buffer {
  if (Buffer.isBuffer(raw)) return raw;
  if (raw instanceof Uint8Array) return Buffer.from(raw);
  if (typeof raw === 'string') return Buffer.from(raw, 'utf-8');
  throw new TypeError('Invalid rawEventBytes type: expected string, Buffer, or Uint8Array');
}

/**
 * Constructs the canonical leaf preimage bytes according to the locked specification:
 * 
 * LOCKED:
 * preimage = 0x00 || version || sourceId || vaultSequence || rawEventLength || rawEventBytes
 * 
 * ASSUMPTION A1 widths:
 * - 0x00: 1 byte (domain tag)
 * - version: 1 byte (uint8)
 * - sourceId: 32 bytes (bytes32)
 * - vaultSequence: 8 bytes big-endian (uint64 BE)
 * - rawEventLength: 4 bytes big-endian (uint32 BE)
 * - rawEventBytes: N bytes (length must match rawEventLength)
 */
export function encodeLeafPreimage(event: CanonicalEvent): Buffer {
  // Domain tag: 1B (0x00)
  const tagBuf = Buffer.from([LEAF_DOMAIN_TAG]);

  // ASSUMPTION A1: version 1B (uint8)
  if (event.version < 0 || event.version > 255 || !Number.isInteger(event.version)) {
    throw new RangeError(`version must be an 8-bit unsigned integer (0-255), got ${event.version}`);
  }
  const versionBuf = Buffer.from([event.version]);

  // ASSUMPTION A1 & A2: sourceId 32B (bytes32)
  const sourceIdBuf = formatSourceId(event.sourceId);

  // ASSUMPTION A1: vaultSequence u64 BE (8 bytes big-endian)
  const seqBigInt = BigInt(event.vaultSequence);
  if (seqBigInt < 0n || seqBigInt > 0xffffffffffffffffn) {
    throw new RangeError(`vaultSequence must be a 64-bit unsigned integer, got ${event.vaultSequence}`);
  }
  const seqBuf = Buffer.alloc(8);
  seqBuf.writeBigUInt64BE(seqBigInt, 0);

  // Raw event payload
  const rawBytes = formatRawEventBytes(event.rawEventBytes);

  // ASSUMPTION A1: rawEventLength u32 BE (4 bytes big-endian)
  const lenBuf = Buffer.alloc(4);
  if (rawBytes.length > 0xffffffff) {
    throw new RangeError(`rawEventBytes length exceeds 32-bit limit: ${rawBytes.length}`);
  }
  lenBuf.writeUInt32BE(rawBytes.length, 0);

  // Concatenate preimage: 1 + 1 + 32 + 8 + 4 + N = 46 + N bytes
  return Buffer.concat([
    tagBuf,
    versionBuf,
    sourceIdBuf,
    seqBuf,
    lenBuf,
    rawBytes
  ]);
}

/**
 * Computes the canonical leaf hash according to the locked specification:
 * 
 * LOCKED:
 * leafHash = SHA256(0x00 || version || sourceId || vaultSequence || rawEventLength || rawEventBytes);
 * 
 * Returns 32-byte Buffer.
 */
export function computeLeafHash(event: CanonicalEvent): Buffer {
  const preimage = encodeLeafPreimage(event);
  return crypto.createHash('sha256').update(preimage).digest();
}

/**
 * Computes canonical leaf hash returning 0x-prefixed hex string (66 chars).
 */
export function computeLeafHashHex(event: CanonicalEvent): string {
  return '0x' + computeLeafHash(event).toString('hex');
}
