import assert from "node:assert/strict";
import test from "node:test";
import { loadAgentConfig } from "../src/config.ts";

function requiredEnv() {
  return {
    AGENT_SOURCE_ID: "host-agent-cyprus-01",
    AGENT_STREAM_ID: "auth.log",
    AGENT_FILE_IDENTITY: "inode:42",
    VAULT_BASE_URL: "https://vault.example",
  };
}

test("loads default runtime configuration", () => {
  assert.deepEqual(loadAgentConfig(requiredEnv()), {
    sourceId: "host-agent-cyprus-01",
    streamId: "auth.log",
    fileIdentity: "inode:42",
    vaultBaseUrl: "https://vault.example",
    authLogPath: "/var/log/auth.log",
    stateDir: "/var/lib/trusttrace-agent",
    pollIntervalMs: 250,
    heartbeatIntervalMs: 5000,
    retryDelayMs: 1000,
  });
});

test("loads valid overrides and normalizes values", () => {
  const config = loadAgentConfig({
    ...requiredEnv(),
    AGENT_SOURCE_ID: "  host-agent-cyprus-01  ",
    AGENT_STREAM_ID: "  auth.log  ",
    AGENT_FILE_IDENTITY: "  inode:42  ",
    VAULT_BASE_URL: "https://vault.example/base/",
    AUTH_LOG_PATH: " /tmp/auth.log ",
    AGENT_STATE_DIR: " /tmp/trusttrace ",
    AGENT_POLL_INTERVAL_MS: "100",
    HEARTBEAT_INTERVAL_MS: "6000",
    AGENT_RETRY_DELAY_MS: "250",
  });

  assert.deepEqual(config, {
    sourceId: "host-agent-cyprus-01",
    streamId: "auth.log",
    fileIdentity: "inode:42",
    vaultBaseUrl: "https://vault.example/base",
    authLogPath: "/tmp/auth.log",
    stateDir: "/tmp/trusttrace",
    pollIntervalMs: 100,
    heartbeatIntervalMs: 6000,
    retryDelayMs: 250,
  });
});

test("rejects missing and blank required values", () => {
  for (const name of [
    "AGENT_SOURCE_ID",
    "AGENT_STREAM_ID",
    "AGENT_FILE_IDENTITY",
    "VAULT_BASE_URL",
  ]) {
    const env = { ...requiredEnv() };
    delete env[name as keyof typeof env];
    assert.throws(
      () => loadAgentConfig(env),
      new RegExp(`${name} is required`),
    );

    assert.throws(
      () => loadAgentConfig({ ...requiredEnv(), [name]: "   " }),
      new RegExp(`${name} is required`),
    );
  }
});

test("rejects malformed and non-HTTP(S) Vault URLs", () => {
  for (const url of [
    "not-a-url",
    "ftp://vault.example",
    "javascript:alert(1)",
  ]) {
    assert.throws(
      () => loadAgentConfig({ ...requiredEnv(), VAULT_BASE_URL: url }),
      /VAULT_BASE_URL must be a valid HTTP\(S\) URL/,
    );
  }
});

test("rejects invalid interval values", () => {
  for (const name of [
    "AGENT_POLL_INTERVAL_MS",
    "HEARTBEAT_INTERVAL_MS",
    "AGENT_RETRY_DELAY_MS",
  ]) {
    for (const value of ["0", "-1", "1.5", "abc", "9007199254740992"]) {
      assert.throws(
        () => loadAgentConfig({ ...requiredEnv(), [name]: value }),
        new RegExp(`${name} must be a positive safe integer`),
      );
    }
  }
});
