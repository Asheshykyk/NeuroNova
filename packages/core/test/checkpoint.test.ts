import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHECKPOINT_DOMAIN_TAG,
  GENESIS_CHECKPOINT_DIGEST,
  buildCheckpoint,
  buildCheckpointPreimage,
  checkCheckpoint,
  verifyCheckpointContinuity,
  checkLocalChain
} from '../src/checkpoint.ts';
import type { BatchCommitment } from '../src/types.ts';
import { hashCommitmentHex, GENESIS_CHECKPOINT_HASH } from '../src/commitment.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const vectorPath = path.resolve(__dirname, '../../../vectors/checkpoint.json');
const vectors = JSON.parse(fs.readFileSync(vectorPath, 'utf-8'));

export function runCheckpointTests(): void {
  console.log('--- Running Cross-Chain Checkpoint Digest Tests ---');

  // 1. Domain tag
  assert.equal(CHECKPOINT_DOMAIN_TAG, 0xcc, 'CHECKPOINT_DOMAIN_TAG must be 0xCC');
  assert.equal(GENESIS_CHECKPOINT_DIGEST, '0x0000000000000000000000000000000000000000000000000000000000000000');

  // 2. Genesis Checkpoint Vector
  const genesisVec = vectors.genesisCheckpoint;
  const genPreimage = buildCheckpointPreimage(genesisVec.input);
  assert.equal(genPreimage.length, 165, 'Preimage length must be exactly 165 bytes');
  assert.equal('0x' + genPreimage.toString('hex'), genesisVec.preimageHex, 'Genesis preimage hex matches vector');

  const genResult = buildCheckpoint(genesisVec.input);
  assert.equal(genResult.digestHex, genesisVec.digestHex, 'Genesis digest hex matches vector');
  assert.equal(checkCheckpoint(genesisVec.input, genesisVec.digestHex), true, 'Genesis checkCheckpoint passes');

  // 3. Chained Checkpoint Vector
  const chainedVec = vectors.chainedCheckpoint;
  const chainedPreimage = buildCheckpointPreimage(chainedVec.input);
  assert.equal(chainedPreimage.length, 165, 'Chained preimage length must be 165 bytes');
  assert.equal('0x' + chainedPreimage.toString('hex'), chainedVec.preimageHex, 'Chained preimage hex matches vector');

  const chainedResult = buildCheckpoint(chainedVec.input);
  assert.equal(chainedResult.digestHex, chainedVec.digestHex, 'Chained digest hex matches vector');
  assert.equal(checkCheckpoint(chainedVec.input, chainedVec.digestHex), true, 'Chained checkCheckpoint passes');

  // 4. Checkpoint Continuity
  assert.equal(
    verifyCheckpointContinuity(chainedVec.input, genesisVec.digestHex),
    true,
    'Chained checkpoint previousCheckpointDigest matches genesis digest'
  );

  // 5. Negative: Altered Batch Root
  const alteredRootCase = vectors.negativeCases.find((c: any) => c.name === 'altered_batch_root');
  assert.equal(
    checkCheckpoint(alteredRootCase.input, chainedVec.digestHex),
    false,
    'Must reject checkpoint with altered latestBatchRoot'
  );

  // 6. Negative: Altered Block Hash
  const alteredBlockCase = vectors.negativeCases.find((c: any) => c.name === 'altered_local_block_hash');
  assert.equal(
    checkCheckpoint(alteredBlockCase.input, chainedVec.digestHex),
    false,
    'Must reject checkpoint with altered localBlockHash'
  );

  // 7. Negative: Broken Continuity
  const brokenContCase = vectors.negativeCases.find((c: any) => c.name === 'broken_continuity');
  assert.equal(
    verifyCheckpointContinuity(brokenContCase.input, genesisVec.digestHex),
    false,
    'Must reject broken checkpoint continuity'
  );

  // 8. checkLocalChain: Valid chained batches
  const batch1: BatchCommitment = {
    sourceId: '0x' + Buffer.alloc(32, 1).toString('hex'),
    sequenceStart: 1n,
    sequenceEnd: 50n,
    leafCount: 50n,
    merkleRoot: '0x' + Buffer.alloc(32, 0xaa).toString('hex'),
    previousCheckpointHash: GENESIS_CHECKPOINT_HASH
  };
  const batch1Hash = hashCommitmentHex(batch1);

  const batch2: BatchCommitment = {
    sourceId: '0x' + Buffer.alloc(32, 1).toString('hex'),
    sequenceStart: 51n,
    sequenceEnd: 100n,
    leafCount: 50n,
    merkleRoot: '0x' + Buffer.alloc(32, 0xbb).toString('hex'),
    previousCheckpointHash: batch1Hash
  };
  const batch2Hash = hashCommitmentHex(batch2);

  const batch3: BatchCommitment = {
    sourceId: '0x' + Buffer.alloc(32, 1).toString('hex'),
    sequenceStart: 101n,
    sequenceEnd: 150n,
    leafCount: 50n,
    merkleRoot: '0x' + Buffer.alloc(32, 0xcc).toString('hex'),
    previousCheckpointHash: batch2Hash
  };

  const localChainAnalysis = checkLocalChain([batch1, batch2, batch3]);
  assert.equal(localChainAnalysis.valid, true, 'Valid local chain passes analysis');
  assert.equal(localChainAnalysis.latestSequence, 150n, 'latestSequence matches');
  assert.equal(localChainAnalysis.totalLeaves, 150n, 'totalLeaves matches');
  assert.equal(localChainAnalysis.batchCount, 3, 'batchCount matches');
  assert.equal(localChainAnalysis.latestBatchRoot, batch3.merkleRoot, 'latestBatchRoot matches');

  // 9. checkLocalChain Negative: Sequence Gap
  const gapBatch3 = { ...batch3, sequenceStart: 102n };
  assert.equal(checkLocalChain([batch1, batch2, gapBatch3]).valid, false, 'Rejects sequence gap');

  // 10. checkLocalChain Negative: Leaf Count Mismatch
  const countMismatchBatch3 = { ...batch3, leafCount: 49n };
  assert.equal(checkLocalChain([batch1, batch2, countMismatchBatch3]).valid, false, 'Rejects leafCount mismatch');

  // 11. checkLocalChain Negative: Tampered previousCheckpointHash
  const tamperedPrevHashBatch3 = { ...batch3, previousCheckpointHash: GENESIS_CHECKPOINT_HASH };
  assert.equal(checkLocalChain([batch1, batch2, tamperedPrevHashBatch3]).valid, false, 'Rejects tampered previousCheckpointHash');

  // 12. checkLocalChain Negative: Empty Chain
  assert.equal(checkLocalChain([]).valid, false, 'Rejects empty chain');

  console.log('✓ Cross-Chain Checkpoint Digest tests passed (12/12)');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCheckpointTests();
}
