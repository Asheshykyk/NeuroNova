/**
 * Cyprus-1 (Zone 0-0) Wallet Generator for Quai Network Orchard Testnet
 *
 * Quai Network uses address prefixes to route transactions to specific execution zones.
 * For Cyprus-1, all valid addresses MUST start with the '0x00' byte prefix.
 *
 * This script generates dedicated testnet wallets for:
 * 1. Quai Contract Deployer / Owner (Person 1)
 * 2. Quai Relayer (Person 2)
 * 3. Quai Vault Signer (mounted only in Vault secret)
 *
 * SECURITY INVARIANT:
 * Generated private keys are for TESTNET USE ONLY.
 * Never commit private keys to git or shared repositories.
 */

import crypto from 'node:crypto';
import * as quais from 'quais';

interface GeneratedQuaiWallet {
  role: string;
  address: string;
  privateKey: string;
  zone: string;
  attempts: number;
  durationMs: number;
}

export function generateCyprus1Wallet(role: string): GeneratedQuaiWallet {
  const start = Date.now();
  let attempts = 0;

  while (true) {
    attempts++;
    const privBytes = crypto.randomBytes(32);
    const privHex = '0x' + privBytes.toString('hex');
    const wallet = new quais.Wallet(privHex);

    if (wallet.address.toLowerCase().startsWith('0x00')) {
      const zoneHex = quais.getZoneForAddress(wallet.address);
      const durationMs = Date.now() - start;
      return {
        role,
        address: wallet.address,
        privateKey: privHex,
        zone: zoneHex === '0x00' ? 'Cyprus-1 (Zone 0-0)' : zoneHex,
        attempts,
        durationMs
      };
    }
  }
}

export function main() {
  console.log('============================================================');
  console.log('TRUSTTRACE: Quai Network Cyprus-1 Wallet Generator');
  console.log('Target: Quai Orchard Testnet | Cyprus-1 (Chain ID: 15000)');
  console.log('============================================================\n');

  const roles = [
    'Quai Deployer / Contract Owner (Person 1)',
    'Quai Relayer (Person 2)',
    'Quai Vault Signer (Docker /run/secrets)'
  ];

  const wallets: GeneratedQuaiWallet[] = [];

  for (const role of roles) {
    const w = generateCyprus1Wallet(role);
    wallets.push(w);
    console.log(`[+] Role: ${w.role}`);
    console.log(`    Address:     ${w.address} (starts with 0x00)`);
    console.log(`    Zone:        ${w.zone}`);
    console.log(`    Private Key: ${w.privateKey}`);
    console.log(`    Grind Stats: ${w.attempts} attempts in ${w.durationMs}ms\n`);
  }

  console.log('============================================================');
  console.log('FUNDING INSTRUCTIONS:');
  console.log('1. Go to Quai Orchard Faucet: https://orchard.faucet.quai.network');
  console.log('2. Request testnet QUAI tokens for Cyprus-1 zone for each address.');
  console.log('3. Add the keys to your local .env (DO NOT COMMIT .env TO GIT):');
  console.log('');
  console.log(`QUAI_DEPLOYER_PRIVATE_KEY=${wallets[0].privateKey}`);
  console.log(`QUAI_DEPLOYER_ADDRESS=${wallets[0].address}`);
  console.log(`QUAI_RELAYER_PRIVATE_KEY=${wallets[1].privateKey}`);
  console.log(`QUAI_RELAYER_ADDRESS=${wallets[1].address}`);
  console.log(`QUAI_VAULT_SIGNER_PRIVATE_KEY=${wallets[2].privateKey}`);
  console.log(`QUAI_VAULT_SIGNER_ADDRESS=${wallets[2].address}`);
  console.log('============================================================');
}

// Run if executed directly
main();
