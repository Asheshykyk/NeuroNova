import type { NextFunction, Request, Response } from 'express';
import { verifyAgentChunk } from '@trusttrace/core/agent';
import type { EvidenceStore } from '../storage/evidenceStore.ts';

export type TrustedAgentPublicKeyProvider = (sourceId: string) => string | undefined;

export interface IngestionOptions {
  store: EvidenceStore;
  trustedAgentPublicKeyProvider: TrustedAgentPublicKeyProvider;
}

interface IngestRequestBody {
  sourceId?: unknown;
  deliveryId?: unknown;
  streamId?: unknown;
  fileIdentity?: unknown;
  fileGeneration?: unknown;
  byteOffset?: unknown;
  observedAt?: unknown;
  rawEventBase64?: unknown;
  signature?: unknown;
}

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const UINT64_MAX = 0xffffffffffffffffn;

function isCanonicalBase64(value: string): boolean {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return false;
  }
  return Buffer.from(value, 'base64').toString('base64') === value;
}

function parseDecimalUint64(value: unknown, fieldName: string): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw Object.assign(new Error(`${fieldName} must be a decimal string`), { statusCode: 400 });
  }
  const parsed = BigInt(value);
  if (parsed > UINT64_MAX) {
    throw Object.assign(new Error(`${fieldName} exceeds uint64 range`), { statusCode: 400 });
  }
  return parsed;
}

function requiredString(body: IngestRequestBody, fieldName: keyof IngestRequestBody): string {
  const value = body[fieldName];
  if (typeof value !== 'string' || value.length === 0) {
    throw Object.assign(new Error(`${fieldName} is required and must be a string`), { statusCode: 400 });
  }
  return value;
}

export function createIngestHandler(options: IngestionOptions) {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      if (typeof request.body !== 'object' || request.body === null || Array.isArray(request.body)) {
        throw Object.assign(new Error('Request body must be a JSON object'), { statusCode: 400 });
      }

      const body = request.body as IngestRequestBody;
      const sourceId = requiredString(body, 'sourceId');
      const deliveryId = requiredString(body, 'deliveryId');
      const streamId = requiredString(body, 'streamId');
      const fileIdentity = requiredString(body, 'fileIdentity');
      const fileGeneration = requiredString(body, 'fileGeneration');
      const byteOffset = parseDecimalUint64(body.byteOffset, 'byteOffset');
      const observedAt = parseDecimalUint64(body.observedAt, 'observedAt');
      const rawEventBase64 = requiredString(body, 'rawEventBase64');
      const signature = requiredString(body, 'signature');

      if (!UUID_PATTERN.test(deliveryId)) {
        throw Object.assign(new Error('deliveryId must be a UUID string'), { statusCode: 400 });
      }

      if (!isCanonicalBase64(rawEventBase64)) {
        throw Object.assign(new Error('rawEventBase64 must be valid canonical Base64'), { statusCode: 400 });
      }
      const rawEventBytes = Buffer.from(rawEventBase64, 'base64');
      if (rawEventBytes.length === 0) {
        throw Object.assign(new Error('rawEventBytes must not be empty'), { statusCode: 400 });
      }

      if (!/^0x[0-9a-fA-F]{128}$/.test(signature)) {
        throw Object.assign(new Error('signature must be a 0x-prefixed 64-byte hex signature'), { statusCode: 400 });
      }
      const signatureBytes = Buffer.from(signature.slice(2), 'hex');

      const publicKey = options.trustedAgentPublicKeyProvider(sourceId);
      if (!publicKey) {
        throw Object.assign(new Error('No trusted public key is configured for sourceId'), { statusCode: 503 });
      }

      const chunk = {
        sourceId,
        deliveryId,
        streamId,
        fileIdentity,
        fileGeneration,
        byteOffset,
        observedAt,
        payload: rawEventBytes
      };

      if (!verifyAgentChunk(chunk, signatureBytes, publicKey)) {
        throw Object.assign(new Error('Invalid agent signature'), { statusCode: 401 });
      }

      let receipt;
      try {
        receipt = await options.store.append({
          sourceId,
          deliveryId,
          rawEventBytes,
          streamId,
          fileIdentity,
          fileGeneration,
          byteOffset,
          observedAt,
          observationSource: 'host-agent'
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/delivery.?id conflict/i.test(message) || /conflicting duplicate/i.test(message)) {
          throw Object.assign(new Error(message), { statusCode: 409 });
        }
        throw error;
      }

      console.log(`[Ingest] Received signed chunk from ${sourceId} (seq ${receipt.vaultSequence}, deliveryId ${deliveryId})`);

      response.status(receipt.duplicate ? 200 : 201).json({
        status: 'accepted',
        sourceId,
        deliveryId: receipt.deliveryId ?? deliveryId,
        vaultSequence: receipt.vaultSequence.toString(),
        vaultReceivedAt: receipt.receiptTimestamp,
        duplicate: receipt.duplicate
      });
    } catch (error) {
      const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
        ? (error as { statusCode?: number }).statusCode
        : 500;
      if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
        response.status(statusCode).json({
          error: error instanceof Error ? error.message : 'Request rejected'
        });
        return;
      }
      next(error);
    }
  };
}
