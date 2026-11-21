export interface CliArguments {
  command?: 'verify' | 'verify-agent-chunk' | 'verify-rest';
  baseUrl?: string;
  sourceId?: string;
  sequence?: string;
  bundlePath?: string;
  evidencePath?: string;
  trustedAgentKeysPath?: string;
  rpcUrl?: string;
  json: boolean;
  help: boolean;
}

export class ArgumentError extends Error {}

export function parseArgs(tokens: string[]): CliArguments {
  const parsed: CliArguments = { json: false, help: false };
  const remaining = [...tokens];

  const command = remaining[0];
  if (command === 'verify' || command === 'verify-agent-chunk' || command === 'verify-rest') {
    parsed.command = command;
    remaining.shift();
  }

  while (remaining.length > 0) {
    const token = remaining.shift();
    if (token === '--help' || token === '-h') {
      parsed.help = true;
    } else if (token === '--json') {
      parsed.json = true;
    } else if (token === '--bundle' || token === '--rpc-url'
      || token === '--evidence' || token === '--trusted-agent-keys'
      || token === '--base-url' || token === '--source-id' || token === '--sequence') {
      const value = remaining.shift();
      if (!value || value.startsWith('--')) throw new ArgumentError(`${token} requires a value.`);
      if (token === '--base-url') parsed.baseUrl = value;
      if (token === '--source-id') parsed.sourceId = value;
      if (token === '--sequence') parsed.sequence = value;
      if (token === '--bundle') parsed.bundlePath = value;
      if (token === '--evidence') parsed.evidencePath = value;
      if (token === '--trusted-agent-keys') parsed.trustedAgentKeysPath = value;
      if (token === '--rpc-url') {
        let url: URL;
        try {
          url = new URL(value);
        } catch {
          throw new ArgumentError('--rpc-url must be a valid HTTP(S) URL.');
        }
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          throw new ArgumentError('--rpc-url must be a valid HTTP(S) URL.');
        }
        parsed.rpcUrl = value;
      }
    } else {
      throw new ArgumentError('Unknown option.');
    }
  }

  return parsed;
}

export function usage(): string {
  return [
    'Usage: trusttrace verify --bundle <path> --rpc-url <url> [--json]',
    '       trusttrace verify-rest --base-url <url> --source-id <bytes32> --sequence <uint64> [--rpc-url <tier1-url>] [--json]',
    '       trusttrace verify-agent-chunk --evidence <path> --trusted-agent-keys <path> [--json]',
    '',
    'Checks normalized evidence and requires a direct read-only RPC check before VERIFIED.',
    'JSON and ZIP file bundle adapters are unavailable pending an approved export schema.',
    '',
    'verify-agent-chunk checks only the AgentChunk Ed25519 signature; it does not verify Vault, Merkle, or chain state.',
    'Trusted-key JSON maps canonical source IDs to raw Ed25519 public keys, e.g. {"0x<64 hex source ID>":"0x<64 hex key>"}',
    '',
    'Exit codes:',
    '  0  VERIFIED',
    '  1  TAMPERED',
    '  2  UNVERIFIABLE',
    ' 64  invalid command or arguments'
  ].join('\n');
}
