import type {
  Checkpoint,
  EvidenceEvent,
  DashboardAdapter,
  VerificationWitness,
} from '../types';
import type { DashboardConfig } from './config';

export class MissingLiveBackendConfigurationError extends Error {
  readonly name = 'MissingLiveBackendConfigurationError';
  constructor() {
    super('Live mode requires approved backend and WebSocket configuration.');
  }
}

export interface LiveDashboardState {
  configError?: string;
  contractError: string;
  transportState: 'disconnected';
}

export const liveContractsPendingMessage =
  'Person 2 has not approved live REST/WebSocket response mappings; no backend paths or fields are used.';

export function createLiveDashboardAdapter(
  config: DashboardConfig,
): DashboardAdapter & { liveState: () => LiveDashboardState } {
  const liveState = (): LiveDashboardState => ({
    configError: !config.apiBaseUrl
      ? 'Missing VITE_TRUSTTRACE_API_BASE_URL'
      : !config.wsEndpoint
        ? 'Missing VITE_TRUSTTRACE_WS_ENDPOINT'
        : undefined,
    contractError: liveContractsPendingMessage,
    transportState: 'disconnected',
  });

  return {
    mode: 'live',
    liveState,
    getEvents: (): EvidenceEvent[] => [],
    getCheckpoints: (): Checkpoint[] => [],
    getVerification: (): VerificationWitness[] => [],
  };
}
