import { mockDashboardAdapter } from './mockAdapter';
import { readDashboardConfig } from './config';
import { createLiveDashboardAdapter } from './liveDashboardAdapter';

export function createDashboardDataSource(
  env: Record<string, string | boolean | undefined> = import.meta.env,
) {
  const config = readDashboardConfig(env);
  if (config.mode === 'live') {
    return {
      mode: 'live' as const,
      config,
      adapter: createLiveDashboardAdapter(config),
    };
  }
  return {
    mode: 'demo' as const,
    config,
    adapter: mockDashboardAdapter,
  };
}
