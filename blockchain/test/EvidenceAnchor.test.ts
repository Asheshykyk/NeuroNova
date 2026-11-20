import { expect } from 'chai';
import hardhat from 'hardhat';
const { ethers } = hardhat;
import {
  BATCH_COMMITMENT_EIP712_TYPES,
  computeCommitmentStructHashHex,
  computeDomainSeparatorHex,
  GENESIS_CHECKPOINT_HASH
} from '../../packages/core/src/commitment.ts';
import {
  buildMerkleTree,
  generateMerkleProof
} from '../../packages/core/src/merkle.ts';
import {
  TEST_BATCH_1,
  TEST_BATCH_2,
  TEST_LEAF_HASHES,
  TEST_VAULT_SIGNER_KEY
} from '../../packages/core/src/test-vectors.ts';
import type { BatchCommitment } from '../../packages/core/src/types.ts';

describe('EvidenceAnchor Smart Contract - Phase 2 Invariants & Negative Tests', function () {
  let contract: any;
  let owner: any;
  let relayer: any;
  let vaultSigner: any;
  let unauthorizedSigner: any;

  const sourceId = '0x736f757263652d30310000000000000000000000000000000000000000000000'; // "source-01"
  const unregisteredSourceId = '0x736f757263652d39390000000000000000000000000000000000000000000000'; // "source-99"
  let domain: any;

  beforeEach(async function () {
    [owner, relayer, unauthorizedSigner] = await ethers.getSigners();
    vaultSigner = new ethers.Wallet(TEST_VAULT_SIGNER_KEY, ethers.provider);

    const EvidenceAnchor = await ethers.getContractFactory('EvidenceAnchor');
    contract = await EvidenceAnchor.deploy();
    await contract.waitForDeployment();

    const contractAddress = await contract.getAddress();
    domain = {
      name: 'EvidenceAnchor',
      version: '1',
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: contractAddress
    };
  });

  describe('1. Source Registration & Revocation (ASSUMPTION A5)', function () {
    it('allows owner to register a new source [measures gasUsed]', async function () {
      const tx = await contract.connect(owner).registerSource(sourceId, vaultSigner.address);
      const receipt = await tx.wait();

      console.log(`      Gas used (registerSource): ${receipt.gasUsed.toString()} units`);
      expect(receipt.gasUsed).to.be.gt(0n);

      await expect(tx)
        .to.emit(contract, 'SourceRegistered')
        .withArgs(sourceId, vaultSigner.address);

      const src = await contract.getSource(sourceId);
      expect(src.signer).to.equal(vaultSigner.address);
      expect(src.registered).to.be.true;
      expect(src.revoked).to.be.false;
      expect(src.batchCount).to.equal(0n);
    });

    it('negative: rejects source overwrite (ASSUMPTION A5: no overwrite/delete function)', async function () {
      await contract.connect(owner).registerSource(sourceId, vaultSigner.address);
      const expectedRevert = 'Source already registered; overwrite not permitted (A5)';

      await expect(
        contract.connect(owner).registerSource(sourceId, relayer.address)
      ).to.be.revertedWith(expectedRevert);

      console.log(`      [Revert Asserted]: "${expectedRevert}"`);
    });

    it('negative: rejects registration from non-owner accounts', async function () {
      const expectedRevert = 'Caller is not contract owner';

      await expect(
        contract.connect(relayer).registerSource(sourceId, vaultSigner.address)
      ).to.be.revertedWith(expectedRevert);

      console.log(`      [Revert Asserted]: "${expectedRevert}"`);
    });

    it('allows owner to revoke a source [measures gasUsed]', async function () {
      await contract.connect(owner).registerSource(sourceId, vaultSigner.address);
      const tx = await contract.connect(owner).revokeSource(sourceId);
      const receipt = await tx.wait();

      console.log(`      Gas used (revokeSource): ${receipt.gasUsed.toString()} units`);
      expect(receipt.gasUsed).to.be.gt(0n);

      await expect(tx)
        .to.emit(contract, 'SourceRevoked')
        .withArgs(sourceId);

      const src = await contract.getSource(sourceId);
      expect(src.revoked).to.be.true;
    });

    it('negative: rejects revocation from non-owner accounts', async function () {
      await contract.connect(owner).registerSource(sourceId, vaultSigner.address);
      const expectedRevert = 'Caller is not contract owner';

      await expect(
        contract.connect(relayer).revokeSource(sourceId)
      ).to.be.revertedWith(expectedRevert);

      console.log(`      [Revert Asserted]: "${expectedRevert}"`);
    });

    it('negative: rejects revoking an unregistered source', async function () {
      const expectedRevert = 'Source not registered';

      await expect(
        contract.connect(owner).revokeSource(unregisteredSourceId)
      ).to.be.revertedWith(expectedRevert);

      console.log(`      [Revert Asserted]: "${expectedRevert}"`);
    });

    it('negative: rejects revoking an already revoked source', async function () {
      await contract.connect(owner).registerSource(sourceId, vaultSigner.address);
      await contract.connect(owner).revokeSource(sourceId);
      const expectedRevert = 'Source is already revoked';

      await expect(
        contract.connect(owner).revokeSource(sourceId)
      ).to.be.revertedWith(expectedRevert);

      console.log(`      [Revert Asserted]: "${expectedRevert}"`);
    });
  });

  describe('2. EIP-712 Signing, Signer Verification & Field Alteration (LOCKED)', function () {
    beforeEach(async function () {
      await contract.connect(owner).registerSource(sourceId, vaultSigner.address);
    });

    it('accepts anchorBatch submitted by separate relayer with valid vault signature [measures gasUsed]', async function () {
      const commitment = { ...TEST_BATCH_1, sourceId };
      const signature = await vaultSigner.signTypedData(domain, BATCH_COMMITMENT_EIP712_TYPES, commitment);
      const expectedStructHash = computeCommitmentStructHashHex(commitment);

      // Relayer submits transaction (msg.sender != vaultSigner)
      const tx = await contract.connect(relayer).anchorBatch(commitment, signature);
      const receipt = await tx.wait();

      console.log(`      Gas used (anchorBatch Genesis 1): ${receipt.gasUsed.toString()} units`);
      expect(receipt.gasUsed).to.be.gt(0n);

      await expect(tx).to.emit(contract, 'BatchAnchored');
      expect(await contract.isBatchAnchored(expectedStructHash)).to.be.true;

      // Verify stored data matches via getBatch
      const stored = await contract.getBatch(expectedStructHash);
      expect(stored.sourceId).to.equal(commitment.sourceId);
      expect(stored.sequenceStart).to.equal(commitment.sequenceStart);
      expect(stored.sequenceEnd).to.equal(commitment.sequenceEnd);
      expect(stored.leafCount).to.equal(commitment.leafCount);
      expect(stored.merkleRoot).to.equal(commitment.merkleRoot);
      expect(stored.previousCheckpointHash).to.equal(commitment.previousCheckpointHash);

      // Verify stored data matches via getLatest
      const latest = await contract.getLatest(sourceId);
      expect(latest.commitmentHash).to.equal(expectedStructHash);
      expect(latest.commitment.sequenceStart).to.equal(1n);
      expect(latest.commitment.sequenceEnd).to.equal(3n);
    });

    it('negative: rejects anchorBatch if source is unregistered', async function () {
      const commitment = { ...TEST_BATCH_1, sourceId: unregisteredSourceId };
      const signature = await vaultSigner.signTypedData(domain, BATCH_COMMITMENT_EIP712_TYPES, commitment);
      const expectedRevert = 'Source not registered';

      await expect(
        contract.connect(relayer).anchorBatch(commitment, signature)
      ).to.be.revertedWith(expectedRevert);

      console.log(`      [Revert Asserted]: "${expectedRevert}"`);
    });

    it('negative: rejects anchorBatch if source is revoked (stops new anchors)', async function () {
      await contract.connect(owner).revokeSource(sourceId);
      const commitment = { ...TEST_BATCH_1, sourceId };
      const signature = await vaultSigner.signTypedData(domain, BATCH_COMMITMENT_EIP712_TYPES, commitment);
      const expectedRevert = 'Source is revoked';

      await expect(
        contract.connect(relayer).anchorBatch(commitment, signature)
      ).to.be.revertedWith(expectedRevert);

      console.log(`      [Revert Asserted]: "${expectedRevert}"`);
    });

    it('negative: rejects anchorBatch if signature is produced by unauthorized signer', async function () {
      const commitment = { ...TEST_BATCH_1, sourceId };
      const badSignature = await unauthorizedSigner.signTypedData(domain, BATCH_COMMITMENT_EIP712_TYPES, commitment);
      const expectedRevert = 'Invalid signer: does not match registered vault signer';

      await expect(
        contract.connect(relayer).anchorBatch(commitment, badSignature)
      ).to.be.revertedWith(expectedRevert);

      console.log(`      [Revert Asserted]: "${expectedRevert}"`);
    });

    it('negative: rejects anchorBatch when field is altered after signing (tampered merkleRoot)', async function () {
      const validCommitment = { ...TEST_BATCH_1, sourceId };
      // Vault signer signs the original valid commitment
      const signature = await vaultSigner.signTypedData(domain, BATCH_COMMITMENT_EIP712_TYPES, validCommitment);

      // Attacker tampers with merkleRoot before submitting to blockchain
      const tamperedCommitment: BatchCommitment = {
        ...validCommitment,
        merkleRoot: '0xbad0000000000000000000000000000000000000000000000000000000000bad'
      };
      const expectedRevert = 'Invalid signer: does not match registered vault signer';

      await expect(
        contract.connect(relayer).anchorBatch(tamperedCommitment, signature)
      ).to.be.revertedWith(expectedRevert);

      console.log(`      [Revert Asserted]: "${expectedRevert}"`);
    });

    it('negative: rejects anchorBatch when field is altered after signing (tampered sequenceEnd)', async function () {
      const validCommitment = { ...TEST_BATCH_1, sourceId };
      const signature = await vaultSigner.signTypedData(domain, BATCH_COMMITMENT_EIP712_TYPES, validCommitment);

      // Attacker tampers sequenceEnd
      const tamperedCommitment: BatchCommitment = {
        ...validCommitment,
        sequenceEnd: 4n,
        leafCount: 4n // matching range, but digest altered
      };
      const expectedRevert = 'Invalid signer: does not match registered vault signer';

      await expect(
        contract.connect(relayer).anchorBatch(tamperedCommitment, signature)
      ).to.be.revertedWith(expectedRevert);

      console.log(`      [Revert Asserted]: "${expectedRevert}"`);
    });
  });

  describe('3. Sequence Continuity, Range & Contiguity Invariants (ASSUMPTION A3)', function () {
    beforeEach(async function () {
      await contract.connect(owner).registerSource(sourceId, vaultSigner.address);
    });

    it('negative: rejects invalid sequence range where sequenceEnd < sequenceStart', async function () {
      const badRange = {
        ...TEST_BATCH_1,
        sourceId,
        sequenceStart: 5n,
        sequenceEnd: 4n,
        leafCount: 0n
      };
      const sig = await vaultSigner.signTypedData(domain, BATCH_COMMITMENT_EIP712_TYPES, badRange);
      const expectedRevert = 'Invalid sequence: start > end';

      await expect(
        contract.connect(relayer).anchorBatch(badRange, sig)
      ).to.be.revertedWith(expectedRevert);

      console.log(`      [Revert Asserted]: "${expectedRevert}"`);
    });

    it('negative: rejects leafCount mismatch with sequence range (leafCount != end - start + 1)', async function () {
      const badCount = {
        ...TEST_BATCH_1,
        sourceId,
        sequenceStart: 1n,
        sequenceEnd: 3n,
        leafCount: 2n // Expected 3n
      };
      const sig = await vaultSigner.signTypedData(domain, BATCH_COMMITMENT_EIP712_TYPES, badCount);
      const expectedRevert = 'leafCount mismatch with sequence range';

      await expect(
        contract.connect(relayer).anchorBatch(badCount, sig)
      ).to.be.revertedWith(expectedRevert);

      console.log(`      [Revert Asserted]: "${expectedRevert}"`);
    });

    it('negative: rejects genesis batch starting at seq 2 (A3: first batch starts at seq 1)', async function () {
      const badGenesis = {
        ...TEST_BATCH_1,
        sourceId,
        sequenceStart: 2n,
        sequenceEnd: 4n,
        leafCount: 3n
      };
      const sig = await vaultSigner.signTypedData(domain, BATCH_COMMITMENT_EIP712_TYPES, badGenesis);
      const expectedRevert = 'First batch must start at sequence 1 (A3)';

      await expect(
        contract.connect(relayer).anchorBatch(badGenesis, sig)
      ).to.be.revertedWith(expectedRevert);

      console.log(`      [Revert Asserted]: "${expectedRevert}"`);
    });

    it('negative: rejects genesis batch with non-zero previousCheckpointHash (A3: genesis zero)', async function () {
      const badGenesis = {
        ...TEST_BATCH_1,
        sourceId,
        previousCheckpointHash: '0x1111111111111111111111111111111111111111111111111111111111111111'
      };
      const sig = await vaultSigner.signTypedData(domain, BATCH_COMMITMENT_EIP712_TYPES, badGenesis);
      const expectedRevert = 'Genesis previousCheckpointHash must be zero (A3)';

      await expect(
        contract.connect(relayer).anchorBatch(badGenesis, sig)
      ).to.be.revertedWith(expectedRevert);

      console.log(`      [Revert Asserted]: "${expectedRevert}"`);
    });

    it('anchors Batch 1 and successfully chains Batch 2 with struct hash binding [measures gasUsed]', async function () {
      // 1. Anchor Batch 1 (seq 1..3)
      const batch1 = { ...TEST_BATCH_1, sourceId };
      const sig1 = await vaultSigner.signTypedData(domain, BATCH_COMMITMENT_EIP712_TYPES, batch1);
      const tx1 = await contract.connect(relayer).anchorBatch(batch1, sig1);
      const receipt1 = await tx1.wait();
      console.log(`      Gas used (Batch 1 anchor): ${receipt1.gasUsed.toString()} units`);

      const structHash1 = computeCommitmentStructHashHex(batch1);

      // 2. Anchor Batch 2 (seq 4..5, previousCheckpointHash = structHash1)
      const batch2 = {
        ...TEST_BATCH_2,
        sourceId,
        previousCheckpointHash: structHash1
      };
      const sig2 = await vaultSigner.signTypedData(domain, BATCH_COMMITMENT_EIP712_TYPES, batch2);
      const tx2 = await contract.connect(relayer).anchorBatch(batch2, sig2);
      const receipt2 = await tx2.wait();
      console.log(`      Gas used (Batch 2 chained anchor): ${receipt2.gasUsed.toString()} units`);

      const src = await contract.getSource(sourceId);
      expect(src.batchCount).to.equal(2n);
      expect(src.lastSequenceEnd).to.equal(5n);
      expect(src.lastCheckpointHash).to.equal(computeCommitmentStructHashHex(batch2));
    });

    it('negative: rejects Batch 2 if sequence continuity is broken (gap)', async function () {
      const batch1 = { ...TEST_BATCH_1, sourceId };
      const sig1 = await vaultSigner.signTypedData(domain, BATCH_COMMITMENT_EIP712_TYPES, batch1);
      await contract.connect(relayer).anchorBatch(batch1, sig1);
      const structHash1 = computeCommitmentStructHashHex(batch1);

      // Gap: starts at 5 instead of 4
      const gapBatch = {
        ...TEST_BATCH_2,
        sourceId,
        sequenceStart: 5n,
        sequenceEnd: 6n,
        leafCount: 2n,
        previousCheckpointHash: structHash1
      };
      const gapSig = await vaultSigner.signTypedData(domain, BATCH_COMMITMENT_EIP712_TYPES, gapBatch);
      const expectedRevert = 'Sequence continuity broken: sequenceStart != lastSequenceEnd + 1';

      await expect(
        contract.connect(relayer).anchorBatch(gapBatch, gapSig)
      ).to.be.revertedWith(expectedRevert);

      console.log(`      [Revert Asserted]: "${expectedRevert}"`);
    });

    it('negative: rejects Batch 2 if sequence overlaps (start <= lastSequenceEnd)', async function () {
      const batch1 = { ...TEST_BATCH_1, sourceId };
      const sig1 = await vaultSigner.signTypedData(domain, BATCH_COMMITMENT_EIP712_TYPES, batch1);
      await contract.connect(relayer).anchorBatch(batch1, sig1);
      const structHash1 = computeCommitmentStructHashHex(batch1);

      // Overlap: starts at 3 (lastSequenceEnd was 3)
      const overlapBatch = {
        ...TEST_BATCH_2,
        sourceId,
        sequenceStart: 3n,
        sequenceEnd: 4n,
        leafCount: 2n,
        previousCheckpointHash: structHash1
      };
      const overlapSig = await vaultSigner.signTypedData(domain, BATCH_COMMITMENT_EIP712_TYPES, overlapBatch);
      const expectedRevert = 'Sequence continuity broken: sequenceStart != lastSequenceEnd + 1';

      await expect(
        contract.connect(relayer).anchorBatch(overlapBatch, overlapSig)
      ).to.be.revertedWith(expectedRevert);

      console.log(`      [Revert Asserted]: "${expectedRevert}"`);
    });

    it('negative: rejects Batch 2 if previousCheckpointHash does not match Batch 1 struct hash', async function () {
      const batch1 = { ...TEST_BATCH_1, sourceId };
      const sig1 = await vaultSigner.signTypedData(domain, BATCH_COMMITMENT_EIP712_TYPES, batch1);
      await contract.connect(relayer).anchorBatch(batch1, sig1);

      // Wrong checkpoint hash
      const wrongHashBatch = {
        ...TEST_BATCH_2,
        sourceId,
        previousCheckpointHash: GENESIS_CHECKPOINT_HASH
      };
      const sig2 = await vaultSigner.signTypedData(domain, BATCH_COMMITMENT_EIP712_TYPES, wrongHashBatch);
      const expectedRevert = 'previousCheckpointHash mismatch: does not match previous commitment struct hash (A3)';

      await expect(
        contract.connect(relayer).anchorBatch(wrongHashBatch, sig2)
      ).to.be.revertedWith(expectedRevert);

      console.log(`      [Revert Asserted]: "${expectedRevert}"`);
    });
  });

  describe('4. Duplicate / Replay Protection & Immutability Verification (LOCKED & A5)', function () {
    beforeEach(async function () {
      await contract.connect(owner).registerSource(sourceId, vaultSigner.address);
    });

    it('negative: rejects duplicate submission of an already anchored batch', async function () {
      const commitment = { ...TEST_BATCH_1, sourceId };
      const signature = await vaultSigner.signTypedData(domain, BATCH_COMMITMENT_EIP712_TYPES, commitment);

      await contract.connect(relayer).anchorBatch(commitment, signature);

      // Attempt replay
      const expectedRevert = 'Duplicate batch: commitment already anchored';
      await expect(
        contract.connect(relayer).anchorBatch(commitment, signature)
      ).to.be.revertedWith(expectedRevert);

      console.log(`      [Revert Asserted]: "${expectedRevert}"`);
    });

    it('confirms immutability: revoking source stops new anchors but never invalidates existing batches', async function () {
      const commitment = { ...TEST_BATCH_1, sourceId };
      const signature = await vaultSigner.signTypedData(domain, BATCH_COMMITMENT_EIP712_TYPES, commitment);
      await contract.connect(relayer).anchorBatch(commitment, signature);
      const structHash = computeCommitmentStructHashHex(commitment);

      // Revoke the source
      await contract.connect(owner).revokeSource(sourceId);

      // Existing batch remains fully intact and verifiable
      expect(await contract.isBatchAnchored(structHash)).to.be.true;
      const stored = await contract.getBatch(structHash);
      expect(stored.sourceId).to.equal(commitment.sourceId);

      // New anchors for this source are strictly rejected
      const nextBatch = {
        ...TEST_BATCH_2,
        sourceId,
        previousCheckpointHash: structHash
      };
      const nextSig = await vaultSigner.signTypedData(domain, BATCH_COMMITMENT_EIP712_TYPES, nextBatch);
      const expectedRevert = 'Source is revoked';

      await expect(
        contract.connect(relayer).anchorBatch(nextBatch, nextSig)
      ).to.be.revertedWith(expectedRevert);

      console.log(`      [Revert Asserted]: "${expectedRevert}"`);
    });
  });

  describe('5. Polygon Amoy Checkpoint Mode & On-chain Merkle Verification', function () {
    beforeEach(async function () {
      await contract.connect(owner).registerSource(sourceId, vaultSigner.address);
    });

    it('anchors checkpoint digest stored in merkleRoot field (ASSUMPTION A4) [measures gasUsed]', async function () {
      const amoyCheckpointDigest = '0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
      const amoyBatch = {
        sourceId,
        sequenceStart: 1n,
        sequenceEnd: 50n,
        leafCount: 50n,
        merkleRoot: amoyCheckpointDigest, // Checkpoint digest in merkleRoot field (A4)
        previousCheckpointHash: GENESIS_CHECKPOINT_HASH
      };
      const signature = await vaultSigner.signTypedData(domain, BATCH_COMMITMENT_EIP712_TYPES, amoyBatch);
      const tx = await contract.connect(relayer).anchorBatch(amoyBatch, signature);
      const receipt = await tx.wait();

      console.log(`      Gas used (Amoy checkpoint anchor): ${receipt.gasUsed.toString()} units`);
      expect(receipt.gasUsed).to.be.gt(0n);

      const latest = await contract.getLatest(sourceId);
      expect(latest.commitment.merkleRoot).to.equal(amoyCheckpointDigest);
    });

    it('verifies inclusion proof for odd promoted node on-chain [measures gasUsed]', async function () {
      const leaves = TEST_LEAF_HASHES.slice(0, 3);
      const { root, layers } = buildMerkleTree(leaves);
      const proof = generateMerkleProof(layers, 2); // Leaf 2 is promoted odd node

      // Convert proof steps for contract: promoted steps are passed as bytes32(0)
      const contractProof = proof.steps.map(s => (s.sibling ? s.sibling : ethers.ZeroHash));
      const rootHex = '0x' + root.toString('hex');

      const isValid = await contract.verifyInclusionProof(
        proof.leafHash,
        contractProof,
        2n,
        rootHex
      );
      expect(isValid).to.be.true;

      const badValid = await contract.verifyInclusionProof(
        proof.leafHash,
        contractProof,
        2n,
        ethers.ZeroHash // wrong root
      );
      expect(badValid).to.be.false;
    });
  });
});
