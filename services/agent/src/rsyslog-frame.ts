export interface RsyslogFrameOptions {
  sourceId: string;
  streamId: string;
  fileIdentity: string;
  fileGeneration: string;
  byteOffset: bigint | number | string;
  observedAt: bigint | number | string;
  rawEventBytes: Uint8Array | Buffer;
}

export interface RsyslogJsonBody {
  sourceId: string;
  streamId: string;
  fileIdentity: string;
  fileGeneration: string;
  byteOffset: string;
  observedAt: string;
  rawEventBase64: string;
}

function requiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a nonblank string`);
  }
  return value;
}

function decimalValue(
  value: bigint | number | string,
  name: string,
): string {
  if (typeof value === "bigint") {
    if (value < 0n) {
      throw new Error(`${name} must be nonnegative`);
    }
    return value.toString();
  }

  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${name} must be a nonnegative safe integer`);
    }
    return value.toString();
  }

  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error(`${name} must be a decimal string`);
  }
  return BigInt(value).toString();
}

export function serializeRsyslogFrame(
  options: RsyslogFrameOptions,
): Buffer;
export function serializeRsyslogFrame(
  sourceId: string,
  streamId: string,
  fileIdentity: string,
  fileGeneration: string,
  byteOffset: bigint | number | string,
  observedAt: bigint | number | string,
  rawEventBytes: Uint8Array | Buffer,
): Buffer;
export function serializeRsyslogFrame(
  optionsOrSourceId:
    | RsyslogFrameOptions
    | string,
  streamId?: string,
  fileIdentity?: string,
  fileGeneration?: string,
  byteOffset?: bigint | number | string,
  observedAt?: bigint | number | string,
  rawEventBytes?: Uint8Array | Buffer,
): Buffer {
  let options: RsyslogFrameOptions;
  if (typeof optionsOrSourceId === "object") {
    options = optionsOrSourceId;
  } else {
    if (
      streamId === undefined ||
      fileIdentity === undefined ||
      fileGeneration === undefined ||
      byteOffset === undefined ||
      observedAt === undefined ||
      rawEventBytes === undefined
    ) {
      throw new Error("Incomplete rsyslog frame arguments");
    }
    options = {
      sourceId: optionsOrSourceId,
      streamId,
      fileIdentity,
      fileGeneration,
      byteOffset,
      observedAt,
      rawEventBytes,
    };
  }

  const sourceId = requiredText(options.sourceId, "sourceId");
  const resolvedStreamId = requiredText(options.streamId, "streamId");
  const resolvedFileIdentity = requiredText(
    options.fileIdentity,
    "fileIdentity",
  );
  const resolvedFileGeneration = requiredText(
    options.fileGeneration,
    "fileGeneration",
  );
  if (!/^dev:\d+:ino:\d+$/.test(resolvedFileGeneration)) {
    throw new Error(
      "fileGeneration must use dev:<device-number>:ino:<inode-number>",
    );
  }

  if (
    !(options.rawEventBytes instanceof Uint8Array)
  ) {
    throw new Error("rawEventBytes must be a Uint8Array or Buffer");
  }
  const payload = Buffer.from(options.rawEventBytes);
  if (payload.length === 0) {
    throw new Error("rawEventBytes must contain an LF-terminated payload");
  }
  if (payload.at(-1) !== 0x0a) {
    throw new Error("rawEventBytes must end with LF (0x0A)");
  }

  const body: RsyslogJsonBody = {
    sourceId,
    streamId: resolvedStreamId,
    fileIdentity: resolvedFileIdentity,
    fileGeneration: resolvedFileGeneration,
    byteOffset: decimalValue(options.byteOffset, "byteOffset"),
    observedAt: decimalValue(options.observedAt, "observedAt"),
    rawEventBase64: payload.toString("base64"),
  };

  const jsonBody = JSON.stringify(body);
  const bodyLength = Buffer.byteLength(jsonBody, "utf8");
  const prefix = Buffer.from(`${bodyLength} `, "ascii");
  return Buffer.concat([prefix, Buffer.from(jsonBody, "utf8")]);
}

export const rsyslogFrame = serializeRsyslogFrame;
export const buildRsyslogFrame = serializeRsyslogFrame;
