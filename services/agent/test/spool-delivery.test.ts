import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DurableSpool } from "../src/durable-spool.ts";
import { SpoolDeliveryWorker } from "../src/spool-delivery.ts";
import type { SignedEventRequest } from "../src/signed-event.ts";

function request(
  deliveryId: string,
  byteOffset: bigint,
  rawEventBase64 = "AQIDCg==",
): SignedEventRequest {
  return {
    schemaVersion: 1,
    sourceId: "host-agent-cyprus-01",
    deliveryId,
    streamId: "auth.log",
    fileIdentity: "inode:42",
    fileGeneration: "dev:2049:ino:42",
    byteOffset: byteOffset.toString(),
    observedAt: "1732145400000000000",
    rawEventBase64,
    rawEventLength: Buffer.from(rawEventBase64, "base64").length,
    signature: "0x" + "cd".repeat(64),
  };
}

async function withSpool(
  run: (directory: string, spool: DurableSpool) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "trusttrace-delivery-"));
  try {
    await run(directory, new DurableSpool(directory));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("successful new-event acknowledgement removes the spool entry", async () => {
  await withSpool(async (_directory, spool) => {
    const signed = request("550e8400-e29b-41d4-a716-446655440020", 10n);
    await spool.enqueue(signed);

    const worker = new SpoolDeliveryWorker(spool, {
      async ingestEvent(received) {
        assert.deepEqual(received, signed);
        return {
          status: "accepted",
          sourceId: signed.sourceId,
          deliveryId: signed.deliveryId,
          duplicate: false,
        };
      },
    });

    assert.equal(await worker.deliverOnce(), 1);
    assert.deepEqual(await spool.listPending(), []);
  });
});

test("successful duplicate acknowledgement removes the spool entry", async () => {
  await withSpool(async (_directory, spool) => {
    const signed = request("550e8400-e29b-41d4-a716-446655440021", 20n);
    await spool.enqueue(signed);

    const worker = new SpoolDeliveryWorker(spool, {
      async ingestEvent(received) {
        assert.deepEqual(received, signed);
        return {
          status: "accepted",
          sourceId: signed.sourceId,
          deliveryId: signed.deliveryId,
          duplicate: true,
        };
      },
    });

    assert.equal(await worker.deliverOnce(), 1);
    assert.deepEqual(await spool.listPending(), []);
  });
});

test("failed request remains and later requests are not attempted", async () => {
  await withSpool(async (_directory, spool) => {
    const first = request("550e8400-e29b-41d4-a716-446655440022", 30n);
    const later = request("550e8400-e29b-41d4-a716-446655440023", 40n);
    await spool.enqueue(later);
    await spool.enqueue(first);

    const attempted: string[] = [];
    const worker = new SpoolDeliveryWorker(spool, {
      async ingestEvent(received) {
        attempted.push(received.deliveryId);
        throw new Error("Vault unavailable");
      },
    });

    await assert.rejects(worker.deliverOnce(), /Vault unavailable/);
    assert.deepEqual(attempted, [first.deliveryId]);
    assert.deepEqual(await spool.listPending(), [first, later]);
  });
});

test("passes the exact stored request unchanged to the client", async () => {
  await withSpool(async (_directory, spool) => {
    const signed = request(
      "550e8400-e29b-41d4-a716-446655440024",
      9007199254740993n,
      "AAECAwo=",
    );
    await spool.enqueue(signed);

    let passed: SignedEventRequest | undefined;
    const worker = new SpoolDeliveryWorker(spool, {
      async ingestEvent(received) {
        passed = received;
        return {
          status: "accepted",
          sourceId: signed.sourceId,
          deliveryId: signed.deliveryId,
          duplicate: false,
        };
      },
    });

    assert.equal(await worker.deliverOnce(), 1);
    assert.deepEqual(passed, signed);
    assert.equal(passed?.deliveryId, signed.deliveryId);
    assert.equal(passed?.signature, signed.signature);
    assert.equal(passed?.rawEventBase64, signed.rawEventBase64);
  });
});
