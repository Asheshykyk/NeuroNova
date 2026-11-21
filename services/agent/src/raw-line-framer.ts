export interface RawLineEvent {
  byteOffset: bigint;
  rawEventBytes: Buffer;
}

export class RawLineFramer {
  private pending: Buffer = Buffer.alloc(0);
  private nextByteOffset: bigint;

  constructor(initialFileByteOffset: bigint = 0n) {
    this.nextByteOffset = initialFileByteOffset;
  }

  push(chunk: Uint8Array | Buffer): RawLineEvent[] {
    const input = Buffer.from(chunk);
    const combined = Buffer.concat([this.pending, input]);
    const events: RawLineEvent[] = [];
    let lineStart = 0;

    for (let index = 0; index < combined.length; index++) {
      if (combined[index] !== 0x0a) {
        continue;
      }

      const rawEventBytes = Buffer.from(combined.subarray(lineStart, index));
      const byteOffset = this.nextByteOffset;
      events.push({ byteOffset, rawEventBytes });
      this.nextByteOffset += BigInt(rawEventBytes.length + 1);
      lineStart = index + 1;
    }

    this.pending = Buffer.from(combined.subarray(lineStart));
    return events;
  }
}
