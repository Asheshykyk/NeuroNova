/**
 * Pure TypeScript Implementation of Ethereum Keccak-256.
 * Zero external dependencies.
 * Verified against Ethereum test vectors:
 *   keccak256("")    = 0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470
 *   keccak256("abc") = 0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45
 */

const SHA3_PI: number[] = [];
const SHA3_ROTL: number[] = [];
const _SHA3_IOTA: bigint[] = [];

const _0n = 0n;
const _1n = 1n;
const _2n = 2n;
const _7n = 7n;
const _256n = 256n;
const _0x71n = 0x71n;

for (let round = 0, R = _1n, x = 1, y = 0; round < 24; round++) {
  [x, y] = [y, (2 * x + 3 * y) % 5];
  SHA3_PI.push(2 * (5 * y + x));
  SHA3_ROTL.push((((round + 1) * (round + 2)) / 2) % 64);
  let t = _0n;
  for (let j = 0; j < 7; j++) {
    R = ((R << _1n) ^ ((R >> _7n) * _0x71n)) % _256n;
    if (R & _2n) t ^= _1n << ((_1n << BigInt(j)) - _1n);
  }
  _SHA3_IOTA.push(t);
}

const U32_MASK64 = BigInt(2 ** 32 - 1);
const _32n = 32n;

function split(lst: bigint[], le = false): [Uint32Array, Uint32Array] {
  const Ah = new Uint32Array(lst.length);
  const Al = new Uint32Array(lst.length);
  for (let i = 0; i < lst.length; i++) {
    const n = lst[i];
    if (le) {
      Ah[i] = Number(n & U32_MASK64);
      Al[i] = Number((n >> _32n) & U32_MASK64);
    } else {
      Ah[i] = Number((n >> _32n) & U32_MASK64) | 0;
      Al[i] = Number(n & U32_MASK64) | 0;
    }
  }
  return [Ah, Al];
}

const IOTAS = split(_SHA3_IOTA, true);
const SHA3_IOTA_H = IOTAS[0];
const SHA3_IOTA_L = IOTAS[1];

const rotlSH = (h: number, l: number, s: number) => (h << s) | (l >>> (32 - s));
const rotlSL = (h: number, l: number, s: number) => (l << s) | (h >>> (32 - s));
const rotlBH = (h: number, l: number, s: number) => (l << (s - 32)) | (h >>> (64 - s));
const rotlBL = (h: number, l: number, s: number) => (h << (s - 32)) | (l >>> (64 - s));
const rotlH = (h: number, l: number, s: number) => (s > 32 ? rotlBH(h, l, s) : rotlSH(h, l, s));
const rotlL = (h: number, l: number, s: number) => (s > 32 ? rotlBL(h, l, s) : rotlSL(h, l, s));

export function keccakP(s: Uint32Array, rounds = 24): void {
  const B = new Uint32Array(10);
  for (let round = 24 - rounds; round < 24; round++) {
    // Theta
    for (let x = 0; x < 10; x++) B[x] = s[x] ^ s[x + 10] ^ s[x + 20] ^ s[x + 30] ^ s[x + 40];
    for (let x = 0; x < 10; x += 2) {
      const idx1 = (x + 8) % 10;
      const idx0 = (x + 2) % 10;
      const B0 = B[idx0];
      const B1 = B[idx0 + 1];
      const Th = rotlH(B0, B1, 1) ^ B[idx1];
      const Tl = rotlL(B0, B1, 1) ^ B[idx1 + 1];
      for (let y = 0; y < 50; y += 10) {
        s[x + y] ^= Th;
        s[x + y + 1] ^= Tl;
      }
    }
    // Rho and Pi
    let curH = s[2];
    let curL = s[3];
    for (let t = 0; t < 24; t++) {
      const shift = SHA3_ROTL[t];
      const Th = rotlH(curH, curL, shift);
      const Tl = rotlL(curH, curL, shift);
      const PI = SHA3_PI[t];
      curH = s[PI];
      curL = s[PI + 1];
      s[PI] = Th;
      s[PI + 1] = Tl;
    }
    // Chi
    for (let y = 0; y < 50; y += 10) {
      const b0 = s[y], b1 = s[y + 1], b2 = s[y + 2], b3 = s[y + 3];
      s[y] ^= ~s[y + 2] & s[y + 4];
      s[y + 1] ^= ~s[y + 3] & s[y + 5];
      s[y + 2] ^= ~s[y + 4] & s[y + 6];
      s[y + 3] ^= ~s[y + 5] & s[y + 7];
      s[y + 4] ^= ~s[y + 6] & s[y + 8];
      s[y + 5] ^= ~s[y + 7] & s[y + 9];
      s[y + 6] ^= ~s[y + 8] & b0;
      s[y + 7] ^= ~s[y + 9] & b1;
      s[y + 8] ^= ~b0 & b2;
      s[y + 9] ^= ~b1 & b3;
    }
    // Iota
    s[0] ^= SHA3_IOTA_H[round];
    s[1] ^= SHA3_IOTA_L[round];
  }
}

/**
 * Computes Ethereum Keccak-256 hash.
 * Returns 32-byte Buffer.
 */
export function keccak256(data: Uint8Array | Buffer | string): Buffer {
  let buf: Buffer;
  if (Buffer.isBuffer(data)) {
    buf = data;
  } else if (data instanceof Uint8Array) {
    buf = Buffer.from(data);
  } else if (typeof data === 'string') {
    buf = data.startsWith('0x') && data.length % 2 === 0
      ? Buffer.from(data.slice(2), 'hex')
      : Buffer.from(data, 'utf-8');
  } else {
    throw new TypeError('Invalid data for keccak256');
  }

  const blockLen = 136; // 1088 bits / 8
  const state = new Uint8Array(200);
  const state32 = new Uint32Array(state.buffer);

  let pos = 0;
  for (let i = 0; i < buf.length; i++) {
    state[pos++] ^= buf[i];
    if (pos === blockLen) {
      keccakP(state32);
      pos = 0;
    }
  }

  // Pre-NIST Keccak padding: 0x01 ... 0x80
  state[pos] ^= 0x01;
  state[blockLen - 1] ^= 0x80;
  keccakP(state32);

  return Buffer.from(state.buffer, 0, 32);
}

/**
 * Computes Ethereum Keccak-256 hash returning 0x-prefixed hex string.
 */
export function keccak256Hex(data: Uint8Array | Buffer | string): string {
  return '0x' + keccak256(data).toString('hex');
}
