import { describe, expect, it } from 'vitest';
import { createDashboardDataSource } from './source';
import { readDashboardConfig } from './config';
import { createLiveDashboardAdapter } from './liveDashboardAdapter';

describe('dashboard data sources', () => {
  it('keeps DEMO fixtures separate from empty live mode', () => {
    const demo = createDashboardDataSource({
      VITE_TRUSTTRACE_DATA_MODE: 'demo',
    });
    const live = createDashboardDataSource({
      VITE_TRUSTTRACE_DATA_MODE: 'live',
    });

    expect(demo.mode).toBe('demo');
    expect(demo.adapter.getEvents().length).toBeGreaterThan(0);
    expect(demo.adapter.getEvents().every((event) => event.eventId === `${event.sourceId}:${event.vaultSequence}`)).toBe(true);
    expect(live.mode).toBe('live');
    expect(live.adapter.getEvents()).toEqual([]);
    expect(live.adapter.getCheckpoints()).toEqual([]);
    expect(live.adapter.getVerification()).toBeUndefined();
    expect(live.adapter.getCollectionGaps()).toEqual([]);
  });

  it('reports missing live backend configuration without a mock fallback', () => {
    const config = readDashboardConfig({
      VITE_TRUSTTRACE_DATA_MODE: 'live',
    });
    const adapter = createLiveDashboardAdapter(config);

    expect(adapter.getLiveState().viewState).toBe('error');
    expect(adapter.getLiveState().configError).toContain('VITE_TRUSTTRACE_API_BASE_URL');
    expect(adapter.getEvents()).toEqual([]);
  });

  it('stays disconnected when configuration exists but read contracts are pending', () => {
    const live = createDashboardDataSource({
      VITE_TRUSTTRACE_DATA_MODE: 'live',
      VITE_TRUSTTRACE_API_BASE_URL: 'https://example.invalid',
      VITE_TRUSTTRACE_WS_ENDPOINT: 'wss://example.invalid/api/v1/ws',
    });

    expect(live.mode).toBe('live');
    if (live.mode !== 'live') throw new Error('Expected live mode');
    expect(live.adapter.getLiveState().viewState).toBe('disconnected');
    expect(live.adapter.getLiveState().proposedWebSocketPath).toBe('/api/v1/ws');
    expect(live.adapter.getEvents()).toEqual([]);
  });

  it('keeps persistence, local anchoring, public anchoring, and verification separate', () => {
    const demo = createDashboardDataSource({ VITE_TRUSTTRACE_DATA_MODE: 'demo' });
    const checkpoint = demo.adapter.getCheckpoints()[0];

    expect(checkpoint.vaultPersistenceStatus).toBe('VAULT_PERSISTED');
    expect(checkpoint.localAnchorStatus).toBe('ANCHORED_SERVER_REPORTED');
    expect(checkpoint.publicAnchorStatus).toBe('ANCHORED_SERVER_REPORTED');
    expect(checkpoint.independentVerificationStatus).toBe('UNVERIFIABLE');
    expect(demo.adapter.getCollectionGaps()[0].status).toBe('COLLECTION_GAP');
  });
});
