import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm, writeFile, stat, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { generateAgentKeyPair } from "@trusttrace/core/agent";
import { AgentCheckpointStore } from "../src/agent-checkpoint-store.ts";
import { DurableSpool } from "../src/durable-spool.ts";
import { createCapturePipeline } from "../src/capture-pipeline.ts";

const deliveryIds = [
  "550e8400-e29b-41d4-a716-446655440010",
  "550e8400-e29b-41d4-a716-446655440011",
  "550e8400-e29b-41d4-a716-446655440012",
];

async function setup(contents = "") {
  const directory = await mkdtemp(join(tmpdir(), "trusttrace-capture-"));
  const logPath = join(directory, "auth.log");
  const checkpointPath = join(directory, "checkpoint.json");
  const spoolDirectory = join(directory, "spool");
  await writeFile(logPath, contents);

  const sourceId = "host-agent-cyprus-01";
  const streamId = "auth.log";
  const fileIdentity = "/var/log/auth.log";
  const metadata = await stat(logPath, { bigint: true });
  const fileGeneration = `dev:${metadata.dev}:ino:${metadata.ino}`;
  const privateKey = generateAgentKeyPair(Buffer.alloc(32, 7)).privateKey;
  const checkpointStore = new AgentCheckpointStore(
    checkpointPath,
    sourceId,
    streamId,
    fileIdentity,
  );
  const spool = new DurableSpool(spoolDirectory);
  let deliveryIndex = 0;
  let timestamp = 1732145400000000000n;

  const pipeline = await createCapturePipeline({
    logPath,
    sourceId,
    streamId,
    fileIdentity,
    privateKey,
    checkpointStore,
    spool,
    deliveryIdFactory: () => deliveryIds[deliveryIndex++]!,
    observedAtNsFactory: () => timestamp++,
  });

  return {
    directory,
    logPath,
    spoolDirectory,
    sourceId,
    streamId,
    fileIdentity,
    fileGeneration,
    privateKey,
    checkpointStore,
    spool,
    pipeline,
  };
}

test("captures and persists multiple lines", async () => {
  const state = await setup("aa\nbb\n");
  try {
    const captured = await state.pipeline.captureOnce();
    assert.equal(captured.length, 2);
    assert.deepEqual(captured.map((request) => request.byteOffset), ["0", "3"]);
    assert.equal((await state.checkpointStore.load()), 6n);
    assert.equal((await state.spool.listPending()).length, 2);
  } finally {
    await state.pipeline.close();
    await rm(state.directory, { recursive: true, force: true });
  }
});

test("incremental append does not replay prior lines", async () => {
  const state = await setup("first\n");
  try {
    assert.equal((await state.pipeline.captureOnce()).length, 1);
    await appendFile(state.logPath, "second\n");

    const captured = await state.pipeline.captureOnce();
    assert.equal(captured.length, 1);
    assert.equal(captured[0].byteOffset, "6");
    assert.equal((await state.checkpointStore.load()), 13n);
  } finally {
    await state.pipeline.close();
    await rm(state.directory, { recursive: true, force: true });
  }
});

test("recovers a pending event when checkpoint save fails", async () => {
  const state = await setup("recover\n");
  let recovered: Awaited<ReturnType<typeof createCapturePipeline>> | undefined;
  try {
    const originalSave = state.checkpointStore.save.bind(state.checkpointStore);
    let fail = true;
    state.checkpointStore.save = async (offset: bigint, fileGeneration?: string) => {
      if (fail) {
        fail = false;
        throw new Error("simulated checkpoint save failure");
      }
      await originalSave(offset, fileGeneration);
    };

    await assert.rejects(
      state.pipeline.captureOnce(),
      /simulated checkpoint save failure/,
    );
    await assert.rejects(
      state.pipeline.captureOnce(),
      /construct a new instance/,
    );

    const pending = await state.spool.listPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].deliveryId, deliveryIds[0]);

    let recoveredDeliveryId: string | undefined;
    let recoveryTimestamp = 1732145400000000001n;
    recovered = await createCapturePipeline({
      logPath: state.logPath,
      sourceId: state.sourceId,
      streamId: state.streamId,
      fileIdentity: state.fileIdentity,
      fileGeneration: state.fileGeneration,
      privateKey: state.privateKey,
      checkpointStore: state.checkpointStore,
      spool: state.spool,
      deliveryIdFactory: () => {
        recoveredDeliveryId = deliveryIds[1];
        return recoveredDeliveryId;
      },
      observedAtNsFactory: () => recoveryTimestamp++,
    });

    const recoveredEvents = await recovered.captureOnce();
    assert.equal(recoveredEvents.length, 1);
    assert.equal(recoveredEvents[0].deliveryId, pending[0].deliveryId);
    assert.equal(recoveredDeliveryId, undefined);
  } finally {
    await state.pipeline.close();
    await recovered?.close();
    await rm(state.directory, { recursive: true, force: true });
  }
});

