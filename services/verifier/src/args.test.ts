import { describe, expect, it } from 'vitest';
import { ArgumentError, parseArgs } from './args.js';

describe('argument parsing', () => {
  it('parses the required verify options and JSON output', () => {
    expect(parseArgs(['verify', '--bundle', 'bundle.json', '--rpc-url', 'http://127.0.0.1:8545', '--json'])).toEqual({
      command: 'verify', bundlePath: 'bundle.json', rpcUrl: 'http://127.0.0.1:8545', json: true, help: false
    });
  });

  it('rejects unknown or incomplete arguments', () => {
    expect(() => parseArgs(['verify', '--bundle'])).toThrow(ArgumentError);
    expect(() => parseArgs(['verify', '--unknown'])).toThrow('Unknown argument');
  });
});
