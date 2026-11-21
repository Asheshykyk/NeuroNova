import { open } from "node:fs/promises";
import { RawLineFramer, type RawLineEvent } from "./raw-line-framer.ts";

export class AuthLogFollower {
  private readonly filePath: string;
  private readOffset: bigint;
  private readonly framer: RawLineFramer;
  private readonly maxReadBytes: number;

  constructor(
    filePath: string,
    initialByteOffset: bigint = 0n,
    maxReadBytes: number = 64 * 1024,
  ) {
    if (!Number.isSafeInteger(maxReadBytes) || maxReadBytes <= 0) {
      throw new Error("maxReadBytes must be a positive safe integer");
    }

    this.filePath = filePath;
    this.readOffset = initialByteOffset;
    this.framer = new RawLineFramer(initialByteOffset);
    this.maxReadBytes = maxReadBytes;
  }

  async pollOnce(): Promise<RawLineEvent[]> {
    const handle = await open(this.filePath, "r");

    try {
      const stat = await handle.stat({ bigint: true });
      const fileSize = stat.size;

      if (fileSize < this.readOffset) {
        throw new Error(
          `Auth log file shrank below read offset: ${this.filePath} is ${fileSize} bytes, read offset is ${this.readOffset}`,
        );
      }

      const bytesToRead = fileSize - this.readOffset;
      if (bytesToRead === 0n) {
        return [];
      }

      const readLength = Number(
        bytesToRead < BigInt(this.maxReadBytes)
          ? bytesToRead
          : BigInt(this.maxReadBytes),
      );
      const buffer = Buffer.alloc(readLength);
      const result = await handle.read(
        buffer,
        0,
        buffer.length,
        this.readOffset,
      );

      this.readOffset += BigInt(result.bytesRead);
      if (result.bytesRead === 0) {
        return [];
      }

      return this.framer.push(buffer.subarray(0, result.bytesRead));
    } finally {
      await handle.close();
    }
  }
}
