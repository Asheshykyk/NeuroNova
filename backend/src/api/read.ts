import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { formatSourceIdHex } from '@trusttrace/core/canonical';
import type { EvidenceStore } from '../storage/evidenceStore.ts';
import type { EvidenceBatchManager } from '../batching/EvidenceBatchManager.ts';
import type { EvidenceBatchRecord } from '../batching/types.ts';
import type { AnchoringWorker } from '../blockchain/AnchoringWorker.ts';
import type { EvidenceVerifier } from '../verification/EvidenceVerifier.ts';

export interface ReadApiOptions {
  store: EvidenceStore;
  batchManager?: EvidenceBatchManager;
  anchoringWorker?: AnchoringWorker;
  verifier?: EvidenceVerifier;
}

interface CursorPayload {
  sourceId: string;
  vaultSequence: string;
}

function nanosecondsToIso(observedAt: string | undefined): string | null {
  if (observedAt === undefined || !/^\d+$/.test(observedAt)) return null;
  try {
    const milliseconds = BigInt(observedAt) / 1_000_000n;
    if (milliseconds > 8_640_000_000_000000n || milliseconds < -8_640_000_000_000000n) return null;
    return new Date(Number(milliseconds)).toISOString();
  } catch {
    return null;
  }
}

function payloadSha256(rawBytes: Buffer): string {
  return '0x' + crypto.createHash('sha256').update(rawBytes).digest('hex');
}

function encodeCursor(sourceId: string, vaultSequence: bigint): string {
  return Buffer.from(JSON.stringify({ sourceId, vaultSequence: vaultSequence.toString() }), 'utf8').toString('base64url');
}

function decodeCursor(value: unknown): CursorPayload | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<CursorPayload>;
    if (typeof parsed.sourceId !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(parsed.sourceId)) return null;
    if (typeof parsed.vaultSequence !== 'string' || !/^\d+$/.test(parsed.vaultSequence)) return null;
    if (BigInt(parsed.vaultSequence) < 1n) return null;
    return { sourceId: parsed.sourceId, vaultSequence: parsed.vaultSequence };
  } catch {
    return null;
  }
}

function parseLimit(value: unknown): number {
  if (value === undefined) return 100;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw Object.assign(new Error('limit must be a positive integer'), { statusCode: 400, code: 'INVALID_LIMIT' });
  }
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw Object.assign(new Error('limit must be between 1 and 1000'), { statusCode: 400, code: 'INVALID_LIMIT' });
  }
  return limit;
}

function badCursor(): never {
  throw Object.assign(new Error('Malformed or invalid cursor'), { statusCode: 400, code: 'INVALID_CURSOR' });
}

function sourceFilter(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') badCursor();
  if (value.startsWith('0x') && (!/^0x[0-9a-fA-F]{64}$/.test(value))) {
    throw Object.assign(new Error('Invalid sourceId'), { statusCode: 400, code: 'INVALID_SOURCE_ID' });
  }
  try {
    return formatSourceIdHex(value);
  } catch {
    throw Object.assign(new Error('Invalid sourceId'), { statusCode: 400, code: 'INVALID_SOURCE_ID' });
  }
}

function sortEvents(records: ReturnType<EvidenceStore['readPersistedEvidence']>) {
  return [...records].sort((left, right) => {
    const sourceComparison = left.record.sourceId.localeCompare(right.record.sourceId);
    if (sourceComparison !== 0) return sourceComparison;
    const leftSequence = BigInt(left.record.vaultSequence);
    const rightSequence = BigInt(right.record.vaultSequence);
    return leftSequence < rightSequence ? -1 : leftSequence > rightSequence ? 1 : 0;
  });
}

function anchorStatus(options: ReadApiOptions, batch: EvidenceBatchRecord): string {
  const status = options.anchoringWorker?.getLatestStatuses().get(batch.batchId);
  if (status?.status === 'confirmed') return 'ANCHORED';
  if (status?.status === 'failed') return 'ANCHOR_FAILED';
  if (status?.status === 'submitted') return 'ANCHOR_PENDING';
  return 'ANCHOR_PENDING';
}

