import assert from "node:assert/strict";
import test from "node:test";
import {
  VaultHeartbeatClient,
  type HeartbeatFetchCompatible,
} from "../src/vault-heartbeat-client.ts";
import type { SignedHeartbeatRequest } from "../src/signed-heartbeat.ts";

function heartbeat(): SignedHeartbeatRequest {
  return {
    schemaVersion: 1,
    sourceId: "host-agent-cyprus-01",
    heartbeatSequence: "7",
    observedAt: "1732145400000000000",
    lastByteOffset: "1048576",
    status: "OK",
    signature: "0x" + "ab".repeat(64),
  };
}

function response(status: number, body: unknown) {
  return {
    status,
    async json() {
      return body;
    },
  };
}

test("accepts HTTP 201 new heartbeat acknowledgement", async () => {
  const request = heartbeat();
  const client = new VaultHeartbeatClient(
    "https://vault.example",
    async () => response(201, {
      status: "accepted",
      sourceId: request.sourceId,
      heartbeatSequence: request.heartbeatSequence,
      duplicate: false,
    }),
  );

  const receipt = await client.sendHeartbeat(request);
  assert.equal(receipt.status, "accepted");
  assert.equal(receipt.duplicate, false);
});

test("accepts HTTP 200 duplicate heartbeat acknowledgement", async () => {
  const request = heartbeat();
  const client = new VaultHeartbeatClient(
    "https://vault.example",
    async () => response(200, {
      status: "accepted",
      sourceId: request.sourceId,
      heartbeatSequence: request.heartbeatSequence,
      duplicate: true,
    }),
  );

  assert.equal((await client.sendHeartbeat(request)).duplicate, true);
});

test("rejects mismatched source or heartbeat sequence", async () => {
  const request = heartbeat();
  for (const body of [
    {
      status: "accepted",
      sourceId: "other-source",
      heartbeatSequence: "7",
      duplicate: false,
    },
    {
      status: "accepted",
      sourceId: request.sourceId,
      heartbeatSequence: "8",
      duplicate: false,
    },
  ]) {
    const client = new VaultHeartbeatClient(
      "https://vault.example",
      async () => response(201, body),
    );
    await assert.rejects(
      client.sendHeartbeat(request),
      /does not match the request/,
    );
  }
});

test("rejects invalid response bodies", async () => {
  const request = heartbeat();
  for (const body of [
    null,
    { status: "rejected", sourceId: request.sourceId, heartbeatSequence: "7", duplicate: false },
    { status: "accepted", sourceId: request.sourceId, heartbeatSequence: "7" },
  ]) {
    const client = new VaultHeartbeatClient(
      "https://vault.example",
      async () => response(201, body),
    );
    await assert.rejects(
      client.sendHeartbeat(request),
      /invalid acknowledgement envelope/,
    );
  }
});

test("fails immediately on non-retryable errors", async () => {
  let calls = 0;
  const fetchImpl: HeartbeatFetchCompatible = async () => {
    calls++;
    return response(409, { status: "conflict" });
  };
  const client = new VaultHeartbeatClient(
    "https://vault.example",
    fetchImpl,
    { retryDelayMs: 0, maxRetries: 5 },
  );

  await assert.rejects(
    client.sendHeartbeat(heartbeat()),
    /Heartbeat HTTP error: 409/,
  );
  assert.equal(calls, 1);
});

test("retries HTTP 500 and sends the identical body every time", async () => {
  const request = heartbeat();
  const serialized = JSON.stringify(request);
  const bodies: string[] = [];
  let calls = 0;

  const fetchImpl: HeartbeatFetchCompatible = async (_url, init) => {
    calls++;
    bodies.push(init.body);
    if (calls < 3) {
      return response(500, { status: "unavailable" });
    }
    return response(201, {
      status: "accepted",
      sourceId: request.sourceId,
      heartbeatSequence: request.heartbeatSequence,
      duplicate: false,
    });
  };

  const client = new VaultHeartbeatClient(
    "https://vault.example",
    fetchImpl,
    { retryDelayMs: 0, maxRetries: 3 },
  );
  await client.sendHeartbeat(request);

  assert.equal(calls, 3);
  assert.deepEqual(bodies, [serialized, serialized, serialized]);
});

test("retries network errors and validates exact URL and headers", async () => {
  const request = heartbeat();
  const serialized = JSON.stringify(request);
  const bodies: string[] = [];
  const urls: string[] = [];
  let calls = 0;

  const fetchImpl: HeartbeatFetchCompatible = async (url, init) => {
    calls++;
    urls.push(url);
    bodies.push(init.body);
    if (calls === 1) {
      throw new Error("network unavailable");
    }
    return response(200, {
      status: "accepted",
      sourceId: request.sourceId,
      heartbeatSequence: request.heartbeatSequence,
      duplicate: true,
    });
  };

  const client = new VaultHeartbeatClient(
    "https://vault.example/",
    fetchImpl,
    { retryDelayMs: 0, maxRetries: 2 },
  );
  await client.sendHeartbeat(request);

  assert.equal(calls, 2);
  assert.deepEqual(
    urls,
    [
      "https://vault.example/api/v1/agents/heartbeat",
      "https://vault.example/api/v1/agents/heartbeat",
    ],
  );
  assert.deepEqual(bodies, [serialized, serialized]);
});

