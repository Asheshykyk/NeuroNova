import type { DashboardAdapter } from '../types';
import { readDashboardConfig, type DashboardConfig } from './config';
import { createLiveDashboardAdapter } from './liveDashboardAdapter';
import type { LiveDashboardAdapter } from './liveDashboardAdapter';
import { mockAdapter } from './mockAdapter';

export type DashboardDataSource =
  | {
      mode: 'demo';
      config: DashboardConfig;
      adapter: DashboardAdapter;
    }
  | {
      mode: 'live';
      config: DashboardConfig;
      adapter: LiveDashboardAdapter;
    };

export function createDashboardDataSource(
  env: Record<string, string | boolean | undefined> = import.meta.env,
): DashboardDataSource {
  const config = readDashboardConfig(env);
  if (config.mode === 'live') {
    return {
      mode: 'live',
      config,
      adapter: createLiveDashboardAdapter(config),
    };
  }
  return {
    mode: 'demo',
    config,
    adapter: mockAdapter,
  };
}
