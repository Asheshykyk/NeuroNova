import { createRequire } from 'node:module';
import { assertCyprus1Address, assertAddressNotCompromised } from '@trusttrace/core/quai';

const require = createRequire(import.meta.url);
const deployments = require('@trusttrace/core/deployments');

export interface RsyslogConfig {
  host: string;
  port: number;
  maxFrameBytes: number;
}

export interface QuaiOrchardConfig {
  network: string;
  displayName: string;
  tier: string;
  chainId: bigint;
  zone: string;
  shard: string;
  rpcUrl: string;
  fallbackRpcUrl: string;
  explorerUrl: string;
  contractAddress: string | null;
  relayerAddress: string | null;
  vaultSignerAddress: string | null;
  relayerPrivateKey: string | null;
}

export interface BackendConfig {
  host: string;
  port: number;
  anchorRpcUrl: string | null;
  anchorContractAddress: string | null;
  anchorRelayerPrivateKey: string | null;
  anchorChainId: bigint | null;
  vaultSignerPrivateKey: string | null;
  vaultSignerSecretPath: string | null;
  trustedAgentPublicKeys: Map<string, string>;
  trustedAgentPublicKeyHistory: Map<string, string[]>;
  rsyslog: RsyslogConfig;
  quai: QuaiOrchardConfig;
}

function readPort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return 3000;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid BACKEND_PORT: ${value}`);
  }
  return port;
}

function readPortWithName(value: string | undefined, name: string, defaultValue: number): number {
  if (value === undefined || value.trim() === '') return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return parsed;
}

function readPositiveInteger(value: string | undefined, name: string, defaultValue: number): number {
  if (value === undefined || value.trim() === '') return defaultValue;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return parsed;
}

function readTrustedAgentPublicKeyHistory(): Map<string, string[]> {
  const history = new Map<string, string[]>();
  const json = process.env.TRUSTED_AGENT_PUBLIC_KEY_HISTORY_JSON;
  if (json?.trim()) {
    const parsed = JSON.parse(json) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Invalid TRUSTED_AGENT_PUBLIC_KEY_HISTORY_JSON: expected an object');
    }
    for (const [sourceId, keys] of Object.entries(parsed)) {
      if (!Array.isArray(keys) || keys.some((key) => typeof key !== 'string')) {
        throw new Error(`Invalid trusted agent public key history for sourceId ${sourceId}`);
      }
      history.set(sourceId, keys);
    }
  }
  return history;
}

function readTrustedAgentPublicKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  const json = process.env.TRUSTED_AGENT_PUBLIC_KEYS_JSON;
  if (json?.trim()) {
    const parsed = JSON.parse(json) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Invalid TRUSTED_AGENT_PUBLIC_KEYS_JSON: expected an object');
    }
    for (const [sourceId, publicKey] of Object.entries(parsed)) {
      if (typeof publicKey !== 'string') {
        throw new Error(`Invalid trusted agent public key for sourceId ${sourceId}`);
      }
      keys.set(sourceId, publicKey);
    }
  }

  const globalKey = process.env.AGENT_PUBLIC_KEY_HEX?.trim();
  if (globalKey) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('AGENT_PUBLIC_KEY_HEX (one shared key for all sources) is lab-only; set TRUSTED_AGENT_PUBLIC_KEYS_JSON per sourceId in production.');
    }
    if (process.env.ALLOW_SHARED_LAB_AGENT_KEY !== 'true') {
      throw new Error('AGENT_PUBLIC_KEY_HEX requires ALLOW_SHARED_LAB_AGENT_KEY=true (lab only).');
    }
    keys.set('*', globalKey);
  }
  return keys;
}

export function getQuaiOrchardConfig(): QuaiOrchardConfig {
  const orchard = deployments.quai_orchard_cyprus1;
  const relayerAddress = process.env.QUAI_RELAYER_ADDRESS?.trim() || orchard.relayerAddress;
  const contractAddress = process.env.EVIDENCE_ANCHOR_QUAI_ADDRESS?.trim() || orchard.contractAddress;

  if (relayerAddress) {
    assertCyprus1Address(relayerAddress, 'Quai Relayer Address');
  }
  if (contractAddress) {
    assertCyprus1Address(contractAddress, 'EvidenceAnchor Quai Contract Address');
  }

  const chainId = BigInt(process.env.QUAI_CHAIN_ID || orchard.chainId);
  if (relayerAddress) assertAddressNotCompromised(relayerAddress, chainId, 'Quai relayer address');
  if (orchard.vaultSignerAddress) assertAddressNotCompromised(orchard.vaultSignerAddress, chainId, 'Quai vault signer address');

  return {
    network: orchard.network,
    displayName: orchard.displayName,
    tier: orchard.tier,
    chainId,
    zone: orchard.zone,
    shard: orchard.shard,
    rpcUrl: process.env.QUAI_ORCHARD_RPC_URL?.trim() || orchard.rpcUrl,
    fallbackRpcUrl: orchard.fallbackRpcUrl,
    explorerUrl: orchard.explorerUrl,
    contractAddress,
    relayerAddress,
    vaultSignerAddress: orchard.vaultSignerAddress,
    relayerPrivateKey: process.env.QUAI_RELAYER_PRIVATE_KEY?.trim() || null
  };
}

export function verifyKeySeparation(options: {
  vaultSignerPrivateKey?: string | null;
  relayerPrivateKey?: string | null;
}): boolean {
  if (options.vaultSignerPrivateKey && options.relayerPrivateKey) {
    if (options.vaultSignerPrivateKey.toLowerCase() === options.relayerPrivateKey.toLowerCase()) {
      throw new Error('Key Separation Violation: Vault Signer key and Relayer key must NOT be identical');
    }
  }
  return true;
}

const defaultHost = process.env.NODE_ENV === 'production' || process.env.DOCKER === 'true' ? '0.0.0.0' : '127.0.0.1';

export const config: BackendConfig = {
  host: process.env.BACKEND_HOST?.trim() || defaultHost,
  port: readPort(process.env.PORT || process.env.BACKEND_PORT),
  anchorRpcUrl: process.env.LOCAL_RPC_URL?.trim() || null,
  anchorContractAddress: process.env.EVIDENCE_ANCHOR_LOCAL_ADDRESS?.trim() || null,
  anchorRelayerPrivateKey: process.env.LOCAL_RELAYER_PRIVATE_KEY?.trim() || null,
  anchorChainId: process.env.LOCAL_CHAIN_ID?.trim() ? BigInt(process.env.LOCAL_CHAIN_ID) : null,
  vaultSignerPrivateKey: process.env.VAULT_SIGNER_PRIVATE_KEY?.trim() || null,
  vaultSignerSecretPath: process.env.VAULT_SIGNER_SECRET_PATH?.trim() || null,
  trustedAgentPublicKeys: readTrustedAgentPublicKeys(),
  trustedAgentPublicKeyHistory: readTrustedAgentPublicKeyHistory(),
  rsyslog: {
    host: process.env.RSYSLOG_HOST?.trim() || defaultHost,
    port: readPortWithName(process.env.RSYSLOG_PORT, 'RSYSLOG_PORT', 5140),
    maxFrameBytes: readPositiveInteger(process.env.RSYSLOG_MAX_FRAME_BYTES, 'RSYSLOG_MAX_FRAME_BYTES', 1024 * 1024)
  },
  quai: getQuaiOrchardConfig()
};
