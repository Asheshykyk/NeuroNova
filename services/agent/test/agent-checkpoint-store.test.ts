import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentCheckpointStore } from "../src/agent-checkpoint-store.ts";

async function withDirectory(
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "trusttrace-checkpoint-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("missing checkpoint returns zero", async () => {
  await withDirectory(async (directory) => {
    const store = new AgentCheckpointStore(
      join(directory, "checkpoint.json"),
      "host-agent-cyprus-01",
      "auth.log",
      "inode:42",
    );
    assert.equal(await store.load(), 0n);
  });
});

test("save and reload checkpoint", async () => {
  await withDirectory(async (directory) => {
    const path = join(directory, "checkpoint.json");
    const store = new AgentCheckpointStore(
      path,
      "host-agent-cyprus-01",
      "auth.log",
      "inode:42",
    );

    await store.save(123n, "dev:2049:ino:42");
    assert.equal(await new AgentCheckpointStore(
      path,
      "host-agent-cyprus-01",
      "auth.log",
      "inode:42",
    ).load(), 123n);
  });
});

test("supports a large BigInt offset", async () => {
  await withDirectory(async (directory) => {
    const path = join(directory, "checkpoint.json");
    const offset = 900719925474099312345n;
    const store = new AgentCheckpointStore(
      path,
      "host-agent-cyprus-01",
      "auth.log",
      "inode:42",
    );

    await store.save(offset, "dev:2049:ino:42");
    assert.equal(await store.load(), offset);
  });
});

test("rejects corrupt checkpoint", async () => {
  await withDirectory(async (directory) => {
    const path = join(directory, "checkpoint.json");
    await writeFile(path, "{corrupt");
    const store = new AgentCheckpointStore(
      path,
      "host-agent-cyprus-01",
      "auth.log",
      "inode:42",
    );

    await assert.rejects(store.load(), /Corrupt agent checkpoint file/);
  });
});

test("rejects identity-mismatched checkpoint", async () => {
  await withDirectory(async (directory) => {
    const path = join(directory, "checkpoint.json");
    await writeFile(path, JSON.stringify({
      schemaVersion: 1,
      sourceId: "different-source",
      streamId: "auth.log",
      fileIdentity: "inode:42",
      fileGeneration: "dev:2049:ino:42",
      nextByteOffset: "10",
    }));
    const store = new AgentCheckpointStore(
      path,
      "host-agent-cyprus-01",
      "auth.log",
      "inode:42",
    );

    await assert.rejects(store.load(), /identity mismatch/);
  });
});

test("refuses to move checkpoint backward", async () => {
  await withDirectory(async (directory) => {
    const path = join(directory, "checkpoint.json");
    const store = new AgentCheckpointStore(
      path,
      "host-agent-cyprus-01",
      "auth.log",
      "inode:42",
    );

    await store.save(100n, "dev:2049:ino:42");
    await assert.rejects(
      store.save(99n, "dev:2049:ino:42"),
      /Refusing to move agent checkpoint backward/,
    );
    assert.equal(await store.load(), 100n);
  });
});
