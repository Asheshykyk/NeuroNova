export interface BackendConfig {
  host: string;
  port: number;
  trustedAgentPublicKeys: Map<string, string>;
}

function readPort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return 3000;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid BACKEND_PORT: ${value}`);
  }
  return port;
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
  trustedAgentPublicKeys: readTrustedAgentPublicKeys()
};
