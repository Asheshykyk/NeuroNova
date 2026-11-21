import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DurableSpool } from "../src/durable-spool.ts";
import type { SignedEventRequest } from "../src/signed-event.ts";

function request(
  deliveryId: string,
  byteOffset: bigint,
  rawEventBase64 = "YQ==",
): SignedEventRequest {
  return {
    schemaVersion: 1,
    sourceId: "host-agent-cyprus-01",
    deliveryId,
    streamId: "auth.log",
    fileIdentity: "inode:42",
    byteOffset: byteOffset.toString(),
    observedAt: "1732145400000000000",
    rawEventBase64,
    rawEventLength: Buffer.from(rawEventBase64, "base64").length,
    signature: "0x" + "ab".repeat(64),
  };
}

async function withSpool(
  run: (directory: string, spool: DurableSpool) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "trusttrace-spool-"));
  try {
    await run(directory, new DurableSpool(directory));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("persists requests across new DurableSpool instances", async () => {
  await withSpool(async (directory, spool) => {
    const first = request("550e8400-e29b-41d4-a716-446655440000", 10n);
    await spool.enqueue(first);

    const reloaded = new DurableSpool(directory);
    assert.deepEqual(await reloaded.listPending(), [first]);
  });
});

test("identical duplicate enqueue is an idempotent no-op", async () => {
  await withSpool(async (_directory, spool) => {
    const first = request("550e8400-e29b-41d4-a716-446655440001", 20n);
    await spool.enqueue(first);
    await spool.enqueue({ ...first });

    assert.deepEqual(await spool.listPending(), [first]);
  });
});

test("conflicting duplicate enqueue rejects without overwriting", async () => {
  await withSpool(async (_directory, spool) => {
    const deliveryId = "550e8400-e29b-41d4-a716-446655440002";
    const first = request(deliveryId, 30n, "YQ==");
    await spool.enqueue(first);

    await assert.rejects(
      spool.enqueue(request(deliveryId, 30n, "Yg==")),
      /Delivery ID conflict/,
    );
    assert.deepEqual(await spool.listPending(), [first]);
  });
});

test("lists requests sorted by byteOffset", async () => {
  await withSpool(async (_directory, spool) => {
    const later = request("550e8400-e29b-41d4-a716-446655440003", 100n);
    const earlier = request("550e8400-e29b-41d4-a716-446655440004", 5n);
    await spool.enqueue(later);
    await spool.enqueue(earlier);

    assert.deepEqual(await spool.listPending(), [earlier, later]);
  });
});

test("acknowledgement removes a request and is idempotent", async () => {
  await withSpool(async (_directory, spool) => {
    const deliveryId = "550e8400-e29b-41d4-a716-446655440005";
    await spool.enqueue(request(deliveryId, 40n));

    await spool.acknowledge(deliveryId);
    await spool.acknowledge(deliveryId);

    assert.deepEqual(await spool.listPending(), []);
  });
});

test("corrupt and invalid persisted requests throw", async () => {
  await withSpool(async (directory, spool) => {
    await writeFile(
      join(directory, "550e8400-e29b-41d4-a716-446655440006.json"),
      "{corrupt",
    );

    await assert.rejects(spool.listPending(), /Corrupt spool file/);
  });
});

test("empty existing spool file is rejected and remains empty", async () => {
  await withSpool(async (directory, spool) => {
    const deliveryId = "550e8400-e29b-41d4-a716-446655440007";
    const finalPath = join(directory, `${deliveryId}.json`);
    await writeFile(finalPath, "");

    await assert.rejects(
      spool.enqueue(request(deliveryId, 50n)),
      /Existing spool file is corrupt/,
    );

    assert.equal((await readFile(finalPath)).length, 0);
  });
});
