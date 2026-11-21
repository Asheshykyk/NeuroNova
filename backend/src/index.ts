import type { Server } from 'node:http';
import { createApp } from './api/app.ts';
import { config } from './config/index.ts';
import { storageConfig } from './config/storage.ts';
import { EvidenceStore } from './storage/evidenceStore.ts';
import { RsyslogReceiver } from './ingestion/rsyslogReceiver.ts';
import { EvidenceBatchManager } from './batching/EvidenceBatchManager.ts';
import { AnchoringWorker, EthersEvidenceAnchorClient } from './blockchain/index.ts';
import { getEthereumAddress, loadPrivateKey } from '@trusttrace/core';
import { EvidenceVerifier } from './verification/EvidenceVerifier.ts';

let server: Server | null = null;
let store: EvidenceStore | null = null;
let rsyslogReceiver: RsyslogReceiver | null = null;
let anchoringTimer: NodeJS.Timeout | null = null;

async function main(): Promise<void> {
  const trustedAgentPublicKeyProvider = (sourceId: string) =>
    config.trustedAgentPublicKeys.get(sourceId) ?? config.trustedAgentPublicKeys.get('*');
  const trustedAgentPublicKeyHistoryProvider = (sourceId: string) => {
    const exact = config.trustedAgentPublicKeyHistory.get(sourceId);
    const wildcard = config.trustedAgentPublicKeyHistory.get('*');
    const current = trustedAgentPublicKeyProvider(sourceId);
    return Array.from(new Set([...(exact ?? []), ...(wildcard ?? []), ...(current ? [current] : [])]));
  };

  const evidenceStore = await EvidenceStore.open({
    directory: storageConfig.evidenceDirectory,
    databasePath: storageConfig.sqliteDatabasePath,
    segmentMaxBytes: storageConfig.segmentMaxBytes,
    trustedAgentPublicKeyProvider,
    trustedAgentPublicKeyHistoryProvider
  });
  store = evidenceStore;

  let vaultSignerPrivateKey: string | undefined;
  if (config.vaultSignerPrivateKey) {
    vaultSignerPrivateKey = loadPrivateKey(config.vaultSignerPrivateKey);
  } else if (config.vaultSignerSecretPath) {
    vaultSignerPrivateKey = loadPrivateKey(config.vaultSignerSecretPath);
  }

  const eip712Domain = config.anchorContractAddress && config.anchorChainId
    ? {
        name: 'EvidenceAnchor',
        version: '1',
        chainId: config.anchorChainId,
        verifyingContract: config.anchorContractAddress
      }
    : undefined;

  const batchManager = new EvidenceBatchManager(evidenceStore, {
    directory: storageConfig.evidenceDirectory,
    batchMaxLeaves: storageConfig.batchMaxLeaves,
    vaultSignerPrivateKey,
    eip712Domain
  });

  let anchoringWorker: AnchoringWorker | null = null;
  let evidenceVerifier: EvidenceVerifier | null = null;
  if (config.anchorRpcUrl && config.anchorContractAddress && config.anchorRelayerPrivateKey) {
    const anchorClient = new EthersEvidenceAnchorClient({
      rpcUrl: config.anchorRpcUrl,
      contractAddress: config.anchorContractAddress,
      relayerPrivateKey: config.anchorRelayerPrivateKey
    });
    anchoringWorker = new AnchoringWorker({
      directory: storageConfig.evidenceDirectory,
      batchManager,
      client: anchorClient
    });
    evidenceVerifier = new EvidenceVerifier({
      store: evidenceStore,
      batchManager,
      anchorClient,
      anchoringWorker,
      eip712Domain,
      expectedVaultSigner: vaultSignerPrivateKey ? getEthereumAddress(vaultSignerPrivateKey) : undefined
    });
  }

  const processBatches = async (): Promise<void> => {
    try {
      await batchManager.generateNextBatches();
      if (anchoringWorker) await anchoringWorker.processEligibleBatches();
      if (evidenceVerifier) await evidenceVerifier.reconcile();
    } catch (error) {
      console.error('Batch generation or anchoring failed', error);
    }
  };
  await processBatches();
  anchoringTimer = setInterval(() => { void processBatches(); }, 10_000);

  rsyslogReceiver = new RsyslogReceiver({
    host: config.rsyslog.host,
    port: config.rsyslog.port,
    maxFrameBytes: config.rsyslog.maxFrameBytes,
    store: evidenceStore,
    onError: (error) => console.error('Rsyslog receiver error', error)
  });
  await rsyslogReceiver.start();
  console.log(`Rsyslog TCP receiver listening on ${config.rsyslog.host}:${config.rsyslog.port}`);

  const app = createApp({
    store: evidenceStore,
    trustedAgentPublicKeyProvider,
    trustedAgentPublicKeyHistoryProvider,
    batchManager,
    anchoringWorker: anchoringWorker ?? undefined,
    verifier: evidenceVerifier ?? undefined
  });

  server = app.listen(config.port, config.host, () => {
    console.log(`TRUSTTRACE backend listening on http://${config.host}:${config.port}`);
  });
}

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}; shutting down TRUSTTRACE backend`);
  if (anchoringTimer) clearInterval(anchoringTimer);
  if (rsyslogReceiver) {
    await rsyslogReceiver.close();
  }
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
