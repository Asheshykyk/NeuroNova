import crypto from 'node:crypto';
import { formatSourceId, formatRawEventBytes } from './canonical.ts';
import type { SourceIdInput } from './types.ts';

/**
 * Domain separation byte for Host Agent chunk signing.
 * Distinguishes agent attestation from leaf preimages (0x00),
 * internal Merkle nodes (0x01), and EIP-712 digests (0x19 0x01).
 */
export const AGENT_CHUNK_DOMAIN_TAG = 0xAA;

/**
 * Domain separation byte for Host Agent periodic heartbeat signing.
 * Distinguishes heartbeats from event chunks (0xAA) and Merkle nodes (0x01).
 */
export const AGENT_HEARTBEAT_DOMAIN_TAG = 0xAB;

const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export interface AgentChunk {
  /** 32-byte host / source identifier (formatSourceId compatible) */
  sourceId: SourceIdInput;
  /** Unique delivery identifier (UUID string or idempotent sequence) */
  deliveryId: string;
  /** Raw log line(s) or payload bytes (unmodified, pure log bytes) */
  payload: Uint8Array | Buffer | string;
  /** Logical log stream identifier, e.g. "auth.log" (default: "") */
  streamId?: string;
  /** File identity (e.g. "inode:142857" or "/var/log/auth.log") (default: "") */
  fileIdentity?: string;
  /** File generation string in dev:<device>:ino:<inode> format (canonical alias for fileIdentity) */
  fileGeneration?: string;
  /** Monotonic byte offset within the monitored log file (default: 0n) */
  byteOffset?: bigint | number;
  /** Nanoseconds or milliseconds epoch timestamp observed by host agent (default: 0n) */
  observedAt?: bigint | number;
}

export interface AgentHeartbeat {
  /** 32-byte host / source identifier */
  sourceId: SourceIdInput;
  /** Strictly monotonic heartbeat sequence (1, 2, 3...) */
  heartbeatSequence: bigint | number;
  /** Host agent observation timestamp (nanoseconds or milliseconds epoch) */
  observedAt: bigint | number;
  /** Current tail byte offset in the monitored log file */
  lastByteOffset: bigint | number;
  /** Agent operational status (e.g. "OK", "DEGRADED", "TAMPER_DETECTED") */
  status: string;
}

export interface AgentKeyPair {
  publicKey: crypto.KeyObject;
  privateKey: crypto.KeyObject;
  publicKeyRaw: Buffer;
  privateKeyRaw: Buffer;
  publicKeyHex: string;
  privateKeyHex: string;
}

/**
 * Parses an Ed25519 private key from KeyObject, PEM string, PKCS8 DER, or raw 32-byte seed.
 */
export function parseAgentPrivateKey(key: crypto.KeyObject | string | Buffer | Uint8Array): crypto.KeyObject {
  if (key instanceof crypto.KeyObject) {
    if (key.type !== 'private' || key.asymmetricKeyType !== 'ed25519') {
      throw new Error('KeyObject must be an Ed25519 private key');
    }
    return key;
  }

  if (typeof key === 'string') {
    if (key.includes('BEGIN PRIVATE KEY')) {
      return crypto.createPrivateKey(key);
    }
    const clean = key.startsWith('0x') ? key.slice(2) : key;
    return parseAgentPrivateKey(Buffer.from(clean, 'hex'));
  }

  const buf = Buffer.isBuffer(key) ? key : Buffer.from(key);
  if (buf.length === 32) {
    return crypto.createPrivateKey({
      key: Buffer.concat([PKCS8_ED25519_PREFIX, buf]),
      format: 'der',
      type: 'pkcs8'
    });
  }

  // Already PKCS#8 DER (48 bytes) or other standard encoding
  return crypto.createPrivateKey({
    key: buf,
    format: 'der',
    type: 'pkcs8'
  });
}

/**
 * Parses an Ed25519 public key from KeyObject, PEM string, SPKI DER, or raw 32-byte public key.
 */
export function parseAgentPublicKey(key: crypto.KeyObject | string | Buffer | Uint8Array): crypto.KeyObject {
  if (key instanceof crypto.KeyObject) {
    if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') {
      throw new Error('KeyObject must be an Ed25519 public key');
    }
    return key;
  }

  if (typeof key === 'string') {
    if (key.includes('BEGIN PUBLIC KEY')) {
      return crypto.createPublicKey(key);
    }
    const clean = key.startsWith('0x') ? key.slice(2) : key;
    return parseAgentPublicKey(Buffer.from(clean, 'hex'));
  }

  const buf = Buffer.isBuffer(key) ? key : Buffer.from(key);
  if (buf.length === 32) {
    return crypto.createPublicKey({
      key: Buffer.concat([SPKI_ED25519_PREFIX, buf]),
      format: 'der',
      type: 'spki'
    });
  }

  // Already SPKI DER (44 bytes) or other standard encoding
  return crypto.createPublicKey({
    key: buf,
    format: 'der',
    type: 'spki'
  });
}

