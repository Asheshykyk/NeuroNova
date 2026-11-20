import { describe, expect, it } from 'vitest';
import { createDashboardDataSource } from './source';
import { readDashboardConfig } from './config';
import { createLiveDashboardAdapter } from './liveDashboardAdapter';

describe('dashboard data sources', () => {
  it('separates demo mode from live mode', () => {
    const demo = createDashboardDataSource({
      VITE_TRUSTTRACE_DATA_MODE: 'demo',
    });
    const live = createDashboardDataSource({
      VITE_TRUSTTRACE_DATA_MODE: 'live',
    });

    expect(demo.mode).toBe('demo');
    expect(demo.adapter.getEvents().length).toBeGreaterThan(0);
    expect(live.mode).toBe('live');
    expect(live.adapter.getEvents()).toEqual([]);
  });

  it('reports missing live backend configuration', () => {
    const config = readDashboardConfig({
      VITE_TRUSTTRACE_DATA_MODE: 'live',
    });
    const adapter = createLiveDashboardAdapter(config);

    expect(adapter.liveState().configError).toContain('VITE_TRUSTTRACE_API_BASE_URL');
  });

  it('does not expose a live mock-data fallback', () => {
    const live = createDashboardDataSource({
      VITE_TRUSTTRACE_DATA_MODE: 'live',
      VITE_TRUSTTRACE_API_BASE_URL: 'https://example.invalid',
      VITE_TRUSTTRACE_WS_ENDPOINT: 'wss://example.invalid/feed',
    });

    expect(live.adapter.getEvents()).toEqual([]);
    expect(live.adapter.getCheckpoints()).toEqual([]);
  });
});
