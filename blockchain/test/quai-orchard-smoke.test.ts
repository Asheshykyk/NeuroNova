import { expect } from 'chai';
import hardhat from 'hardhat';
const { ethers } = hardhat;
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BATCH_COMMITMENT_EIP712_TYPES,
  computeCommitmentStructHashHex,
  computeDomainSeparatorHex,
  computeEIP712DigestHex,
  GENESIS_CHECKPOINT_HASH
} from '../../packages/core/src/commitment.ts';
import {
  isCyprus1Address,
  assertCyprus1Address,
  QUAI_ORCHARD_CHAIN_ID,
  QUAI_ORCHARD_CYPRUS1_RPC
} from '../../packages/core/src/quai.ts';
import {
  signCommitment,
  verifyCommitmentSignature,
  getEthereumAddress
} from '../../packages/core/src/signer.ts';
import {
  buildCheckpoint,
  checkCheckpoint,
  GENESIS_CHECKPOINT_DIGEST
} from '../../packages/core/src/checkpoint.ts';
import type { BatchCommitment } from '../../packages/core/src/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Phase 4: Quai Network Orchard (Cyprus-1, Chain ID 15000) Smoke & Invariant Suite', function () {
  let contract: any;
  let owner: any;
  let relayer: any;

  // Cyprus-1 Grounded Wallets (all start with 0x00)
  const cyprusVaultSignerKey = '0x767c350ed0345bc6ba7b432407cff6a7401f3c4a772c2f22244dee6aa9c78852';
  const cyprusVaultSignerAddress = '0x00ec2241529f64253d1239ce336a15f1f454e839';
  const cyprusContractAddress = '0x00a89d7494cb3d16858a74e5cae1a965d14df5a2';

  const sourceId = '0x736f757263652d30310000000000000000000000000000000000000000000000'; // "source-01"

  beforeEach(async function () {
    [owner, relayer] = await ethers.getSigners();

    const EvidenceAnchor = await ethers.getContractFactory('EvidenceAnchor');
    contract = await EvidenceAnchor.deploy();
    await contract.waitForDeployment();

    // Register Cyprus-1 Vault Signer for the test source
    await contract.connect(owner).registerSource(sourceId, cyprusVaultSignerAddress);
  });

  describe('1. Quai Cyprus-1 Shard Invariants & Validation', function () {
    it('should validate that Cyprus-1 address requires 0x00 prefix', function () {
      expect(isCyprus1Address(cyprusVaultSignerAddress)).to.be.true;
      expect(isCyprus1Address(cyprusContractAddress)).to.be.true;
      expect(isCyprus1Address('0x00112233445566778899aabbccddeeff00112233')).to.be.true;

      // Rejects non-Cyprus-1 addresses
      expect(isCyprus1Address(owner.address)).to.be.false;
      expect(isCyprus1Address(relayer.address)).to.be.false;
      expect(isCyprus1Address('0x1234567890abcdef1234567890abcdef12345678')).to.be.false;
    });

    it('assertCyprus1Address should throw on non-Cyprus-1 addresses', function () {
      expect(() => assertCyprus1Address(cyprusVaultSignerAddress, 'VaultSigner')).not.to.throw();
      expect(() => assertCyprus1Address(owner.address, 'Owner')).to.throw(/Quai Shard Violation/);
    });

    it('should confirm Quai Orchard network constants', function () {
      expect(QUAI_ORCHARD_CHAIN_ID).to.equal(15000);
      expect(QUAI_ORCHARD_CYPRUS1_RPC).to.equal('https://orchard.rpc.quai.network/cyprus1');
    });
  });

  describe('2. Canonical Test Vector Verification (vectors/quai-orchard-commitment.json)', function () {
    let vector: any;

    before(function () {
      const vectorPath = path.resolve(__dirname, '../../vectors/quai-orchard-commitment.json');
      expect(fs.existsSync(vectorPath), 'Vector file must exist').to.be.true;
      vector = JSON.parse(fs.readFileSync(vectorPath, 'utf-8'));
    });

    it('should match the exact chain ID and domain parameters in test vector', function () {
      expect(vector.chainId).to.equal(15000);
      expect(vector.domain.chainId).to.equal(15000);
      expect(vector.domain.name).to.equal('EvidenceAnchor');
      expect(vector.domain.version).to.equal('1');
      expect(vector.domain.verifyingContract.toLowerCase()).to.equal(cyprusContractAddress.toLowerCase());
      expect(isCyprus1Address(vector.domain.verifyingContract)).to.be.true;
    });

    it('should compute invariant structHash across all chains', function () {
      const structHash = computeCommitmentStructHashHex(vector.commitment);
      expect(structHash).to.equal(vector.structHash);
      // Invariant: structHash for identical commitment fields is identical to local chain vector
      expect(structHash).to.equal('0x3303ce2de046f2a609558e7353942ed8332c5d27557b19c0f7bf4cbdd1418dc2');
    });

    it('should compute deterministic domainSeparator for Quai Orchard', function () {
      const domainSep = computeDomainSeparatorHex(vector.domain);
      expect(domainSep).to.equal(vector.domainSeparator);
    });

    it('should compute deterministic EIP-712 digest for Quai Orchard', function () {
      const digest = computeEIP712DigestHex(vector.domain, vector.commitment);
      expect(digest).to.equal(vector.digest);
    });

    it('should verify signature against Cyprus-1 signer address', function () {
      const isValid = verifyCommitmentSignature(
        vector.domain,
        vector.commitment,
        vector.signature,
        vector.signer
      );
      expect(isValid).to.be.true;
      expect(isCyprus1Address(vector.signer)).to.be.true;
    });
  });

  describe('3. On-Chain Anchoring with Quai Cyprus-1 Signer', function () {
    it('should successfully anchor batch commitment signed by Cyprus-1 signer', async function () {
      const net = await ethers.provider.getNetwork();
      const localDomain = {
        name: 'EvidenceAnchor',
        version: '1',
        chainId: net.chainId,
        verifyingContract: await contract.getAddress()
      };

      const commitment: BatchCommitment = {
        sourceId,
        sequenceStart: 1n,
        sequenceEnd: 5n,
        leafCount: 5n,
        merkleRoot: '0x2e02f236f0b4d4719b4cfb08de4e1eb815ad7fae1d134b2cfab9bc401f8eec4c',
        previousCheckpointHash: GENESIS_CHECKPOINT_HASH
      };

      const signed = signCommitment(cyprusVaultSignerKey, localDomain, commitment);

      const tx = await contract.connect(relayer).anchorBatch(commitment, signed.signature);
      const receipt = await tx.wait();

      expect(Number(receipt.status)).to.equal(1);

      // Verify on-chain record
      const [latestCommitment, latestHash] = await contract.getLatest(sourceId);
      expect(Number(latestCommitment.sequenceStart)).to.equal(1);
      expect(Number(latestCommitment.sequenceEnd)).to.equal(5);
      expect(Number(latestCommitment.leafCount)).to.equal(5);
      expect(latestCommitment.merkleRoot).to.equal(commitment.merkleRoot);
      expect(latestCommitment.previousCheckpointHash).to.equal(GENESIS_CHECKPOINT_HASH);
      expect(latestHash).to.be.a('string');
    });

    it('should reject batch signed with wrong chainId (domain mismatch)', async function () {
      const wrongDomain = {
        name: 'EvidenceAnchor',
        version: '1',
        chainId: 999999n, // wrong chain ID
        verifyingContract: await contract.getAddress()
      };

      const commitment: BatchCommitment = {
        sourceId,
        sequenceStart: 1n,
        sequenceEnd: 5n,
        leafCount: 5n,
        merkleRoot: '0x2e02f236f0b4d4719b4cfb08de4e1eb815ad7fae1d134b2cfab9bc401f8eec4c',
        previousCheckpointHash: GENESIS_CHECKPOINT_HASH
      };

      const signedWrong = signCommitment(cyprusVaultSignerKey, wrongDomain, commitment);

      await expect(
        contract.connect(relayer).anchorBatch(commitment, signedWrong.signature)
      ).to.be.revertedWith('Invalid signer: does not match registered vault signer');
    });
  });

  describe('4. Tier 1 to Tier 2 Quai Checkpoint Integration', function () {
    it('should construct valid cross-chain checkpoint targeting Quai Orchard', async function () {
      const net = await ethers.provider.getNetwork();
      const localAddress = await contract.getAddress();

      const commitment: BatchCommitment = {
        sourceId,
        sequenceStart: 1n,
        sequenceEnd: 10n,
        leafCount: 10n,
        merkleRoot: '0x2e02f236f0b4d4719b4cfb08de4e1eb815ad7fae1d134b2cfab9bc401f8eec4c',
        previousCheckpointHash: GENESIS_CHECKPOINT_HASH
      };

      const localDomain = {
        name: 'EvidenceAnchor',
        version: '1',
        chainId: net.chainId,
        verifyingContract: localAddress
      };

      const signed = signCommitment(cyprusVaultSignerKey, localDomain, commitment);
      const tx = await contract.connect(relayer).anchorBatch(commitment, signed.signature);
      const receipt = await tx.wait();

      const block = await ethers.provider.getBlock(receipt.blockNumber);

      // Construct checkpoint for Quai Orchard Tier 2 anchoring
      const checkpointResult = buildCheckpoint({
        previousCheckpointDigest: GENESIS_CHECKPOINT_DIGEST,
        localChainId: Number(net.chainId),
        localBlockNumber: receipt.blockNumber,
        localBlockHash: block!.hash!,
        latestBatchRoot: commitment.merkleRoot,
        latestSequence: 10n,
        contractAddress: localAddress
      });

      expect(checkpointResult.digestHex).to.be.a('string');
      expect(checkpointResult.digestHex).to.match(/^0x[0-9a-f]{64}$/);

      // Verify checkpoint check function succeeds
      const checkResult = checkCheckpoint(checkpointResult.checkpoint, checkpointResult.digestHex);
      expect(checkResult).to.be.true;
    });
  });
});
