import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { generateAgentKeyPair } from "@trusttrace/core/agent";
import { buildSignedHeartbeat } from "../src/signed-heartbeat.ts";

const vectorUrl = new URL("../../../vectors/agent-heartbeat.json", import.meta.url);

test("buildSignedHeartbeat matches the agent heartbeat vector", async () => {
  const vector = JSON.parse(await readFile(vectorUrl, "utf8"));
  const pair = generateAgentKeyPair(Buffer.from(vector.seed.slice(2), "hex"));
  const heartbeat = vector.heartbeat;

  const request = buildSignedHeartbeat(
    heartbeat.sourceId,
    BigInt(heartbeat.heartbeatSequence),
    BigInt(heartbeat.observedAt),
    BigInt(heartbeat.lastByteOffset),
    heartbeat.status,
    pair.privateKey,
  );

  assert.equal(request.schemaVersion, 1);
  assert.equal(request.sourceId, heartbeat.sourceId);
  assert.equal(request.heartbeatSequence, heartbeat.heartbeatSequence);
  assert.equal(request.observedAt, heartbeat.observedAt);
  assert.equal(request.lastByteOffset, heartbeat.lastByteOffset);
  assert.equal(request.status, heartbeat.status);
  assert.equal(request.signature, vector.signatureHex);
  assert.equal(pair.publicKeyRaw.toString("hex"), vector.keyPair.publicKeyRaw.slice(2));
});
