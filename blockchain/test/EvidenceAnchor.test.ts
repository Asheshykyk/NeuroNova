import { expect } from 'chai';
import hardhat from 'hardhat';
const { ethers } = hardhat;
import {
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
  TEST_EVENTS,
  TEST_LEAF_HASHES,
  TEST_VAULT_SIGNER_KEY
} from '../../packages/core/src/test-vectors.ts';

describe('EvidenceAnchor Smart Contract (Problem B3)', function () {
  let contract: any;
  let owner: any;
  let relayer: any;
  let vaultSigner: any;
  let unauthorizedSigner: any;

  const sourceId = '0x736f757263652d30310000000000000000000000000000000000000000000000'; // "source-01"
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

  describe('Source Registration & Revocation (ASSUMPTION A5)', function () {
    it('allows owner to register a new source', async function () {
      await expect(contract.connect(owner).registerSource(sourceId, vaultSigner.address))
        .to.emit(contract, 'SourceRegistered')
        .withArgs(sourceId, vaultSigner.address);

      const src = await contract.getSource(sourceId);
      expect(src.signer).to.equal(vaultSigner.address);
      expect(src.registered).to.be.true;
      expect(src.revoked).to.be.false;
      expect(src.batchCount).to.equal(0n);
    });

    it('rejects source overwrite (ASSUMPTION A5: no overwrite/delete function)', async function () {
      await contract.connect(owner).registerSource(sourceId, vaultSigner.address);
      await expect(
        contract.connect(owner).registerSource(sourceId, relayer.address)
      ).to.be.revertedWith('Source already registered; overwrite not permitted (A5)');
    });

    it('allows owner to revoke a source, preventing subsequent anchors', async function () {
      await contract.connect(owner).registerSource(sourceId, vaultSigner.address);
      await expect(contract.connect(owner).revokeSource(sourceId))
        .to.emit(contract, 'SourceRevoked')
        .withArgs(sourceId);

      const src = await contract.getSource(sourceId);
      expect(src.revoked).to.be.true;
    });

    it('rejects registration from non-owner accounts', async function () {
      await expect(
        contract.connect(relayer).registerSource(sourceId, vaultSigner.address)
      ).to.be.revertedWith('Caller is not contract owner');
    });
  });

  describe('EIP-712 Signing & Relayer Separation (LOCKED)', function () {
    beforeEach(async function () {
      await contract.connect(owner).registerSource(sourceId, vaultSigner.address);
    });

    it('accepts anchorBatch submitted by separate relayer with valid vault signature', async function () {
      const commitment = { ...TEST_BATCH_1, sourceId };

      // Vault signs EIP-712 typed data
      const types = {
        BatchCommitment: [
          { name: 'sourceId', type: 'bytes32' },
          { name: 'sequenceStart', type: 'uint64' },
          { name: 'sequenceEnd', type: 'uint64' },
          { name: 'leafCount', type: 'uint64' },
          { name: 'merkleRoot', type: 'bytes32' },
          { name: 'previousCheckpointHash', type: 'bytes32' }
        ]
      };
      const signature = await vaultSigner.signTypedData(domain, types, commitment);

      // Relayer submits transaction (msg.sender != vaultSigner)
      const tx = await contract.connect(relayer).anchorBatch(commitment, signature);
      const receipt = await tx.wait();

      const expectedStructHash = computeCommitmentStructHashHex(commitment);
      expect(await contract.isBatchAnchored(expectedStructHash)).to.be.true;

      const latest = await contract.getLatestBatch(sourceId);
      expect(latest.commitmentHash).to.equal(expectedStructHash);
      expect(latest.commitment.sequenceStart).to.equal(1n);
      expect(latest.commitment.sequenceEnd).to.equal(3n);
    });

    it('rejects anchorBatch if signature is produced by unauthorized signer', async function () {
      const commitment = { ...TEST_BATCH_1, sourceId };
      const types = {
        BatchCommitment: [
          { name: 'sourceId', type: 'bytes32' },
          { name: 'sequenceStart', type: 'uint64' },
          { name: 'sequenceEnd', type: 'uint64' },
          { name: 'leafCount', type: 'uint64' },
          { name: 'merkleRoot', type: 'bytes32' },
          { name: 'previousCheckpointHash', type: 'bytes32' }
        ]
      };
      // Unauthorized signer
      const badSignature = await unauthorizedSigner.signTypedData(domain, types, commitment);

      await expect(
        contract.connect(relayer).anchorBatch(commitment, badSignature)
      ).to.be.revertedWith('Invalid signer: does not match registered vault signer');
    });
  });

  describe('Sequence Continuity & Checkpoint Chaining (ASSUMPTION A3)', function () {
    const types = {
      BatchCommitment: [
        { name: 'sourceId', type: 'bytes32' },
        { name: 'sequenceStart', type: 'uint64' },
        { name: 'sequenceEnd', type: 'uint64' },
        { name: 'leafCount', type: 'uint64' },
        { name: 'merkleRoot', type: 'bytes32' },
        { name: 'previousCheckpointHash', type: 'bytes32' }
      ]
    };

    beforeEach(async function () {
      await contract.connect(owner).registerSource(sourceId, vaultSigner.address);
    });

    it('rejects genesis batch starting at seq 2 (A3: first batch starts at seq 1)', async function () {
      const badGenesis = {
        ...TEST_BATCH_1,
        sourceId,
        sequenceStart: 2n,
        sequenceEnd: 4n,
        leafCount: 3n
      };
      const sig = await vaultSigner.signTypedData(domain, types, badGenesis);
      await expect(
        contract.connect(relayer).anchorBatch(badGenesis, sig)
      ).to.be.revertedWith('First batch must start at sequence 1 (A3)');
    });

    it('rejects genesis batch with non-zero previousCheckpointHash (A3: genesis zero)', async function () {
      const badGenesis = {
        ...TEST_BATCH_1,
        sourceId,
        previousCheckpointHash: '0x1111111111111111111111111111111111111111111111111111111111111111'
      };
      const sig = await vaultSigner.signTypedData(domain, types, badGenesis);
      await expect(
        contract.connect(relayer).anchorBatch(badGenesis, sig)
      ).to.be.revertedWith('Genesis previousCheckpointHash must be zero (A3)');
    });

    it('anchors Batch 1 and successfully chains Batch 2 with struct hash binding', async function () {
      // 1. Anchor Batch 1 (seq 1..3)
      const batch1 = { ...TEST_BATCH_1, sourceId };
      const sig1 = await vaultSigner.signTypedData(domain, types, batch1);
      await contract.connect(relayer).anchorBatch(batch1, sig1);
      const structHash1 = computeCommitmentStructHashHex(batch1);

      // 2. Anchor Batch 2 (seq 4..5, previousCheckpointHash = structHash1)
      const batch2 = {
        ...TEST_BATCH_2,
        sourceId,
        previousCheckpointHash: structHash1
      };
      const sig2 = await vaultSigner.signTypedData(domain, types, batch2);
      await contract.connect(relayer).anchorBatch(batch2, sig2);

      const src = await contract.getSource(sourceId);
      expect(src.batchCount).to.equal(2n);
      expect(src.lastSequenceEnd).to.equal(5n);
      expect(src.lastCheckpointHash).to.equal(computeCommitmentStructHashHex(batch2));
    });

    it('rejects Batch 2 if sequence continuity is broken (gap)', async function () {
      const batch1 = { ...TEST_BATCH_1, sourceId };
      const sig1 = await vaultSigner.signTypedData(domain, types, batch1);
      await contract.connect(relayer).anchorBatch(batch1, sig1);
      const structHash1 = computeCommitmentStructHashHex(batch1);

      // Gap: starts at 5 instead of 4
      const gapBatch = {
        ...TEST_BATCH_2,
        sourceId,
        sequenceStart: 5n,
        sequenceEnd: 6n,
        previousCheckpointHash: structHash1
      };
      const gapSig = await vaultSigner.signTypedData(domain, types, gapBatch);
      await expect(
        contract.connect(relayer).anchorBatch(gapBatch, gapSig)
      ).to.be.revertedWith('Sequence continuity broken: sequenceStart != lastSequenceEnd + 1');
    });

    it('rejects Batch 2 if previousCheckpointHash does not match Batch 1 struct hash', async function () {
      const batch1 = { ...TEST_BATCH_1, sourceId };
      const sig1 = await vaultSigner.signTypedData(domain, types, batch1);
      await contract.connect(relayer).anchorBatch(batch1, sig1);

      // Wrong checkpoint hash
      const wrongHashBatch = {
        ...TEST_BATCH_2,
        sourceId,
        previousCheckpointHash: GENESIS_CHECKPOINT_HASH
      };
      const sig2 = await vaultSigner.signTypedData(domain, types, wrongHashBatch);
      await expect(
        contract.connect(relayer).anchorBatch(wrongHashBatch, sig2)
      ).to.be.revertedWith('previousCheckpointHash mismatch: does not match previous commitment struct hash (A3)');
    });
  });

  describe('Duplicate / Replay Protection (LOCKED)', function () {
    it('rejects duplicate submission of an already anchored batch', async function () {
      await contract.connect(owner).registerSource(sourceId, vaultSigner.address);
      const commitment = { ...TEST_BATCH_1, sourceId };
      const types = {
        BatchCommitment: [
          { name: 'sourceId', type: 'bytes32' },
          { name: 'sequenceStart', type: 'uint64' },
          { name: 'sequenceEnd', type: 'uint64' },
          { name: 'leafCount', type: 'uint64' },
          { name: 'merkleRoot', type: 'bytes32' },
          { name: 'previousCheckpointHash', type: 'bytes32' }
        ]
      };
      const signature = await vaultSigner.signTypedData(domain, types, commitment);

      await contract.connect(relayer).anchorBatch(commitment, signature);

      // Attempt replay
      await expect(
        contract.connect(relayer).anchorBatch(commitment, signature)
      ).to.be.revertedWith('Duplicate batch: commitment already anchored');
    });
  });

  describe('Polygon Amoy Mode (ASSUMPTION A4)', function () {
    it('anchors checkpoint digest stored in merkleRoot field', async function () {
      await contract.connect(owner).registerSource(sourceId, vaultSigner.address);
      const amoyCheckpointDigest = '0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
      const amoyBatch = {
        sourceId,
        sequenceStart: 1n,
        sequenceEnd: 50n,
        leafCount: 50n,
        merkleRoot: amoyCheckpointDigest, // Checkpoint digest in merkleRoot field (A4)
        previousCheckpointHash: GENESIS_CHECKPOINT_HASH
      };
      const types = {
        BatchCommitment: [
          { name: 'sourceId', type: 'bytes32' },
          { name: 'sequenceStart', type: 'uint64' },
          { name: 'sequenceEnd', type: 'uint64' },
          { name: 'leafCount', type: 'uint64' },
          { name: 'merkleRoot', type: 'bytes32' },
          { name: 'previousCheckpointHash', type: 'bytes32' }
        ]
      };
      const signature = await vaultSigner.signTypedData(domain, types, amoyBatch);
      await contract.connect(relayer).anchorBatch(amoyBatch, signature);

      const latest = await contract.getLatestBatch(sourceId);
      expect(latest.commitment.merkleRoot).to.equal(amoyCheckpointDigest);
    });
  });

  describe('On-chain Merkle Proof Verification with Odd Promotion', function () {
    it('verifies inclusion proof for odd promoted node on-chain', async function () {
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
    });
  });
});
