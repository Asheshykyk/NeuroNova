export interface RsyslogConfig {
  host: string;
  port: number;
  maxFrameBytes: number;
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
  if (globalKey) keys.set('*', globalKey);
  return keys;
}

export const config: BackendConfig = {
  host: process.env.BACKEND_HOST?.trim() || '127.0.0.1',
  port: readPort(process.env.BACKEND_PORT),
  anchorRpcUrl: process.env.LOCAL_RPC_URL?.trim() || null,
  anchorContractAddress: process.env.EVIDENCE_ANCHOR_LOCAL_ADDRESS?.trim() || null,
  anchorRelayerPrivateKey: process.env.LOCAL_RELAYER_PRIVATE_KEY?.trim() || null,
  anchorChainId: process.env.LOCAL_CHAIN_ID?.trim() ? BigInt(process.env.LOCAL_CHAIN_ID) : null,
  vaultSignerPrivateKey: process.env.VAULT_SIGNER_PRIVATE_KEY?.trim() || null,
  vaultSignerSecretPath: process.env.VAULT_SIGNER_SECRET_PATH?.trim() || null,
  trustedAgentPublicKeys: readTrustedAgentPublicKeys(),
  trustedAgentPublicKeyHistory: readTrustedAgentPublicKeyHistory(),
  rsyslog: {
    host: process.env.RSYSLOG_HOST?.trim() || '127.0.0.1',
    port: readPortWithName(process.env.RSYSLOG_PORT, 'RSYSLOG_PORT', 1514),
    maxFrameBytes: readPositiveInteger(process.env.RSYSLOG_MAX_FRAME_BYTES, 'RSYSLOG_MAX_FRAME_BYTES', 1024 * 1024)
  }
};
