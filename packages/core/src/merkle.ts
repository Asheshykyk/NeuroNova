import crypto from 'node:crypto';
import type { MerkleProof, MerkleProofStep } from './types.ts';

/**
 * Domain separator byte for internal tree nodes.
 * LOCKED SPECIFICATION: 0x01
 */
export const NODE_DOMAIN_TAG = 0x01;

/**
 * Normalizes a 32-byte hash to a Buffer.
 */
function toBuffer32(hash: Uint8Array | Buffer | string, name = 'hash'): Buffer {
  if (Buffer.isBuffer(hash)) {
    if (hash.length !== 32) throw new Error(`${name} must be 32 bytes, got ${hash.length}`);
    return hash;
  }
  if (hash instanceof Uint8Array) {
    if (hash.length !== 32) throw new Error(`${name} must be 32 bytes, got ${hash.length}`);
    return Buffer.from(hash);
  }
  if (typeof hash === 'string') {
    const clean = hash.startsWith('0x') ? hash.slice(2) : hash;
    if (clean.length !== 64) throw new Error(`${name} hex string must be 64 characters (32 bytes), got ${clean.length}`);
    return Buffer.from(clean, 'hex');
  }
  throw new TypeError(`Invalid ${name} type: expected Buffer, Uint8Array or hex string`);
}

/**
 * Computes an internal node hash according to the locked specification:
 * 
 * LOCKED:
 * node = SHA256(0x01 || left || right);
 * 
 * Preimage length is exactly 65 bytes (1 + 32 + 32).
 */
export function hashInternalNode(
  left: Uint8Array | Buffer | string,
  right: Uint8Array | Buffer | string
): Buffer {
  const leftBuf = toBuffer32(left, 'left');
  const rightBuf = toBuffer32(right, 'right');
  const preimage = Buffer.concat([Buffer.from([NODE_DOMAIN_TAG]), leftBuf, rightBuf]);
  return crypto.createHash('sha256').update(preimage).digest();
}

/**
 * Builds a deterministic binary Merkle tree from an ordered array of leaf hashes.
 * 
 * LOCKED SPECIFICATION:
 * - node = SHA256(0x01 || left || right);
 * - odd node promoted unchanged (never duplicated);
 * 
 * If leaves.length === 1, root is the leaf hash itself.
 * If leaves.length === 0, throws an Error.
 * 
 * Returns { root, layers } where layers[0] is leaves, layers[last] is [root].
 */
export function buildMerkleTree(
  leaves: (Uint8Array | Buffer | string)[]
): { root: Buffer; layers: Buffer[][] } {
  if (!leaves || leaves.length === 0) {
    throw new Error('Cannot build Merkle tree from empty leaves array');
  }

  // Layer 0: Leaves
  const leafBuffers = leaves.map((l, idx) => toBuffer32(l, `leaf[${idx}]`));
  const layers: Buffer[][] = [leafBuffers];

  let currentLayer = leafBuffers;
  while (currentLayer.length > 1) {
    const nextLayer: Buffer[] = [];
    for (let i = 0; i < currentLayer.length; i += 2) {
      if (i + 1 < currentLayer.length) {
        // Even pair: hash with 0x01 domain tag
        nextLayer.push(hashInternalNode(currentLayer[i], currentLayer[i + 1]));
      } else {
        // LOCKED: odd node promoted unchanged (never duplicated)
        nextLayer.push(currentLayer[i]);
      }
    }
    layers.push(nextLayer);
    currentLayer = nextLayer;
  }

  return {
    root: currentLayer[0],
    layers
  };
}

/**
 * Computes the Merkle root directly from leaf hashes.
 */
export function computeMerkleRoot(leaves: (Uint8Array | Buffer | string)[]): Buffer {
  return buildMerkleTree(leaves).root;
}

/**
 * Computes the Merkle root returning 0x-prefixed hex string.
 */
export function computeMerkleRootHex(leaves: (Uint8Array | Buffer | string)[]): string {
  return '0x' + computeMerkleRoot(leaves).toString('hex');
}

/**
 * Generates an inclusion proof for a leaf at index `leafIndex`.
 * 
 * Handles the locked odd-node promotion rule:
 * If a node at layer L is promoted without a sibling, the proof step records:
 * { position: 'promoted', sibling: null }
 */
export function generateMerkleProof(
  layers: Buffer[][],
  leafIndex: number
): MerkleProof {
  if (layers.length === 0 || layers[0].length === 0) {
    throw new Error('Layers array is empty');
  }
  if (leafIndex < 0 || leafIndex >= layers[0].length) {
    throw new RangeError(`leafIndex ${leafIndex} out of bounds [0, ${layers[0].length - 1}]`);
  }

  const steps: MerkleProofStep[] = [];
  let currentIndex = leafIndex;

  for (let l = 0; l < layers.length - 1; l++) {
    const layer = layers[l];
    const isRightChild = currentIndex % 2 === 1;
    const siblingIndex = isRightChild ? currentIndex - 1 : currentIndex + 1;

    if (siblingIndex < layer.length) {
      // Sibling exists
      steps.push({
        position: isRightChild ? 'left' : 'right',
        sibling: '0x' + layer[siblingIndex].toString('hex')
      });
    } else {
      // LOCKED: odd node promoted unchanged (never duplicated) -> no sibling
      steps.push({
        position: 'promoted',
        sibling: null
      });
    }

    currentIndex = Math.floor(currentIndex / 2);
  }

  const leafHash = '0x' + layers[0][leafIndex].toString('hex');
  const root = '0x' + layers[layers.length - 1][0].toString('hex');

  return {
    leafIndex,
    leafHash,
    root,
    steps
  };
}

/**
 * Verifies a Merkle inclusion proof against an expected Merkle root.
 * 
 * Applies the locked rules:
 * - position 'right': curr = SHA256(0x01 || curr || sibling)
 * - position 'left': curr = SHA256(0x01 || sibling || curr)
 * - position 'promoted': curr = curr (unchanged)
 */
export function verifyMerkleProof(
  leafHash: Uint8Array | Buffer | string,
  steps: MerkleProofStep[],
  expectedRoot: Uint8Array | Buffer | string
): boolean {
  let current = toBuffer32(leafHash, 'leafHash');
  const rootBuf = toBuffer32(expectedRoot, 'expectedRoot');

  for (const step of steps) {
    if (step.position === 'promoted') {
      // Promoted node remains unchanged at this level
      continue;
    } else if (step.position === 'right') {
      if (!step.sibling) {
        throw new Error('Step with position right missing sibling hash');
      }
      current = hashInternalNode(current, step.sibling);
    } else if (step.position === 'left') {
      if (!step.sibling) {
        throw new Error('Step with position left missing sibling hash');
      }
      current = hashInternalNode(step.sibling, current);
    } else {
      throw new Error(`Unknown Merkle proof step position: ${(step as any).position}`);
    }
  }

  return current.equals(rootBuf);
}
