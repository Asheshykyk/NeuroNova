import { open, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { SignedEventRequest } from "./signed-event.ts";

const UUID_PATTERN =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

function isSignedEventRequest(value: unknown): value is SignedEventRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const request = value as Record<string, unknown>;
  if (
    request.schemaVersion === 1 &&
    typeof request.sourceId === "string" &&
    typeof request.deliveryId === "string" &&
    UUID_PATTERN.test(request.deliveryId) &&
    typeof request.streamId === "string" &&
    typeof request.fileIdentity === "string" &&
    typeof request.byteOffset === "string" &&
    /^\d+$/.test(request.byteOffset) &&
    typeof request.observedAt === "string" &&
    /^\d+$/.test(request.observedAt) &&
    typeof request.rawEventBase64 === "string" &&
    typeof request.rawEventLength === "number" &&
    Number.isSafeInteger(request.rawEventLength) &&
    request.rawEventLength >= 0 &&
    typeof request.rawEventBase64 === "string" &&
    typeof request.signature === "string" &&
    /^0x[0-9a-f]{128}$/i.test(request.signature)
  ) {
    const rawEvent = Buffer.from(request.rawEventBase64, "base64");
    return (
      rawEvent.toString("base64") === request.rawEventBase64 &&
      rawEvent.length === request.rawEventLength
    );
  }
  return false;
}

function canonicalRequest(request: SignedEventRequest): string {
  return JSON.stringify([
    request.schemaVersion,
    request.sourceId,
    request.deliveryId,
    request.streamId,
    request.fileIdentity,
    request.byteOffset,
    request.observedAt,
    request.rawEventBase64,
    request.rawEventLength,
    request.signature,
  ]);
}

export class DurableSpool {
  private readonly spoolDirectory: string;

  constructor(spoolDirectory: string) {
    this.spoolDirectory = spoolDirectory;
  }

  private finalPath(deliveryId: string): string {
    if (!UUID_PATTERN.test(deliveryId)) {
      throw new Error("deliveryId must be a UUID");
    }
    return join(this.spoolDirectory, `${deliveryId}.json`);
  }

  private async ensureDirectory(): Promise<void> {
    await mkdir(this.spoolDirectory, { recursive: true });
  }

  async enqueue(request: SignedEventRequest): Promise<void> {
    if (!isSignedEventRequest(request)) {
      throw new Error("Invalid signed event request");
    }

    await this.ensureDirectory();
    const finalPath = this.finalPath(request.deliveryId);

    let existing: Buffer | undefined;
    try {
      existing = await readFile(finalPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    if (existing !== undefined) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(existing.toString("utf8"));
      } catch (error) {
        throw new Error(
          `Existing spool file is corrupt: ${finalPath}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (!isSignedEventRequest(parsed)) {
        throw new Error(`Existing spool file is invalid: ${finalPath}`);
      }
      if (canonicalRequest(parsed) === canonicalRequest(request)) {
        return;
      }
      throw new Error(
        `Delivery ID conflict: ${request.deliveryId} already has a different request`,
      );
    }

    const temporaryPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
    let handle;

    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(JSON.stringify(request), "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, finalPath);
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => {});
      }
      await rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  async listPending(): Promise<SignedEventRequest[]> {
    await this.ensureDirectory();
    const entries = await readdir(this.spoolDirectory);
    const requests: SignedEventRequest[] = [];

    for (const entry of entries) {
      if (!entry.endsWith(".json")) {
        continue;
      }

      const path = join(this.spoolDirectory, entry);
      const fileStat = await stat(path);
      if (!fileStat.isFile()) {
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(path, "utf8"));
      } catch (error) {
        throw new Error(
          `Corrupt spool file: ${path}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (!isSignedEventRequest(parsed)) {
        throw new Error(`Invalid spool file: ${path}`);
      }

      const expectedFilename = `${parsed.deliveryId}.json`;
      if (entry !== expectedFilename) {
        throw new Error(
          `Spool filename mismatch: ${path} is for deliveryId ${parsed.deliveryId}`,
        );
      }

      requests.push(parsed);
    }

    requests.sort((left, right) => {
      const leftOffset = BigInt(left.byteOffset);
      const rightOffset = BigInt(right.byteOffset);
      return leftOffset < rightOffset ? -1 : leftOffset > rightOffset ? 1 : 0;
    });
    return requests;
  }

  async acknowledge(deliveryId: string): Promise<void> {
    await this.ensureDirectory();
    await rm(this.finalPath(deliveryId), { force: true });
  }
}
