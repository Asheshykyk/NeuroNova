export type RuntimeDelay = (
  milliseconds: number,
  signal?: AbortSignal,
) => Promise<void>;

export interface AgentRuntimeDependencies {
  captureOnce: () => Promise<unknown>;
  deliverPending: () => Promise<number>;
  heartbeatRun: (signal: AbortSignal) => Promise<void>;
  pollIntervalMs: number;
  delay?: RuntimeDelay;
  onDeliveryError?: (error: unknown) => void | Promise<void>;
  onFatalError?: (error: unknown) => void | Promise<void>;
}

export class AgentRuntime {
  private readonly captureOnce: () => Promise<unknown>;
  private readonly deliverPending: () => Promise<number>;
  private readonly heartbeatRun: (signal: AbortSignal) => Promise<void>;
  private readonly pollIntervalMs: number;
  private readonly delay: RuntimeDelay;
  private readonly onDeliveryError?: (error: unknown) => void | Promise<void>;
  private readonly onFatalError?: (error: unknown) => void | Promise<void>;
  private stopped = false;
  private running = false;
  private controller: AbortController | undefined;

  constructor(dependencies: AgentRuntimeDependencies) {
    if (
      !Number.isSafeInteger(dependencies.pollIntervalMs) ||
      dependencies.pollIntervalMs <= 0
    ) {
      throw new Error("pollIntervalMs must be a positive safe integer");
    }

    this.captureOnce = dependencies.captureOnce;
    this.deliverPending = dependencies.deliverPending;
    this.heartbeatRun = dependencies.heartbeatRun;
    this.pollIntervalMs = dependencies.pollIntervalMs;
    this.delay = dependencies.delay ?? this.defaultDelay;
    this.onDeliveryError = dependencies.onDeliveryError;
    this.onFatalError = dependencies.onFatalError;
  }

  stop(): void {
    this.stopped = true;
    this.controller?.abort();
  }

  private defaultDelay(
    milliseconds: number,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("Agent runtime cancelled"));
        return;
      }

      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, milliseconds);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error("Agent runtime cancelled"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private async reportFatal(error: unknown): Promise<void> {
    this.stop();
    if (this.onFatalError) {
      await this.onFatalError(error);
    }
  }

  private async pollLoop(signal: AbortSignal): Promise<void> {
    while (!this.stopped && !signal.aborted) {
      try {
        await this.captureOnce();
      } catch (error) {
        await this.reportFatal(error);
        return;
      }

      try {
        await this.deliverPending();
      } catch (error) {
        if (this.onDeliveryError) {
          try {
            await this.onDeliveryError(error);
          } catch (callbackError) {
            await this.reportFatal(callbackError);
            return;
          }
        }
      }

      try {
        await this.delay(this.pollIntervalMs, signal);
      } catch (error) {
        if (!this.stopped && !signal.aborted) {
          await this.reportFatal(error);
        }
        return;
      }
    }
  }

  async run(callerSignal?: AbortSignal): Promise<void> {
    if (this.running) {
      throw new Error("AgentRuntime is already running");
    }
    if (callerSignal?.aborted) {
      return;
    }

    this.running = true;
    this.stopped = false;
    this.controller = new AbortController();

    const stopLink = () => this.controller?.abort();
    callerSignal?.addEventListener("abort", stopLink, { once: true });
    const signal = this.controller.signal;

    const heartbeatPromise = (async () => {
      try {
        await this.heartbeatRun(signal);
      } catch (error) {
        if (this.stopped || signal.aborted) {
          return;
        }
        await this.reportFatal(error);
      }
      if (!this.stopped && !signal.aborted) {
        await this.reportFatal(
          new Error("Heartbeat runner exited unexpectedly"),
        );
      }
    })();

    await Promise.resolve();
    if (this.stopped) {
      await heartbeatPromise;
      callerSignal?.removeEventListener("abort", stopLink);
      this.running = false;
      this.controller = undefined;
      return;
    }

    const pollPromise = (async () => {
      await this.pollLoop(signal);
    })();

    try {
      await Promise.race([pollPromise, heartbeatPromise]);
      await Promise.all([pollPromise, heartbeatPromise]);
    } finally {
      callerSignal?.removeEventListener("abort", stopLink);
      this.running = false;
      this.controller = undefined;
    }
  }
}
