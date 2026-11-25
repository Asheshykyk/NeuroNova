/**
 * Quai Network Cyprus-1 Zone & Address Utilities
 * 
 * Quai Network is a multi-threaded, hierarchical PoW blockchain.
 * The active Zone for standard EVM smart contracts on Orchard testnet is Cyprus-1 (Zone 0-0).
 * 
 * RULE: Cyprus-1 addresses MUST start with the 0x00 byte prefix.
 */

export const QUAI_ORCHARD_CHAIN_ID = 15000;
export const QUAI_ORCHARD_CYPRUS1_RPC = 'https://orchard.rpc.quai.network/cyprus1';
export const QUAI_ORCHARD_FALLBACK_RPC = 'https://orchard.rpc.quai.network';
export const QUAI_ORCHARD_EXPLORER_URL = 'https://orchard.quaiscan.io';
export const QUAI_ORCHARD_FAUCET_URL = 'https://orchard.faucet.quai.network';

export const CYPRUS1_PREFIX_BYTE = 0x00;
export const CYPRUS1_PREFIX_HEX = '0x00';

/**
 * Validates whether an address string is a valid Cyprus-1 in-zone address.
 * 
 * Requirements:
 * 1. Exactly 42 characters (0x + 40 hex characters)
 * 2. Starts with "0x00" (case-insensitive)
 */
export function isCyprus1Address(address: string): boolean {
  if (typeof address !== 'string') return false;
  const clean = address.trim();
  if (!clean.startsWith('0x') || clean.length !== 42) return false;
  if (!/^0x[0-9a-fA-F]{40}$/.test(clean)) return false;
  return clean.toLowerCase().startsWith('0x00');
}

/**
 * Asserts that an address is in Cyprus-1 (starts with 0x00), throwing a descriptive error if not.
 */
export function assertCyprus1Address(address: string, label = 'Address'): void {
  if (!isCyprus1Address(address)) {
    throw new Error(
      `Quai Shard Violation: ${label} "${address}" is not a valid Cyprus-1 address! ` +
      `Cyprus-1 addresses MUST begin with the "0x00" prefix. ` +
      `Generate an in-zone address using blockchain/scripts/generate-quai-wallet.ts.`
    );
  }
}

/**
 * Normalizes a Quai address to standard lowercase 0x-prefixed hex string.
 */
export function formatQuaiAddress(address: string): string {
  if (!isCyprus1Address(address)) {
    throw new Error(`Invalid Quai address: ${address}`);
  }
  return address.trim().toLowerCase();
}

/**
 * Identifies the Quai zone for a given address based on its leading byte.
 */
export function getZoneFromAddress(address: string): string {
  if (typeof address !== 'string' || !address.startsWith('0x') || address.length !== 42) {
    return 'unknown';
  }
  const prefixByte = parseInt(address.slice(2, 4), 16);
  if (prefixByte <= 0x1d) return 'cyprus-1';
  if (prefixByte <= 0x3a) return 'cyprus-2';
  if (prefixByte <= 0x57) return 'cyprus-3';
  return 'other-zone';
}

export * from './denylist.ts';

