import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { generateAgentKeyPair } from "@trusttrace/core/agent";
import { HeartbeatSequenceStore } from "../src/heartbeat-sequence-store.ts";
import { HeartbeatRunner } from "../src/heartbeat-runner.ts";
import { RetryableVaultHeartbeatError } from "../src/vault-heartbeat-client.ts";
import type { SignedHeartbeatRequest } from "../src/signed-heartbeat.ts";

async function withDirectory(
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "trusttrace-heartbeat-runner-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function request(sequence: string): SignedHeartbeatRequest {
  return {
    schemaVersion: 1,
    sourceId: "host-agent-cyprus-01",
    heartbeatSequence: sequence,
    observedAt: "1732145400000000000",
    lastByteOffset: "1048576",
    status: "OK",
    signature: "0x" + "ab".repeat(64),
  };
}

test("progresses sequence only after acknowledgement", async () => {
  await withDirectory(async (directory) => {
    const sequenceStore = new HeartbeatSequenceStore(
      join(directory, "sequence.json"),
      "host-agent-cyprus-01",
    );
    const privateKey = generateAgentKeyPair(Buffer.alloc(32, 7)).privateKey;
    const sent: SignedHeartbeatRequest[] = [];

    const runner = new HeartbeatRunner({
      sourceId: "host-agent-cyprus-01",
      heartbeatSequenceStore: sequenceStore,
      privateKey,
      lastByteOffsetProvider: () => 1048576n,
      statusProvider: () => "OK",
      observedAtNsFactory: () => 1732145400000000000n,
      vaultClient: {
        async sendHeartbeat(received) {
          sent.push(received);
          return {
            status: "accepted",
            sourceId: received.sourceId,
            heartbeatSequence: received.heartbeatSequence,
            duplicate: false,
          };
        },
      },
    });

    await runner.runOnce();
    await runner.runOnce();

    assert.deepEqual(
      sent.map((heartbeat) => heartbeat.heartbeatSequence),
      ["1", "2"],
    );
  });
});

test("identical pending payload is retried after exhausted delivery", async () => {
  await withDirectory(async (directory) => {
    const sequenceStore = new HeartbeatSequenceStore(
      join(directory, "sequence.json"),
      "host-agent-cyprus-01",
    );
    const privateKey = generateAgentKeyPair(Buffer.alloc(32, 8)).privateKey;
    const sent: SignedHeartbeatRequest[] = [];
    let attempts = 0;

    const runner = new HeartbeatRunner({
      sourceId: "host-agent-cyprus-01",
      heartbeatSequenceStore: sequenceStore,
      privateKey,
      lastByteOffsetProvider: () => 42n,
      statusProvider: () => "OK",
      observedAtNsFactory: () => 1732145400000000001n,
      retryDelayMs: 0,
      vaultClient: {
        async sendHeartbeat(received) {
          sent.push(received);
          attempts++;
          if (attempts === 1) {
            throw new RetryableVaultHeartbeatError("Heartbeat request timed out");
          }
          return {
            status: "accepted",
            sourceId: received.sourceId,
            heartbeatSequence: received.heartbeatSequence,
            duplicate: false,
          };
        },
      },
    });

    await runner.runOnce().catch((error) => {
      assert.ok(error instanceof RetryableVaultHeartbeatError);
    });
    await runner.runOnce();

    assert.equal(sent.length, 2);
    assert.deepEqual(sent[0], sent[1]);
  });
});

test("permanent HTTP and invalid acknowledgement errors fail fast", async () => {
  await withDirectory(async (directory) => {
    const sequenceStore = new HeartbeatSequenceStore(
      join(directory, "sequence.json"),
      "host-agent-cyprus-01",
    );
    const privateKey = generateAgentKeyPair(Buffer.alloc(32, 9)).privateKey;
    const runner = new HeartbeatRunner({
      sourceId: "host-agent-cyprus-01",
      heartbeatSequenceStore: sequenceStore,
      privateKey,
      lastByteOffsetProvider: () => 0n,
      statusProvider: () => "OK",
      vaultClient: {
        async sendHeartbeat() {
          throw new Error("Heartbeat HTTP error: 409");
        },
      },
    });

    await assert.rejects(runner.runOnce(), /Heartbeat HTTP error: 409/);
  });
});

test("cancellation stops the runner and pending request is retained", async () => {
  await withDirectory(async (directory) => {
    const sequenceStore = new HeartbeatSequenceStore(
      join(directory, "sequence.json"),
      "host-agent-cyprus-01",
    );
    const privateKey = generateAgentKeyPair(Buffer.alloc(32, 10)).privateKey;
    const controller = new AbortController();
    let sentCount = 0;

    const runner = new HeartbeatRunner({
      sourceId: "host-agent-cyprus-01",
      heartbeatSequenceStore: sequenceStore,
      privateKey,
      lastByteOffsetProvider: () => 0n,
      statusProvider: () => "OK",
      heartbeatIntervalMs: 100,
      retryDelayMs: 100,
      delay: async (milliseconds, signal) => {
        await new Promise<void>((resolve, reject) => {
          if (signal?.aborted) {
            reject(new Error("Heartbeat runner cancelled"));
            return;
          }
          const timer = setTimeout(resolve, milliseconds);
          signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("Heartbeat runner cancelled"));
          }, { once: true });
        });
      },
      vaultClient: {
        async sendHeartbeat(received, signal) {
          sentCount++;
          if (signal?.aborted) {
            throw new Error("Heartbeat runner cancelled");
          }
          return {
            status: "accepted",
            sourceId: received.sourceId,
            heartbeatSequence: received.heartbeatSequence,
            duplicate: false,
          };
        },
      },
    });

    const running = runner.run(controller.signal);
    await Promise.resolve();
    setTimeout(() => controller.abort(), 10);
    await assert.rejects(running, /Heartbeat runner cancelled/);
    assert.equal(sentCount, 1);
  });
});

test("uses injected delay for acknowledgement interval", async () => {
  await withDirectory(async (directory) => {
    const sequenceStore = new HeartbeatSequenceStore(
      join(directory, "sequence.json"),
      "host-agent-cyprus-01",
    );
    const privateKey = generateAgentKeyPair(Buffer.alloc(32, 11)).privateKey;
    const waited: number[] = [];
    let sentCount = 0;

    const runner = new HeartbeatRunner({
      sourceId: "host-agent-cyprus-01",
      heartbeatSequenceStore: sequenceStore,
      privateKey,
      lastByteOffsetProvider: () => 1n,
      statusProvider: () => "OK",
      heartbeatIntervalMs: 5000,
      delay: async (milliseconds) => {
        waited.push(milliseconds);
      },
      vaultClient: {
        async sendHeartbeat(received) {
          sentCount++;
          if (sentCount === 1) {
            return {
              status: "accepted",
              sourceId: received.sourceId,
              heartbeatSequence: received.heartbeatSequence,
              duplicate: false,
            };
          }
          throw new Error("stop");
        },
      },
    });

    await assert.rejects(runner.run(), /stop/);
    assert.equal(waited[0], 5000);
  });
});