test("rejects pending event raw bytes conflicting with the file", async () => {
  const state = await setup("file bytes\n");
  let conflicting: Awaited<ReturnType<typeof createCapturePipeline>> | undefined;
  try {
    await state.spool.enqueue({
      schemaVersion: 1,
      sourceId: state.sourceId,
      deliveryId: deliveryIds[0],
      streamId: state.streamId,
      fileIdentity: state.fileIdentity,
      fileGeneration: state.fileGeneration,
      byteOffset: "0",
      observedAt: "1732145400000000000",
      rawEventBase64: Buffer.from("wrong bytes\n").toString("base64"),
      rawEventLength: 12,
      signature: "0x" + "ab".repeat(64),
    });

    conflicting = await createCapturePipeline({
      logPath: state.logPath,
      sourceId: state.sourceId,
      streamId: state.streamId,
      fileIdentity: state.fileIdentity,
      privateKey: state.privateKey,
      checkpointStore: state.checkpointStore,
      spool: state.spool,
    });

    await assert.rejects(
      conflicting.captureOnce(),
      /Pending request conflict at byteOffset 0/,
    );
    await assert.rejects(
      conflicting.captureOnce(),
      /construct a new instance/,
    );
  } finally {
    await state.pipeline.close();
    await conflicting?.close();
    await rm(state.directory, { recursive: true, force: true });
  }
});

test("rejects pending event without LF and leaves a missing checkpoint at zero", async () => {
  const state = await setup("match!");
  let conflicting: Awaited<ReturnType<typeof createCapturePipeline>> | undefined;
  try {
    await state.spool.enqueue({
      schemaVersion: 1,
      sourceId: state.sourceId,
      deliveryId: deliveryIds[0],
      streamId: state.streamId,
      fileIdentity: state.fileIdentity,
      fileGeneration: state.fileGeneration,
      byteOffset: "0",
      observedAt: "1732145400000000000",
      rawEventBase64: Buffer.from("match\n").toString("base64"),
      rawEventLength: 6,
      signature: "0x" + "ab".repeat(64),
    });

    conflicting = await createCapturePipeline({
      logPath: state.logPath,
      sourceId: state.sourceId,
      streamId: state.streamId,
      fileIdentity: state.fileIdentity,
      privateKey: state.privateKey,
      checkpointStore: state.checkpointStore,
      spool: state.spool,
    });

    await assert.rejects(
      conflicting.captureOnce(),
      /terminating LF is missing/,
    );
    assert.equal(await state.checkpointStore.load(), 0n);
  } finally {
    await state.pipeline.close();
    await conflicting?.close();
    await rm(state.directory, { recursive: true, force: true });
  }
});

