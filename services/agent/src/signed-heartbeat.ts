import type { KeyObject } from "node:crypto";
import { signAgentHeartbeatHex } from "@trusttrace/core/agent";

export type Ed25519PrivateKey =
  | KeyObject
  | string
  | Buffer
  | Uint8Array;

export interface SignedHeartbeatRequest {
  schemaVersion: 1;
  sourceId: string;
  heartbeatSequence: string;
  observedAt: string;
  lastByteOffset: string;
  status: string;
  signature: string;
}

export function buildSignedHeartbeat(
  sourceId: string,
  heartbeatSequence: bigint,
  observedAtNs: bigint,
  lastByteOffset: bigint,
  status: string,
  privateKey: Ed25519PrivateKey,
): SignedHeartbeatRequest {
  const signature = signAgentHeartbeatHex({
    sourceId,
    heartbeatSequence,
    observedAt: observedAtNs,
    lastByteOffset,
    status,
  }, privateKey);

  return {
    schemaVersion: 1,
    sourceId,
    heartbeatSequence: heartbeatSequence.toString(),
    observedAt: observedAtNs.toString(),
    lastByteOffset: lastByteOffset.toString(),
    status,
    signature,
  };
}
