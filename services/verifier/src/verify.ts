import { result } from './core.js';
import type { BatchEvidence } from './core.js';
import { redactRpcUrl } from './rpc.js';
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
    rpcUrl: redactRpcUrl(rpcUrl),
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

  let parsed: Awaited<ReturnType<VerifierDependencies['parseBundle']>>;
  try {
    parsed = await dependencies.parseBundle(options.bundlePath);
  } catch {
    stages.push(result('bundle-parsing', 'Bundle parsing failed unexpectedly; no integrity verdict was produced.',
      'VERIFIER_INTERNAL_ERROR', 'UNVERIFIABLE'));
    return finalResult(options.bundlePath, options.rpcUrl, stages);
  }
  const { bundle, ...parsingStage } = parsed;
  stages.push(parsingStage);
  if (parsingStage.status !== 'VERIFIED') return finalResult(options.bundlePath, options.rpcUrl, stages);
  if (!bundle) {
    stages[0] = result('bundle-parsing', 'Parser returned no evidence.', 'REQUIRED_EVIDENCE_MISSING', 'UNVERIFIABLE');
    return finalResult(options.bundlePath, options.rpcUrl, stages);
  }

  const stageRunners: Array<{ name: StageResult['stage']; run: () => Promise<StageResult> }> = [
    { name: 'vault-signature', run: () => dependencies.verifyVaultSignature(bundle, options) },
    { name: 'commitment-matching', run: () => dependencies.matchCommitment(bundle) },
    { name: 'raw-byte-validation', run: () => dependencies.validateRawBytes(bundle) },
    { name: 'merkle-verification', run: () => dependencies.verifyMerkle(bundle) },
    { name: 'public-checkpoint-verification', run: () => dependencies.verifyPublicCheckpoint(bundle) },
  ];
  for (const { name, run } of stageRunners) {
    let stage: StageResult;
    try {
      stage = await run();
    } catch {
      stage = result(name, 'Verification stage failed unexpectedly; no integrity verdict was produced.',
        'VERIFIER_INTERNAL_ERROR', 'UNVERIFIABLE');
    }
    stages.push(stage);
    if (stage.status !== 'VERIFIED') return finalResult(options.bundlePath, options.rpcUrl, stages);
  }

  let rpcStage: StageResult;
  try {
    rpcStage = await dependencies.lookupCheckpoint(bundle, options.rpcUrl, options);
  } catch {
    rpcStage = result('direct-rpc', 'Direct RPC verification failed unexpectedly; no integrity verdict was produced.',
      'VERIFIER_INTERNAL_ERROR', 'UNVERIFIABLE');
  }
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
