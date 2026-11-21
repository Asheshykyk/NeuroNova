import { describe, expect, it } from 'vitest';
import { createDashboardDataSource } from './source';
import { readDashboardConfig } from './config';

describe('dashboard data sources', () => {
  it('defaults to demo and keeps fixtures in that mode', () => {
    const demo = createDashboardDataSource({});
    if (demo.mode !== 'demo') throw new Error('Expected demo mode');
    expect(demo.adapter.getEvents().length).toBeGreaterThan(0);
    expect(demo.adapter.getEvents().every((event) => event.eventId === `${event.sourceId}:${event.vaultSequence}`)).toBe(true);
  });

  it('selects LIVE with REST configuration and no WebSocket endpoint', () => {
    const env = { VITE_TRUSTTRACE_DATA_MODE: 'live', VITE_TRUSTTRACE_API_BASE_URL: 'http://localhost:3000/api/v1' };
    const config = readDashboardConfig(env);
    const live = createDashboardDataSource(env);
    expect(live.mode).toBe('live');
    expect(config.apiBaseUrl).toBe('http://localhost:3000/api/v1');
    expect(config.wsEndpoint).toBeUndefined();
    expect(live.adapter).toHaveProperty('getSources');
    expect(live.adapter).not.toHaveProperty('getCheckpoints');
    expect(live.adapter).not.toHaveProperty('getCollectionGaps');
  });

  it('keeps persistence, local anchoring, public anchoring, and verification separate', () => {
    const demo = createDashboardDataSource({ VITE_TRUSTTRACE_DATA_MODE: 'demo' });
    if (demo.mode !== 'demo') throw new Error('Expected demo mode');
    const checkpoint = demo.adapter.getCheckpoints()[0];

    expect(checkpoint.vaultPersistenceStatus).toBe('VAULT_PERSISTED');
    expect(checkpoint.localAnchorStatus).toBe('ANCHORED_SERVER_REPORTED');
    expect(checkpoint.publicAnchorStatus).toBe('ANCHORED_SERVER_REPORTED');
    expect(checkpoint.independentVerificationStatus).toBe('UNVERIFIABLE');
    expect(demo.adapter.getCollectionGaps()[0].status).toBe('COLLECTION_GAP');
  });
});
