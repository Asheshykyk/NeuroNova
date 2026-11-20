/**
 * TRUSTTRACE EIP-712 Vault Signer & Relayer Separation
 * 
 * LOCKED SPECIFICATION:
 * EIP-712 signer key exists ONLY in the vault; relayer is a separate key.
 * 
 * Implements deterministic RFC 6979 secp256k1 signing, address derivation,
 * and signature recovery with zero external dependencies.
 */

import crypto from 'node:crypto';
import type { BatchCommitment, EIP712Domain, SignedBatchCommitment } from './types.ts';
import { computeCommitmentStructHashHex, computeEIP712Digest } from './commitment.ts';
import { keccak256 } from './keccak.ts';

// secp256k1 curve parameters
const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const Gx = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const Gy = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;

function modInverse(a: bigint, m: bigint): bigint {
  a = ((a % m) + m) % m;
  let [m0, y, x] = [m, 0n, 1n];
  while (a > 1n) {
    const q = a / m;
    [a, m] = [m, a % m];
    [x, y] = [y, x - q * y];
  }
  return x < 0n ? x + m0 : x;
}

type Point = [bigint, bigint] | null;

function pointAdd(p1: Point, p2: Point): Point {
  if (!p1) return p2;
  if (!p2) return p1;
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  if (x1 === x2 && (y1 !== y2 || y1 === 0n)) return null;
  let m: bigint;
  if (x1 === x2) {
    m = ((3n * x1 * x1) % P * modInverse(2n * y1, P)) % P;
  } else {
    const dx = ((x2 - x1) % P + P) % P;
    const dy = ((y2 - y1) % P + P) % P;
    m = (dy * modInverse(dx, P)) % P;
  }
  const x3 = ((m * m - x1 - x2) % P + P) % P;
  const y3 = ((m * (x1 - x3) - y1) % P + P) % P;
  return [x3, y3];
}

function pointMul(k: bigint, p: [bigint, bigint]): Point {
  let res: Point = null;
  let curr: [bigint, bigint] = p;
  let n = ((k % N) + N) % N;
  while (n > 0n) {
    if (n & 1n) res = pointAdd(res, curr);
    const doubled = pointAdd(curr, curr);
    if (!doubled) break;
    curr = doubled;
    n >>= 1n;
  }
  return res;
}

/**
 * RFC 6979 deterministic nonce generator for secp256k1.
 */
function generateK(digest: Buffer, privKey: Buffer): bigint {
  let v = Buffer.alloc(32, 0x01);
  let k = Buffer.alloc(32, 0x00);
  k = crypto.createHmac('sha256', k).update(Buffer.concat([v, Buffer.from([0x00]), privKey, digest])).digest();
  v = crypto.createHmac('sha256', k).update(v).digest();
  k = crypto.createHmac('sha256', k).update(Buffer.concat([v, Buffer.from([0x01]), privKey, digest])).digest();
  v = crypto.createHmac('sha256', k).update(v).digest();

  while (true) {
    v = crypto.createHmac('sha256', k).update(v).digest();
    const kInt = BigInt('0x' + v.toString('hex'));
    if (kInt >= 1n && kInt < N) return kInt;
    k = crypto.createHmac('sha256', k).update(Buffer.concat([v, Buffer.from([0x00])])).digest();
    v = crypto.createHmac('sha256', k).update(v).digest();
  }
}

/**
 * Derives uncompressed Ethereum public key point [X, Y] from a private key.
 */
export function getPublicKeyPoint(privKey: Uint8Array | Buffer | string): [bigint, bigint] {
  const privBuf = normalizePrivateKey(privKey);
  const d = BigInt('0x' + privBuf.toString('hex'));
  if (d <= 0n || d >= N) throw new RangeError('Private key out of valid secp256k1 range');
  const pt = pointMul(d, [Gx, Gy]);
  if (!pt) throw new Error('Failed to derive public key point');
  return pt;
}

/**
 * Derives Ethereum address (0x...) from a private key.
 */