/**
 * Generates a fresh Ed25519 keypair for the Host Agent.
 */
export function generateAgentKeyPair(seed?: Buffer | Uint8Array): AgentKeyPair {
  let privateKey: crypto.KeyObject;
  if (seed) {
    const seedBuf = Buffer.isBuffer(seed) ? seed : Buffer.from(seed);
    if (seedBuf.length !== 32) {
      throw new Error(`Ed25519 seed must be exactly 32 bytes, got ${seedBuf.length}`);
    }
    privateKey = parseAgentPrivateKey(seedBuf);
  } else {
    const pair = crypto.generateKeyPairSync('ed25519');
    privateKey = pair.privateKey;
  }

  const publicKey = crypto.createPublicKey(privateKey);
  const pkcs8Der = privateKey.export({ type: 'pkcs8', format: 'der' });
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' });

  const privateKeyRaw = pkcs8Der.subarray(pkcs8Der.length - 32);
  const publicKeyRaw = spkiDer.subarray(spkiDer.length - 32);

  return {
    publicKey,
    privateKey,
    privateKeyRaw,
    publicKeyRaw,
    publicKeyHex: '0x' + publicKeyRaw.toString('hex'),
    privateKeyHex: '0x' + privateKeyRaw.toString('hex')
  };
}

/**
 * Encodes the canonical Host Agent chunk preimage:
 *
 * preimage = 0xAA
 *   || sourceId (32B)
 *   || deliveryIdLen (2B BE) || deliveryId (MB)
 *   || streamIdLen (2B BE) || streamId (KB)
 *   || fileIdentityLen (2B BE) || fileIdentity (PB, e.g. "/var/log/auth.log")
 *   || fileGenerationLen (2B BE) || fileGeneration (GB, e.g. "dev:2049:ino:142857")
 *   || byteOffset (8B BE uint64)
 *   || observedAt (8B BE uint64)
 *   || payloadLen (4B BE uint32) || payload (NB)
 */
export function encodeAgentChunkPreimage(chunk: AgentChunk): Buffer {
  const tagBuf = Buffer.from([AGENT_CHUNK_DOMAIN_TAG]);
  const sourceIdBuf = formatSourceId(chunk.sourceId);

  const deliveryIdBuf = Buffer.from(chunk.deliveryId, 'utf-8');
  if (deliveryIdBuf.length > 65535) {
    throw new RangeError(`deliveryId exceeds maximum length of 65535 bytes: got ${deliveryIdBuf.length}`);
  }
  const deliveryIdLenBuf = Buffer.alloc(2);
  deliveryIdLenBuf.writeUInt16BE(deliveryIdBuf.length, 0);

  const streamIdBuf = Buffer.from(chunk.streamId ?? '', 'utf-8');
  if (streamIdBuf.length > 65535) {
    throw new RangeError(`streamId exceeds maximum length of 65535 bytes: got ${streamIdBuf.length}`);
  }
  const streamIdLenBuf = Buffer.alloc(2);
  streamIdLenBuf.writeUInt16BE(streamIdBuf.length, 0);

  const fileIdentityBuf = Buffer.from(chunk.fileIdentity ?? '', 'utf-8');
  if (fileIdentityBuf.length > 65535) {
    throw new RangeError(`fileIdentity exceeds maximum length of 65535 bytes: got ${fileIdentityBuf.length}`);
  }
  const fileIdentityLenBuf = Buffer.alloc(2);
  fileIdentityLenBuf.writeUInt16BE(fileIdentityBuf.length, 0);

  const fileGenerationBuf = Buffer.from(chunk.fileGeneration ?? '', 'utf-8');
  if (fileGenerationBuf.length > 65535) {
    throw new RangeError(`fileGeneration exceeds maximum length of 65535 bytes: got ${fileGenerationBuf.length}`);
  }
  const fileGenerationLenBuf = Buffer.alloc(2);
  fileGenerationLenBuf.writeUInt16BE(fileGenerationBuf.length, 0);

  const byteOffsetBuf = Buffer.alloc(8);
  byteOffsetBuf.writeBigUInt64BE(BigInt(chunk.byteOffset ?? 0n), 0);

  const observedAtBuf = Buffer.alloc(8);
  observedAtBuf.writeBigUInt64BE(BigInt(chunk.observedAt ?? 0n), 0);

  const payloadBuf = formatRawEventBytes(chunk.payload);
  const payloadLenBuf = Buffer.alloc(4);
  payloadLenBuf.writeUInt32BE(payloadBuf.length, 0);

  return Buffer.concat([
    tagBuf,
    sourceIdBuf,
    deliveryIdLenBuf,
    deliveryIdBuf,
    streamIdLenBuf,
    streamIdBuf,
    fileIdentityLenBuf,
    fileIdentityBuf,
    fileGenerationLenBuf,
    fileGenerationBuf,
    byteOffsetBuf,
    observedAtBuf,
    payloadLenBuf,
    payloadBuf
  ]);
}

