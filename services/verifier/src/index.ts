#!/usr/bin/env node
import { ArgumentError, parseArgs, usage } from './args.js';
import { verifyBundle } from './verify.js';
import type { VerificationResult } from './types.js';

const exitCodes = { VERIFIED: 0, TAMPERED: 1, UNVERIFIABLE: 2, USAGE: 64 } as const;

function formatResult(result: VerificationResult): string {
  return [
    `Result: ${result.status}`,
    `Reason: ${result.reasonCode ?? 'NONE'}`,
    result.message,
    'Stages:',
    ...result.stages.map((stage) => `  ${stage.stage}: ${stage.status}${stage.reasonCode ? ` (${stage.reasonCode})` : ''}`)
  ].join('\n');
}

export async function run(argv: string[], writeOut = console.log, writeError = console.error): Promise<number> {
  try {
    const args = parseArgs(argv);
    if (args.help) {
      writeOut(usage());
      return exitCodes.VERIFIED;
    }
    if (args.command !== 'verify' || !args.bundlePath || !args.rpcUrl) {
      writeError(usage());
      return exitCodes.USAGE;
    }

    const result = await verifyBundle({ bundlePath: args.bundlePath, rpcUrl: args.rpcUrl });
    writeOut(args.json ? JSON.stringify(result, null, 2) : formatResult(result));
    return exitCodes[result.status];
  } catch (error) {
    const message = error instanceof ArgumentError ? error.message : 'Unexpected verifier error.';
    writeError(`${message}\n\n${usage()}`);
    return exitCodes.USAGE;
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  run(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
