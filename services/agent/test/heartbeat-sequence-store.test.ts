import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { HeartbeatSequenceStore } from "../src/heartbeat-sequence-store.ts";

async function withDirectory(
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "trusttrace-heartbeat-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("starts at sequence one and persists it", async () => {
  await withDirectory(async (directory) => {
    const path = join(directory, "heartbeat-sequence.json");
    const store = new HeartbeatSequenceStore(
      path,
      "host-agent-cyprus-01",
    );

    assert.equal(await store.nextSequence(), 1n);
    assert.equal(await store.nextSequence(), 2n);
  });
});

test("reloads the persisted sequence", async () => {
  await withDirectory(async (directory) => {
    const path = join(directory, "heartbeat-sequence.json");
    const first = new HeartbeatSequenceStore(
      path,
      "host-agent-cyprus-01",
    );

    assert.equal(await first.nextSequence(), 1n);
    assert.equal(await first.nextSequence(), 2n);

    const reloaded = new HeartbeatSequenceStore(
      path,
      "host-agent-cyprus-01",
    );
    assert.equal(await reloaded.nextSequence(), 3n);
  });
});

test("serializes concurrent calls without repeated sequences", async () => {
  await withDirectory(async (directory) => {
    const store = new HeartbeatSequenceStore(
      join(directory, "heartbeat-sequence.json"),
      "host-agent-cyprus-01",
    );

    const sequences = await Promise.all([
      store.nextSequence(),
      store.nextSequence(),
      store.nextSequence(),
      store.nextSequence(),
    ]);

    assert.deepEqual(sequences, [1n, 2n, 3n, 4n]);
  });
});

test("rejects corrupt sequence files", async () => {
  await withDirectory(async (directory) => {
    const path = join(directory, "heartbeat-sequence.json");
    await writeFile(path, "{corrupt");
    const store = new HeartbeatSequenceStore(
      path,
      "host-agent-cyprus-01",
    );

    await assert.rejects(
      store.nextSequence(),
      /Corrupt heartbeat sequence file/,
    );
  });
});

test("rejects another source without overwriting", async () => {
  await withDirectory(async (directory) => {
    const path = join(directory, "heartbeat-sequence.json");
    await writeFile(path, JSON.stringify({
      schemaVersion: 1,
      sourceId: "different-source",
      heartbeatSequence: "7",
    }));
    const store = new HeartbeatSequenceStore(
      path,
      "host-agent-cyprus-01",
    );

    await assert.rejects(
      store.nextSequence(),
      /source mismatch/,
    );
  });
});
