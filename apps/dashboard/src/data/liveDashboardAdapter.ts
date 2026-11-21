import { DashboardApiService, type CursorListQuery, type CursorPage } from './apiService';
import { ApiTransport } from './apiTransport';
import type { DashboardConfig } from './config';

type Guard<T> = (value: unknown) => value is T;
type Row = Record<string, unknown>;

const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string';
const decimal = (value: unknown): value is string => text(value) && /^(0|[1-9]\d*)$/.test(value);
const sequence = (value: unknown): value is string => decimal(value) && value !== '0' && BigInt(value) <= 0xffffffffffffffffn;
const hash = (value: unknown): value is string => text(value) && /^0x[0-9a-f]{64}$/i.test(value);
const date = (value: unknown): value is string => text(value) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value)
  && Number.isFinite(Date.parse(value));
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const nullable = <T,>(guard: Guard<T>) => (value: unknown): value is T | null => value === null || guard(value);
const base64 = (value: unknown): value is string => text(value) && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);

const anchorStatuses = {
  ANCHOR_PENDING: 'PENDING',
  ANCHORED: 'ANCHORED_SERVER_REPORTED',
  ANCHOR_FAILED: 'ANCHOR_FAILED',
} as const;
type WireAnchorStatus = keyof typeof anchorStatuses;
const isAnchor = (value: unknown): value is WireAnchorStatus => text(value) && Object.hasOwn(anchorStatuses, value);

export interface VaultSource {
  sourceId: string;
  eventCount: number;
  latestVaultSequence: string;
  latestReceiptAt: string;
}

interface EventSummary {
  eventId: string;
  sourceId: string;
  vaultSequence: string;
  streamId: string | null;
  hostTimestamp: string | null;
  vaultReceivedAt: string;
  deliveryId: string | null;
  payloadSha256: string;
  batchId: string | null;
}

interface EventWire extends EventSummary {
  verificationStatus: 'VAULT_PERSISTED' | WireAnchorStatus;
}

interface FeedWire extends EventWire {
  observationSource: string | null;
  fileIdentity: string | null;
  byteOffset: string | null;
}

type AnchorState = (typeof anchorStatuses)[WireAnchorStatus];
type EventStatus = { vaultPersistenceStatus: 'VAULT_PERSISTED'; localAnchorStatus: AnchorState | null };
export type VaultEvent = Omit<FeedWire, 'verificationStatus'> & EventStatus;

interface MerkleProof {
  leafIndex: number;
  leafCount: number;
  leafHash: string;
  root: string;
  siblings: string[];
  steps: Array<{ position: 'left' | 'right' | 'promoted'; sibling: string | null }>;
}

interface DetailWire extends EventWire {
  rawPayloadBase64: string;
  signature: null;
  keyId: null;
  correlationStatus: null;
  merkleProof: MerkleProof | null;
}

export type VaultEventDetail = Omit<DetailWire, 'verificationStatus' | 'rawPayloadBase64'> & EventStatus & {
  rawBytes: Uint8Array;
};

interface BatchWire {
  batchId: string;
  sourceId: string;
  startSequence: string;
  endSequence: string;
  leafCount: number;
  merkleRoot: string;
  previousBatchRoot: string;
  commitmentHash: string;
  createdAt: string;
  transactionHash: string | null;
  chainId: string | null;
  blockNumber: string | null;
  anchorStatus: WireAnchorStatus;
}

export type VaultBatch = Omit<BatchWire, 'previousBatchRoot' | 'anchorStatus'> & {
  previousCommitmentHash: string;
  localAnchorStatus: AnchorState;
};

export interface SequenceGap {
  sourceId: string;
  gapType: 'SEQUENCE_GAP';
  startSequence: string;
  endSequence: string;
  missingSequences: string[];
}

const isSource: Guard<VaultSource> = (v): v is VaultSource => isRow(v) && hash(v.sourceId)
  && count(v.eventCount) && sequence(v.latestVaultSequence) && date(v.latestReceiptAt);

const hasEventSummary = (v: Row) => text(v.eventId) && hash(v.sourceId) && sequence(v.vaultSequence)
  && nullable(text)(v.streamId) && nullable(date)(v.hostTimestamp) && date(v.vaultReceivedAt)
  && nullable(text)(v.deliveryId) && hash(v.payloadSha256) && nullable(hash)(v.batchId)
  && (v.verificationStatus === 'VAULT_PERSISTED' || isAnchor(v.verificationStatus));

const isFeed: Guard<FeedWire> = (v): v is FeedWire => isRow(v) && hasEventSummary(v)
  && nullable(text)(v.observationSource) && nullable(text)(v.fileIdentity) && nullable(decimal)(v.byteOffset);

const isProof: Guard<MerkleProof> = (v): v is MerkleProof => isRow(v) && count(v.leafIndex) && count(v.leafCount)
  && hash(v.leafHash) && hash(v.root) && Array.isArray(v.siblings) && v.siblings.every(hash)
  && Array.isArray(v.steps) && v.steps.every((step) => isRow(step)
    && (step.position === 'promoted' ? step.sibling === null
      : (step.position === 'left' || step.position === 'right') && hash(step.sibling)));

