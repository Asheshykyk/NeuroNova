import { open, readdir, stat, type FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";
import { RawLineFramer, type RawLineEvent } from "./raw-line-framer.ts";

function generationFromStat(value: {
  dev: bigint | number;
  ino: bigint | number;
}): string {
  return `dev:${BigInt(value.dev)}:ino:${BigInt(value.ino)}`;
}

export class AuthLogFollower {
  private readonly filePath: string;
  private readOffset: bigint;
  private readonly framer: RawLineFramer;
  private readonly maxReadBytes: number;
  private readonly initialFileGeneration?: string;
  private handle: FileHandle | undefined;
  private fileGeneration: string | undefined;
  private initialized = false;
  private lastHandleSize: bigint = 0n;
  private closed = false;
  private closing: Promise<void> | undefined;

  constructor(
    filePath: string,
    initialByteOffset: bigint = 0n,
    maxReadBytes: number = 64 * 1024,
    initialFileGeneration?: string,
  ) {
    if (!Number.isSafeInteger(maxReadBytes) || maxReadBytes <= 0) {
      throw new Error("maxReadBytes must be a positive safe integer");
    }
    this.filePath = filePath;
    this.readOffset = initialByteOffset;
    this.framer = new RawLineFramer(initialByteOffset);
    this.maxReadBytes = maxReadBytes;
    this.initialFileGeneration = initialFileGeneration;
  }

  getFileGeneration(): string | undefined {
    return this.fileGeneration;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    if (this.closing) return this.closing;

    this.closed = true;
    this.closing = (async () => {
      const handle = this.handle;
      this.handle = undefined;
      if (handle) {
        await handle.close();
      }
    })();
    await this.closing;
  }

  private async findGeneration(
    generation: string,
  ): Promise<string | undefined> {
    const directory = dirname(this.filePath);
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const candidate = join(directory, entry.name);
      try {
        const metadata = await stat(candidate, { bigint: true });
        if (generationFromStat(metadata) === generation) {
          return candidate;
        }
      } catch {
        // Candidate disappeared during rotation.
      }
    }
    return undefined;
  }

  private async initialize(): Promise<void> {
    if (this.closed) throw new Error("AuthLogFollower is closed");
    if (this.initialized) return;

    const currentStat = await stat(this.filePath, { bigint: true });
    const currentGeneration = generationFromStat(currentStat);

    if (
      this.initialFileGeneration !== undefined &&
      this.initialFileGeneration !== currentGeneration
    ) {
      const candidate = await this.findGeneration(
        this.initialFileGeneration,
      );
      if (!candidate) {
        throw new Error(
          `Fail closed: checkpointed file generation ${this.initialFileGeneration} was not found`,
        );
      }
      try {
        this.handle = await open(candidate, "r");
      } catch (error) {
        throw error;
      }
    } else {
      try {
        this.handle = await open(this.filePath, "r");
      } catch (error) {
        throw error;
      }
    }

    try {
      const handleStat = await this.handle.stat({ bigint: true });
      this.fileGeneration = generationFromStat(handleStat);
      if (
        this.initialFileGeneration !== undefined &&
        this.fileGeneration !== this.initialFileGeneration
      ) {
        await this.handle.close();
        this.handle = undefined;
        throw new Error(
          `Fail closed: opened file generation ${this.fileGeneration} does not match checkpointed generation ${this.initialFileGeneration}`,
        );
      }
      this.lastHandleSize = handleStat.size;
      this.initialized = true;
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  private async switchToCurrent(events: RawLineEvent[]): Promise<RawLineEvent[]> {
    if (this.handle) {
      await this.handle.close();
      this.handle = undefined;
    }
    try {
      this.handle = await open(this.filePath, "r");
      const handleStat = await this.handle.stat({ bigint: true });
      this.fileGeneration = generationFromStat(handleStat);
      this.lastHandleSize = handleStat.size;
      this.readOffset = 0n;
      this.framer.reset(0n);
      return events.concat(await this.readFromHandle());
    } catch (error) {
      if (this.handle) {
        await this.handle.close();
        this.handle = undefined;
      }
      throw error;
    }
  }

  private async readFromHandle(): Promise<RawLineEvent[]> {
    if (!this.handle) throw new Error("Auth log file handle is not open");
    const handleStat = await this.handle.stat({ bigint: true });
    const fileSize = handleStat.size;

    if (
      fileSize < this.readOffset ||
      fileSize < this.lastHandleSize
    ) {
      throw new Error(
        `Copy-truncate detected: ${this.filePath} shrank; fail closed`,
      );
    }
    this.lastHandleSize = fileSize;

    const bytesToRead = fileSize - this.readOffset;
    if (bytesToRead === 0n) return [];

    const readLength = Number(
      bytesToRead < BigInt(this.maxReadBytes)
        ? bytesToRead
        : BigInt(this.maxReadBytes),
    );
    const buffer = Buffer.alloc(readLength);
    const result = await this.handle.read(
      buffer,
      0,
      buffer.length,
      this.readOffset,
    );
    this.readOffset += BigInt(result.bytesRead);
    if (result.bytesRead === 0) return [];

    const events = this.framer.push(buffer.subarray(0, result.bytesRead));
    for (const event of events) {
      event.fileGeneration = this.fileGeneration;
    }
    return events;
  }

  async pollOnce(): Promise<RawLineEvent[]> {
    await this.initialize();
    if (!this.handle) throw new Error("Auth log file handle is not open");

    let pathStat;
    try {
      pathStat = await stat(this.filePath, { bigint: true });
    } catch (error) {
      throw new Error(
        `Auth log path disappeared during polling: ${this.filePath}`,
      );
    }
    const pathGeneration = generationFromStat(pathStat);

    if (pathGeneration !== this.fileGeneration) {
      const oldEvents = await this.readFromHandle();
      const handleStat = await this.handle.stat({ bigint: true });
      if (handleStat.size === this.readOffset) {
        if (this.framer.hasPendingBytes()) {
          throw new Error(
            `Fail closed: old file generation ${this.fileGeneration} ended with an incomplete line`,
          );
        }
        return this.switchToCurrent(oldEvents);
      }
      return oldEvents;
    }

    return this.readFromHandle();
  }
}
