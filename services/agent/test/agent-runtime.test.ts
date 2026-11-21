import assert from "node:assert/strict";
import test from "node:test";
import { AgentRuntime } from "../src/agent-runtime.ts";

test("polling never overlaps capture and delivery", async () => {
  let activePoll = false;
  let overlap = false;
  let pollCount = 0;
  const controller = new AbortController();

  const runtime = new AgentRuntime({
    pollIntervalMs: 1,
    delay: async (_milliseconds, signal) => {
      if (signal?.aborted) {
        throw new Error("Agent runtime cancelled");
      }
      if (pollCount >= 3) {
        controller.abort();
      }
    },
    captureOnce: async () => {
      if (activePoll) overlap = true;
      activePoll = true;
      await Promise.resolve();
      activePoll = false;
    },
    deliverPending: async () => {
      pollCount++;
      if (activePoll) overlap = true;
      await Promise.resolve();
      return 0;
    },
    heartbeatRun: async (signal) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    },
  });

  await runtime.run(controller.signal);
  assert.equal(overlap, false);
  assert.equal(pollCount, 3);
});

test("delivery failure is retried on a later poll", async () => {
  let deliverAttempts = 0;
  let pollCount = 0;
  const controller = new AbortController();
  const deliveryErrors: unknown[] = [];

  const runtime = new AgentRuntime({
    pollIntervalMs: 1,
    onDeliveryError: (error) => {
      deliveryErrors.push(error);
    },
    delay: async (_milliseconds, signal) => {
      if (signal?.aborted) throw new Error("Agent runtime cancelled");
      pollCount++;
      if (pollCount === 2) controller.abort();
    },
    captureOnce: async () => {},
    deliverPending: async () => {
      deliverAttempts++;
      if (deliverAttempts === 1) {
        throw new Error("Vault unavailable");
      }
      return 1;
    },
    heartbeatRun: async (signal) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    },
  });

  await runtime.run(controller.signal);
  assert.equal(deliverAttempts, 2);
  assert.equal(deliveryErrors.length, 1);
});

test("caller cancellation stops capture and heartbeat loops", async () => {
  const controller = new AbortController();
  let captureStarted = false;
  let heartbeatStopped = false;

  const runtime = new AgentRuntime({
    pollIntervalMs: 100,
    captureOnce: async () => {
      captureStarted = true;
    },
    deliverPending: async () => 0,
    heartbeatRun: async (signal) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => {
          heartbeatStopped = true;
          resolve();
        }, { once: true });
      });
    },
  });

  const running = runtime.run(controller.signal);
  await Promise.resolve();
  await Promise.resolve();
  controller.abort();
  await running;

  assert.equal(captureStarted, true);
  assert.equal(heartbeatStopped, true);
});

test("capture failure stops runtime and reports fatal error", async () => {
  const captureError = new Error("auth.log disappeared");
  let fatal: unknown;

  const runtime = new AgentRuntime({
    pollIntervalMs: 100,
    onFatalError: (error) => {
      fatal = error;
    },
    captureOnce: async () => {
      throw captureError;
    },
    deliverPending: async () => {
      throw new Error("must not run");
    },
    heartbeatRun: async (signal) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    },
  });

  await runtime.run();
  assert.equal(fatal, captureError);
});

test("fatal heartbeat error stops runtime", async () => {
  const heartbeatError = new Error("heartbeat HTTP error: 409");
  let fatal: unknown;
  let delivered = false;

  const runtime = new AgentRuntime({
    pollIntervalMs: 100,
    onFatalError: (error) => {
      fatal = error;
    },
    captureOnce: async () => {},
    deliverPending: async () => {
      delivered = true;
      return 0;
    },
    heartbeatRun: async () => {
      throw heartbeatError;
    },
  });

  await runtime.run();
  assert.equal(fatal, heartbeatError);
  assert.equal(delivered, false);
});

test("already-aborted signal starts no runtime work", async () => {
  const controller = new AbortController();
  controller.abort();
  let captureCalls = 0;
  let deliveryCalls = 0;
  let heartbeatCalls = 0;

  const runtime = new AgentRuntime({
    pollIntervalMs: 100,
    captureOnce: async () => {
      captureCalls++;
    },
    deliverPending: async () => {
      deliveryCalls++;
      return 0;
    },
    heartbeatRun: async () => {
      heartbeatCalls++;
    },
  });

  await runtime.run(controller.signal);
  assert.equal(captureCalls, 0);
  assert.equal(deliveryCalls, 0);
  assert.equal(heartbeatCalls, 0);
});

test("unexpected normal heartbeat exit stops and reports fatal error", async () => {
  const controller = new AbortController();
  let fatal: unknown;
  let pollCount = 0;

  const runtime = new AgentRuntime({
    pollIntervalMs: 100,
    onFatalError: (error) => {
      fatal = error;
    },
    captureOnce: async () => {
      pollCount++;
    },
    deliverPending: async () => 0,
    heartbeatRun: async () => {},
  });

  await runtime.run(controller.signal);
  assert.equal(
    fatal instanceof Error ? fatal.message : "",
    "Heartbeat runner exited unexpectedly",
  );
  assert.equal(pollCount, 0);
});

test("delivery callback throw stops heartbeat and reports fatal", async () => {
  const callbackError = new Error("delivery reporter failed");
  let fatal: unknown;
  let heartbeatStopped = false;

  const runtime = new AgentRuntime({
    pollIntervalMs: 100,
    onDeliveryError: async () => {
      throw callbackError;
    },
    onFatalError: (error) => {
      fatal = error;
    },
    captureOnce: async () => {},
    deliverPending: async () => {
      throw new Error("delivery failed");
    },
    heartbeatRun: async (signal) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => {
          heartbeatStopped = true;
          resolve();
        }, { once: true });
      });
    },
  });

  await runtime.run();
  assert.equal(fatal, callbackError);
  assert.equal(heartbeatStopped, true);
});
