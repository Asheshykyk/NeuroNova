import assert from "node:assert/strict";
import test from "node:test";
import { serializeRsyslogFrame } from "../src/rsyslog-frame.ts";

test("produces exact octet-counted framing", () => {
  const payload = Buffer.from("hello\n", "utf8");
  const frame = serializeRsyslogFrame({
    sourceId: "host-agent-cyprus-01",
    streamId: "auth.log",
    fileIdentity: "/var/log/auth.log",
    fileGeneration: "dev:2049:ino:142857",
    byteOffset: 1048576n,
    observedAt: 1732145400000000000n,
    rawEventBytes: payload,
  });

  const body = JSON.stringify({
    sourceId: "host-agent-cyprus-01",
    streamId: "auth.log",
    fileIdentity: "/var/log/auth.log",
    fileGeneration: "dev:2049:ino:142857",
    byteOffset: "1048576",
    observedAt: "1732145400000000000",
    rawEventBase64: "aGVsbG8K",
  });
  const expected = Buffer.concat([
    Buffer.from(`${Buffer.byteLength(body, "utf8")} `, "ascii"),
    Buffer.from(body, "utf8"),
  ]);

  assert.deepEqual(frame, expected);
  assert.equal(frame.at(-1), 0x7d);
  assert.equal(frame.toString("utf8").endsWith("\n"), false);
});

test("UTF-8 length prefix uses byte length and no trailing newline", () => {
  const payload = Buffer.from("héllo\n", "utf8");
  const frame = serializeRsyslogFrame({
    sourceId: "café",
    streamId: "auth.log",
    fileIdentity: "/var/log/auth.log",
    fileGeneration: "dev:2049:ino:7",
    byteOffset: "12",
    observedAt: "34",
    rawEventBytes: payload,
  });

  const separator = frame.indexOf(0x20);
  const declaredLength = Number(frame.subarray(0, separator).toString("ascii"));
  const body = frame.subarray(separator + 1);

  assert.equal(body.length, declaredLength);
  assert.equal(body.length, Buffer.byteLength(body.toString("utf8"), "utf8"));
  assert.equal(frame.at(-1), 0x7d);
});

test("preserves LF-inclusive payload bytes exactly through Base64", () => {
  const payload = Buffer.from([0xff, 0x00, 0xfe, 0x80, 0x0d, 0x0a]);
  const frame = serializeRsyslogFrame(
    "host-agent-cyprus-01",
    "auth.log",
    "/var/log/auth.log",
    "dev:2049:ino:42",
    99n,
    1732145400000000000n,
    payload,
  );

  const separator = frame.indexOf(0x20);
  const body = JSON.parse(frame.subarray(separator + 1).toString("utf8"));
  assert.equal(body.rawEventBase64, payload.toString("base64"));
  assert.deepEqual(
    Buffer.from(body.rawEventBase64, "base64"),
    payload,
  );
  assert.equal(body.byteOffset, "99");
  assert.equal(body.observedAt, "1732145400000000000");
});

test("rejects invalid metadata", () => {
  assert.throws(
    () => serializeRsyslogFrame({
      sourceId: " ",
      streamId: "auth.log",
      fileIdentity: "/var/log/auth.log",
      fileGeneration: "dev:2049:ino:42",
      byteOffset: 0n,
      observedAt: 0n,
      rawEventBytes: Buffer.from("x\n"),
    }),
    /sourceId/,
  );
  assert.throws(
    () => serializeRsyslogFrame({
      sourceId: "host-agent-cyprus-01",
      streamId: "auth.log",
      fileIdentity: "/var/log/auth.log",
      fileGeneration: "inode:42",
      byteOffset: 0n,
      observedAt: 0n,
      rawEventBytes: Buffer.from("x\n"),
    }),
    /fileGeneration/,
  );
  assert.throws(
    () => serializeRsyslogFrame({
      sourceId: "host-agent-cyprus-01",
      streamId: "auth.log",
      fileIdentity: "/var/log/auth.log",
      fileGeneration: "dev:2049:ino:42",
      byteOffset: -1n,
      observedAt: 0n,
      rawEventBytes: Buffer.from("x\n"),
    }),
    /byteOffset/,
  );
});

test("rejects empty or unterminated payloads", () => {
  for (const payload of [
    Buffer.alloc(0),
    Buffer.from("unterminated"),
  ]) {
    assert.throws(
      () => serializeRsyslogFrame({
        sourceId: "host-agent-cyprus-01",
        streamId: "auth.log",
        fileIdentity: "/var/log/auth.log",
        fileGeneration: "dev:2049:ino:42",
        byteOffset: 0n,
        observedAt: 0n,
        rawEventBytes: payload,
      }),
      /rawEventBytes/,
    );
  }
});
