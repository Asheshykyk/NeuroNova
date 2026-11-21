#!/usr/bin/env node
import { ArgumentError, parseArgs, usage } from './args.js';
import { verifyAgentChunkFiles } from './agentChunk.js';
import { verifyBundle } from './verify.js';
import type { AgentChunkVerificationResult, VerificationResult } from './types.js';
import { createQuaiEvidenceAnchor, QUAI_ORCHARD_REGISTRY, redactRpcUrl } from './rpc.js';
import type { CliArguments } from './args.js';

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

function formatAgentChunkResult(result: AgentChunkVerificationResult): string {
  return [
    'Scope: AgentChunk signature only; Vault, Merkle, and public-chain checks were not performed.',
    `Result: ${result.status}`,
    `Reason: ${result.reasonCode ?? 'NONE'}`,
    result.message,
    ...(result.sourceId ? [`Source: ${result.sourceId}`] : []),
    ...(result.deliveryId ? [`Delivery: ${result.deliveryId}`] : []),
  ].join('\n');
}

export async function run(argv: string[], writeOut = console.log, writeError = console.error): Promise<number> {
  let args: CliArguments | undefined;
  try {
    args = parseArgs(argv);
    if (args.help) {
      writeOut(usage());
      return exitCodes.VERIFIED;
    }
    if (args.command === 'verify-agent-chunk') {
      if (!args.evidencePath || !args.trustedAgentKeysPath) {
        writeError(usage());
        return exitCodes.USAGE;
      }
      const result = await verifyAgentChunkFiles(args.evidencePath, args.trustedAgentKeysPath);
      writeOut(args.json
        ? JSON.stringify(result, (_key, value) => typeof value === 'bigint' ? value.toString(10) : value, 2)
        : formatAgentChunkResult(result));
      return exitCodes[result.status];
    }
    if (args.command !== 'verify' || !args.bundlePath || !args.rpcUrl) {
      writeError(usage());
      return exitCodes.USAGE;
    }

    const result = await verifyBundle({
      bundlePath: args.bundlePath,
      rpcUrl: args.rpcUrl,
      trusted: {
        signer: QUAI_ORCHARD_REGISTRY.expectedVaultSigner,
        domain: {
          name: 'EvidenceAnchor',
          version: '1',
          chainId: QUAI_ORCHARD_REGISTRY.chainId,
          verifyingContract: QUAI_ORCHARD_REGISTRY.contractAddress,
        },
      },
      connect: createQuaiEvidenceAnchor,
    });
    writeOut(args.json ? JSON.stringify(result, null, 2) : formatResult(result));
    return exitCodes[result.status];
  } catch (error) {
    if (error instanceof ArgumentError) {
      writeError(`${error.message}\n\n${usage()}`);
      return exitCodes.USAGE;
    }
    if (args?.command === 'verify-agent-chunk') {
      const result: AgentChunkVerificationResult = {
        scope: 'agent-chunk-signature-only',
        status: 'UNVERIFIABLE',
        reasonCode: 'VERIFIER_INTERNAL_ERROR',
        message: 'AgentChunk verification failed; no integrity verdict was produced.',
        evidencePath: args.evidencePath ?? '',
        verifiedAt: new Date().toISOString(),
      };
      writeOut(args.json ? JSON.stringify(result, null, 2) : formatAgentChunkResult(result));
      return exitCodes.UNVERIFIABLE;
    }
    if (!args?.bundlePath || !args.rpcUrl) {
      writeError('Verifier execution failed; no integrity verdict was produced.');
      return exitCodes.UNVERIFIABLE;
    }
    const result: VerificationResult = {
      status: 'UNVERIFIABLE',
      reasonCode: 'VERIFIER_INTERNAL_ERROR',
      message: 'Verifier execution failed; no integrity verdict was produced.',
      bundlePath: args.bundlePath,
      rpcUrl: redactRpcUrl(args.rpcUrl),
      stages: [],
      verifiedAt: new Date().toISOString(),
    };
    writeOut(args.json ? JSON.stringify(result, null, 2) : formatResult(result));
    return exitCodes.UNVERIFIABLE;
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  run(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
