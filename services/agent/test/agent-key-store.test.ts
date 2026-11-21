import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentKeyStore } from "../src/agent-key-store.ts";

test("creates and persists an Ed25519 private seed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trusttrace-key-store-"));
  const keyPath = join(directory, "keys", "agent-private.seed");
  try {
    const store = new AgentKeyStore(keyPath);
    const pair = await store.loadOrCreate();
    const contents = await readFile(keyPath);

    assert.equal(contents.length, 32);
    assert.deepEqual(contents, pair.privateKeyRaw);
    assert.match(pair.publicKeyHex, /^0x[0-9a-f]{64}$/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("loads the same Ed25519 key from a new store instance", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trusttrace-key-store-"));
  const keyPath = join(directory, "agent-private.seed");
  try {
    const first = await new AgentKeyStore(keyPath).loadOrCreate();
    const second = await new AgentKeyStore(keyPath).loadOrCreate();

    assert.equal(first.publicKeyHex, second.publicKeyHex);
    assert.deepEqual(first.publicKeyRaw, second.publicKeyRaw);
    assert.deepEqual(first.privateKeyRaw, second.privateKeyRaw);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects an invalid existing key without overwriting it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trusttrace-key-store-"));
  const keyPath = join(directory, "agent-private.seed");
  try {
    await writeFile(keyPath, Buffer.alloc(31), { mode: 0o600 });

    await assert.rejects(
      new AgentKeyStore(keyPath).loadOrCreate(),
      /Invalid existing Ed25519 private seed/,
    );
    assert.deepEqual(await readFile(keyPath), Buffer.alloc(31));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
