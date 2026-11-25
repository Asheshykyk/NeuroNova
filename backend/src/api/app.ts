import express, { type Express, type ErrorRequestHandler } from 'express';
import type { EvidenceStore } from '../storage/evidenceStore.ts';
import { createIngestHandler, type TrustedAgentPublicKeyProvider } from './ingest.ts';
import { createHeartbeatHandler } from './heartbeat.ts';
import type { EvidenceBatchManager } from '../batching/EvidenceBatchManager.ts';
import type { AnchoringWorker } from '../blockchain/AnchoringWorker.ts';
import type { EvidenceVerifier } from '../verification/EvidenceVerifier.ts';
import {
  createSourcesHandler,
  createEventsHandler,
  createEventDetailHandler,
  createBatchesHandler,
  createCheckpointsHandler,
  createGapsHandler
} from './read.ts';
import { createCorsMiddleware, createReadAuthMiddleware, resolveApiSecurity, type ApiSecurityOptions } from './security.ts';

export interface CreateAppOptions {
  store?: EvidenceStore;
  trustedAgentPublicKeyProvider?: TrustedAgentPublicKeyProvider;
  trustedAgentPublicKeyHistoryProvider?: (sourceId: string) => string[];
  batchManager?: EvidenceBatchManager;
  anchoringWorker?: AnchoringWorker;
  verifier?: EvidenceVerifier;
  security?: ApiSecurityOptions;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  const security = options.security ?? resolveApiSecurity();
  const requireReadAuth = createReadAuthMiddleware(security);
  app.use(createCorsMiddleware(security));
  app.use(express.json({ limit: '10mb' }));

  app.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  if (options.store) {
    const keyProvider = options.trustedAgentPublicKeyProvider ?? (() => undefined);
    app.post('/api/v1/logs/ingest', createIngestHandler({
      store: options.store,
      trustedAgentPublicKeyProvider: keyProvider
    }));
    app.post('/api/v1/agents/heartbeat', createHeartbeatHandler({
      store: options.store,
      trustedAgentPublicKeyProvider: keyProvider,
      trustedAgentPublicKeyHistoryProvider: options.trustedAgentPublicKeyHistoryProvider
    }));

    const readOptions = {
      store: options.store,
      batchManager: options.batchManager,
      anchoringWorker: options.anchoringWorker,
      verifier: options.verifier
    };
    app.get('/api/v1/sources', requireReadAuth, createSourcesHandler(readOptions));
    app.get('/api/v1/events', requireReadAuth, createEventsHandler(readOptions));
    app.get('/api/v1/events/:sourceId/:vaultSequence', requireReadAuth, createEventDetailHandler(readOptions));
    app.get('/api/v1/events/:vaultSequence', requireReadAuth, createEventDetailHandler(readOptions));
    app.get('/api/v1/batches', requireReadAuth, createBatchesHandler(readOptions));
    app.get('/api/v1/checkpoints', requireReadAuth, createCheckpointsHandler(readOptions));
    app.get('/api/v1/gaps', requireReadAuth, createGapsHandler(readOptions));
  }

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    const statusCode = error instanceof SyntaxError && 'body' in error
      ? 400
      : typeof error === 'object' && error !== null && 'statusCode' in error
      ? (error as { statusCode?: number }).statusCode
      : 500;
    response.status(typeof statusCode === 'number' ? statusCode : 500).json({
      code: typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code: unknown }).code)
        : statusCode === 400 ? 'BAD_REQUEST' : 'INTERNAL_ERROR',
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  };
  app.use(errorHandler);

  return app;
}
