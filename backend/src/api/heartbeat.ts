import type { NextFunction, Request, Response } from 'express';
import { verifyAgentHeartbeat } from '@trusttrace/core/agent';
import type { EvidenceStore } from '../storage/evidenceStore.ts';

export type TrustedAgentPublicKeyProvider = (sourceId: string) => string | undefined;

export interface HeartbeatOptions {
  store: EvidenceStore;
  trustedAgentPublicKeyProvider: TrustedAgentPublicKeyProvider;
  trustedAgentPublicKeyHistoryProvider?: (sourceId: string) => string[];
}

interface HeartbeatRequestBody {
  sourceId?: unknown;
  heartbeatSequence?: unknown;
  observedAt?: unknown;
  lastByteOffset?: unknown;
  status?: unknown;
  signature?: unknown;
}

const UINT64_MAX = 0xffffffffffffffffn;

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

function requiredString(body: HeartbeatRequestBody, fieldName: keyof HeartbeatRequestBody): string {
  const value = body[fieldName];
  if (typeof value !== 'string' || value.length === 0) {
    throw Object.assign(new Error(`${fieldName} is required and must be a string`), { statusCode: 400 });
  }
  return value;
}

export function createHeartbeatHandler(options: HeartbeatOptions) {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      if (typeof request.body !== 'object' || request.body === null || Array.isArray(request.body)) {
        throw Object.assign(new Error('Request body must be a JSON object'), { statusCode: 400 });
      }

      const body = request.body as HeartbeatRequestBody;
      const sourceId = requiredString(body, 'sourceId');
      const heartbeatSequence = parseDecimalUint64(body.heartbeatSequence, 'heartbeatSequence');
      const observedAt = parseDecimalUint64(body.observedAt, 'observedAt');
      const lastByteOffset = parseDecimalUint64(body.lastByteOffset, 'lastByteOffset');
      const status = requiredString(body, 'status');
      const signature = requiredString(body, 'signature');

      if (heartbeatSequence < 1n) {
        throw Object.assign(new Error('heartbeatSequence must be at least 1'), { statusCode: 400 });
      }
      if (!/^0x[0-9a-fA-F]{128}$/.test(signature)) {
        throw Object.assign(new Error('signature must be a 0x-prefixed 64-byte hex signature'), { statusCode: 400 });
      }

      const publicKey = options.trustedAgentPublicKeyProvider(sourceId);
      if (!publicKey) {
        throw Object.assign(new Error('No trusted public key is configured for sourceId'), { statusCode: 503 });
      }

      const heartbeat = {
        sourceId,
        heartbeatSequence,
        observedAt,
        lastByteOffset,
        status
      };

      const history = options.trustedAgentPublicKeyHistoryProvider?.(sourceId) ?? [];
      const keys = Array.from(new Set([publicKey, ...history]));
      if (!keys.some((key) => verifyAgentHeartbeat(heartbeat, signature, key))) {
        throw Object.assign(new Error('Invalid agent heartbeat signature'), { statusCode: 401 });
      }

      try {
        const receipt = await options.store.acceptHeartbeat(
          sourceId,
          heartbeatSequence,
          observedAt,
          lastByteOffset,
          status,
          signature,
          publicKey
        );

        response.status(200).json({
          status: 'accepted',
          sourceId,
          heartbeatSequence: receipt.heartbeatSequence.toString(),
          vaultReceivedAt: receipt.vaultReceivedAt,
          availability: receipt.availability
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/replay|out-of-order/i.test(message)) {
          throw Object.assign(new Error(message), { statusCode: 409 });
        }
        throw error;
      }
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
