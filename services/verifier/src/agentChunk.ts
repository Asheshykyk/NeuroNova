import { readFile } from 'node:fs/promises';
import type { KeyObject } from 'node:crypto';
import {
  encodeAgentChunkPreimage,
  formatSourceId,
  parseAgentPublicKey,
  verifyAgentChunk,
} from '@trusttrace/core';
import type { AgentChunk } from '@trusttrace/core';
import type { AgentChunkVerificationResult, ReasonCode, VerificationStatus } from './types.js';

const uint64Max = (1n << 64n) - 1n;
const sourceIdPattern = /^0x[0-9a-f]{64}$/i;
const rawPublicKeyPattern = /^0x[0-9a-f]{64}$/i;
const signaturePattern = /^0x[0-9a-f]{128}$/i;
const fileGenerationPattern = /^dev:\d+:ino:\d+$/;
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

interface NormalizedAgentChunk {
  chunk: AgentChunk;
  signature: string;
  sourceId: string;
  deliveryId: string;
}

class LosslessJsonNumberSourceUnavailable extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
}

function makeResult(
  evidencePath: string,
  status: VerificationStatus,
  message: string,
  reasonCode?: ReasonCode,
  identity?: Pick<NormalizedAgentChunk, 'sourceId' | 'deliveryId'>,
): AgentChunkVerificationResult {
  return {
    scope: 'agent-chunk-signature-only',
    status,
    ...(reasonCode && { reasonCode }),
    message,
    evidencePath,
    ...(identity && { ...identity }),
    verifiedAt: new Date().toISOString(),
  };
}

function parseEvidenceJson(text: string): unknown {
  return JSON.parse(text, function (key, value) {
    if ((key === 'byteOffset' || key === 'observedAt') && typeof value === 'number') {
      const context = arguments[2] as { source?: unknown } | undefined;
      if (typeof context?.source !== 'string') {
        throw new LosslessJsonNumberSourceUnavailable();
      }
      if (/^(0|[1-9]\d*)$/.test(context.source)) return BigInt(context.source);
    }
    return value;
  });
}

function parseTrustedKeys(text: string): Map<string, KeyObject> | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(value)) return undefined;

  const keys = new Map<string, KeyObject>();
  for (const [sourceId, publicKey] of Object.entries(value)) {
    if (!sourceIdPattern.test(sourceId) || typeof publicKey !== 'string'
        || !rawPublicKeyPattern.test(publicKey)) return undefined;
    const normalizedSourceId = sourceId.toLowerCase();
    if (keys.has(normalizedSourceId)) return undefined;
    try {
      keys.set(normalizedSourceId, parseAgentPublicKey(publicKey));
    } catch {
      return undefined;
    }
  }
  return keys;
}

function decodeBase64(value: string): Buffer | undefined {
  if (!base64Pattern.test(value)) return undefined;
  const bytes = Buffer.from(value, 'base64');
  return bytes.toString('base64') === value ? bytes : undefined;
}

function normalizeEvidence(value: unknown): NormalizedAgentChunk | undefined {
  if (!isRecord(value) || !isRecord(value.chunk) || typeof value.signature !== 'string'
      || !signaturePattern.test(value.signature)) return undefined;

  const raw = value.chunk;
  if (typeof raw.sourceId !== 'string' || !sourceIdPattern.test(raw.sourceId)
      || typeof raw.deliveryId !== 'string' || raw.deliveryId.length === 0
      || typeof raw.streamId !== 'string' || typeof raw.fileIdentity !== 'string'
      || typeof raw.byteOffset !== 'bigint' || typeof raw.observedAt !== 'bigint'
      || typeof raw.payload !== 'string') return undefined;

  const deliveryIdBytes = Buffer.from(raw.deliveryId, 'utf8');
  if (deliveryIdBytes.length === 0 || deliveryIdBytes.length > 65_535
      || deliveryIdBytes.toString('utf8') !== raw.deliveryId) return undefined;
  if (raw.byteOffset < 0n || raw.byteOffset > uint64Max
      || raw.observedAt < 0n || raw.observedAt > uint64Max) return undefined;

  const hasFileGeneration = Object.hasOwn(raw, 'fileGeneration');
  let fileGeneration: string | undefined;
  if (hasFileGeneration) {
    if (typeof raw.fileGeneration !== 'string') return undefined;
    fileGeneration = raw.fileGeneration;
    if (fileGeneration !== '' && !fileGenerationPattern.test(fileGeneration)) return undefined;
  }

  const payload = decodeBase64(raw.payload);
  if (!payload || payload.length > 0xffff_ffff) return undefined;

  const chunk: AgentChunk = {
    sourceId: raw.sourceId,
    deliveryId: raw.deliveryId,
    streamId: raw.streamId,
    fileIdentity: raw.fileIdentity,
    ...(hasFileGeneration && { fileGeneration }),
    byteOffset: raw.byteOffset,
    observedAt: raw.observedAt,
    payload,
  };

  try {
    encodeAgentChunkPreimage(chunk);
    const sourceId = `0x${formatSourceId(chunk.sourceId).toString('hex')}`;
    return { chunk, signature: value.signature, sourceId, deliveryId: raw.deliveryId };
  } catch {
    return undefined;
  }
}

