import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { generateAgentKeyPair } from "@trusttrace/core/agent";
import { buildSignedEvent } from "../src/signed-event.ts";

const vectorUrl = new URL("../../../vectors/agent-chunk.json", import.meta.url);

test("buildSignedEvent matches the agent chunk vector", async () => {
  const vector = JSON.parse(await readFile(vectorUrl, "utf8"));
  const pair = generateAgentKeyPair(Buffer.from(vector.seed.slice(2), "hex"));

  const request = buildSignedEvent(
    vector.chunk.sourceId,
    vector.chunk.deliveryId,
    vector.chunk.streamId,
    vector.chunk.fileIdentity,
    vector.chunk.fileGeneration,
    BigInt(vector.chunk.observedAt),
    {
      byteOffset: BigInt(vector.chunk.byteOffset),
      rawEventBytes: Buffer.from(vector.chunk.payload, "utf8"),
    },
    pair.privateKey,
  );

  assert.equal(request.schemaVersion, 1);
  assert.equal(request.sourceId, vector.chunk.sourceId);
  assert.equal(request.deliveryId, vector.chunk.deliveryId);
  assert.equal(request.streamId, vector.chunk.streamId);
  assert.equal(request.fileIdentity, vector.chunk.fileIdentity);
  assert.equal(request.fileGeneration, vector.chunk.fileGeneration);
  assert.equal(request.byteOffset, vector.chunk.byteOffset);
  assert.equal(request.observedAt, vector.chunk.observedAt);
  assert.equal(
    request.rawEventBase64,
    Buffer.from(vector.chunk.payload, "utf8").toString("base64"),
  );
  assert.equal(request.rawEventLength, Buffer.byteLength(vector.chunk.payload));
  assert.equal(request.signature, vector.signatureHex);
  assert.equal(pair.publicKeyRaw.toString("hex"), vector.keyPair.publicKeyRaw.slice(2));
});

test("non-UTF-8 event bytes round-trip through base64", () => {
  const pair = generateAgentKeyPair();
  const bytes = Buffer.from([0xff, 0x00, 0xfe, 0x80, 0x0d, 0x0a]);
  const request = buildSignedEvent(
    "host-agent-cyprus-01",
    "550e8400-e29b-41d4-a716-446655440000",
    "auth.log",
    "/var/log/auth.log",
    "dev:2049:ino:42",
    1732145400000000000n,
    { byteOffset: 99n, rawEventBytes: bytes },
    pair.privateKey,
  );

  assert.equal(request.rawEventBase64, bytes.toString("base64"));
  assert.deepEqual(Buffer.from(request.rawEventBase64, "base64"), bytes);
  assert.equal(request.rawEventLength, bytes.length);
  assert.match(request.signature, /^0x[0-9a-f]{128}$/);
});

test("rejects event bytes without terminating LF", () => {
  const pair = generateAgentKeyPair();

  assert.throws(
    () => buildSignedEvent(
      "host-agent-cyprus-01",
      "550e8400-e29b-41d4-a716-446655440000",
      "auth.log",
      "/var/log/auth.log",
      "dev:2049:ino:42",
      0n,
      { byteOffset: 0n, rawEventBytes: Buffer.from([0xff, 0x0a, 0x80]) },
      pair.privateKey,
    ),
    /rawEventBytes must end with LF \(0x0A\)/,
  );
});

test("rejects a deliveryId that is not a UUID", () => {
  const pair = generateAgentKeyPair();

  assert.throws(
    () => buildSignedEvent(
      "host-agent-cyprus-01",
      "not-a-uuid",
      "auth.log",
      "/var/log/auth.log",
      "dev:2049:ino:42",
      0n,
      { byteOffset: 0n, rawEventBytes: Buffer.alloc(0) },
      pair.privateKey,
    ),
    /deliveryId must be a UUID/,
  );
});
