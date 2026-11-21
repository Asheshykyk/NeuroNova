import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface AgentCheckpointState {
  fileGeneration: string;
  nextByteOffset: bigint;
}

interface AgentCheckpoint {
  schemaVersion: 1;
  sourceId: string;
  streamId: string;
  fileIdentity: string;
  fileGeneration: string;
  nextByteOffset: string;
}

export class AgentCheckpointStore {
  private readonly checkpointPath: string;
  private readonly sourceId: string;
  private readonly streamId: string;
  private readonly fileIdentity: string;

  constructor(
    checkpointPath: string,
    sourceId: string,
    streamId: string,
    fileIdentity: string,
  ) {
    this.checkpointPath = checkpointPath;
    this.sourceId = sourceId;
    this.streamId = streamId;
    this.fileIdentity = fileIdentity;
  }

  async loadCheckpoint(): Promise<AgentCheckpointState | null> {
    let contents: Buffer;
    try {
      contents = await readFile(this.checkpointPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }

    let checkpoint: unknown;
    try {
      checkpoint = JSON.parse(contents.toString("utf8"));
    } catch (error) {
      throw new Error(
        `Corrupt agent checkpoint file ${this.checkpointPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (typeof checkpoint !== "object" || checkpoint === null) {
      throw new Error(`Invalid agent checkpoint file ${this.checkpointPath}`);
    }

    const value = checkpoint as Record<string, unknown>;
    if (
      value.schemaVersion !== 1 ||
      typeof value.sourceId !== "string" ||
      typeof value.streamId !== "string" ||
      typeof value.fileIdentity !== "string" ||
      typeof value.fileGeneration !== "string" ||
      typeof value.nextByteOffset !== "string" ||
      !/^\d+$/.test(value.nextByteOffset)
    ) {
      throw new Error(`Invalid agent checkpoint file ${this.checkpointPath}`);
    }

    if (
      value.sourceId !== this.sourceId ||
      value.streamId !== this.streamId ||
      value.fileIdentity !== this.fileIdentity
    ) {
      throw new Error(
        `Agent checkpoint identity mismatch in ${this.checkpointPath}`,
      );
    }

    return {
      fileGeneration: value.fileGeneration,
      nextByteOffset: BigInt(value.nextByteOffset),
    };
  }

  async load(): Promise<bigint> {
    const state = await this.loadCheckpoint();
    return state?.nextByteOffset ?? 0n;
  }

  async save(
    nextByteOffset: bigint,
    fileGeneration?: string,
  ): Promise<void> {
    if (typeof nextByteOffset !== "bigint" || nextByteOffset < 0n) {
      throw new Error("nextByteOffset must be a nonnegative bigint");
    }
    if (
      fileGeneration !== undefined &&
      !/^dev:\d+:ino:\d+$/.test(fileGeneration)
    ) {
      throw new Error("fileGeneration must use dev:<device>:ino:<inode>");
    }

    await mkdir(dirname(this.checkpointPath), { recursive: true });
    const existing = await this.loadCheckpoint();

    if (existing && fileGeneration !== undefined) {
      if (
        existing.fileGeneration === fileGeneration &&
        nextByteOffset < existing.nextByteOffset
      ) {
        throw new Error(
          `Refusing to move agent checkpoint backward from ${existing.nextByteOffset} to ${nextByteOffset}`,
        );
      }
    } else if (existing && fileGeneration === undefined) {
      if (nextByteOffset < existing.nextByteOffset) {
        throw new Error(
          `Refusing to move agent checkpoint backward from ${existing.nextByteOffset} to ${nextByteOffset}`,
        );
      }
    }

    const checkpoint: AgentCheckpoint = {
      schemaVersion: 1,
      sourceId: this.sourceId,
      streamId: this.streamId,
      fileIdentity: this.fileIdentity,
      fileGeneration: fileGeneration ?? existing?.fileGeneration ?? "",
      nextByteOffset: nextByteOffset.toString(),
    };

    const temporaryPath = join(
      dirname(this.checkpointPath),
      `.${process.pid}.${Date.now()}.tmp`,
    );
    let handle;

    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(JSON.stringify(checkpoint), "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, this.checkpointPath);
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => {});
      }
      await rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    }
  }
}
