import type { BatchEvidence, TrustedBatchConfig } from './core.js';
import type { ConnectEvidenceAnchor } from './rpc.js';

export type VerificationStatus = 'VERIFIED' | 'TAMPERED' | 'UNVERIFIABLE';

export type ReasonCode =
  | 'BUNDLE_NOT_FOUND'
  | 'BUNDLE_READ_FAILED'
  | 'BUNDLE_JSON_INVALID'
  | 'BUNDLE_SCHEMA_UNAVAILABLE'
  | 'REQUIRED_EVIDENCE_MISSING'
  | 'BUNDLE_FORMAT_UNSUPPORTED'
  | 'TRUSTED_CONFIG_MISSING'
  | 'SIGNATURE_INVALID'
  | 'CHAIN_ID_MISMATCH'
  | 'PAYLOAD_HASH_MISMATCH'
  | 'MERKLE_ROOT_MISMATCH'
  | 'PROOF_INVALID'
  | 'COMMITMENT_MISMATCH'
  | 'TRUSTED_CONFIG_MISMATCH'
  | 'CONTRACT_LOOKUP_UNAVAILABLE'
  | 'RPC_UNAVAILABLE'
  | 'RPC_RESPONSE_INVALID'
  | 'VERIFIER_INTERNAL_ERROR';

export type StageName =
  | 'bundle-parsing'
  | 'raw-byte-validation'
  | 'merkle-verification'
  | 'public-checkpoint-verification'
  | 'commitment-matching'
  | 'vault-signature'
  | 'direct-rpc';

export interface StageResult {
  stage: StageName;
  status: VerificationStatus;
  reasonCode?: ReasonCode;
  message: string;
}

export interface VerificationResult {
  status: VerificationStatus;
  reasonCode?: ReasonCode;
  message: string;
  bundlePath: string;
  rpcUrl: string;
  stages: StageResult[];
  verifiedAt: string;
}

export interface VerifyOptions {
  bundlePath: string;
  rpcUrl: string;
  trusted?: TrustedBatchConfig;
  connect?: ConnectEvidenceAnchor;
}

export interface ParsedBundle {
  path: string;
  evidence?: BatchEvidence;
}

export interface VerifierDependencies {
  parseBundle: (bundlePath: string) => Promise<StageResult & { bundle?: ParsedBundle }>;
  validateRawBytes: (bundle: ParsedBundle) => Promise<StageResult>;
  verifyMerkle: (bundle: ParsedBundle) => Promise<StageResult>;
  verifyPublicCheckpoint: (bundle: ParsedBundle) => Promise<StageResult>;
  matchCommitment: (bundle: ParsedBundle) => Promise<StageResult>;
  verifyVaultSignature: (bundle: ParsedBundle, options: VerifyOptions) => Promise<StageResult>;
  lookupCheckpoint: (bundle: ParsedBundle, rpcUrl: string, options: VerifyOptions) => Promise<StageResult>;
}
