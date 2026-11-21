import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

interface HeartbeatSequenceFile {
  schemaVersion: 1;
  sourceId: string;
  heartbeatSequence: string;
}

export class HeartbeatSequenceStore {
  private readonly sequencePath: string;
  private readonly sourceId: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(sequencePath: string, sourceId: string) {
    this.sequencePath = sequencePath;
    this.sourceId = sourceId;
  }

  private async readSequence(): Promise<bigint> {
    let contents: Buffer;
    try {
      contents = await readFile(this.sequencePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return 0n;
      }
      throw error;
    }

    let value: unknown;
    try {
      value = JSON.parse(contents.toString("utf8"));
    } catch (error) {
      throw new Error(
        `Corrupt heartbeat sequence file ${this.sequencePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (typeof value !== "object" || value === null) {
      throw new Error(`Invalid heartbeat sequence file ${this.sequencePath}`);
    }

    const sequence = value as Record<string, unknown>;
    if (
      sequence.schemaVersion !== 1 ||
      typeof sequence.sourceId !== "string" ||
      typeof sequence.heartbeatSequence !== "string" ||
      !/^[1-9]\d*$/.test(sequence.heartbeatSequence)
    ) {
      throw new Error(`Invalid heartbeat sequence file ${this.sequencePath}`);
    }

    if (sequence.sourceId !== this.sourceId) {
      throw new Error(
        `Heartbeat sequence source mismatch in ${this.sequencePath}`,
      );
    }

    return BigInt(sequence.heartbeatSequence);
  }

  nextSequence(): Promise<bigint> {
    const operation = this.queue.then(async () => {
      await mkdir(dirname(this.sequencePath), { recursive: true });
      const current = await this.readSequence();
      const next = current + 1n;
      const record: HeartbeatSequenceFile = {
        schemaVersion: 1,
        sourceId: this.sourceId,
        heartbeatSequence: next.toString(),
      };

      const temporaryPath = join(
        dirname(this.sequencePath),
        `.${process.pid}.${Date.now()}.tmp`,
      );
      let handle;

      try {
        handle = await open(temporaryPath, "wx", 0o600);
        await handle.writeFile(JSON.stringify(record), "utf8");
        await handle.sync();
        await handle.close();
        handle = undefined;
        await rename(temporaryPath, this.sequencePath);
        return next;
      } catch (error) {
        if (handle) {
          await handle.close().catch(() => {});
        }
        await rm(temporaryPath, { force: true }).catch(() => {});
        throw error;
      }
    });

    this.queue = operation.catch(() => {});
    return operation;
  }
}
