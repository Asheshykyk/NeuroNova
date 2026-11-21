import assert from "node:assert/strict";
import { mkdtemp, rm, truncate, writeFile, appendFile } from "node:fs/promises";
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
  try {
    const follower = new AuthLogFollower(filePath);
    const events = await follower.pollOnce();

    assert.deepEqual(events, [{
      byteOffset: 0n,
      rawEventBytes: Buffer.from("existing line"),
    }]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reads a later append without replaying prior lines", async () => {
  const { directory, filePath } = await createLog("first\n");
  try {
    const follower = new AuthLogFollower(filePath);
    assert.equal((await follower.pollOnce()).length, 1);

    await appendFile(filePath, "second\n");
    const events = await follower.pollOnce();

    assert.deepEqual(events, [{
      byteOffset: 6n,
      rawEventBytes: Buffer.from("second"),
    }]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("completes a line split across polls", async () => {
  const { directory, filePath } = await createLog("split");
  try {
    const follower = new AuthLogFollower(filePath);
    assert.deepEqual(await follower.pollOnce(), []);

    await appendFile(filePath, " line\n");
    assert.deepEqual(await follower.pollOnce(), [{
      byteOffset: 0n,
      rawEventBytes: Buffer.from("split line"),
    }]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("starts at a nonzero offset", async () => {
  const initial = Buffer.from("skip this\n");
  const { directory, filePath } = await createLog(
    Buffer.concat([initial, Buffer.from("read this\n")]),
  );
  try {
    const follower = new AuthLogFollower(filePath, BigInt(initial.length));
    const events = await follower.pollOnce();

    assert.deepEqual(events, [{
      byteOffset: BigInt(initial.length),
      rawEventBytes: Buffer.from("read this"),
    }]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("throws when the file shrinks below the read offset", async () => {
  const { directory, filePath } = await createLog("first\n");
  try {
    const follower = new AuthLogFollower(filePath);
    await follower.pollOnce();

    await truncate(filePath, 0);
    await assert.rejects(
      follower.pollOnce(),
      /Auth log file shrank below read offset/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("uses bounded reads across multiple polls without duplicates", async () => {
  const { directory, filePath } = await createLog("aa\nbb\ncc\ndd\n");
  try {
    const follower = new AuthLogFollower(filePath, 0n, 4);
    const allEvents = [];

    allEvents.push(...await follower.pollOnce());
    allEvents.push(...await follower.pollOnce());
    allEvents.push(...await follower.pollOnce());

    assert.deepEqual(allEvents, [
      { byteOffset: 0n, rawEventBytes: Buffer.from("aa") },
      { byteOffset: 3n, rawEventBytes: Buffer.from("bb") },
      { byteOffset: 6n, rawEventBytes: Buffer.from("cc") },
      { byteOffset: 9n, rawEventBytes: Buffer.from("dd") },
    ]);
  } finally {
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