export function verifyAgentChunkEvidence(
  evidenceText: string,
  trustedKeysText: string,
  evidencePath = '<memory>',
): AgentChunkVerificationResult {
  const trustedKeys = parseTrustedKeys(trustedKeysText);
  if (!trustedKeys) {
    return makeResult(evidencePath, 'UNVERIFIABLE', 'Trusted AgentChunk key configuration is invalid.',
      'TRUSTED_CONFIG_INVALID');
  }

  let parsedEvidence: unknown;
  try {
    parsedEvidence = parseEvidenceJson(evidenceText);
  } catch (error) {
    if (error instanceof LosslessJsonNumberSourceUnavailable) {
      return makeResult(evidencePath, 'UNVERIFIABLE',
        'Runtime cannot preserve exact numeric tokens required by AgentChunk evidence.',
        'BUNDLE_FORMAT_UNSUPPORTED');
    }
    return makeResult(evidencePath, 'UNVERIFIABLE', 'AgentChunk evidence is not valid JSON.',
      'BUNDLE_JSON_INVALID');
  }

  const normalized = normalizeEvidence(parsedEvidence);
  if (!normalized) {
    return makeResult(evidencePath, 'UNVERIFIABLE', 'AgentChunk evidence fields are missing, malformed, or unsupported.',
      'AGENT_CHUNK_FORMAT_INVALID');
  }

  const trustedKey = trustedKeys.get(normalized.sourceId);
  if (!trustedKey) {
    return makeResult(evidencePath, 'UNVERIFIABLE', 'No trusted AgentChunk key is configured for this source.',
      'TRUSTED_CONFIG_MISSING', normalized);
  }

  try {
    if (!verifyAgentChunk(normalized.chunk, normalized.signature, trustedKey)) {
      return makeResult(evidencePath, 'TAMPERED', 'AgentChunk signature does not match the trusted source key.',
        'SIGNATURE_INVALID', normalized);
    }
  } catch {
    return makeResult(evidencePath, 'UNVERIFIABLE', 'AgentChunk signature verification could not be completed.',
      'VERIFIER_INTERNAL_ERROR', normalized);
  }

  return makeResult(evidencePath, 'VERIFIED',
    'AgentChunk signature verified; Vault, Merkle, and public-chain checks were not performed.',
    undefined, normalized);
}

export async function verifyAgentChunkFiles(
  evidencePath: string,
  trustedKeysPath: string,
): Promise<AgentChunkVerificationResult> {
  let evidenceText: string;
  try {
    evidenceText = await readFile(evidencePath, 'utf8');
  } catch (error) {
    const missing = errorCode(error) === 'ENOENT';
    return makeResult(evidencePath, 'UNVERIFIABLE', 'Unable to read AgentChunk evidence.',
      missing ? 'BUNDLE_NOT_FOUND' : 'BUNDLE_READ_FAILED');
  }

  let trustedKeysText: string;
  try {
    trustedKeysText = await readFile(trustedKeysPath, 'utf8');
  } catch (error) {
    const missing = errorCode(error) === 'ENOENT';
    return makeResult(evidencePath, 'UNVERIFIABLE', 'Unable to read trusted AgentChunk key configuration.',
      missing ? 'TRUSTED_CONFIG_MISSING' : 'TRUSTED_CONFIG_INVALID');
  }

  return verifyAgentChunkEvidence(evidenceText, trustedKeysText, evidencePath);
}
