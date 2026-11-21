export interface CliArguments {
  command?: 'verify';
  bundlePath?: string;
  rpcUrl?: string;
  json: boolean;
  help: boolean;
}

export class ArgumentError extends Error {}

export function parseArgs(tokens: string[]): CliArguments {
  const parsed: CliArguments = { json: false, help: false };
  const remaining = [...tokens];

  if (remaining[0] === 'verify') {
    remaining.shift();
    parsed.command = 'verify';
  }

  while (remaining.length > 0) {
    const token = remaining.shift();
    if (token === '--help' || token === '-h') {
      parsed.help = true;
    } else if (token === '--json') {
      parsed.json = true;
    } else if (token === '--bundle' || token === '--rpc-url') {
      const value = remaining.shift();
      if (!value || value.startsWith('--')) throw new ArgumentError(`${token} requires a value.`);
      if (token === '--bundle') parsed.bundlePath = value;
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
    '',
    'Checks normalized evidence and requires a direct read-only RPC check before VERIFIED.',
    'JSON and ZIP file bundle adapters are unavailable pending an approved export schema.',
    '',
    'Exit codes:',
    '  0  VERIFIED',
    '  1  TAMPERED',
    '  2  UNVERIFIABLE',
    ' 64  invalid command or arguments'
  ].join('\n');
}
