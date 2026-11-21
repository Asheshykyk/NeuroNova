import { afterEach, describe, expect, it, vi } from 'vitest';
import { readDashboardConfig } from './config';
import { createLiveDashboardAdapter } from './liveDashboardAdapter';

const adapter = createLiveDashboardAdapter(readDashboardConfig({
  VITE_TRUSTTRACE_DATA_MODE: 'live',
  VITE_TRUSTTRACE_API_BASE_URL: 'http://localhost:3000/api/v1',
}));
const sourceId = '0x' + '11'.repeat(32);
const hash = '0x' + 'ab'.repeat(32);
const timestamp = '2026-11-21T07:00:00.000Z';
const vaultSequence = '18446744073709551615';

const event = {
  eventId: 'opaque/id-whatever', sourceId, vaultSequence, streamId: null, hostTimestamp: null,
  vaultReceivedAt: timestamp, deliveryId: null, payloadSha256: hash, batchId: null,
  verificationStatus: 'VAULT_PERSISTED', fileIdentity: null, observationSource: null, byteOffset: '9007199254740993',
};
const detail = {
  eventId: event.eventId, sourceId, vaultSequence, streamId: null, hostTimestamp: null,
  vaultReceivedAt: timestamp, deliveryId: null, payloadSha256: hash, batchId: null,
  verificationStatus: 'VAULT_PERSISTED', rawPayloadBase64: 'AP8KIA==',
  signature: null, keyId: null, correlationStatus: null, merkleProof: null,
};
const batch = {
  batchId: hash, sourceId, startSequence: '1', endSequence: '1', leafCount: 1,
  merkleRoot: hash, previousBatchRoot: '0x' + '00'.repeat(32), commitmentHash: hash, createdAt: timestamp,
  transactionHash: null, chainId: '15000', blockNumber: '9007199254740993',
};

function respond(body: unknown) {
  const fetch = vi.fn(async () => Response.json(body));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
const signal = () => new AbortController().signal;

afterEach(() => vi.unstubAllGlobals());

describe('Vault LIVE REST adapter', () => {
  it('validates source summaries and preserves opaque pagination', async () => {
    const item = { sourceId, eventCount: 1, latestVaultSequence: vaultSequence, latestReceiptAt: timestamp };
    const fetch = respond({ items: [item], nextCursor: 'cursor+/last' });
    await expect(adapter.getSources({ cursor: 'cursor+/first' }, signal())).resolves.toEqual({
      items: [item], nextCursor: 'cursor+/last',
    });
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/sources?cursor=cursor%2B%2Ffirst&limit=50',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('preserves nullable feed metadata and ignores raw data in a list response', async () => {
    respond({ items: [{ ...event, rawPayloadBase64: 'AP8KIA==' }], nextCursor: null });
    const { items: [mapped] } = await adapter.getEvents({ sourceId }, signal());
    expect(mapped).toMatchObject({
      eventId: event.eventId, sourceId, vaultSequence, streamId: null, hostTimestamp: null,
      observationSource: null, fileIdentity: null, byteOffset: '9007199254740993', localAnchorStatus: null,
    });
    expect(mapped).not.toHaveProperty('rawPayloadBase64');
    expect(mapped).not.toHaveProperty('rawBytes');
  });

  it('loads detail by source and sequence and preserves non-text bytes and null proof metadata', async () => {
    const fetch = respond(detail);
    const mapped = await adapter.getEventDetail(sourceId, vaultSequence, signal());
    expect(mapped.rawBytes).toEqual(Uint8Array.of(0, 255, 10, 32));
    expect(mapped).toMatchObject({ eventId: event.eventId, signature: null, keyId: null, correlationStatus: null, merkleProof: null });
    expect(fetch).toHaveBeenCalledWith(
      `http://localhost:3000/api/v1/events/${sourceId}/${vaultSequence}`, expect.objectContaining({ method: 'GET' }),
    );
  });

  it.each([
    ['ANCHOR_PENDING', 'PENDING'],
    ['ANCHORED', 'ANCHORED_SERVER_REPORTED'],
    ['ANCHOR_FAILED', 'ANCHOR_FAILED'],
  ])('maps %s to %s for batches and events', async (backend, label) => {
    respond({ items: [{ ...batch, anchorStatus: backend }], nextCursor: null });
    const { items: [mapped] } = await adapter.getBatches({}, signal());
    expect(mapped).toMatchObject({
      localAnchorStatus: label, chainId: '15000', blockNumber: '9007199254740993',
      previousCommitmentHash: batch.previousBatchRoot, transactionHash: null,
    });
    expect(mapped).not.toHaveProperty('independentVerificationStatus');
    respond({ items: [{ ...event, verificationStatus: backend }], nextCursor: null });
    await expect(adapter.getEvents({}, signal())).resolves.toMatchObject({ items: [{ localAnchorStatus: label }] });
  });

  it('rejects malformed event and batch responses and a mismatched detail identity', async () => {
    respond({ items: [{ ...event, vaultSequence: 1 }], nextCursor: null });
    await expect(adapter.getEvents({}, signal())).rejects.toThrow('API response failed type validation');
    respond({ items: [{ ...batch, anchorStatus: 'RPC_VERIFIED' }], nextCursor: null });
    await expect(adapter.getBatches({}, signal())).rejects.toThrow('API response failed type validation');
    respond({ ...detail, vaultSequence: '1' });
    await expect(adapter.getEventDetail(sourceId, vaultSequence, signal())).rejects.toThrow('identity does not match');
    respond({ ...detail, rawPayloadBase64: 'not base64' });
    await expect(adapter.getEventDetail(sourceId, vaultSequence, signal())).rejects.toThrow('API response failed type validation');
  });
});
