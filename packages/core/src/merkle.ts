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
export function hashNode(
  left: Uint8Array | Buffer | string,
  right: Uint8Array | Buffer | string
): Buffer {
  const leftBuf = toBuffer32(left, 'left');
  const rightBuf = toBuffer32(right, 'right');
  const preimage = Buffer.concat([Buffer.from([NODE_DOMAIN_TAG]), leftBuf, rightBuf]);
  return crypto.createHash('sha256').update(preimage).digest();
}

/** Backward compatibility alias */
export const hashInternalNode = hashNode;

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
export function buildTree(
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
        nextLayer.push(hashNode(currentLayer[i], currentLayer[i + 1]));
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

/** Backward compatibility alias */
export const buildMerkleTree = buildTree;

/**
 * Computes the Merkle root directly from leaf hashes.
 */
export function computeMerkleRoot(leaves: (Uint8Array | Buffer | string)[]): Buffer {
  return buildTree(leaves).root;
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
 * SPECIFICATION:
 * A proof needs (leafIndex, leafCount) so the verifier knows which levels have no sibling.
 * 
 * Accepts either:
 * - `leaves`: an array of leaf hashes (Uint8Array | Buffer | string)[]
 * - `layers`: the pre-computed tree layers Buffer[][]
 */
export function getProof(
  leavesOrLayers: (Uint8Array | Buffer | string)[] | Buffer[][],
  leafIndex: number
): MerkleProof {
  let layers: Buffer[][];
  let leafCount: number;

  if (Array.isArray(leavesOrLayers) && leavesOrLayers.length > 0 && Array.isArray(leavesOrLayers[0])) {
    layers = leavesOrLayers as Buffer[][];
    leafCount = layers[0].length;
  } else {
    const tree = buildTree(leavesOrLayers as (Uint8Array | Buffer | string)[]);
    layers = tree.layers;
    leafCount = layers[0].length;
  }

  if (layers.length === 0 || layers[0].length === 0) {
    throw new Error('Layers array is empty');
  }
  if (leafIndex < 0 || leafIndex >= leafCount) {
    throw new RangeError(`leafIndex ${leafIndex} out of bounds [0, ${leafCount - 1}]`);
  }

  const steps: MerkleProofStep[] = [];
  const siblings: string[] = [];
  let currentIndex = leafIndex;

  for (let l = 0; l < layers.length - 1; l++) {
    const layer = layers[l];
    const isRightChild = currentIndex % 2 === 1;
    const siblingIndex = isRightChild ? currentIndex - 1 : currentIndex + 1;

    if (siblingIndex < layer.length) {
      // Sibling exists
      const siblingHex = '0x' + layer[siblingIndex].toString('hex');
      siblings.push(siblingHex);
      steps.push({
        position: isRightChild ? 'left' : 'right',
        sibling: siblingHex
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
    leafCount,
    leafHash,
    root,
    siblings,
    steps
  };
}

/** Backward compatibility alias */
export const generateMerkleProof = getProof;

/**
 * Verifies a Merkle inclusion proof against an expected Merkle root.
 * 
 * SPECIFICATION:
 * A proof needs (leafIndex, leafCount) so the verifier knows which levels have no sibling.
 * 
 * Supports:
 * 1. Object parameter: verifyProof(proof, expectedRoot?)
 * 2. Positional parameters: verifyProof(leafHash, proofOrSteps, expectedRoot, leafIndex?, leafCount?)
 */
export function verifyProof(
  leafHashOrProof: Uint8Array | Buffer | string | MerkleProof | { leafIndex: number; leafCount: number; leafHash: string; siblings: string[]; root?: string },
  proofOrExpectedRoot?: MerkleProofStep[] | string[] | Uint8Array | Buffer | string,
  expectedRootParam?: Uint8Array | Buffer | string,
  leafIndexParam?: number,
  leafCountParam?: number
): boolean {
  try {
    // Mode A: Called with MerkleProof object as first argument
    if (typeof leafHashOrProof === 'object' && leafHashOrProof !== null && 'leafIndex' in leafHashOrProof && 'leafCount' in leafHashOrProof) {
      const p = leafHashOrProof as { leafIndex: number; leafCount: number; leafHash: string; siblings?: string[]; steps?: MerkleProofStep[]; root?: string };
      const expectedRoot = expectedRootParam || (typeof proofOrExpectedRoot === 'string' || Buffer.isBuffer(proofOrExpectedRoot) ? proofOrExpectedRoot : p.root);
      if (!expectedRoot) return false;

      // Verify using (leafIndex, leafCount, siblings)
      if (Array.isArray(p.siblings)) {
        return verifyProofWithIndices(p.leafHash, p.siblings, expectedRoot, p.leafIndex, p.leafCount);
      }
      // Or fallback to steps
      if (Array.isArray(p.steps)) {
        return verifyProofWithSteps(p.leafHash, p.steps, expectedRoot);
      }
      return false;
    }

    // Mode B: Called with explicit (leafHash, proof, expectedRoot, leafIndex, leafCount)
    const leafHash = leafHashOrProof as Uint8Array | Buffer | string;
    const expectedRoot = expectedRootParam;
    if (!expectedRoot) return false;

    // If proofOrExpectedRoot is array of MerkleProofStep objects
    if (Array.isArray(proofOrExpectedRoot) && proofOrExpectedRoot.length > 0 && typeof proofOrExpectedRoot[0] === 'object' && 'position' in proofOrExpectedRoot[0]) {
      return verifyProofWithSteps(leafHash, proofOrExpectedRoot as MerkleProofStep[], expectedRoot);
    }

    // If proofOrExpectedRoot is an array of sibling hex strings with leafIndex & leafCount provided
    if (Array.isArray(proofOrExpectedRoot) && leafIndexParam !== undefined && leafCountParam !== undefined) {
      return verifyProofWithIndices(leafHash, proofOrExpectedRoot as string[], expectedRoot, leafIndexParam, leafCountParam);
    }

    // If proofOrExpectedRoot is a MerkleProof object
    if (typeof proofOrExpectedRoot === 'object' && proofOrExpectedRoot !== null && 'siblings' in proofOrExpectedRoot) {
      const p = proofOrExpectedRoot as MerkleProof;
      return verifyProofWithIndices(leafHash, p.siblings, expectedRoot, p.leafIndex, p.leafCount);
    }

    return false;
  } catch {
    return false;
  }
}

/** Backward compatibility alias */
export const verifyMerkleProof = verifyProof;

/**
 * Deterministic traversal verification using (leafIndex, leafCount) and siblings array.
 * 
 * Traverses layer by layer:
 * - If current layer count is odd and index == count - 1: promoted unchanged (no sibling consumed)
 * - If index is even: sibling on right
 * - If index is odd: sibling on left
 */
function verifyProofWithIndices(
  leafHash: Uint8Array | Buffer | string,
  siblings: string[],
  expectedRoot: Uint8Array | Buffer | string,
  leafIndex: number,
  leafCount: number
): boolean {
  if (leafCount <= 0 || leafIndex < 0 || leafIndex >= leafCount) return false;

  let current = toBuffer32(leafHash, 'leafHash');
  const rootBuf = toBuffer32(expectedRoot, 'expectedRoot');

  let currentCount = BigInt(leafCount);
  let currentIndex = BigInt(leafIndex);
  let siblingPtr = 0;

  while (currentCount > 1n) {
    const isOddLayer = currentCount % 2n === 1n;
    const isPromotedNode = isOddLayer && currentIndex === currentCount - 1n;

    if (isPromotedNode) {
      // LOCKED: odd node promoted unchanged (never duplicated); no sibling consumed at this level
    } else {
      if (siblingPtr >= siblings.length) {
        return false; // Sibling missing
      }
      const siblingBuf = toBuffer32(siblings[siblingPtr++], `sibling[${siblingPtr - 1}]`);
      if (currentIndex % 2n === 1n) {
        // Current is right child, sibling is on left
        current = hashNode(siblingBuf, current);
      } else {
        // Current is left child, sibling is on right
        current = hashNode(current, siblingBuf);
      }
    }

    currentCount = (currentCount + 1n) / 2n;
    currentIndex = currentIndex / 2n;
  }

  // Ensure all provided siblings were consumed (no extraneous siblings)
  if (siblingPtr !== siblings.length) {
    return false;
  }

  return current.equals(rootBuf);
}

/**
 * Traversal verification using explicit MerkleProofStep[] steps.
 */
function verifyProofWithSteps(
  leafHash: Uint8Array | Buffer | string,
  steps: MerkleProofStep[],
  expectedRoot: Uint8Array | Buffer | string
): boolean {
  let current = toBuffer32(leafHash, 'leafHash');
  const rootBuf = toBuffer32(expectedRoot, 'expectedRoot');

  for (const step of steps) {
    if (step.position === 'promoted') {
      continue;
    } else if (step.position === 'right') {
      if (!step.sibling) return false;
      current = hashNode(current, step.sibling);
    } else if (step.position === 'left') {
      if (!step.sibling) return false;
      current = hashNode(step.sibling, current);
    } else {
      return false;
    }
  }

  return current.equals(rootBuf);
}
