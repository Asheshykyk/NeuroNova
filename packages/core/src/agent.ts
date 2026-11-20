import crypto from 'node:crypto';
import { formatSourceId, formatRawEventBytes } from './canonical.ts';
import type { SourceIdInput } from './types.ts';

/**
 * Domain separation byte for Host Agent chunk signing.
 * Distinguishes agent attestation from leaf preimages (0x00),
 * internal Merkle nodes (0x01), and EIP-712 digests (0x19 0x01).
 */
export const AGENT_CHUNK_DOMAIN_TAG = 0xAA;

const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export interface AgentChunk {
  /** 32-byte host / source identifier (formatSourceId compatible) */
  sourceId: SourceIdInput;
  /** Unique delivery identifier for chunk deduplication & idempotency */
  deliveryId: string;
  /** Raw log line(s) or payload bytes */
  payload: Uint8Array | Buffer | string;
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
 * preimage = 0xAA || sourceId (32B) || deliveryIdLen (2B BE) || deliveryId (MB) || payloadLen (4B BE) || payload (NB)
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

  const payloadBuf = formatRawEventBytes(chunk.payload);
  const payloadLenBuf = Buffer.alloc(4);
  payloadLenBuf.writeUInt32BE(payloadBuf.length, 0);

  return Buffer.concat([
    tagBuf,
    sourceIdBuf,
    deliveryIdLenBuf,
    deliveryIdBuf,
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