const isDetail: Guard<DetailWire> = (v): v is DetailWire => isRow(v) && hasEventSummary(v)
  && base64(v.rawPayloadBase64) && v.signature === null && v.keyId === null
  && v.correlationStatus === null && nullable(isProof)(v.merkleProof);

const isBatch: Guard<BatchWire> = (v): v is BatchWire => isRow(v) && hash(v.batchId) && hash(v.sourceId)
  && sequence(v.startSequence) && sequence(v.endSequence) && count(v.leafCount)
  && hash(v.merkleRoot) && hash(v.previousBatchRoot) && hash(v.commitmentHash) && date(v.createdAt)
  && nullable(hash)(v.transactionHash) && nullable(decimal)(v.chainId) && nullable(decimal)(v.blockNumber)
  && isAnchor(v.anchorStatus);

const isGap: Guard<SequenceGap> = (v): v is SequenceGap => isRow(v) && hash(v.sourceId)
  && v.gapType === 'SEQUENCE_GAP' && sequence(v.startSequence) && sequence(v.endSequence)
  && Array.isArray(v.missingSequences) && v.missingSequences.every(sequence);

function eventSummary(v: EventWire): EventSummary & EventStatus {
  const { eventId, sourceId, vaultSequence, streamId, hostTimestamp, vaultReceivedAt, deliveryId, payloadSha256, batchId } = v;
  return {
    eventId, sourceId, vaultSequence, streamId, hostTimestamp, vaultReceivedAt, deliveryId, payloadSha256, batchId,
    vaultPersistenceStatus: 'VAULT_PERSISTED',
    localAnchorStatus: v.verificationStatus === 'VAULT_PERSISTED' ? null : anchorStatuses[v.verificationStatus],
  };
}

type PageQuery = { cursor?: string; sourceId?: string; limit?: number };

export function createLiveDashboardAdapter(config: DashboardConfig) {
  const api = new DashboardApiService(new ApiTransport({
    baseUrl: config.apiBaseUrl ?? '/api/v1',
    timeoutMs: config.requestTimeoutMs,
  }));

  function list<T>(path: string, query: PageQuery, signal: AbortSignal, isItem: Guard<T>) {
    const { sourceId, ...options } = query;
    const apiQuery: CursorListQuery = sourceId ? { ...options, sourceId } : options;
    return api.get(path, {
      query: apiQuery,
      signal,
      validate: (v): v is CursorPage<T> => isRow(v) && Array.isArray(v.items)
        && v.items.every(isItem) && (v.nextCursor === null || (text(v.nextCursor) && v.nextCursor.length > 0)),
    });
  }

  return {
    getSources: (query: Omit<PageQuery, 'sourceId'>, signal: AbortSignal) => list('/sources', query, signal, isSource),
    async getEvents(query: PageQuery, signal: AbortSignal): Promise<CursorPage<VaultEvent>> {
      const { items, nextCursor } = await list('/events', query, signal, isFeed);
      return { nextCursor, items: items.map((v) => ({
        ...eventSummary(v), observationSource: v.observationSource, fileIdentity: v.fileIdentity, byteOffset: v.byteOffset,
      })) };
    },
    async getEventDetail(sourceId: string, vaultSequence: string, signal: AbortSignal): Promise<VaultEventDetail> {
      if (!hash(sourceId) || !sequence(vaultSequence)) throw new Error('Invalid event identity');
      const path = `/events/${encodeURIComponent(sourceId)}/${encodeURIComponent(vaultSequence)}`;
      const v = await api.get(path, { signal, validate: isDetail });
      if (v.sourceId !== sourceId || v.vaultSequence !== vaultSequence) throw new Error('Event detail identity does not match the request');
      const binary = atob(v.rawPayloadBase64);
      if (btoa(binary) !== v.rawPayloadBase64) throw new Error('Invalid raw payload encoding');
      return {
        ...eventSummary(v), rawBytes: Uint8Array.from(binary, (byte) => byte.charCodeAt(0)),
        signature: v.signature, keyId: v.keyId, correlationStatus: v.correlationStatus, merkleProof: v.merkleProof,
      };
    },
    async getBatches(query: PageQuery, signal: AbortSignal): Promise<CursorPage<VaultBatch>> {
      const { items, nextCursor } = await list('/batches', query, signal, isBatch);
      return { nextCursor, items: items.map(({ previousBatchRoot, anchorStatus, ...batch }) => ({
        ...batch, previousCommitmentHash: previousBatchRoot, localAnchorStatus: anchorStatuses[anchorStatus],
      })) };
    },
    getSequenceGaps: (query: PageQuery, signal: AbortSignal) => list('/gaps', query, signal, isGap),
  };
}

export type LiveDashboardAdapter = ReturnType<typeof createLiveDashboardAdapter>;