test("recovers an older pending request when checkpoint is beyond it", async () => {
  const state = await setup("old\n" + "x".repeat(16));
  let recovered: Awaited<ReturnType<typeof createCapturePipeline>> | undefined;
  try {
    await state.spool.enqueue({
      schemaVersion: 1,
      sourceId: state.sourceId,
      deliveryId: deliveryIds[0],
      streamId: state.streamId,
      fileIdentity: state.fileIdentity,
      fileGeneration: state.fileGeneration,
      byteOffset: "0",
      observedAt: "1732145400000000000",
      rawEventBase64: Buffer.from("old\n").toString("base64"),
      rawEventLength: 4,
      signature: "0x" + "ab".repeat(64),
    });
    await state.checkpointStore.save(20n, state.fileGeneration);

    recovered = await createCapturePipeline({
      logPath: state.logPath,
      sourceId: state.sourceId,
      streamId: state.streamId,
      fileIdentity: state.fileIdentity,
      privateKey: state.privateKey,
      checkpointStore: state.checkpointStore,
      spool: state.spool,
    });

    const recoveredEvents = await recovered.captureOnce();
    assert.equal(recoveredEvents.length, 1);
    assert.equal(recoveredEvents[0].deliveryId, deliveryIds[0]);
    assert.equal(await state.checkpointStore.load(), 20n);
  } finally {
    await state.pipeline.close();
    await recovered?.close();
    await rm(state.directory, { recursive: true, force: true });
  }
});

test("old pending offset does not affect active generation checkpoint", async () => {
  const state = await setup("active\n");
  let recovered: Awaited<ReturnType<typeof createCapturePipeline>> | undefined;
  try {
    await state.checkpointStore.save(7n, state.fileGeneration);
    await state.spool.enqueue({
      schemaVersion: 1,
      sourceId: state.sourceId,
      deliveryId: deliveryIds[0],
      streamId: state.streamId,
      fileIdentity: state.fileIdentity,
      fileGeneration: "dev:2049:ino:999",
      byteOffset: "200",
      observedAt: "1732145400000000000",
      rawEventBase64: Buffer.from("old\n").toString("base64"),
      rawEventLength: 4,
      signature: "0x" + "ab".repeat(64),
    });

    recovered = await createCapturePipeline({
      logPath: state.logPath,
      sourceId: state.sourceId,
      streamId: state.streamId,
      fileIdentity: state.fileIdentity,
      privateKey: state.privateKey,
      checkpointStore: state.checkpointStore,
      spool: state.spool,
    });

    await assert.rejects(
      recovered.captureOnce(),
      /file generation dev:2049:ino:999 was not found/,
    );
    assert.equal(await state.checkpointStore.load(), 7n);
  } finally {
    await state.pipeline.close();
    await recovered?.close();
    await rm(state.directory, { recursive: true, force: true });
  }
});

test("old pending event does not move checkpoint or skip active generation records", async () => {
  const state = await setup("old\n");
  let recovered: Awaited<ReturnType<typeof createCapturePipeline>> | undefined;
  try {
    const oldMetadata = await stat(state.logPath, { bigint: true });
    const oldGeneration = `dev:${oldMetadata.dev}:ino:${oldMetadata.ino}`;
    await rename(state.logPath, `${state.logPath}.1`);
    await writeFile(state.logPath, "active\n");
    const activeMetadata = await stat(state.logPath, { bigint: true });
    const activeGeneration =
      `dev:${activeMetadata.dev}:ino:${activeMetadata.ino}`;

    await state.spool.enqueue({
      schemaVersion: 1,
      sourceId: state.sourceId,
      deliveryId: deliveryIds[0],
      streamId: state.streamId,
      fileIdentity: state.fileIdentity,
      fileGeneration: oldGeneration,
      byteOffset: "0",
      observedAt: "1732145400000000000",
      rawEventBase64: Buffer.from("old\n").toString("base64"),
      rawEventLength: 4,
      signature: "0x" + "ab".repeat(64),
    });

    recovered = await createCapturePipeline({
      logPath: state.logPath,
      sourceId: state.sourceId,
      streamId: state.streamId,
      fileIdentity: state.fileIdentity,
      privateKey: state.privateKey,
      checkpointStore: state.checkpointStore,
      spool: state.spool,
    });

    const events = await recovered.captureOnce();
    assert.equal(events.length, 2);
    assert.equal(events[0].fileGeneration, oldGeneration);
    assert.equal(events[1].fileGeneration, activeGeneration);
    assert.equal(
      events[1].rawEventBase64,
      Buffer.from("active\n").toString("base64"),
    );
    assert.equal(
      await state.checkpointStore.load(),
      7n,
    );
  } finally {
    await state.pipeline.close();
    await recovered?.close();
    await rm(state.directory, { recursive: true, force: true });
  }
});
