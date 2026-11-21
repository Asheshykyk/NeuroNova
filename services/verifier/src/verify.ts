import { result } from './core.js';
import type { BatchEvidence } from './core.js';
import { defaultDependencies } from './stages.js';
import type { StageResult, VerificationResult, VerifierDependencies, VerifyOptions } from './types.js';

function finalResult(bundlePath: string, rpcUrl: string, stages: StageResult[]): VerificationResult {
  const failed = stages.find((stage) => stage.status !== 'VERIFIED');
  const status = failed?.status ?? 'VERIFIED';
  return {
    status,
    reasonCode: failed?.reasonCode,
    message: failed?.message ?? 'All required verification stages, including direct RPC, succeeded.',
    bundlePath,
    rpcUrl,
    stages,
    verifiedAt: new Date().toISOString()
  };
}

/**
 * Runs stages sequentially. A cryptographic mismatch may be TAMPERED only
 * when its stage received sufficient approved inputs. Otherwise stages return
 * UNVERIFIABLE and no later stage may upgrade the final verdict.
 */
export async function verifyBundle(options: VerifyOptions, overrides: Partial<VerifierDependencies> = {}): Promise<VerificationResult> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const stages: StageResult[] = [];

  const { bundle, ...parsingStage } = await dependencies.parseBundle(options.bundlePath);
  stages.push(parsingStage);
  if (parsingStage.status !== 'VERIFIED') return finalResult(options.bundlePath, options.rpcUrl, stages);
  if (!bundle) {
    stages[0] = result('bundle-parsing', 'Parser returned no evidence.', 'REQUIRED_EVIDENCE_MISSING', 'UNVERIFIABLE');
    return finalResult(options.bundlePath, options.rpcUrl, stages);
  }

  for (const stageRunner of [dependencies.validateRawBytes, dependencies.matchCommitment,
    dependencies.verifyMerkle, dependencies.verifyPublicCheckpoint, dependencies.verifyVaultSignature]) {
    const stage = await stageRunner(bundle, options);
    stages.push(stage);
    if (stage.status !== 'VERIFIED') return finalResult(options.bundlePath, options.rpcUrl, stages);
  }

  const rpcStage = await dependencies.lookupCheckpoint(bundle, options.rpcUrl, options);
  stages.push(rpcStage);
  return finalResult(options.bundlePath, options.rpcUrl, stages);
}

/** Runs the same verification stages after an approved adapter has normalized the evidence. */
export function verifyEvidence(evidence: BatchEvidence, options: VerifyOptions): Promise<VerificationResult> {
  return verifyBundle(options, {
    parseBundle: async (path) => ({
      ...result('bundle-parsing', 'Caller supplied normalized evidence.'),
      bundle: { path, evidence }
    })
  });
}
