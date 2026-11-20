import express, { type Express, type ErrorRequestHandler } from 'express';
import type { EvidenceStore } from '../storage/evidenceStore.ts';
import { createIngestHandler, type TrustedAgentPublicKeyProvider } from './ingest.ts';
import { createHeartbeatHandler } from './heartbeat.ts';

export interface CreateAppOptions {
  store?: EvidenceStore;
  trustedAgentPublicKeyProvider?: TrustedAgentPublicKeyProvider;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
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
      trustedAgentPublicKeyProvider: keyProvider
    }));
  }

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    const statusCode = error instanceof SyntaxError && 'body' in error
      ? 400
      : typeof error === 'object' && error !== null && 'statusCode' in error
      ? (error as { statusCode?: number }).statusCode
      : 500;
    response.status(typeof statusCode === 'number' ? statusCode : 500).json({
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  };
  app.use(errorHandler);

  return app;
}