export function createSourcesHandler(options: ReadApiOptions) {
  return (request: Request, response: Response, next: NextFunction): void => {
    try {
      const limit = parseLimit(request.query.limit);
      const cursorValue = request.query.cursor;
      let cursor: CursorPayload | null = null;
      if (cursorValue !== undefined) {
        cursor = decodeCursor(cursorValue);
        if (!cursor) badCursor();
      }
      const counts = new Map<string, { eventCount: number; latestVaultSequence: bigint; latestReceiptAt: string }>();
      for (const { record } of options.store.readPersistedEvidence()) {
        const sequence = BigInt(record.vaultSequence);
        const current = counts.get(record.sourceId);
        if (!current || sequence > current.latestVaultSequence) {
          counts.set(record.sourceId, {
            eventCount: (current?.eventCount ?? 0) + 1,
            latestVaultSequence: sequence,
            latestReceiptAt: record.receiptTimestamp
          });
        } else {
          current.eventCount += 1;
        }
      }

      const sourceIds = Array.from(counts.keys()).sort();
      let startIndex = 0;
      if (cursor) {
        const index = sourceIds.indexOf(cursor.sourceId);
        if (index >= 0) startIndex = index + 1;
      }
      const page = sourceIds.slice(startIndex, startIndex + limit);
      const items = page.map((sourceId) => {
        const count = counts.get(sourceId)!;
        return {
          sourceId,
          eventCount: count.eventCount,
          latestVaultSequence: count.latestVaultSequence.toString(),
          latestReceiptAt: count.latestReceiptAt
        };
      });
      const last = page.at(-1);
      const nextCursor = page.length === limit && last
        ? encodeCursor(last, counts.get(last)!.latestVaultSequence)
        : null;
      response.status(200).json({ items, nextCursor });
    } catch (error) {
      next(error);
    }
  };
}

export function createEventsHandler(options: ReadApiOptions) {
  return (request: Request, response: Response, next: NextFunction): void => {
    try {
      const limit = parseLimit(request.query.limit);
      const filter = sourceFilter(request.query.sourceId);
      const cursorValue = request.query.cursor;
      let cursor: CursorPayload | null = null;
      if (cursorValue !== undefined) {
        cursor = decodeCursor(cursorValue);
        if (!cursor) badCursor();
      }

      let records = sortEvents(options.store.readPersistedEvidence());
      if (filter) records = records.filter(({ record }) => record.sourceId === filter);

      if (cursor) {
        const cursorSequence = BigInt(cursor.vaultSequence);
        records = records.filter(({ record }) => {
          if (filter && record.sourceId !== cursor.sourceId) return false;
          if (record.sourceId < cursor.sourceId) return false;
          if (record.sourceId === cursor.sourceId) return BigInt(record.vaultSequence) > cursorSequence;
          return true;
        });
      }

      const page = records.slice(0, limit);
      const items = page.map(({ record, rawBytes }) => {
        const sequence = BigInt(record.vaultSequence);
        const batch = options.batchManager?.listBatchRecords().find((candidate) =>
          candidate.sourceId === record.sourceId
          && candidate.evidenceMappings.some((mapping) => BigInt(mapping.vaultSequence) === sequence)
        );
        return {
          eventId: `${record.sourceId}-${sequence.toString().padStart(12, '0')}`,
          sourceId: record.sourceId,
          vaultSequence: record.vaultSequence,
          streamId: record.streamId ?? record.observationSource ?? null,
          hostTimestamp: nanosecondsToIso(record.observedAt),
          vaultReceivedAt: record.receiptTimestamp,
          deliveryId: record.deliveryId ?? null,
          fileIdentity: record.fileIdentity ?? null,
          byteOffset: record.byteOffset ?? null,
          observationSource: record.observationSource ?? null,
          payloadSha256: payloadSha256(rawBytes),
          batchId: batch?.batchId ?? null,
          verificationStatus: batch
            ? anchorStatus(options, batch)
            : 'VAULT_PERSISTED'
        };
      });

      const lastRecord = page.at(-1)?.record;
      const nextCursor = records.length > limit && lastRecord
        ? encodeCursor(lastRecord.sourceId, BigInt(lastRecord.vaultSequence))
        : null;
      response.status(200).json({ items, nextCursor });
    } catch (error) {
      next(error);
    }
  };
}

