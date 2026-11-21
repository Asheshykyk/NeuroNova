import { ApiTransport } from './apiTransport';

export type AuditorStatus = 'VERIFIED' | 'TAMPERED' | 'UNVERIFIABLE';
export type AuditorStageName =
  | 'rest-fetch'
  | 'vault-signature'
  | 'commitment-matching'
  | 'raw-byte-validation'
  | 'merkle-verification'
  | 'direct-rpc'
  | 'public-checkpoint-verification';

export interface AuditorCheck {
  check: 'payload-sha256' | 'canonical-leaf';
  status: AuditorStatus;
  reasonCode?: string;
  message: string;
}

export interface AuditorStage {
  stage: AuditorStageName;
  status: AuditorStatus;
  reasonCode?: string;
  message: string;
  checks?: AuditorCheck[];
}

export interface AuditorRestResult {
  scope: 'vault-rest';
  sourceId: string;
  vaultSequence: string;
  batchId?: string;
  status: AuditorStatus;
  reasonCode?: string;
  message: string;
  tier1: {
    status: AuditorStatus;
    reasonCode?: string;
    stages: AuditorStage[];
  };
  tier2: AuditorStage;
}

export interface RestVerificationIdentity {
  sourceId: string;
  sequence: string;
}

const sourceIdPattern = /^0x[0-9a-f]{64}$/i;
const sequencePattern = /^[1-9]\d{0,19}$/;
const uint64Max = (1n << 64n) - 1n;
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStatus(value: unknown): value is AuditorStatus {
  return value === 'VERIFIED' || value === 'TAMPERED' || value === 'UNVERIFIABLE';
}

function isStageName(value: unknown): value is AuditorStageName {
  return value === 'rest-fetch'
    || value === 'vault-signature'
    || value === 'commitment-matching'
    || value === 'raw-byte-validation'
    || value === 'merkle-verification'
    || value === 'direct-rpc'
    || value === 'public-checkpoint-verification';
}

function isCheck(value: unknown): value is AuditorCheck {
  return isRecord(value)
    && (value.check === 'payload-sha256' || value.check === 'canonical-leaf')
    && isStatus(value.status)
    && typeof value.message === 'string'
    && (value.reasonCode === undefined || typeof value.reasonCode === 'string');
}

function isStage(value: unknown): value is AuditorStage {
  return isRecord(value)
    && isStageName(value.stage)
    && isStatus(value.status)
    && typeof value.message === 'string'
    && (value.reasonCode === undefined || typeof value.reasonCode === 'string')
    && (value.checks === undefined || (Array.isArray(value.checks) && value.checks.every(isCheck)));
}

export function isAuditorRestResult(value: unknown): value is AuditorRestResult {
  return isRecord(value)
    && value.scope === 'vault-rest'
    && typeof value.sourceId === 'string'
    && sourceIdPattern.test(value.sourceId)
    && typeof value.vaultSequence === 'string'
    && sequencePattern.test(value.vaultSequence)
    && BigInt(value.vaultSequence) <= uint64Max
    && (value.batchId === undefined || (typeof value.batchId === 'string' && sourceIdPattern.test(value.batchId)))
    && isStatus(value.status)
    && typeof value.message === 'string'
    && (value.reasonCode === undefined || typeof value.reasonCode === 'string')
    && isRecord(value.tier1)
    && isStatus(value.tier1.status)
    && (value.tier1.reasonCode === undefined || typeof value.tier1.reasonCode === 'string')
    && Array.isArray(value.tier1.stages)
    && value.tier1.stages.every(isStage)
    && isStage(value.tier2)
    && value.tier2.stage === 'public-checkpoint-verification';
}

const transport = new ApiTransport({ baseUrl: '', timeoutMs: 120_000 });

export function requestRestVerification(
  identity: RestVerificationIdentity,
  signal?: AbortSignal,
): Promise<AuditorRestResult> {
  if (!sourceIdPattern.test(identity.sourceId)
      || !sequencePattern.test(identity.sequence)
      || BigInt(identity.sequence) > uint64Max) {
    throw new TypeError('Source ID or sequence is invalid.');
  }
  return transport.request('/api/verifier/verify-rest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(identity),
    signal,
    validate: isAuditorRestResult,
  }).then((result) => {
    if (result.sourceId.toLowerCase() !== identity.sourceId.toLowerCase()
        || result.vaultSequence !== identity.sequence) {
      throw new Error('Auditor response identity does not match the request.');
    }
    return result;
  });
}
