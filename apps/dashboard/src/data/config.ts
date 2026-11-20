export type DashboardMode = 'demo' | 'live';

export interface DashboardConfig {
  mode: DashboardMode;
  apiBaseUrl?: string;
  wsEndpoint?: string;
  requestTimeoutMs: number;
  reconnectMaxAttempts: number;
}

export function readDashboardConfig(
  env: Partial<Record<string, string | boolean | undefined>> = import.meta.env,
): DashboardConfig {
  const mode = env.VITE_TRUSTTRACE_DATA_MODE === 'live' ? 'live' : 'demo';
  const timeout = Number(env.VITE_TRUSTTRACE_API_TIMEOUT_MS);

  return {
    mode,
    apiBaseUrl: typeof env.VITE_TRUSTTRACE_API_BASE_URL === 'string'
      ? env.VITE_TRUSTTRACE_API_BASE_URL.trim() || undefined
      : undefined,
    wsEndpoint: typeof env.VITE_TRUSTTRACE_WS_ENDPOINT === 'string'
      ? env.VITE_TRUSTTRACE_WS_ENDPOINT.trim() || undefined
      : undefined,
    requestTimeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 10_000,
    reconnectMaxAttempts: 5,
  };
}