export function createEventDetailHandler(options: ReadApiOptions) {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      let sourceId: string;
      let vaultSequence: bigint;
      try {
        if (typeof request.params.sourceId === 'string' && typeof request.params.vaultSequence === 'string') {
          sourceId = formatSourceIdHex(request.params.sourceId);
        } else if (typeof request.params.vaultSequence === 'string') {
          if (typeof request.query.sourceId !== 'string') {
            throw Object.assign(new Error('sourceId query parameter is required'), { statusCode: 400, code: 'SOURCE_ID_REQUIRED' });
          }
          sourceId = formatSourceIdHex(request.query.sourceId);
        } else {
          throw Object.assign(new Error('sourceId and vaultSequence are required'), { statusCode: 400, code: 'INVALID_EVENT_IDENTITY' });
        }

        const sequenceValue = request.params.vaultSequence;
        if (typeof sequenceValue !== 'string' || !/^\d+$/.test(sequenceValue)) {
          throw Object.assign(new Error('vaultSequence must be a positive decimal integer'), { statusCode: 400, code: 'INVALID_VAULT_SEQUENCE' });
        }
        vaultSequence = BigInt(sequenceValue);
        if (vaultSequence < 1n || vaultSequence > 0xffffffffffffffffn) {
          throw Object.assign(new Error('vaultSequence must be within the uint64 range'), { statusCode: 400, code: 'INVALID_VAULT_SEQUENCE' });
        }
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'statusCode' in error) throw error;
        throw Object.assign(new Error('Invalid event identity'), { statusCode: 400, code: 'INVALID_EVENT_IDENTITY' });
      }
      const persisted = options.store.readPersistedEvidence().find(({ record }) => record.sourceId === sourceId && BigInt(record.vaultSequence) === vaultSequence);
      if (!persisted) {
        throw Object.assign(new Error('Evidence record not found'), { statusCode: 404, code: 'EVENT_NOT_FOUND' });
      }

      const batch = options.batchManager?.listBatchRecords().find((candidate) =>
        candidate.sourceId === sourceId
        && candidate.evidenceMappings.some((mapping) => BigInt(mapping.vaultSequence) === vaultSequence)
      );
      const proof = batch
        ? (await options.batchManager?.getBatchForAnchoring(batch.batchId))?.proofs.find((_proof, index) => BigInt(batch.evidenceMappings[index].vaultSequence) === vaultSequence) ?? null
        : null;

      response.status(200).json({
        eventId: `${sourceId}-${vaultSequence.toString().padStart(12, '0')}`,
        sourceId,
        vaultSequence: vaultSequence.toString(),
        streamId: persisted.record.streamId ?? persisted.record.observationSource ?? null,
        hostTimestamp: nanosecondsToIso(persisted.record.observedAt),
        vaultReceivedAt: persisted.record.receiptTimestamp,
        deliveryId: persisted.record.deliveryId ?? null,
        rawPayloadBase64: persisted.record.rawEventBytesBase64,
        payloadSha256: payloadSha256(persisted.rawBytes),
        signature: null,
        keyId: null,
        correlationStatus: null,
        batchId: batch?.batchId ?? null,
        verificationStatus: batch ? anchorStatus(options, batch) : 'VAULT_PERSISTED',
        merkleProof: proof
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'statusCode' in error) {
        response.status((error as { statusCode: number }).statusCode).json({
          code: 'code' in error ? (error as { code: string }).code : 'REQUEST_ERROR',
          error: error instanceof Error ? error.message : 'Request rejected'
        });
        return;
      }
      next(error);
    }
  };
}

