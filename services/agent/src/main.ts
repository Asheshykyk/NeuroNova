import { join } from "node:path";
import { loadAgentConfig } from "./config.ts";
import { AgentKeyStore } from "./agent-key-store.ts";
import { AgentCheckpointStore } from "./agent-checkpoint-store.ts";
import { HeartbeatSequenceStore } from "./heartbeat-sequence-store.ts";
import { createCapturePipeline } from "./capture-pipeline.ts";
import { DurableSpool } from "./durable-spool.ts";
import { SpoolDeliveryWorker } from "./spool-delivery.ts";
import { VaultClient } from "./vault-client.ts";
import { VaultHeartbeatClient } from "./vault-heartbeat-client.ts";
import { HeartbeatRunner } from "./heartbeat-runner.ts";
import { AgentRuntime } from "./agent-runtime.ts";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const config = loadAgentConfig();

  const keyStore = new AgentKeyStore(
    join(config.stateDir, "agent-private.seed"),
  );
  const keyPair = await keyStore.loadOrCreate();
  console.log(`Host Agent public key: ${keyPair.publicKeyHex}`);
  const fileIdentity = "/var/log/auth.log";

  const checkpointStore = new AgentCheckpointStore(
    join(config.stateDir, "agent-checkpoint.json"),
    config.sourceId,
    config.streamId,
    fileIdentity,
  );
  const heartbeatSequenceStore = new HeartbeatSequenceStore(
    join(config.stateDir, "heartbeat-sequence.json"),
    config.sourceId,
  );
  const spool = new DurableSpool(
    join(config.stateDir, "spool"),
  );

  const capturePipeline = await createCapturePipeline({
    logPath: config.authLogPath,
    sourceId: config.sourceId,
    streamId: config.streamId,
    fileIdentity,
    privateKey: keyPair.privateKey,
    checkpointStore,
    spool,
  });

  const vaultClient = new VaultClient(config.vaultBaseUrl);
  const spoolDelivery = new SpoolDeliveryWorker(spool, vaultClient);

  const vaultHeartbeatClient = new VaultHeartbeatClient(
    config.vaultBaseUrl,
    {
      retryDelayMs: config.retryDelayMs,
      maxRetries: 3,
      timeoutMs: 5000,
    },
  );
  const heartbeatRunner = new HeartbeatRunner({
    sourceId: config.sourceId,
    heartbeatSequenceStore,
    privateKey: keyPair.privateKey,
    vaultClient: vaultHeartbeatClient,
    lastByteOffsetProvider: () => checkpointStore.load(),
    statusProvider: () => "OK",
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    retryDelayMs: config.retryDelayMs,
  });

  const abortController = new AbortController();
  const onSignal = () => {
    abortController.abort();
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  const runtime = new AgentRuntime({
    pollIntervalMs: config.pollIntervalMs,
    captureOnce: () => capturePipeline.captureOnce(),
    deliverPending: () => spoolDelivery.deliverOnce(),
    heartbeatRun: (signal) => heartbeatRunner.run(signal),
    onDeliveryError: (error) => {
      console.error(`Host Agent event delivery error: ${errorMessage(error)}`);
    },
    onFatalError: (error) => {
      console.error(`Host Agent fatal error: ${errorMessage(error)}`);
      process.exitCode = 1;
    },
  });

  try {
    await runtime.run(abortController.signal);
  } finally {
    await capturePipeline.close();
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
}

main().catch((error) => {
  console.error(`Host Agent startup failed: ${errorMessage(error)}`);
  process.exitCode = 1;
});
