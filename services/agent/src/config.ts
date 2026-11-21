export interface AgentConfig {
  sourceId: string;
  streamId: string;
  fileIdentity: string;
  vaultBaseUrl: string;
  authLogPath: string;
  stateDir: string;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  retryDelayMs: number;
}

function requiredValue(
  env: Record<string, string | undefined>,
  name: string,
): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function positiveSafeInteger(
  env: Record<string, string | undefined>,
  name: string,
  defaultValue: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") {
    return defaultValue;
  }

  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`${name} must be a positive safe integer`);
  }

  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}

function normalizedVaultUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("VAULT_BASE_URL must be a valid HTTP(S) URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("VAULT_BASE_URL must be a valid HTTP(S) URL");
  }

  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/+$/, "");
}

export function loadAgentConfig(
  env: Record<string, string | undefined> = process.env,
): AgentConfig {
  const sourceId = requiredValue(env, "AGENT_SOURCE_ID");
  const streamId = requiredValue(env, "AGENT_STREAM_ID");
  const fileIdentity = requiredValue(env, "AGENT_FILE_IDENTITY");
  const vaultBaseUrl = normalizedVaultUrl(
    requiredValue(env, "VAULT_BASE_URL"),
  );

  const authLogPath = env.AUTH_LOG_PATH?.trim();
  const stateDir = env.AGENT_STATE_DIR?.trim();

  return {
    sourceId,
    streamId,
    fileIdentity,
    vaultBaseUrl,
    authLogPath: authLogPath || "/var/log/auth.log",
    stateDir: stateDir || "/var/lib/trusttrace-agent",
    pollIntervalMs: positiveSafeInteger(
      env,
      "AGENT_POLL_INTERVAL_MS",
      250,
    ),
    heartbeatIntervalMs: positiveSafeInteger(
      env,
      "HEARTBEAT_INTERVAL_MS",
      5000,
    ),
    retryDelayMs: positiveSafeInteger(
      env,
      "AGENT_RETRY_DELAY_MS",
      1000,
    ),
  };
}
