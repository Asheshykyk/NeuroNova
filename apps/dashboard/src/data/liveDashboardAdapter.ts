import type { DashboardAdapter } from '../types';
import type { DashboardConfig } from './config';

export interface LiveDashboardState {
  viewState: 'error' | 'disconnected';
  configError?: string;
  contractError: string;
  transportState: 'disconnected';
  proposedWebSocketPath: '/api/v1/ws';
}

export const liveContractsPendingMessage =
  'Person 2 has not approved live REST/WebSocket response mappings; no backend paths or fields are used.';

export function createLiveDashboardAdapter(
  config: DashboardConfig,
): DashboardAdapter & { getLiveState: () => LiveDashboardState } {
  const configError = !config.apiBaseUrl
    ? 'Missing VITE_TRUSTTRACE_API_BASE_URL'
    : !config.wsEndpoint
      ? 'Missing VITE_TRUSTTRACE_WS_ENDPOINT'
      : undefined;

  const getLiveState = (): LiveDashboardState => ({
    viewState: configError ? 'error' : 'disconnected',
    configError,
    contractError: liveContractsPendingMessage,
    transportState: 'disconnected',
    proposedWebSocketPath: '/api/v1/ws',
  });

  return {
    mode: 'live',
    getLiveState,
    getEvents: () => [],
    getCheckpoints: () => [],
    getVerification: () => undefined,
    getCollectionGaps: () => [],
  };
}
