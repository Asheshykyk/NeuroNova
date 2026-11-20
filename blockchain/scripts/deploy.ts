import { ethers, network } from 'hardhat';

/**
 * Deployment script for EvidenceAnchor.sol
 * 
 * RULES ENFORCED:
 * 1. Never use Hardhat default keys on a public network!
 * 2. Do not broadcast any transaction unless explicitly requested.
 * 3. Do not invent gas, addresses, or results.
 */
async function main() {
  console.log('============================================================');
  console.log(`Deploying EvidenceAnchor to network: ${network.name} (chainId: ${network.config.chainId})`);
  console.log('============================================================\n');

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error('No deployer signer configured for this network');
  }

  const deployerAddress = await deployer.getAddress();
  console.log(`Deployer address: ${deployerAddress}`);

  // RULE CHECK: Public network key check
  const isPublicNetwork = network.name === 'amoy' || network.name === 'polygon' || network.name === 'mainnet';
  const HARDHAT_DEFAULT_DEPLOYER = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'.toLowerCase();

  if (isPublicNetwork && deployerAddress.toLowerCase() === HARDHAT_DEFAULT_DEPLOYER) {
    throw new Error(
      'FATAL SECURITY VIOLATION: Cannot deploy to public network using Hardhat default account 0! (RULE)'
    );
  }

  console.log('Deploying EvidenceAnchor contract...');
  const EvidenceAnchor = await ethers.getContractFactory('EvidenceAnchor');
  const contract = await EvidenceAnchor.deploy();
  await contract.waitForDeployment();

  const contractAddress = await contract.getAddress();
  const txHash = contract.deploymentTransaction()?.hash;

  console.log('\nDeployment Succeeded:');
  console.log(`- Contract Address: ${contractAddress}`);
  console.log(`- Deployment Transaction Hash: ${txHash}`);
  console.log(`- Contract Owner: ${deployerAddress}`);
  console.log(`- Domain Separator: ${await contract.domainSeparator()}`);

  console.log('\nNext steps:');
  if (network.name === 'localhost' || network.name === 'hardhat') {
    console.log(`Add to .env: EVIDENCE_ANCHOR_LOCAL_ADDRESS=${contractAddress}`);
  } else if (network.name === 'amoy') {
    console.log(`Add to .env: EVIDENCE_ANCHOR_AMOY_ADDRESS=${contractAddress}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
