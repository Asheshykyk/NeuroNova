import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { restIdentity, verifyRest } from './rest.js';

const bridgePath = '/api/verifier/verify-rest';
const dashboardOrigin = 'http://127.0.0.1:5174';
const vaultApiBaseUrl = 'http://127.0.0.1:3000/api/v1';
const maxRequestBytes = 4096;
const maxConcurrentVerifications = 4;
const maxUint64 = (1n << 64n) - 1n;

interface VerificationIdentity {
  sourceId: string;
  sequence: string;
}

type RestVerifier = (identity: VerificationIdentity) => ReturnType<typeof verifyRest>;

class BridgeRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

function respond(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  response.end(JSON.stringify(body));
}

async function readRequestBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > maxRequestBytes) {
      throw new BridgeRequestError(413, 'REQUEST_TOO_LARGE', 'Request body exceeds the allowed size.');
    }
    chunks.push(bytes);
  }

  try {
    return JSON.parse(Buffer.concat(chunks, length).toString('utf8')) as unknown;
  } catch {
    throw new BridgeRequestError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
}

function readIdentity(value: unknown): VerificationIdentity {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BridgeRequestError(400, 'INVALID_REQUEST', 'Expected sourceId and sequence.');
  }
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length !== 2 || typeof body.sourceId !== 'string' || typeof body.sequence !== 'string') {
    throw new BridgeRequestError(400, 'INVALID_REQUEST', 'Expected only sourceId and sequence.');
  }
  try {
    const identity = restIdentity(body.sourceId, body.sequence);
    if (identity.vaultSequence > maxUint64) {
      throw new Error('Sequence exceeds uint64.');
    }
    return {
      sourceId: identity.sourceId,
      sequence: identity.vaultSequence.toString(10),
    };
  } catch {
    throw new BridgeRequestError(400, 'INVALID_EVENT_IDENTITY', 'Source ID or sequence is invalid.');
  }
}

const fixedDeploymentVerifier: RestVerifier = ({ sourceId, sequence }) =>
  verifyRest({ baseUrl: vaultApiBaseUrl, sourceId, sequence });

export function createVerificationBridgeServer(
  verifier: RestVerifier = fixedDeploymentVerifier,
): Server {
  let activeVerifications = 0;
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (requestUrl.pathname !== bridgePath || requestUrl.search) {
      respond(response, 404, { error: { code: 'NOT_FOUND', message: 'Route not found.' } });
      return;
    }
    if (request.method !== 'POST') {
      response.setHeader('allow', 'POST');
      respond(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST for verification.' } });
      return;
    }
    if (request.headers.origin !== dashboardOrigin) {
      respond(response, 403, { error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Dashboard origin is not allowed.' } });
      return;
    }
    if (request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      respond(response, 415, { error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Use application/json.' } });
      return;
    }
    if (activeVerifications >= maxConcurrentVerifications) {
      respond(response, 429, { error: { code: 'VERIFIER_BUSY', message: 'Verification capacity is temporarily full.' } });
      return;
    }

    let identity: VerificationIdentity;
    try {
      identity = readIdentity(await readRequestBody(request));
    } catch (error) {
      if (error instanceof BridgeRequestError) {
        respond(response, error.status, { error: { code: error.code, message: error.message } });
        return;
      }
      respond(response, 400, { error: { code: 'INVALID_REQUEST', message: 'Request could not be read.' } });
      return;
    }

    activeVerifications += 1;
    try {
      const result = await verifier(identity);
      respond(response, 200, result);
    } catch {
      respond(response, 502, {
        error: { code: 'AUDITOR_UNAVAILABLE', message: 'Independent verification could not be completed.' },
      });
    } finally {
      activeVerifications -= 1;
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 12_000;
  server.timeout = 120_000;
  return server;
}

export function startVerificationBridge(): Server {
  const server = createVerificationBridgeServer();
  server.listen(3001, '127.0.0.1');
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const server = startVerificationBridge();
  server.on('error', () => {
    console.error('Verification bridge failed to start on 127.0.0.1:3001.');
    process.exitCode = 1;
  });
}