export function getEthereumAddress(privKey: Uint8Array | Buffer | string): string {
  const [x, y] = getPublicKeyPoint(privKey);
  const xBuf = Buffer.from(x.toString(16).padStart(64, '0'), 'hex');
  const yBuf = Buffer.from(y.toString(16).padStart(64, '0'), 'hex');
  const pubBuf = Buffer.concat([xBuf, yBuf]); // 64 bytes uncompressed (without 0x04 prefix)
  return '0x' + keccak256(pubBuf).subarray(12, 32).toString('hex');
}

function normalizePrivateKey(privKey: Uint8Array | Buffer | string): Buffer {
  if (Buffer.isBuffer(privKey)) {
    if (privKey.length !== 32) throw new Error(`Private key must be 32 bytes, got ${privKey.length}`);
    return privKey;
  }
  if (privKey instanceof Uint8Array) {
    if (privKey.length !== 32) throw new Error(`Private key must be 32 bytes, got ${privKey.length}`);
    return Buffer.from(privKey);
  }
  if (typeof privKey === 'string') {
    const clean = privKey.startsWith('0x') ? privKey.slice(2) : privKey;
    if (clean.length !== 64) throw new Error(`Private key hex must be 64 characters, got ${clean.length}`);
    return Buffer.from(clean, 'hex');
  }
  throw new TypeError('Invalid private key type');
}

/**
 * Signs a 32-byte digest using a secp256k1 private key.
 * Produces canonical (EIP-2 / BIP-62 compliant) signature { r, s, v }.
 * v is 27 or 28.
 */
export function signDigest(
  digest: Uint8Array | Buffer,
  privKey: Uint8Array | Buffer | string
): { r: bigint; s: bigint; v: number; signatureHex: string } {
  const digestBuf = Buffer.from(digest);
  if (digestBuf.length !== 32) throw new Error(`Digest must be 32 bytes, got ${digestBuf.length}`);
  const privBuf = normalizePrivateKey(privKey);

  const d = BigInt('0x' + privBuf.toString('hex'));
  const e = BigInt('0x' + digestBuf.toString('hex'));
  const k = generateK(digestBuf, privBuf);
  const R = pointMul(k, [Gx, Gy]);
  if (!R) throw new Error('Invalid curve point during signing');

  const r = R[0] % N;
  let s = (modInverse(k, N) * (e + r * d)) % N;
  let recId = Number(R[1] & 1n);

  // Canonical low-s check (EIP-2)
  if (s > N / 2n) {
    s = N - s;
    recId ^= 1;
  }
  const v = 27 + recId;

  const rBuf = Buffer.from(r.toString(16).padStart(64, '0'), 'hex');
  const sBuf = Buffer.from(s.toString(16).padStart(64, '0'), 'hex');
  const vBuf = Buffer.from([v]);
  const signatureHex = '0x' + Buffer.concat([rBuf, sBuf, vBuf]).toString('hex');

  return { r, s, v, signatureHex };
}

/**
 * Recovers the public key point [X, Y] from a 32-byte digest and { r, s, v }.
 */