test("cancellation stops retry waits", async () => {
  const controller = new AbortController();
  const fetchImpl: HeartbeatFetchCompatible = async () => response(503, {});
  const client = new VaultHeartbeatClient(
    "https://vault.example",
    fetchImpl,
    { retryDelayMs: 100, maxRetries: 5 },
  );

  const delivery = client.sendHeartbeat(heartbeat(), controller.signal);
  setTimeout(() => controller.abort(), 10);

  await assert.rejects(delivery, /Heartbeat delivery cancelled/);
});

test("timed-out attempt retries successfully with the identical body", async () => {
  const request = heartbeat();
  const serialized = JSON.stringify(request);
  const bodies: string[] = [];
  let calls = 0;

  const fetchImpl: HeartbeatFetchCompatible = async (_url, init) => {
    calls++;
    bodies.push(init.body);
    if (calls === 1) {
      await new Promise<void>((resolve) => {
        init.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      throw new Error("The heartbeat attempt timed out");
    }
    return response(201, {
      status: "accepted",
      sourceId: request.sourceId,
      heartbeatSequence: request.heartbeatSequence,
      duplicate: false,
    });
  };

  const client = new VaultHeartbeatClient(
    "https://vault.example",
    fetchImpl,
    { retryDelayMs: 0, maxRetries: 2, timeoutMs: 10 },
  );

  await client.sendHeartbeat(request);
  assert.equal(calls, 2);
  assert.deepEqual(bodies, [serialized, serialized]);
});

test("caller cancellation stops an in-flight attempt", async () => {
  const controller = new AbortController();
  let calls = 0;

  const fetchImpl: HeartbeatFetchCompatible = async (_url, init) => {
    calls++;
    await new Promise<void>((resolve) => {
      init.signal?.addEventListener("abort", () => resolve(), { once: true });
    });
    throw new Error("The heartbeat attempt was aborted");
  };

  const client = new VaultHeartbeatClient(
    "https://vault.example",
    fetchImpl,
    { retryDelayMs: 0, maxRetries: 5, timeoutMs: 1000 },
  );

  const delivery = client.sendHeartbeat(heartbeat(), controller.signal);
  setTimeout(() => controller.abort(), 10);

  await assert.rejects(delivery, /Heartbeat delivery cancelled/);
  assert.equal(calls, 1);
});

test("response body timeout retries successfully with the identical body", async () => {
  const request = heartbeat();
  const serialized = JSON.stringify(request);
  const bodies: string[] = [];
  let calls = 0;

  const fetchImpl: HeartbeatFetchCompatible = async (_url, init) => {
    calls++;
    bodies.push(init.body);
    return {
      status: 201,
      json: calls === 1
        ? () => new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new Error("response body aborted"));
          }, { once: true });
        })
        : async () => ({
          status: "accepted",
          sourceId: request.sourceId,
          heartbeatSequence: request.heartbeatSequence,
          duplicate: false,
        }),
    };
  };

  const client = new VaultHeartbeatClient(
    "https://vault.example",
    fetchImpl,
    { retryDelayMs: 0, maxRetries: 2, timeoutMs: 10 },
  );

  await client.sendHeartbeat(request);
  assert.equal(calls, 2);
  assert.deepEqual(bodies, [serialized, serialized]);
});

test("caller cancellation stops while reading the response body", async () => {
  const controller = new AbortController();
  let calls = 0;

  const fetchImpl: HeartbeatFetchCompatible = async (_url, init) => {
    calls++;
    return {
      status: 201,
      json: () => new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new Error("response body aborted"));
        }, { once: true });
      }),
    };
  };

  const client = new VaultHeartbeatClient(
    "https://vault.example",
    fetchImpl,
    { retryDelayMs: 0, maxRetries: 5, timeoutMs: 1000 },
  );

  const delivery = client.sendHeartbeat(heartbeat(), controller.signal);
  setTimeout(() => controller.abort(), 10);

  await assert.rejects(delivery, /Heartbeat delivery cancelled/);
  assert.equal(calls, 1);
});

test("TypeError while reading the response body retries with identical body", async () => {
  const request = heartbeat();
  const serialized = JSON.stringify(request);
  const bodies: string[] = [];
  let calls = 0;

  const fetchImpl: HeartbeatFetchCompatible = async (_url, init) => {
    calls++;
    bodies.push(init.body);
    return {
      status: calls === 1 ? 201 : 200,
      json: calls === 1
        ? async () => {
          throw new TypeError("response body transport failed");
        }
        : async () => ({
          status: "accepted",
          sourceId: request.sourceId,
          heartbeatSequence: request.heartbeatSequence,
          duplicate: true,
        }),
    };
  };

  const client = new VaultHeartbeatClient(
    "https://vault.example",
    fetchImpl,
    { retryDelayMs: 0, maxRetries: 2, timeoutMs: 1000 },
  );

  const receipt = await client.sendHeartbeat(request);
  assert.equal(receipt.duplicate, true);
  assert.equal(calls, 2);
  assert.deepEqual(bodies, [serialized, serialized]);
});

test("malformed JSON fails without retrying", async () => {
  let calls = 0;
  const fetchImpl: HeartbeatFetchCompatible = async () => {
    calls++;
    return {
      status: 201,
      async json() {
        throw new SyntaxError("Unexpected token");
      },
    };
  };
  const client = new VaultHeartbeatClient(
    "https://vault.example",
    fetchImpl,
    { retryDelayMs: 0, maxRetries: 5, timeoutMs: 1000 },
  );

  await assert.rejects(
    client.sendHeartbeat(heartbeat()),
    /invalid JSON/,
  );
  assert.equal(calls, 1);
});
