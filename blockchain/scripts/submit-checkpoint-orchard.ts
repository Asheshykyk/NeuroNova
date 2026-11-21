/**
 * TRUSTTRACE: Quai Orchard Tier 2 Cross-Chain Checkpoint Submission Script
 *
 * Anchors aggregate epoch checkpoint digests to Quai Network Orchard Cyprus-1.
 *
 * ARCHITECTURAL ROLE:
 * Tier 2 public proof-of-work checkpoint anchoring:
 * Even if a root attacker compromises the local host or resets the local Hardhat chain,
 * the immutable checkpoint anchored to Quai Cyprus-1 provides mathematical proof
 * that local history was altered or reset.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as quais from 'quais';
import {
  isCyprus1Address,
  assertCyprus1Address,
  QUAI_ORCHARD_CHAIN_ID,
  QUAI_ORCHARD_CYPRUS1_RPC,
  QUAI_ORCHARD_EXPLORER_URL
} from '../../packages/core/src/quai.ts';
import {
  computeCommitmentStructHashHex,
  GENESIS_CHECKPOINT_HASH
} from '../../packages/core/src/commitment.ts';
import { signCommitment } from '../../packages/core/src/signer.ts';
import type { BatchCommitment } from '../../packages/core/src/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('============================================================');
  console.log('TRUSTTRACE: Quai Orchard Tier 2 Checkpoint Anchor Submission');
  console.log(`Target Network:   Quai Orchard (Cyprus-1, Chain ID: ${QUAI_ORCHARD_CHAIN_ID})`);
  console.log('============================================================\n');

  const deploymentsPath = path.resolve(__dirname, '../../packages/core/src/deployments.json');
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error(`deployments.json not found at ${deploymentsPath}`);
  }

  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf-8'));
  const orchardConfig = deployments.quai_orchard_cyprus1;
  const contractAddress = orchardConfig.contractAddress;

  console.log(`Target Contract:  ${contractAddress}`);
  assertCyprus1Address(contractAddress, 'TargetContract');

  // Checkpoint digest argument (ignoring CLI flags) or default test digest
  const positionalArgs = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const checkpointDigest = positionalArgs[0] || '0x2e02f236f0b4d4719b4cfb08de4e1eb815ad7fae1d134b2cfab9bc401f8eec4c';
  console.log(`Checkpoint Digest to Anchor: ${checkpointDigest}`);

  const sourceId = '0x736f757263652d30310000000000000000000000000000000000000000000000'; // "source-01"

  const commitment: BatchCommitment = {
    sourceId,
    sequenceStart: 1n,
    sequenceEnd: 100n,
    leafCount: 100n,
    merkleRoot: checkpointDigest,
    previousCheckpointHash: GENESIS_CHECKPOINT_HASH
  };

  const domain = {
    name: 'EvidenceAnchor',
    version: '1',
    chainId: QUAI_ORCHARD_CHAIN_ID,
    verifyingContract: contractAddress
  };

  const structHash = computeCommitmentStructHashHex(commitment);
  console.log(`Commitment StructHash:       ${structHash}`);

  const relayerKey = process.env.QUAI_RELAYER_PRIVATE_KEY;
  const vaultKey = process.env.QUAI_VAULT_SIGNER_PRIVATE_KEY;

  if (!relayerKey || !vaultKey || process.argv.includes('--dry-run')) {
    console.log('\n[!] RUNNING IN DRY-RUN / SIMULATION MODE');
    console.log('    QUAI_RELAYER_PRIVATE_KEY or QUAI_VAULT_SIGNER_PRIVATE_KEY not set.');
    console.log('    Validating EIP-712 signature generation under Quai Orchard domain...\n');

    // Use test vault signer key
    const testVaultKey = '0x767c350ed0345bc6ba7b432407cff6a7401f3c4a772c2f22244dee6aa9c78852';
    const signed = signCommitment(testVaultKey, domain, commitment);

    console.log(`[✓] Test Vault Signer:     ${signed.signer} (starts with 0x00: ${isCyprus1Address(signed.signer)})`);
    console.log(`[✓] EIP-712 Digest:        ${signed.digest}`);
    console.log(`[✓] EIP-712 Signature:     ${signed.signature}`);
    console.log('\nDry-run simulation complete. Checkpoint payload is ready for submission.');
    return;
  }

  // Live Submission
  const provider = new quais.JsonRpcProvider(QUAI_ORCHARD_CYPRUS1_RPC);
  const relayerWallet = new quais.Wallet(relayerKey, provider);
  assertCyprus1Address(relayerWallet.address, 'QuaiRelayer');

  console.log(`\nQuai Relayer Address: ${relayerWallet.address}`);
  console.log('Signing commitment with Vault Signer key...');
  const signed = signCommitment(vaultKey, domain, commitment);
  assertCyprus1Address(signed.signer, 'VaultSigner');

  const artifactPath = path.resolve(
    __dirname,
    '../artifacts/contracts/EvidenceAnchor.sol/EvidenceAnchor.json'
  );
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
  const contract = new quais.Contract(contractAddress, artifact.abi, relayerWallet);

  console.log('Submitting anchorBatch transaction to Quai Orchard Cyprus-1...');
  const tx = await contract.anchorBatch(commitment, signed.signature);
  console.log(`Transaction broadcast: ${tx.hash}`);

  const receipt = await tx.wait();
  console.log('\n============================================================');
  console.log('CHECKPOINT ANCHORED SUCCESSFULLY ON QUAI ORCHARD!');
  console.log(`Block Number:  ${receipt.blockNumber}`);
  console.log(`Tx Hash:       ${tx.hash}`);
  console.log(`Explorer Link: ${QUAI_ORCHARD_EXPLORER_URL}/tx/${tx.hash}`);
  console.log('============================================================\n');
}

main().catch((err) => {
  console.error('\n❌ Submission Failed:');
  console.error(err);
  process.exit(1);
});