/**
 * Signs a Host Agent chunk using Ed25519.
 * Returns the raw 64-byte signature Buffer.
 */
export function signAgentChunk(
  chunk: AgentChunk,
  privateKey: crypto.KeyObject | string | Buffer | Uint8Array
): Buffer {
  const privKeyObject = parseAgentPrivateKey(privateKey);
  const preimage = encodeAgentChunkPreimage(chunk);
  return crypto.sign(null, preimage, privKeyObject);
}

/**
 * Signs a Host Agent chunk using Ed25519 and returns a 0x-prefixed hex string.
 */
export function signAgentChunkHex(
  chunk: AgentChunk,
  privateKey: crypto.KeyObject | string | Buffer | Uint8Array
): string {
  return '0x' + signAgentChunk(chunk, privateKey).toString('hex');
}

/**
 * Verifies a Host Agent chunk Ed25519 signature.
 */
export function verifyAgentChunk(
  chunk: AgentChunk,
  signature: Buffer | Uint8Array | string,
  publicKey: crypto.KeyObject | string | Buffer | Uint8Array
): boolean {
  try {
    const pubKeyObject = parseAgentPublicKey(publicKey);
    const preimage = encodeAgentChunkPreimage(chunk);
    const sigBuf = typeof signature === 'string'
      ? Buffer.from(signature.startsWith('0x') ? signature.slice(2) : signature, 'hex')
      : (Buffer.isBuffer(signature) ? signature : Buffer.from(signature));

    if (sigBuf.length !== 64) return false;
    return crypto.verify(null, preimage, pubKeyObject, sigBuf);
  } catch {
    return false;
  }
}

/**
 * Encodes the canonical Host Agent heartbeat preimage:
 *
 * preimage = 0xAB
 *   || sourceId (32B)
 *   || heartbeatSequence (8B BE uint64)
 *   || observedAt (8B BE uint64)
 *   || lastByteOffset (8B BE uint64)
 *   || statusLen (2B BE uint16) || status (SB)
 */
export function encodeAgentHeartbeatPreimage(heartbeat: AgentHeartbeat): Buffer {
  const tagBuf = Buffer.from([AGENT_HEARTBEAT_DOMAIN_TAG]);
  const sourceIdBuf = formatSourceId(heartbeat.sourceId);

  const seqBuf = Buffer.alloc(8);
  seqBuf.writeBigUInt64BE(BigInt(heartbeat.heartbeatSequence), 0);

  const obsBuf = Buffer.alloc(8);
  obsBuf.writeBigUInt64BE(BigInt(heartbeat.observedAt), 0);

  const offsetBuf = Buffer.alloc(8);
  offsetBuf.writeBigUInt64BE(BigInt(heartbeat.lastByteOffset), 0);

  const statusBuf = Buffer.from(heartbeat.status, 'utf-8');
  if (statusBuf.length > 65535) {
    throw new RangeError(`status exceeds maximum length of 65535 bytes: got ${statusBuf.length}`);
  }
  const statusLenBuf = Buffer.alloc(2);
  statusLenBuf.writeUInt16BE(statusBuf.length, 0);

  return Buffer.concat([
    tagBuf,
    sourceIdBuf,
    seqBuf,
    obsBuf,
    offsetBuf,
    statusLenBuf,
    statusBuf
  ]);
}

/**
 * Signs a Host Agent heartbeat using Ed25519.
 * Returns the raw 64-byte signature Buffer.
 */
export function signAgentHeartbeat(
  heartbeat: AgentHeartbeat,
  privateKey: crypto.KeyObject | string | Buffer | Uint8Array
): Buffer {
  const privKeyObject = parseAgentPrivateKey(privateKey);
  const preimage = encodeAgentHeartbeatPreimage(heartbeat);
  return crypto.sign(null, preimage, privKeyObject);
}

/**
 * Signs a Host Agent heartbeat using Ed25519 and returns a 0x-prefixed hex string.
 */
export function signAgentHeartbeatHex(
  heartbeat: AgentHeartbeat,
  privateKey: crypto.KeyObject | string | Buffer | Uint8Array
): string {
  return '0x' + signAgentHeartbeat(heartbeat, privateKey).toString('hex');
}

/**
 * Verifies a Host Agent heartbeat Ed25519 signature.
 */
export function verifyAgentHeartbeat(
  heartbeat: AgentHeartbeat,
  signature: Buffer | Uint8Array | string,
  publicKey: crypto.KeyObject | string | Buffer | Uint8Array
): boolean {
  try {
    const pubKeyObject = parseAgentPublicKey(publicKey);
    const preimage = encodeAgentHeartbeatPreimage(heartbeat);
    const sigBuf = typeof signature === 'string'
      ? Buffer.from(signature.startsWith('0x') ? signature.slice(2) : signature, 'hex')
      : (Buffer.isBuffer(signature) ? signature : Buffer.from(signature));

    if (sigBuf.length !== 64) return false;
    return crypto.verify(null, preimage, pubKeyObject, sigBuf);
  } catch {
    return false;
  }
}
