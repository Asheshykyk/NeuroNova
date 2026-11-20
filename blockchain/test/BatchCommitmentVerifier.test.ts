import { expect } from 'chai';
import hardhat from 'hardhat';
const { ethers } = hardhat;
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import {
  BATCH_COMMITMENT_EIP712_TYPES,
  BATCH_COMMITMENT_FIELDS,
  computeCommitmentStructHashHex,
  computeDomainSeparatorHex,
  computeEIP712DigestHex,
  GENESIS_CHECKPOINT_HASH
} from '../../packages/core/src/commitment.ts';
import { recoverSignerAddress } from '../../packages/core/src/signer.ts';
import { TEST_VAULT_SIGNER_KEY } from '../../packages/core/src/test-vectors.ts';
import type { BatchCommitment, EIP712Domain } from '../../packages/core/src/types.ts';

describe('BatchCommitmentVerifier (OpenZeppelin EIP712 + ECDSA)', function () {
  let verifier: any;
  let contractAddress: string;
  let chainId: bigint;
  let domain: EIP712Domain;

  // Single sample commitment for verification
  const commitment: BatchCommitment = {
    sourceId: '0x736f757263652d30310000000000000000000000000000000000000000000000', // "source-01"
    sequenceStart: 1n,
    sequenceEnd: 5n,
    leafCount: 5n,
    merkleRoot: '0x2e02f236f0b4d4719b4cfb08de4e1eb815ad7fae1d134b2cfab9bc401f8eec4c',
    previousCheckpointHash: GENESIS_CHECKPOINT_HASH
  };

  beforeEach(async function () {
    const Factory = await ethers.getContractFactory('BatchCommitmentVerifier');
    verifier = await Factory.deploy();
    await verifier.waitForDeployment();

    contractAddress = await verifier.getAddress();
    const network = await ethers.provider.getNetwork();
    chainId = network.chainId;

    domain = {
      name: 'EvidenceAnchor',
      version: '1',
      chainId: chainId,
      verifyingContract: contractAddress
    };
  });

  it('confirms OpenZeppelin dependency and MIT license', function () {
    // OpenZeppelin Contracts v5.x is used, confirmed under MIT License.
    expect(BATCH_COMMITMENT_FIELDS).to.have.lengthOf(6);
    expect(BATCH_COMMITMENT_EIP712_TYPES.BatchCommitment).to.deep.equal([
      { name: 'sourceId', type: 'bytes32' },
      { name: 'sequenceStart', type: 'uint64' },
      { name: 'sequenceEnd', type: 'uint64' },
      { name: 'leafCount', type: 'uint64' },
      { name: 'merkleRoot', type: 'bytes32' },
      { name: 'previousCheckpointHash', type: 'bytes32' }
    ]);
  });

  it('matches Domain Separator: TypeScript == Solidity', async function () {
    const tsDomainSeparator = computeDomainSeparatorHex(domain);
    const solidityDomainSeparator = await verifier.domainSeparator();

    expect(tsDomainSeparator.toLowerCase()).to.equal(solidityDomainSeparator.toLowerCase());
  });

  it('matches Struct Hash: TypeScript == Solidity', async function () {
    const tsStructHash = computeCommitmentStructHashHex(commitment);
    const solidityStructHash = await verifier.hashCommitment(commitment);

    expect(tsStructHash.toLowerCase()).to.equal(solidityStructHash.toLowerCase());
  });

  it('matches EIP-712 Digest: TypeScript digest equals Solidity digest', async function () {
    const tsDigest = computeEIP712DigestHex(domain, commitment);
    const solidityDigest = await verifier.getDigest(commitment);

    console.log(`      TypeScript digest: ${tsDigest}`);
    console.log(`      Solidity digest:   ${solidityDigest}`);
    expect(tsDigest.toLowerCase()).to.equal(solidityDigest.toLowerCase());
  });

  it('signs in TypeScript with ethers and recovers same address in Solidity (recovered address == signer)', async function () {
    const [hardhatSigner] = await ethers.getSigners();

    // Sign typed data using ethers with canonical BATCH_COMMITMENT_EIP712_TYPES
    const signature = await hardhatSigner.signTypedData(
      domain,
      BATCH_COMMITMENT_EIP712_TYPES,
      commitment
    );

    // Verify TypeScript digest matches Solidity digest
    const tsDigest = computeEIP712DigestHex(domain, commitment);
    const solidityDigest = await verifier.getDigest(commitment);
    expect(tsDigest.toLowerCase()).to.equal(solidityDigest.toLowerCase());

    // Recover address in Solidity using OpenZeppelin ECDSA.recover
    const recoveredAddress = await verifier.recoverSigner(commitment, signature);

    console.log(`      Signer address:    ${hardhatSigner.address}`);
    console.log(`      Recovered address: ${recoveredAddress}`);
    console.log(`      recovered address == signer: ${recoveredAddress.toLowerCase() === hardhatSigner.address.toLowerCase()}`);

    // ASSERTION: recovered address == signer
    expect(recoveredAddress.toLowerCase()).to.equal(hardhatSigner.address.toLowerCase());

    // Also verify pure TypeScript recovery gives identical address
    const tsRecoveredAddress = recoverSignerAddress(tsDigest, signature);
    expect(tsRecoveredAddress.toLowerCase()).to.equal(hardhatSigner.address.toLowerCase());
  });

  it('signs with Vault private key wallet and recovers identical address in Solidity', async function () {
    const vaultWallet = new ethers.Wallet(TEST_VAULT_SIGNER_KEY, ethers.provider);

    const signature = await vaultWallet.signTypedData(
      domain,
      BATCH_COMMITMENT_EIP712_TYPES,
      commitment
    );

    const tsDigest = computeEIP712DigestHex(domain, commitment);
    const solidityDigest = await verifier.getDigest(commitment);
    expect(tsDigest.toLowerCase()).to.equal(solidityDigest.toLowerCase());

    const recoveredAddress = await verifier.recoverSigner(commitment, signature);
    expect(recoveredAddress.toLowerCase()).to.equal(vaultWallet.address.toLowerCase());
  });

  it('rejects tampered commitment: altered leafCount recovers wrong address', async function () {
    const [hardhatSigner] = await ethers.getSigners();
    const signature = await hardhatSigner.signTypedData(
      domain,
      BATCH_COMMITMENT_EIP712_TYPES,
      commitment
    );

    const tamperedCommitment: BatchCommitment = {
      ...commitment,
      leafCount: 999n
    };

    const recoveredAddress = await verifier.recoverSigner(tamperedCommitment, signature);
    expect(recoveredAddress.toLowerCase()).to.not.equal(hardhatSigner.address.toLowerCase());
  });

  it('validates test vector vectors/eip712-commitment.json matches core and Solidity', async function () {
    const vectorPath = path.resolve(__dirname, '../../vectors/eip712-commitment.json');
    const vectorRaw = fs.readFileSync(vectorPath, 'utf-8');
    const vector = JSON.parse(vectorRaw);

    const vectorCommitment: BatchCommitment = {
      sourceId: vector.commitment.sourceId,
      sequenceStart: BigInt(vector.commitment.sequenceStart),
      sequenceEnd: BigInt(vector.commitment.sequenceEnd),
      leafCount: BigInt(vector.commitment.leafCount),
      merkleRoot: vector.commitment.merkleRoot,
      previousCheckpointHash: vector.commitment.previousCheckpointHash
    };

    // Verify structHash
    const tsStructHash = computeCommitmentStructHashHex(vectorCommitment);
    expect(tsStructHash.toLowerCase()).to.equal(vector.structHash.toLowerCase());

    const solidityStructHash = await verifier.hashCommitment(vectorCommitment);
    expect(solidityStructHash.toLowerCase()).to.equal(vector.structHash.toLowerCase());

    // Verify domain separator
    const vectorDomain: EIP712Domain = {
      name: vector.domain.name,
      version: vector.domain.version,
      chainId: BigInt(vector.domain.chainId),
      verifyingContract: vector.domain.verifyingContract
    };
    const tsDomainSeparator = computeDomainSeparatorHex(vectorDomain);
    expect(tsDomainSeparator.toLowerCase()).to.equal(vector.domainSeparator.toLowerCase());

    // Verify digest
    const tsDigest = computeEIP712DigestHex(vectorDomain, vectorCommitment);
    expect(tsDigest.toLowerCase()).to.equal(vector.digest.toLowerCase());

    // Verify signer recovery in TypeScript
    const tsRecovered = recoverSignerAddress(tsDigest, vector.signature);
    expect(tsRecovered.toLowerCase()).to.equal(vector.signer.toLowerCase());
  });
});
