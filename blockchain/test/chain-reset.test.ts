import { expect } from 'chai';
import hardhat from 'hardhat';
const { ethers } = hardhat;
import {
  BATCH_COMMITMENT_EIP712_TYPES,
  hashCommitmentHex,
  GENESIS_CHECKPOINT_HASH
} from '../../packages/core/src/commitment.ts';
import {
  buildCheckpoint,
  checkCheckpoint,
  verifyCheckpointContinuity,
  checkLocalChain,
  GENESIS_CHECKPOINT_DIGEST
} from '../../packages/core/src/checkpoint.ts';
import { TEST_VAULT_SIGNER_KEY } from '../../packages/core/src/test-vectors.ts';
import type { BatchCommitment } from '../../packages/core/src/types.ts';

describe('Phase 3: Cross-Chain Checkpoint Digest & Local Chain Reset Simulation', function () {
  let contract: any;
  let owner: any;
  let relayer: any;
  let vaultSigner: any;

  const sourceId = '0x736f757263652d30310000000000000000000000000000000000000000000000'; // "source-01"
  let contractAddress: string;
  let localChainId: bigint;
  let domain: any;

  beforeEach(async function () {
    [owner, relayer] = await ethers.getSigners();
    vaultSigner = new ethers.Wallet(TEST_VAULT_SIGNER_KEY, ethers.provider);

    const EvidenceAnchor = await ethers.getContractFactory('EvidenceAnchor');
    contract = await EvidenceAnchor.deploy();
    await contract.waitForDeployment();
    contractAddress = await contract.getAddress();

    const net = await ethers.provider.getNetwork();
    localChainId = net.chainId;

    domain = {
      name: 'EvidenceAnchor',
      version: '1',
      chainId: localChainId,
      verifyingContract: contractAddress
    };

    // Register source with authorized Vault Signer address
    await contract.connect(owner).registerSource(sourceId, vaultSigner.address);
  });

  async function signAndAnchor(commitment: BatchCommitment) {
    const signature = await vaultSigner.signTypedData(
      domain,
      BATCH_COMMITMENT_EIP712_TYPES,
      commitment
    );
    const tx = await contract.connect(relayer).anchorBatch(commitment, signature);
    const receipt = await tx.wait();
    return { receipt, signature };
  }

  it('1. anchors local batches and builds verifiable Tier 2 checkpoint digest', async function () {
    // Anchor Batch 1 (seq 1..20)
    const batch1: BatchCommitment = {
      sourceId,
      sequenceStart: 1n,
      sequenceEnd: 20n,
      leafCount: 20n,
      merkleRoot: '0x1111111111111111111111111111111111111111111111111111111111111111',
      previousCheckpointHash: GENESIS_CHECKPOINT_HASH
    };
    await signAndAnchor(batch1);
    const batch1Hash = hashCommitmentHex(batch1);

    // Anchor Batch 2 (seq 21..40)
    const batch2: BatchCommitment = {
      sourceId,
      sequenceStart: 21n,
      sequenceEnd: 40n,
      leafCount: 20n,
      merkleRoot: '0x2222222222222222222222222222222222222222222222222222222222222222',
      previousCheckpointHash: batch1Hash
    };
    await signAndAnchor(batch2);
    const batch2Hash = hashCommitmentHex(batch2);

    // Anchor Batch 3 (seq 41..60)
    const batch3: BatchCommitment = {
      sourceId,
      sequenceStart: 41n,
      sequenceEnd: 60n,
      leafCount: 20n,
      merkleRoot: '0x3333333333333333333333333333333333333333333333333333333333333333',
      previousCheckpointHash: batch2Hash
    };
    const { receipt: r3 } = await signAndAnchor(batch3);

    // 1. Verify local chain analysis
    const analysis = checkLocalChain([batch1, batch2, batch3]);
    expect(analysis.valid).to.be.true;
    expect(analysis.latestSequence).to.equal(60n);
    expect(analysis.totalLeaves).to.equal(60n);
    expect(analysis.latestBatchRoot).to.equal(batch3.merkleRoot);

    // 2. Build Public Checkpoint #1 (Tier 2 consensus payload)
    const latestBlock = await ethers.provider.getBlock(r3.blockNumber);
    const checkpoint1Input = {
      previousCheckpointDigest: GENESIS_CHECKPOINT_DIGEST,
      localChainId,
      localBlockNumber: r3.blockNumber,
      localBlockHash: latestBlock.hash,
      latestBatchRoot: batch3.merkleRoot,
      latestSequence: 60n,
      contractAddress
    };

    const checkpoint1 = buildCheckpoint(checkpoint1Input);
    expect(checkpoint1.digestHex).to.be.a('string');
    expect(checkpoint1.preimage.length).to.equal(165);

    // Verify checkpoint matches expected digest
    const isValid = checkCheckpoint(checkpoint1Input, checkpoint1.digestHex);
    expect(isValid).to.be.true;
  });

  it('2. detects chain reset / rewritten history when local history diverges from public checkpoint', async function () {
    // Phase A: Honest initial local chain (Batches 1..3)
    const batch1: BatchCommitment = {
      sourceId,
      sequenceStart: 1n,
      sequenceEnd: 10n,
      leafCount: 10n,
      merkleRoot: '0x1010101010101010101010101010101010101010101010101010101010101010',
      previousCheckpointHash: GENESIS_CHECKPOINT_HASH
    };
    await signAndAnchor(batch1);
    const b1Hash = hashCommitmentHex(batch1);

    const batch2: BatchCommitment = {
      sourceId,
      sequenceStart: 11n,
      sequenceEnd: 20n,
      leafCount: 10n,
      merkleRoot: '0x2020202020202020202020202020202020202020202020202020202020202020',
      previousCheckpointHash: b1Hash
    };
    await signAndAnchor(batch2);
    const b2Hash = hashCommitmentHex(batch2);

    const batch3: BatchCommitment = {
      sourceId,
      sequenceStart: 21n,
      sequenceEnd: 30n,
      leafCount: 10n,
      merkleRoot: '0x3030303030303030303030303030303030303030303030303030303030303030',
      previousCheckpointHash: b2Hash
    };
    const { receipt: r3 } = await signAndAnchor(batch3);

    // Honest checkpoint anchored to Tier 2 (Quai Orchard)
    const honestBlock = await ethers.provider.getBlock(r3.blockNumber);
    const honestCheckpoint = buildCheckpoint({
      previousCheckpointDigest: GENESIS_CHECKPOINT_DIGEST,
      localChainId,
      localBlockNumber: r3.blockNumber,
      localBlockHash: honestBlock.hash,
      latestBatchRoot: batch3.merkleRoot,
      latestSequence: 30n,
      contractAddress
    });
    const publicAnchoredDigest = honestCheckpoint.digestHex;

    // Phase B: Simulate Attacker Compromising Local Node & Rewriting History
    // Attacker restarts local node or modifies local database from seq 11,
    // erasing evidence of compromise contained in honest batch 2.
    const forgedBatch2: BatchCommitment = {
      sourceId,
      sequenceStart: 11n,
      sequenceEnd: 20n,
      leafCount: 10n,
      merkleRoot: '0xbad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0', // Tampered Merkle Root
      previousCheckpointHash: b1Hash
    };
    const forgedB2Hash = hashCommitmentHex(forgedBatch2);

    const forgedBatch3: BatchCommitment = {
      sourceId,
      sequenceStart: 21n,
      sequenceEnd: 30n,
      leafCount: 10n,
      merkleRoot: '0xbad1bad1bad1bad1bad1bad1bad1bad1bad1bad1bad1bad1bad1bad1bad1bad1',
      previousCheckpointHash: forgedB2Hash
    };

    // The attacker's chain might internally look continuous:
    const forgedChainAnalysis = checkLocalChain([batch1, forgedBatch2, forgedBatch3]);
    expect(forgedChainAnalysis.valid).to.be.true; // Internally consistent locally

    // BUT when the Auditor Verifier (Person 4 CLI) checks against the PUBLIC Quai Checkpoint:
    const forgedStateCheck = checkCheckpoint(
      {
        previousCheckpointDigest: GENESIS_CHECKPOINT_DIGEST,
        localChainId,
        localBlockNumber: r3.blockNumber,
        localBlockHash: honestBlock.hash,
        latestBatchRoot: forgedBatch3.merkleRoot, // Attacker's rewritten root
        latestSequence: 30n,
        contractAddress
      },
      publicAnchoredDigest // Public immutable Quai checkpoint
    );

    // CRITICAL SECURITY ASSERTION:
    // The public checkpoint digest FAILS to match the rewritten local state!
    expect(forgedStateCheck).to.be.false;
    console.log('      ✔ Chain reset detected: rewritten local history rejected by public checkpoint');
  });

  it('3. enforces checkpoint continuity chaining across successive epochs', async function () {
    // Epoch 1 Checkpoint
    const cp1Input = {
      previousCheckpointDigest: GENESIS_CHECKPOINT_DIGEST,
      localChainId,
      localBlockNumber: 100n,
      localBlockHash: '0x' + Buffer.alloc(32, 0x11).toString('hex'),
      latestBatchRoot: '0x' + Buffer.alloc(32, 0xaa).toString('hex'),
      latestSequence: 500n,
      contractAddress
    };
    const cp1 = buildCheckpoint(cp1Input);

    // Epoch 2 Checkpoint chained to Epoch 1
    const cp2Input = {
      previousCheckpointDigest: cp1.digestHex,
      localChainId,
      localBlockNumber: 200n,
      localBlockHash: '0x' + Buffer.alloc(32, 0x22).toString('hex'),
      latestBatchRoot: '0x' + Buffer.alloc(32, 0xbb).toString('hex'),
      latestSequence: 1000n,
      contractAddress
    };
    const cp2 = buildCheckpoint(cp2Input);

    // Verify continuity
    expect(verifyCheckpointContinuity(cp2Input, cp1.digestHex)).to.be.true;

    // Reject broken continuity (e.g. pointing to arbitrary hash or genesis)
    expect(verifyCheckpointContinuity(cp2Input, GENESIS_CHECKPOINT_DIGEST)).to.be.false;
    const fakeDigest = '0x' + Buffer.alloc(32, 0xfe).toString('hex');
    expect(verifyCheckpointContinuity(cp2Input, fakeDigest)).to.be.false;
  });

  it('4. rejects local chain analysis when sequence continuity or leaf count is broken', function () {
    const b1: BatchCommitment = {
      sourceId,
      sequenceStart: 1n,
      sequenceEnd: 10n,
      leafCount: 10n,
      merkleRoot: '0x' + Buffer.alloc(32, 1).toString('hex'),
      previousCheckpointHash: GENESIS_CHECKPOINT_HASH
    };
    const b1Hash = hashCommitmentHex(b1);

    // Gap: starts at 12 instead of 11
    const gapB2: BatchCommitment = {
      sourceId,
      sequenceStart: 12n,
      sequenceEnd: 20n,
      leafCount: 9n,
      merkleRoot: '0x' + Buffer.alloc(32, 2).toString('hex'),
      previousCheckpointHash: b1Hash
    };
    expect(checkLocalChain([b1, gapB2]).valid).to.be.false;

    // Overlap: starts at 10 instead of 11
    const overlapB2: BatchCommitment = {
      sourceId,
      sequenceStart: 10n,
      sequenceEnd: 20n,
      leafCount: 11n,
      merkleRoot: '0x' + Buffer.alloc(32, 2).toString('hex'),
      previousCheckpointHash: b1Hash
    };
    expect(checkLocalChain([b1, overlapB2]).valid).to.be.false;

    // Non-genesis start at 2
    const nonGenB1: BatchCommitment = {
      ...b1,
      sequenceStart: 2n
    };
    expect(checkLocalChain([nonGenB1]).valid).to.be.false;
  });
});
