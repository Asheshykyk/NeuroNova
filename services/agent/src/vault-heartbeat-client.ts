import type { SignedHeartbeatRequest } from "./signed-heartbeat.ts";

export type HeartbeatFetchCompatible = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{
  status: number;
  json(): Promise<unknown>;
}>;

export interface VaultHeartbeatAcknowledgement {
  [key: string]: unknown;
  status: "accepted";
  sourceId: string;
  heartbeatSequence: string;
  duplicate: boolean;
}

export class RetryableVaultHeartbeatError extends Error {
  readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "RetryableVaultHeartbeatError";
    this.cause = cause;
  }
}

export interface VaultHeartbeatClientOptions {
  retryDelayMs?: number;
  maxRetries?: number;
  timeoutMs?: number;
}

export class VaultHeartbeatClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: HeartbeatFetchCompatible;
  private readonly retryDelayMs: number;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;

  constructor(
    baseUrl: string,
    fetchImplOrOptions:
      | HeartbeatFetchCompatible
      | VaultHeartbeatClientOptions
      = globalThis.fetch as HeartbeatFetchCompatible,
    options: VaultHeartbeatClientOptions | number = {},
  ) {
    const fetchImpl =
      typeof fetchImplOrOptions === "function"
        ? fetchImplOrOptions
        : (globalThis.fetch as HeartbeatFetchCompatible);
    const effectiveOptions =
      typeof fetchImplOrOptions === "function"
        ? (typeof options === "number"
          ? { retryDelayMs: options }
          : options)
        : fetchImplOrOptions;

    if (
      effectiveOptions.retryDelayMs !== undefined &&
      (!Number.isSafeInteger(effectiveOptions.retryDelayMs) ||
        effectiveOptions.retryDelayMs < 0)
    ) {
      throw new Error("retryDelayMs must be a nonnegative safe integer");
    }
    if (
      effectiveOptions.maxRetries !== undefined &&
      (!Number.isSafeInteger(effectiveOptions.maxRetries) ||
        effectiveOptions.maxRetries < 0)
    ) {
      throw new Error("maxRetries must be a nonnegative safe integer");
    }
    if (
      effectiveOptions.timeoutMs !== undefined &&
      (!Number.isSafeInteger(effectiveOptions.timeoutMs) ||
        effectiveOptions.timeoutMs <= 0)
    ) {
      throw new Error("timeoutMs must be a positive safe integer");
    }

    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
    this.retryDelayMs = effectiveOptions.retryDelayMs ?? 1000;
    this.maxRetries = effectiveOptions.maxRetries ?? 3;
    this.timeoutMs = effectiveOptions.timeoutMs ?? 5000;
  }

  private waitForRetry(signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("Heartbeat delivery cancelled"));
        return;
      }

      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, this.retryDelayMs);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error("Heartbeat delivery cancelled"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  async sendHeartbeat(
    request: SignedHeartbeatRequest,
    signal?: AbortSignal,
  ): Promise<VaultHeartbeatAcknowledgement> {
    if (signal?.aborted) {
      throw new Error("Heartbeat delivery cancelled");
    }

    const body = JSON.stringify(request);
    const url = `${this.baseUrl}/api/v1/agents/heartbeat`;
    let retries = 0;

    while (true) {
      let response;
      const attemptController = new AbortController();
      let callerAbortHandler: (() => void) | undefined;
      let timedOut = false;

      if (signal) {
        callerAbortHandler = () => attemptController.abort();
        signal.addEventListener("abort", callerAbortHandler, { once: true });
      }

      const timeout = setTimeout(() => {
        timedOut = true;
        attemptController.abort();
      }, this.timeoutMs);

      try {
        response = await this.fetchImpl(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body,
          signal: attemptController.signal,
        });
      } catch (error) {
        clearTimeout(timeout);
        if (callerAbortHandler && signal) {
          signal.removeEventListener("abort", callerAbortHandler);
        }
        if (signal?.aborted) {
          throw new Error("Heartbeat delivery cancelled");
        }
        if (retries >= this.maxRetries) {
          throw timedOut
            ? new RetryableVaultHeartbeatError("Heartbeat request timed out", error)
            : error instanceof Error
              ? new RetryableVaultHeartbeatError(error.message, error)
              : new RetryableVaultHeartbeatError(`Heartbeat network error: ${String(error)}`, error);
        }
        retries++;
        await this.waitForRetry(signal);
        continue;
      }

      const cleanupAttempt = () => {
        clearTimeout(timeout);
        if (callerAbortHandler && signal) {
          signal.removeEventListener("abort", callerAbortHandler);
        }
      };

      if ([400, 401, 409].includes(response.status)) {
        cleanupAttempt();
        throw new Error(`Heartbeat HTTP error: ${response.status}`);
      }

      if ([500, 503].includes(response.status)) {
        cleanupAttempt();
        if (retries >= this.maxRetries) {
          throw new RetryableVaultHeartbeatError(
            `Heartbeat HTTP error: ${response.status}`,
          );
        }
        retries++;
        await this.waitForRetry(signal);
        continue;
      }

      if (response.status !== 200 && response.status !== 201) {
        cleanupAttempt();
        throw new Error(`Heartbeat HTTP error: ${response.status}`);
      }

      let acknowledgement: unknown;
      const bodyAbort = new Promise<never>((_resolve, reject) => {
        if (attemptController.signal.aborted) {
          reject(new Error(
            timedOut ? "Heartbeat request timed out" : "Heartbeat delivery cancelled",
          ));
          return;
        }
        attemptController.signal.addEventListener("abort", () => {
          reject(new Error(
            timedOut ? "Heartbeat request timed out" : "Heartbeat delivery cancelled",
          ));
        }, { once: true });
      });

      try {
        acknowledgement = await Promise.race([
          response.json(),
          bodyAbort,
        ]);
      } catch (error) {
        cleanupAttempt();
        if (signal?.aborted) {
          throw new Error("Heartbeat delivery cancelled");
        }
        if (timedOut) {
          if (retries >= this.maxRetries) {
            throw new RetryableVaultHeartbeatError(
              "Heartbeat request timed out",
            );
          }
          retries++;
          await this.waitForRetry(signal);
          continue;
        }
        if (error instanceof TypeError) {
          if (retries >= this.maxRetries) {
            throw new RetryableVaultHeartbeatError(
              "Heartbeat response body transport failure",
              error,
            );
          }
          retries++;
          await this.waitForRetry(signal);
          continue;
        }
        if (error instanceof SyntaxError) {
          throw new Error(
            `Heartbeat returned invalid JSON: ${error.message}`,
          );
        }
        throw new Error(
          `Heartbeat returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (typeof acknowledgement !== "object" || acknowledgement === null) {
        cleanupAttempt();
        throw new Error("Heartbeat returned an invalid acknowledgement envelope");
      }

      const receipt = acknowledgement as Record<string, unknown>;
      if (
        receipt.status !== "accepted" ||
        typeof receipt.sourceId !== "string" ||
        typeof receipt.heartbeatSequence !== "string" ||
        typeof receipt.duplicate !== "boolean"
      ) {
        cleanupAttempt();
        throw new Error("Heartbeat returned an invalid acknowledgement envelope");
      }
      if (
        receipt.sourceId !== request.sourceId ||
        receipt.heartbeatSequence !== request.heartbeatSequence
      ) {
        cleanupAttempt();
        throw new Error(
          "Heartbeat acknowledgement sourceId or heartbeatSequence does not match the request",
        );
      }
      if (
        (response.status === 201 && receipt.duplicate === false) ||
        (response.status === 200 && receipt.duplicate === true)
      ) {
        cleanupAttempt();
        return receipt as VaultHeartbeatAcknowledgement;
      }

      cleanupAttempt();
      throw new Error(
        `Heartbeat acknowledgement is invalid for HTTP ${response.status}`,
      );
    }
  }

  ingestHeartbeat(
    request: SignedHeartbeatRequest,
    signal?: AbortSignal,
  ): Promise<VaultHeartbeatAcknowledgement> {
    return this.sendHeartbeat(request, signal);
  }

  deliverHeartbeat(
    request: SignedHeartbeatRequest,
    signal?: AbortSignal,
  ): Promise<VaultHeartbeatAcknowledgement> {
    return this.sendHeartbeat(request, signal);
  }
}