export function recoverPublicKeyPoint(
  digest: Uint8Array | Buffer | string,
  r: bigint,
  s: bigint,
  v: number
): [bigint, bigint] {
  const digestBuf = typeof digest === 'string'
    ? Buffer.from(digest.startsWith('0x') ? digest.slice(2) : digest, 'hex')
    : Buffer.from(digest);
  if (digestBuf.length !== 32) throw new Error(`Digest must be 32 bytes, got ${digestBuf.length}`);
  if (v !== 27 && v !== 28) throw new RangeError(`Invalid recovery id v: ${v}, expected 27 or 28`);
  if (r <= 0n || r >= N) throw new RangeError('r value out of valid range');
  if (s <= 0n || s > N / 2n) throw new RangeError('s value out of valid canonical low-s range');

  const e = BigInt('0x' + digestBuf.toString('hex'));
  const x = r;
  const y2 = (x * x * x + 7n) % P;

  // y = y2 ^ ((P+1)/4) mod P
  let expVal = (P + 1n) / 4n;
  let y = 1n;
  let base = y2;
  while (expVal > 0n) {
    if (expVal & 1n) y = (y * base) % P;
    base = (base * base) % P;
    expVal >>= 1n;
  }

  const recId = v - 27;
  if ((y & 1n) !== BigInt(recId)) {
    y = P - y;
  }

  const R: [bigint, bigint] = [x, y];
  const rInv = modInverse(r, N);
  const sR = pointMul(s, R);
  const eG = pointMul(e, [Gx, Gy]);
  if (!sR || !eG) throw new Error('Curve point multiplication failed');

  const neg_eG: [bigint, bigint] = [eG[0], (P - eG[1]) % P];
  const sum = pointAdd(sR, neg_eG);
  if (!sum) throw new Error('Curve point addition failed');

  const Q = pointMul(rInv, sum);
  if (!Q) throw new Error('Failed to recover public key point');
  return Q;
}

/**
 * Recovers Ethereum address from a 32-byte digest and 65-byte signature hex.
 */
export function recoverSignerAddress(
  digest: Uint8Array | Buffer | string,
  signatureHex: string
): string {
  const clean = signatureHex.startsWith('0x') ? signatureHex.slice(2) : signatureHex;
  if (clean.length !== 130) {
    throw new Error(`Signature must be 65 bytes (130 hex chars), got ${clean.length}`);
  }
  const r = BigInt('0x' + clean.slice(0, 64));
  const s = BigInt('0x' + clean.slice(64, 128));
  let v = parseInt(clean.slice(128, 130), 16);
  if (v < 27) v += 27; // Handle 0/1 v values

  const [x, y] = recoverPublicKeyPoint(digest, r, s, v);
  const xBuf = Buffer.from(x.toString(16).padStart(64, '0'), 'hex');
  const yBuf = Buffer.from(y.toString(16).padStart(64, '0'), 'hex');
  const pubBuf = Buffer.concat([xBuf, yBuf]);
  return '0x' + keccak256(pubBuf).subarray(12, 32).toString('hex');
}

/**
 * Recovers Ethereum address from a BatchCommitment and 65-byte signature.
 */
export function recoverCommitmentSigner(
  domain: EIP712Domain,
  commitment: BatchCommitment,
  signature: string
): string {
  const digest = computeEIP712Digest(domain, commitment);
  return recoverSignerAddress(digest, signature);
}

/**
 * Signs a BatchCommitment as the Evidence Vault.
 * 
 * LOCKED SPECIFICATION:
 * EIP-712 signer key exists ONLY in the vault; relayer is a separate key.
 */
export function signBatchCommitment(
  vaultSignerPrivateKey: Uint8Array | Buffer | string,
  domain: EIP712Domain,
  commitment: BatchCommitment
): SignedBatchCommitment {
  const digest = computeEIP712Digest(domain, commitment);
  const { signatureHex } = signDigest(digest, vaultSignerPrivateKey);
  const signerAddress = getEthereumAddress(vaultSignerPrivateKey);
  const structHash = computeCommitmentStructHashHex(commitment);

  return {
    commitment,
    signature: signatureHex,
    signer: signerAddress,
    structHash,
    digest: '0x' + digest.toString('hex')
  };
}

/** Prompt 1 Canonical API Alias */
export const signCommitment = signBatchCommitment;

/**
 * Verifies a signed batch commitment against an expected signer address.
 */
export function verifyCommitmentSignature(
  domain: EIP712Domain,
  commitment: BatchCommitment,
  signature: string,
  expectedSigner: string
): boolean {
  try {
    const digest = computeEIP712Digest(domain, commitment);
    const recovered = recoverSignerAddress(digest, signature);
    return recovered.toLowerCase() === expectedSigner.toLowerCase();
  } catch {
    return false;
  }
}
