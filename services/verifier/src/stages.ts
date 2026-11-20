import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { matchCommitment, result, validateRawBytes, verifyMerkle, verifyVaultSignature } from './core.js';
import { lookupBatch } from './rpc.js';
import type { ParsedBundle, StageResult, VerifierDependencies } from './types.js';

const maxJsonBytes = 1024 * 1024;
const zipMarkers = [0x04034b50, 0x06054b50, 0x08074b50];

export async function parseBundle(path: string): Promise<StageResult & { bundle?: ParsedBundle }> {
  const stage = 'bundle-parsing';
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile()) return result(stage, 'Bundle must be a regular file.', 'BUNDLE_READ_FAILED', 'UNVERIFIABLE');
      const marker = Buffer.alloc(4);
      const prefix = await file.read(marker, 0, marker.length, 0);
      if (prefix.bytesRead === marker.length && zipMarkers.includes(marker.readUInt32LE())) {
        return result(stage, 'ZIP export layout awaits backend approval.', 'BUNDLE_SCHEMA_UNAVAILABLE', 'UNVERIFIABLE');
      }
      if (stat.size > maxJsonBytes) {
        return result(stage, 'Unsupported bundle format.', 'BUNDLE_FORMAT_UNSUPPORTED', 'UNVERIFIABLE');
      }
      const data = Buffer.alloc(stat.size + 1);
      let length = 0;
      while (length < data.length) {
        const { bytesRead } = await file.read(data, length, data.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length !== stat.size) return result(stage, 'Bundle size changed during reading.', 'BUNDLE_READ_FAILED', 'UNVERIFIABLE');
      try {
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(0, length)));
      } catch {
        return result(stage, 'Bundle is not valid UTF-8 JSON.', 'BUNDLE_JSON_INVALID', 'UNVERIFIABLE');
      }
      return result(stage, 'JSON export layout awaits backend approval.', 'BUNDLE_SCHEMA_UNAVAILABLE', 'UNVERIFIABLE');
    } finally {
      await file.close();
    }
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    return result(stage, 'Unable to read bundle.', missing ? 'BUNDLE_NOT_FOUND' : 'BUNDLE_READ_FAILED', 'UNVERIFIABLE');
  }
}

function missingEvidence(stage: StageResult['stage']): StageResult {
  return result(stage, 'Normalized evidence is required.', 'REQUIRED_EVIDENCE_MISSING', 'UNVERIFIABLE');
}

export const defaultDependencies: VerifierDependencies = {
  parseBundle,
  validateRawBytes: async ({ evidence }) => evidence ? validateRawBytes(evidence) : missingEvidence('raw-byte-validation'),
  matchCommitment: async ({ evidence }) => evidence ? matchCommitment(evidence) : missingEvidence('commitment-matching'),
  verifyMerkle: async ({ evidence }) => evidence ? verifyMerkle(evidence) : missingEvidence('merkle-verification'),
  verifyVaultSignature: async ({ evidence }, { trusted }) => evidence
    ? verifyVaultSignature(evidence, trusted) : missingEvidence('vault-signature'),
  lookupCheckpoint: async ({ evidence }, rpcUrl, { trusted, connect }) => evidence && trusted
    ? lookupBatch(evidence, trusted, rpcUrl, connect) : missingEvidence('direct-rpc')
};
