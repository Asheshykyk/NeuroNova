import type { KeyObject } from "node:crypto";
import { signAgentChunkHex } from "@trusttrace/core/agent";
import type { RawLineEvent } from "./raw-line-framer.ts";

export interface SignedEventRequest {
  schemaVersion: 1;
  sourceId: string;
  deliveryId: string;
  streamId: string;
  fileIdentity: string;
  byteOffset: string;
  observedAt: string;
  rawEventBase64: string;
  rawEventLength: number;
  signature: string;
}

export type Ed25519PrivateKey =
  | KeyObject
  | string
  | Buffer
  | Uint8Array;

function requireUuid(value: string): void {
  if (
    !/^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i
      .test(value)
  ) {
    throw new Error("deliveryId must be a UUID");
  }
}

export function buildSignedEvent(
  sourceId: string,
  deliveryId: string,
  streamId: string,
  fileIdentity: string,
  observedAtNs: bigint,
  rawEvent: RawLineEvent,
  privateKey: Ed25519PrivateKey,
): SignedEventRequest {
  requireUuid(deliveryId);
  if (rawEvent.rawEventBytes.includes(0x0a)) {
    throw new Error("rawEventBytes must not contain LF (0x0A)");
  }

  const signature = signAgentChunkHex({
    sourceId,
    deliveryId,
    payload: rawEvent.rawEventBytes,
    streamId,
    fileIdentity,
    byteOffset: rawEvent.byteOffset,
    observedAt: observedAtNs,
  }, privateKey);

  return {
    schemaVersion: 1,
    sourceId,
    deliveryId,
    streamId,
    fileIdentity,
    byteOffset: rawEvent.byteOffset.toString(),
    observedAt: observedAtNs.toString(),
    rawEventBase64: rawEvent.rawEventBytes.toString("base64"),
    rawEventLength: rawEvent.rawEventBytes.length,
    signature,
  };
}