export function createBatchesHandler(options: ReadApiOptions) {
  return (request: Request, response: Response, next: NextFunction): void => {
    try {
      const limit = parseLimit(request.query.limit);
      const filter = sourceFilter(request.query.sourceId);
      const cursorValue = request.query.cursor;
      let cursor: CursorPayload | null = null;
      if (cursorValue !== undefined) {
        cursor = decodeCursor(cursorValue);
        if (!cursor) badCursor();
      }
      let batches = [...(options.batchManager?.listBatchRecords() ?? [])].sort((a, b) => {
        const sourceComparison = a.sourceId.localeCompare(b.sourceId);
        if (sourceComparison !== 0) return sourceComparison;
        return BigInt(a.sequenceStart) < BigInt(b.sequenceStart) ? -1 : 1;
      });
      if (filter) batches = batches.filter((batch) => batch.sourceId === filter);
      if (cursor) {
        batches = batches.filter((batch) => {
          if (batch.sourceId < cursor!.sourceId) return false;
          if (batch.sourceId > cursor!.sourceId) return true;
          return BigInt(batch.sequenceStart) > BigInt(cursor!.vaultSequence);
        });
      }
      const page = batches.slice(0, limit);
      const items = page.map((batch) => {
        const status = options.anchoringWorker?.getLatestStatuses().get(batch.batchId);
        return {
          batchId: batch.batchId,
          sourceId: batch.sourceId,
          startSequence: batch.sequenceStart,
          endSequence: batch.sequenceEnd,
          leafCount: Number(batch.leafCount),
          merkleRoot: batch.merkleRoot,
          previousBatchRoot: batch.previousCheckpointHash,
          commitmentHash: batch.commitmentHash,
          createdAt: batch.createdAt,
          transactionHash: status?.transactionHash ?? null,
          chainId: status?.chainId ?? null,
          blockNumber: status?.blockNumber ?? null,
          anchorStatus: anchorStatus(options, batch)
        };
      });
      const last = page.at(-1);
      const nextCursor = batches.length > limit && last
        ? encodeCursor(last.sourceId, BigInt(last.sequenceStart))
        : null;
      response.status(200).json({ items, nextCursor });
    } catch (error) {
      next(error);
    }
  };
}

export function createCheckpointsHandler(_options: ReadApiOptions) {
  return (request: Request, response: Response): void => {
    const limit = parseLimit(request.query.limit);
    void limit;
    response.status(200).json({ items: [], nextCursor: null });
  };
}

export function createGapsHandler(options: ReadApiOptions) {
  return (request: Request, response: Response, next: NextFunction): void => {
    try {
      const limit = parseLimit(request.query.limit);
      const filter = sourceFilter(request.query.sourceId);
      const cursorValue = request.query.cursor;
      let cursor: CursorPayload | null = null;
      if (cursorValue !== undefined) {
        cursor = decodeCursor(cursorValue);
        if (!cursor) badCursor();
      }
      const sequencesBySource = new Map<string, bigint[]>();
      for (const { record } of options.store.readPersistedEvidence()) {
        if (filter && record.sourceId !== filter) continue;
        if (!sequencesBySource.has(record.sourceId)) sequencesBySource.set(record.sourceId, []);
        sequencesBySource.get(record.sourceId)!.push(BigInt(record.vaultSequence));
      }

      const gaps: Array<{ sourceId: string; gapType: 'SEQUENCE_GAP'; startSequence: string; endSequence: string; missingSequences: string[] }> = [];
      for (const sourceId of Array.from(sequencesBySource.keys()).sort()) {
        const unique = Array.from(new Set(sequencesBySource.get(sourceId)!)).sort((a, b) => a < b ? -1 : 1);
        if (unique.length === 0) continue;
        let start = unique[0];
        if (start > 1n) {
          gaps.push({ sourceId, gapType: 'SEQUENCE_GAP', startSequence: '1', endSequence: (start - 1n).toString(), missingSequences: [] });
        }
        for (let index = 0; index < unique.length - 1; index += 1) {
          const current = unique[index];
          const next = unique[index + 1];
          if (next > current + 1n) {
            const missing: string[] = [];
            for (let sequence = current + 1n; sequence < next; sequence += 1n) missing.push(sequence.toString());
            gaps.push({ sourceId, gapType: 'SEQUENCE_GAP', startSequence: (current + 1n).toString(), endSequence: (next - 1n).toString(), missingSequences: missing });
          }
        }
      }
      let pagedGaps = gaps;
      if (cursor) {
        pagedGaps = gaps.filter((gap) => {
          if (gap.sourceId < cursor!.sourceId) return false;
          if (gap.sourceId > cursor!.sourceId) return true;
          return BigInt(gap.endSequence) > BigInt(cursor!.vaultSequence);
        });
      }
      const page = pagedGaps.slice(0, limit);
      const last = page.at(-1);
      const nextCursor = pagedGaps.length > limit && last
        ? encodeCursor(last.sourceId, BigInt(last.endSequence))
        : null;
      response.status(200).json({ items: page, nextCursor });
    } catch (error) {
      next(error);
    }
  };
}
