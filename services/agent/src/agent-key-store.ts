import { open, mkdir, readFile, rm, link } from "node:fs/promises";
import { dirname } from "node:path";
import {
  generateAgentKeyPair,
  type AgentKeyPair,
} from "@trusttrace/core/agent";

export class AgentKeyStore {
  private readonly privateKeyPath: string;

  constructor(privateKeyPath: string) {
    this.privateKeyPath = privateKeyPath;
  }

  private async loadExisting(): Promise<AgentKeyPair | undefined> {
    let contents: Buffer;
    try {
      contents = await readFile(this.privateKeyPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }

    if (contents.length !== 32) {
      throw new Error(
        `Invalid existing Ed25519 private seed at ${this.privateKeyPath}: expected exactly 32 bytes, got ${contents.length}`,
      );
    }

    return generateAgentKeyPair(contents);
  }

  async loadOrCreate(): Promise<AgentKeyPair> {
    await mkdir(dirname(this.privateKeyPath), { recursive: true });

    const existing = await this.loadExisting();
    if (existing !== undefined) {
      return existing;
    }

    const generated = generateAgentKeyPair();
    const temporaryPath = `${this.privateKeyPath}.${process.pid}.${Date.now()}.tmp`;
    let handle;

    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(generated.privateKeyRaw);
      await handle.sync();
      await handle.close();
      handle = undefined;

      await mkdir(dirname(this.privateKeyPath), { recursive: true });
      try {
        await link(temporaryPath, this.privateKeyPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          throw error;
        }
      }

      const existingAfterRace = await this.loadExisting();
      if (existingAfterRace !== undefined) {
        return existingAfterRace;
      }
      throw new Error(
        `Failed to persist Ed25519 private seed at ${this.privateKeyPath}`,
      );
    } finally {
      if (handle) {
        await handle.close().catch(() => {});
      }
      await rm(temporaryPath, { force: true }).catch(() => {});
    }
  }
}
