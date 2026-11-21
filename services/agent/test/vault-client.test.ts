import assert from "node:assert/strict";
import test from "node:test";
import { VaultClient, type FetchCompatible } from "../src/vault-client.ts";
import type { SignedEventRequest } from "../src/signed-event.ts";

function request(): SignedEventRequest {
  const fixture: SignedEventRequest = {
    schemaVersion: 1,
    sourceId: "host-agent-cyprus-01",
    deliveryId: "550e8400-e29b-41d4-a716-446655440000",
    streamId: "auth.log",
    fileIdentity: "inode:142857",
    byteOffset: "1048576",
    observedAt: "1732145400000000000",
    rawEventBase64: "AQID",
    rawEventLength: 3,
    signature: "0x" + "ab".repeat(64),
  };
  assert.equal(
    Buffer.from(fixture.rawEventBase64, "base64").length,
    fixture.rawEventLength,
  );
  return fixture;
}

function mockResponse(status: number, body: unknown): {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
} {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

test("accepts valid HTTP 201 new-event acknowledgement", async () => {
  const client = new VaultClient("https://vault.example/", async () =>
    mockResponse(201, {
      status: "accepted",
      sourceId: "host-agent-cyprus-01",
      deliveryId: "550e8400-e29b-41d4-a716-446655440000",
      duplicate: false,
      receiptId: "receipt-1",
    }),
  );

  const receipt = await client.ingestEvent(request());
  assert.equal(receipt.duplicate, false);
  assert.equal(receipt.receiptId, "receipt-1");
});

test("accepts valid HTTP 200 duplicate acknowledgement", async () => {
  const client = new VaultClient("https://vault.example", async () =>
    mockResponse(200, {
      status: "accepted",
      sourceId: "host-agent-cyprus-01",
      deliveryId: "550e8400-e29b-41d4-a716-446655440000",
      duplicate: true,
    }),
  );

  const receipt = await client.ingestEvent(request());
  assert.equal(receipt.duplicate, true);
});

test("rejects mismatched sourceId or deliveryId", async () => {
  for (const acknowledgement of [
    {
      status: "accepted",
      sourceId: "other-source",
      deliveryId: "550e8400-e29b-41d4-a716-446655440000",
      duplicate: false,
    },
    {
      status: "accepted",
      sourceId: "host-agent-cyprus-01",
      deliveryId: "550e8400-e29b-41d4-a716-446655440001",
      duplicate: false,
    },
  ]) {
    const client = new VaultClient("https://vault.example", async () =>
      mockResponse(201, acknowledgement),
    );
    await assert.rejects(
      client.ingestEvent(request()),
      /does not match the request/,
    );
  }
});

test("rejects invalid status or acknowledgement envelope", async () => {
  for (const acknowledgement of [
    null,
    { status: "rejected", sourceId: "host-agent-cyprus-01", deliveryId: "550e8400-e29b-41d4-a716-446655440000", duplicate: false },
    { status: "accepted", sourceId: "host-agent-cyprus-01", deliveryId: "550e8400-e29b-41d4-a716-446655440000" },
  ]) {
    const client = new VaultClient("https://vault.example", async () =>
      mockResponse(201, acknowledgement),
    );
    await assert.rejects(
      client.ingestEvent(request()),
      /invalid acknowledgement envelope/,
    );
  }
});

test("rejects HTTP errors", async () => {
  const client = new VaultClient("https://vault.example", async () =>
    mockResponse(503, { status: "unavailable" }),
  );

  await assert.rejects(
    client.ingestEvent(request()),
    /Vault ingest HTTP error: 503/,
  );
});

test("sends exact URL, method, headers, and unchanged request body", async () => {
  let capturedUrl = "";
  let capturedInit: Parameters<FetchCompatible>[1] | undefined;
  const signed = request();
  const signedSnapshot = JSON.parse(JSON.stringify(signed));

  const mockFetch: FetchCompatible = async (url, init) => {
    capturedUrl = url;
    capturedInit = init;
    return mockResponse(201, {
      status: "accepted",
      sourceId: signed.sourceId,
      deliveryId: signed.deliveryId,
      duplicate: false,
    });
  };

  const client = new VaultClient("https://vault.example/base/", mockFetch);
  await client.ingestEvent(signed);

  assert.equal(capturedUrl, "https://vault.example/base/api/v1/logs/ingest");
  assert.equal(capturedInit?.method, "POST");
  assert.deepEqual(capturedInit?.headers, {
    "Content-Type": "application/json",
  });
  assert.deepEqual(JSON.parse(capturedInit!.body), signedSnapshot);
  assert.deepEqual(signed, signedSnapshot);
});

test("rejects invalid JSON acknowledgement", async () => {
  const client = new VaultClient("https://vault.example", async () => ({
    ok: true,
    status: 201,
    async json() {
      throw new SyntaxError("bad json");
    },
  }));

  await assert.rejects(
    client.ingestEvent(request()),
    /invalid JSON/,
  );
});
