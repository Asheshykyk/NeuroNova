import type { KeyObject } from "node:crypto";
import { buildSignedHeartbeat, type SignedHeartbeatRequest } from "./signed-heartbeat.ts";
import type { HeartbeatSequenceStore } from "./heartbeat-sequence-store.ts";
import type {
  VaultHeartbeatAcknowledgement,
  VaultHeartbeatClient,
} from "./vault-heartbeat-client.ts";
import { RetryableVaultHeartbeatError } from "./vault-heartbeat-client.ts";

export type HeartbeatPrivateKey =
  | KeyObject
  | string
  | Buffer
  | Uint8Array;

export interface HeartbeatRunnerOptions {
  sourceId: string;
  heartbeatSequenceStore?: HeartbeatSequenceStore;
  sequenceStore?: HeartbeatSequenceStore;
  privateKey: HeartbeatPrivateKey;
  vaultClient: VaultHeartbeatClient | {
    sendHeartbeat(
      request: SignedHeartbeatRequest,
      signal?: AbortSignal,
    ): Promise<VaultHeartbeatAcknowledgement>;
  };
  lastByteOffsetProvider: () => bigint | Promise<bigint>;
  statusProvider: () => string | Promise<string>;
  observedAtNsFactory?: () => bigint;
  heartbeatIntervalMs?: number;
  ackIntervalMs?: number;
  intervalMs?: number;
  retryDelayMs?: number;
  delay?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export class HeartbeatRunner {
  private readonly options: HeartbeatRunnerOptions;
  private readonly sequenceStore: HeartbeatSequenceStore;
  private pending: SignedHeartbeatRequest | undefined;
  private stopped = false;
  private runController: AbortController | undefined;

  constructor(options: HeartbeatRunnerOptions) {
    const sequenceStore =
      options.heartbeatSequenceStore ?? options.sequenceStore;
    if (!sequenceStore) {
      throw new Error("heartbeatSequenceStore or sequenceStore is required");
    }
    this.options = options;
    this.sequenceStore = sequenceStore;
  }

  stop(): void {
    this.stopped = true;
    this.runController?.abort();
  }

  private wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
    if (this.options.delay) {
      return this.options.delay(milliseconds, signal);
    }
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("Heartbeat runner cancelled"));
        return;
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, milliseconds);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error("Heartbeat runner cancelled"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private async ensurePending(): Promise<SignedHeartbeatRequest> {
    if (this.pending) {
      return this.pending;
    }

    const sequence = await this.sequenceStore.nextSequence();
    const observedAtNs =
      this.options.observedAtNsFactory ??
      (() => BigInt(Date.now()) * 1000000n);
    const lastByteOffset = await this.options.lastByteOffsetProvider();
    const status = await this.options.statusProvider();

    this.pending = buildSignedHeartbeat(
      this.options.sourceId,
      sequence,
      observedAtNs(),
      lastByteOffset,
      status,
      this.options.privateKey,
    );
    return this.pending;
  }

  async runOnce(signal?: AbortSignal): Promise<SignedHeartbeatRequest> {
    if (this.stopped || signal?.aborted) {
      throw new Error("Heartbeat runner cancelled");
    }

    const request = await this.ensurePending();
    await this.options.vaultClient.sendHeartbeat(request, signal);
    this.pending = undefined;
    return request;
  }

  async run(signal?: AbortSignal): Promise<void> {
    this.stopped = false;
    this.runController = new AbortController();

    const stopLink = () => this.runController?.abort();
    signal?.addEventListener("abort", stopLink, { once: true });
    const runnerSignal = this.runController.signal;

    const interval =
      this.options.heartbeatIntervalMs ??
      this.options.ackIntervalMs ??
      this.options.intervalMs ??
      5000;
    const retryDelay = this.options.retryDelayMs ?? 1000;

    try {
      while (!this.stopped && !runnerSignal.aborted && !signal?.aborted) {
        let acknowledged = false;
        try {
          await this.runOnce(runnerSignal);
          acknowledged = true;
        } catch (error) {
          if (this.stopped || runnerSignal.aborted || signal?.aborted) {
            throw new Error("Heartbeat runner cancelled");
          }
          if (error instanceof RetryableVaultHeartbeatError) {
            await this.wait(retryDelay, runnerSignal);
            continue;
          }
          throw error;
        }

        if (acknowledged) {
          await this.wait(interval, runnerSignal);
        }
      }
    } finally {
      signal?.removeEventListener("abort", stopLink);
      this.runController = undefined;
    }
  }
}
