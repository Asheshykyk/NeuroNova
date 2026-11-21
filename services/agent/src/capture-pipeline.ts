import { randomUUID } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { open, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
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

function generationFromStat(value: {
  dev: bigint | number;
  ino: bigint | number;
}): string {
  return `dev:${BigInt(value.dev)}:ino:${BigInt(value.ino)}`;
}

export class CapturePipeline {
  private readonly options: CapturePipelineOptions;
  private readonly follower: AuthLogFollower;
  private readonly pendingByOffset: Map<string, SignedEventRequest>;
  private persistedCheckpoint: bigint;
  private persistedGeneration: string | undefined;
  private failed = false;
  private closed = false;

  constructor(
    options: CapturePipelineOptions,
    follower: AuthLogFollower,
    pendingByOffset: Map<string, SignedEventRequest>,
    persistedCheckpoint: bigint,
    persistedGeneration?: string,
  ) {
    this.options = options;
    this.follower = follower;
    this.pendingByOffset = pendingByOffset;
    this.persistedCheckpoint = persistedCheckpoint;
    this.persistedGeneration = persistedGeneration;
  }

  private async advanceCheckpoint(
    nextByteOffset: bigint,
    fileGeneration: string,
  ): Promise<void> {
    if (this.persistedGeneration !== fileGeneration) {
      const activeGeneration = this.follower.getFileGeneration();
      if (
        this.persistedGeneration !== undefined &&
        activeGeneration !== fileGeneration
      ) {
        return;
      }
    } else if (nextByteOffset <= this.persistedCheckpoint) {
      return;
    }
    await this.options.checkpointStore.save(
      nextByteOffset,
      fileGeneration,
    );
    this.persistedCheckpoint = nextByteOffset;
    this.persistedGeneration = fileGeneration;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.follower.close();
  }

  private pendingKey(
    fileGeneration: string,
    byteOffset: bigint,
  ): string {
    return `${fileGeneration}:${byteOffset}`;
  }

  private async findGenerationFile(
    fileGeneration: string,
  ): Promise<string | undefined> {
    const directory = dirname(this.options.logPath);
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const candidate = join(directory, entry.name);
      try {
        const metadata = await stat(candidate, { bigint: true });
        if (generationFromStat(metadata) === fileGeneration) {
          return candidate;
        }
      } catch {
        // Candidate disappeared during recovery.
      }
    }
    return undefined;
  }

  async captureOnce(): Promise<SignedEventRequest[]> {
    if (this.failed) {
      throw new Error(
        "CapturePipeline is failed after a processing error; construct a new instance to recover",
      );
    }

    const captured: SignedEventRequest[] = [];
    const recoveredRequests = new Map<string, SignedEventRequest>();

    try {
      const recovered = [...this.pendingByOffset.entries()].sort(
        ([leftKey], [rightKey]) => leftKey.localeCompare(rightKey),
      );

      for (const [key, existing] of recovered) {
        const fileGeneration = existing.fileGeneration;
        const byteOffset = BigInt(existing.byteOffset);
        const candidate = await this.findGenerationFile(fileGeneration);
        if (!candidate) {
          throw new Error(
            `Pending request conflict: file generation ${fileGeneration} was not found`,
          );
        }

        const handle = await open(candidate, "r");
        try {
          const handleStat = await handle.stat({ bigint: true });
          if (generationFromStat(handleStat) !== fileGeneration) {
            throw new Error(
              `Pending request conflict: open file is not generation ${fileGeneration}`,
            );
          }
          const length = existing.rawEventLength;
          const buffer = Buffer.alloc(length);
          const result = await handle.read(
            buffer,
            0,
            length,
            byteOffset,
          );
          if (result.bytesRead !== length) {
            throw new Error(
              `Pending request conflict at byteOffset ${byteOffset}: short read in generation ${fileGeneration}`,
            );
          }
          if (buffer.length === 0 || buffer.at(-1) !== 0x0a) {
            throw new Error(
              `Pending request conflict at byteOffset ${byteOffset}: terminating LF is missing`,
            );
          }
          if (
            buffer.toString("base64") !== existing.rawEventBase64 ||
            buffer.length !== existing.rawEventLength
          ) {
            throw new Error(
              `Pending request conflict at byteOffset ${byteOffset}: raw event bytes differ`,
            );
          }
        } finally {
          await handle.close();
        }
        captured.push(existing);
        recoveredRequests.set(key, existing);
        this.pendingByOffset.delete(key);
      }

      const events = await this.follower.pollOnce();
      for (const event of events) {
        const fileGeneration =
          event.fileGeneration ?? this.follower.getFileGeneration();
        if (!fileGeneration) {
          throw new Error("Auth log event has no file generation");
        }

        const key = this.pendingKey(fileGeneration, event.byteOffset);
        const existing =
          this.pendingByOffset.get(key) ?? recoveredRequests.get(key);
        const wasRecovered = recoveredRequests.has(key);
        let request: SignedEventRequest;

        if (existing !== undefined) {
          if (
            existing.rawEventBase64 !== event.rawEventBytes.toString("base64") ||
            existing.rawEventLength !== event.rawEventBytes.length ||
            existing.fileGeneration !== fileGeneration
          ) {
            throw new Error(
              `Pending request conflict at byteOffset ${event.byteOffset} and generation ${fileGeneration}: raw event bytes differ`,
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
            fileGeneration,
            observedAtNs(),
            event,
            this.options.privateKey,
          );
          await this.options.spool.enqueue(request);
        }

        await this.advanceCheckpoint(
          event.byteOffset + BigInt(event.rawEventBytes.length),
          fileGeneration,
        );
        if (!wasRecovered) {
          captured.push(request);
        }
        this.pendingByOffset.delete(key);
        recoveredRequests.delete(key);
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
  const checkpoint = await options.checkpointStore.loadCheckpoint();
  const followerOffset = checkpoint?.nextByteOffset ?? 0n;
  const pending = await options.spool.listPending();
  const pendingByOffset = new Map<string, SignedEventRequest>();

  for (const request of pending) {
    if (
      request.sourceId !== options.sourceId ||
      request.streamId !== options.streamId ||
      request.fileIdentity !== options.fileIdentity
    ) {
      continue;
    }

    const key = `${request.fileGeneration}:${BigInt(request.byteOffset)}`;
    if (pendingByOffset.has(key)) {
      throw new Error(
        `Pending request conflict at byteOffset ${request.byteOffset} and generation ${request.fileGeneration}: multiple matching requests`,
      );
    }
    pendingByOffset.set(key, request);
  }

  const follower = new AuthLogFollower(
    options.logPath,
    followerOffset,
    64 * 1024,
    checkpoint?.fileGeneration,
  );

  return new CapturePipeline(
    options,
    follower,
    pendingByOffset,
    checkpoint?.nextByteOffset ?? 0n,
    checkpoint?.fileGeneration,
  );
}
