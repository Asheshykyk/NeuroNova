import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  truncate,
  writeFile,
  appendFile,
  rename,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AuthLogFollower } from "../src/auth-log-follower.ts";

async function createLog(contents: string | Uint8Array): Promise<{
  directory: string;
  filePath: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "trusttrace-auth-log-"));
  const filePath = join(directory, "auth.log");
  await writeFile(filePath, contents);
  return { directory, filePath };
}

test("reads an existing line", async () => {
  const { directory, filePath } = await createLog("existing line\n");
  const follower = new AuthLogFollower(filePath);
  try {
    const events = await follower.pollOnce();

    assert.deepEqual(events.map((event) => ({
      byteOffset: event.byteOffset,
      rawEventBytes: event.rawEventBytes,
    })), [{
      byteOffset: 0n,
      rawEventBytes: Buffer.from("existing line\n"),
    }]);
  } finally {
    await follower.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("reads a later append without replaying prior lines", async () => {
  const { directory, filePath } = await createLog("first\n");
  const follower = new AuthLogFollower(filePath);
  try {
    assert.equal((await follower.pollOnce()).length, 1);

    await appendFile(filePath, "second\n");
    const events = await follower.pollOnce();

    assert.deepEqual(events.map((event) => ({
      byteOffset: event.byteOffset,
      rawEventBytes: event.rawEventBytes,
    })), [{
      byteOffset: 6n,
      rawEventBytes: Buffer.from("second\n"),
    }]);
  } finally {
    await follower.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("completes a line split across polls", async () => {
  const { directory, filePath } = await createLog("split");
  const follower = new AuthLogFollower(filePath);
  try {
    assert.deepEqual(await follower.pollOnce(), []);

    await appendFile(filePath, " line\n");
    assert.deepEqual((await follower.pollOnce()).map((event) => ({
      byteOffset: event.byteOffset,
      rawEventBytes: event.rawEventBytes,
    })), [{
      byteOffset: 0n,
      rawEventBytes: Buffer.from("split line\n"),
    }]);
  } finally {
    await follower.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("starts at a nonzero offset", async () => {
  const initial = Buffer.from("skip this\n");
  const { directory, filePath } = await createLog(
    Buffer.concat([initial, Buffer.from("read this\n")]),
  );
  const follower = new AuthLogFollower(filePath, BigInt(initial.length));
  try {
    const events = await follower.pollOnce();

    assert.deepEqual(events.map((event) => ({
      byteOffset: event.byteOffset,
      rawEventBytes: event.rawEventBytes,
    })), [{
      byteOffset: BigInt(initial.length),
      rawEventBytes: Buffer.from("read this\n"),
    }]);
  } finally {
    await follower.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("throws when the file shrinks below the read offset", async () => {
  const { directory, filePath } = await createLog("first\n");
  const follower = new AuthLogFollower(filePath);
  try {
    await follower.pollOnce();

    await truncate(filePath, 0);
    await assert.rejects(
      follower.pollOnce(),
      /Copy-truncate detected/,
    );
  } finally {
    await follower.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("uses bounded reads across multiple polls without duplicates", async () => {
  const { directory, filePath } = await createLog("aa\nbb\ncc\ndd\n");
  const follower = new AuthLogFollower(filePath, 0n, 4);
  try {
    const allEvents = [];

    allEvents.push(...await follower.pollOnce());
    allEvents.push(...await follower.pollOnce());
    allEvents.push(...await follower.pollOnce());

    assert.deepEqual(allEvents.map((event) => ({
      byteOffset: event.byteOffset,
      rawEventBytes: event.rawEventBytes,
    })), [
      { byteOffset: 0n, rawEventBytes: Buffer.from("aa\n") },
      { byteOffset: 3n, rawEventBytes: Buffer.from("bb\n") },
      { byteOffset: 6n, rawEventBytes: Buffer.from("cc\n") },
      { byteOffset: 9n, rawEventBytes: Buffer.from("dd\n") },
    ]);
  } finally {
    await follower.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects invalid maxReadBytes values", () => {
  for (const invalid of [0, -1, 1.5, Number.NaN, Infinity]) {
    assert.throws(
      () => new AuthLogFollower("unused.log", 0n, invalid),
      /maxReadBytes must be a positive safe integer/,
    );
  }
});

test("derives fileGeneration from handle metadata", async () => {
  const { directory, filePath } = await createLog("line\n");
  const follower = new AuthLogFollower(filePath);
  try {
    const metadata = await stat(filePath, { bigint: true });
    const events = await follower.pollOnce();

    assert.equal(
      follower.getFileGeneration(),
      `dev:${metadata.dev}:ino:${metadata.ino}`,
    );
    assert.equal(events[0].fileGeneration, follower.getFileGeneration());
  } finally {
    await follower.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("drains old generation then switches to a rotated file", async () => {
  const { directory, filePath } = await createLog("old\n");
  const follower = new AuthLogFollower(filePath);
  try {
    assert.equal((await follower.pollOnce()).length, 1);
    await rename(filePath, `${filePath}.1`);
    await writeFile(filePath, "new\n");

    const events = await follower.pollOnce();
    assert.deepEqual(
      events.map((event) => event.rawEventBytes),
      [Buffer.from("new\n")],
    );
  } finally {
    await follower.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("restart recovers the checkpointed generation from a rotated file", async () => {
  const { directory, filePath } = await createLog("old\n");
  const oldMetadata = await stat(filePath, { bigint: true });
  const oldGeneration = `dev:${oldMetadata.dev}:ino:${oldMetadata.ino}`;
  await rename(filePath, `${filePath}.1`);
  await writeFile(filePath, "new\n");
  const follower = new AuthLogFollower(
    filePath,
    0n,
    64 * 1024,
    oldGeneration,
  );
  try {
    const events = await follower.pollOnce();
    assert.deepEqual(
      events.map((event) => event.rawEventBytes),
      [Buffer.from("old\n"), Buffer.from("new\n")],
    );
  } finally {
    await follower.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("fails closed when checkpointed generation is missing", async () => {
  const { directory, filePath } = await createLog("new\n");
  const follower = new AuthLogFollower(
    filePath,
    0n,
    64 * 1024,
    "dev:1:ino:999",
  );
  try {
    await assert.rejects(
      follower.pollOnce(),
      /checkpointed file generation .* was not found/,
    );
  } finally {
    await follower.close();
    await rm(directory, { recursive: true, force: true });
  }
});
