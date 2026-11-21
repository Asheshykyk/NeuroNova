import { randomUUID } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { open } from "node:fs/promises";
import { AuthLogFollower } from "./auth-log-follower.ts";
import { AgentCheckpointStore } from "./agent-checkpoint-store.ts";
import { DurableSpool } from "./durable-spool.ts";
import { buildSignedEvent, type SignedEventRequest } from "./signed-event.ts";

export type Ed25519PrivateKey =
  | KeyObject
  | string
  | Buffer
  | Uint8Array;

export interface CapturePipelineOptions {
  logPath: string;
  sourceId: string;
  streamId: string;
  fileIdentity: string;
  privateKey: Ed25519PrivateKey;
  checkpointStore: AgentCheckpointStore;
  spool: DurableSpool;
  deliveryIdFactory?: () => string;
  observedAtNsFactory?: () => bigint;
}

export class CapturePipeline {
  private readonly options: CapturePipelineOptions;
  private readonly follower: AuthLogFollower;
  private readonly pendingByOffset: Map<bigint, SignedEventRequest>;
  private persistedCheckpoint: bigint;
  private failed = false;

  constructor(
    options: CapturePipelineOptions,
    follower: AuthLogFollower,
    pendingByOffset: Map<bigint, SignedEventRequest>,
    persistedCheckpoint: bigint,
  ) {
    this.options = options;
    this.follower = follower;
    this.pendingByOffset = pendingByOffset;
    this.persistedCheckpoint = persistedCheckpoint;
  }

  private async advanceCheckpoint(nextByteOffset: bigint): Promise<void> {
    if (nextByteOffset > this.persistedCheckpoint) {
      await this.options.checkpointStore.save(nextByteOffset);
      this.persistedCheckpoint = nextByteOffset;
    }
  }

  async captureOnce(): Promise<SignedEventRequest[]> {
    if (this.failed) {
      throw new Error(
        "CapturePipeline is failed after a processing error; construct a new instance to recover",
      );
    }

    const captured: SignedEventRequest[] = [];

    try {
      const recoveredOffsets = [...this.pendingByOffset.keys()].sort((left, right) =>
        left < right ? -1 : left > right ? 1 : 0,
      );

      for (const byteOffset of recoveredOffsets) {
        const existing = this.pendingByOffset.get(byteOffset);
        if (existing === undefined) {
          continue;
        }

        const length = existing.rawEventLength;
        const buffer = Buffer.alloc(length + 1);
        const handle = await open(this.options.logPath, "r");
        try {
          const result = await handle.read(buffer, 0, length + 1, byteOffset);
          if (result.bytesRead !== length + 1) {
            throw new Error(
              `Pending request conflict at byteOffset ${byteOffset}: file does not contain ${length + 1} bytes including LF`,
            );
          }
        } finally {
          await handle.close();
        }

        if (buffer[length] !== 0x0a) {
          throw new Error(
            `Pending request conflict at byteOffset ${byteOffset}: LF delimiter is missing`,
          );
        }

        const payload = buffer.subarray(0, length);
        if (
          payload.toString("base64") !== existing.rawEventBase64 ||
          payload.length !== existing.rawEventLength
        ) {
          throw new Error(
            `Pending request conflict at byteOffset ${byteOffset}: raw event bytes differ`,
          );
        }

        await this.advanceCheckpoint(byteOffset + BigInt(length + 1));
        captured.push(existing);
        this.pendingByOffset.delete(byteOffset);
      }

      const events = await this.follower.pollOnce();
      for (const event of events) {
        const bytes = event.rawEventBytes;
        const base64 = bytes.toString("base64");
        const existing = this.pendingByOffset.get(event.byteOffset);

        let request: SignedEventRequest;
        if (existing !== undefined) {
          if (
            existing.rawEventBase64 !== base64 ||
            existing.rawEventLength !== bytes.length
          ) {
            throw new Error(
              `Pending request conflict at byteOffset ${event.byteOffset}: raw event bytes differ`,
            );
          }
          request = existing;
        } else {
          const deliveryId = (this.options.deliveryIdFactory ?? randomUUID)();
          const observedAtNs =
            this.options.observedAtNsFactory ??
            (() => BigInt(Date.now()) * 1000000n);
          request = buildSignedEvent(
            this.options.sourceId,
            deliveryId,
            this.options.streamId,
            this.options.fileIdentity,
            observedAtNs(),
            event,
            this.options.privateKey,
          );
          await this.options.spool.enqueue(request);
        }

        await this.advanceCheckpoint(
          event.byteOffset + BigInt(event.rawEventBytes.length + 1),
        );
        captured.push(request);
        this.pendingByOffset.delete(event.byteOffset);
      }
    } catch (error) {
      this.failed = true;
      throw error;
    }

    return captured;
  }
}

export async function createCapturePipeline(
  options: CapturePipelineOptions,
): Promise<CapturePipeline> {
  let checkpoint = await options.checkpointStore.load();
  const persistedCheckpoint = checkpoint;
  const pending = await options.spool.listPending();
  const pendingByOffset = new Map<bigint, SignedEventRequest>();

  for (const request of pending) {
    if (
      request.sourceId !== options.sourceId ||
      request.streamId !== options.streamId ||
      request.fileIdentity !== options.fileIdentity
    ) {
      continue;
    }

    const byteOffset = BigInt(request.byteOffset);
    const nextByteOffset =
      byteOffset + BigInt(request.rawEventLength + 1);

    if (nextByteOffset > checkpoint) {
      checkpoint = nextByteOffset;
    }

    const existing = pendingByOffset.get(byteOffset);
    if (existing !== undefined) {
      throw new Error(
        `Pending request conflict at byteOffset ${byteOffset}: multiple matching requests`,
      );
    }
    pendingByOffset.set(byteOffset, request);
  }

  const follower = new AuthLogFollower(options.logPath, checkpoint);
  return new CapturePipeline(
    options,
    follower,
    pendingByOffset,
    persistedCheckpoint,
  );
}
