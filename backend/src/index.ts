import type { Server } from 'node:http';
import { createApp } from './api/app.ts';
import { config } from './config/index.ts';
import { storageConfig } from './config/storage.ts';
import { EvidenceStore } from './storage/evidenceStore.ts';

let server: Server | null = null;
let store: EvidenceStore | null = null;

async function main(): Promise<void> {
  const evidenceStore = await EvidenceStore.open({
    directory: storageConfig.evidenceDirectory,
    databasePath: storageConfig.sqliteDatabasePath,
    segmentMaxBytes: storageConfig.segmentMaxBytes
  });
  store = evidenceStore;

  const app = createApp({
    store: evidenceStore,
    trustedAgentPublicKeyProvider: (sourceId) =>
      config.trustedAgentPublicKeys.get(sourceId) ?? config.trustedAgentPublicKeys.get('*')
  });

  server = app.listen(config.port, config.host, () => {
    console.log(`TRUSTTRACE backend listening on http://${config.host}:${config.port}`);
  });
}

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}; shutting down TRUSTTRACE backend`);
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => error ? reject(error) : resolve());
    });
  }
  store?.close();
}

process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });

main().catch((error) => {
  console.error('Failed to start TRUSTTRACE backend', error);
  process.exitCode = 1;
});
