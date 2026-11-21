import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  const fileIdentity = "inode:42";
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
    await rm(state.directory, { recursive: true, force: true });
  }
});

test("recovers a pending event when checkpoint save fails", async () => {
  const state = await setup("recover\n");
  try {
    const originalSave = state.checkpointStore.save.bind(state.checkpointStore);
    let fail = true;
    state.checkpointStore.save = async (offset: bigint) => {
      if (fail) {
        fail = false;
        throw new Error("simulated checkpoint save failure");
      }
      await originalSave(offset);
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
    const recovered = await createCapturePipeline({
      logPath: state.logPath,
      sourceId: state.sourceId,
      streamId: state.streamId,
      fileIdentity: state.fileIdentity,
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
    await rm(state.directory, { recursive: true, force: true });
  }
});

test("rejects pending event raw bytes conflicting with the file", async () => {
  const state = await setup("file bytes\n");
  try {
    await state.spool.enqueue({
      schemaVersion: 1,
      sourceId: state.sourceId,
      deliveryId: deliveryIds[0],
      streamId: state.streamId,
      fileIdentity: state.fileIdentity,
      byteOffset: "0",
      observedAt: "1732145400000000000",
      rawEventBase64: Buffer.from("wrong bytes").toString("base64"),
      rawEventLength: 11,
      signature: "0x" + "ab".repeat(64),
    });

    const conflicting = await createCapturePipeline({
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
    await rm(state.directory, { recursive: true, force: true });
  }
});

test("rejects pending event without LF and leaves a missing checkpoint at zero", async () => {
  const state = await setup("match!");
  try {
    await state.spool.enqueue({
      schemaVersion: 1,
      sourceId: state.sourceId,
      deliveryId: deliveryIds[0],
      streamId: state.streamId,
      fileIdentity: state.fileIdentity,
      byteOffset: "0",
      observedAt: "1732145400000000000",
      rawEventBase64: Buffer.from("match").toString("base64"),
      rawEventLength: 5,
      signature: "0x" + "ab".repeat(64),
    });

    const conflicting = await createCapturePipeline({
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
      /LF delimiter is missing/,
    );
    assert.equal(await state.checkpointStore.load(), 0n);
  } finally {
    await rm(state.directory, { recursive: true, force: true });
  }
});

test("recovers an older pending request when checkpoint is beyond it", async () => {
  const state = await setup("old\n" + "x".repeat(16));
  try {
    await state.spool.enqueue({
      schemaVersion: 1,
      sourceId: state.sourceId,
      deliveryId: deliveryIds[0],
      streamId: state.streamId,
      fileIdentity: state.fileIdentity,
      byteOffset: "0",
      observedAt: "1732145400000000000",
      rawEventBase64: Buffer.from("old").toString("base64"),
      rawEventLength: 3,
      signature: "0x" + "ab".repeat(64),
    });
    await state.checkpointStore.save(20n);

    const recovered = await createCapturePipeline({
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
    await rm(state.directory, { recursive: true, force: true });
  }
});
