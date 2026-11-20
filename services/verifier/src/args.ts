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
      if (token === '--rpc-url') parsed.rpcUrl = value;
    } else {
      throw new ArgumentError(`Unknown argument: ${token}`);
    }
  }

  return parsed;
}

export function usage(): string {
  return [
    'Usage: trusttrace verify --bundle <path> --rpc-url <url> [--json]',
    '',
    'Validates a local evidence bundle and requires a direct read-only RPC check',
    'before it can return VERIFIED.',
    '',
    'Exit codes:',
    '  0  VERIFIED',
    '  1  TAMPERED',
    '  2  UNVERIFIABLE',
    ' 64  invalid command or arguments'
  ].join('\n');
}
