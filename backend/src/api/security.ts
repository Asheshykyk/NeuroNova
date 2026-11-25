import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

export interface ApiSecurityOptions {
  readApiToken: string | null;
  allowUnauthenticatedReads: boolean;
  corsAllowedOrigins: string[];
}

const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

export function resolveApiSecurity(env: NodeJS.ProcessEnv = process.env): ApiSecurityOptions {
  const production = env.NODE_ENV === 'production';
  const readApiToken = env.READ_API_TOKEN?.trim() || null;
  const allowUnauthenticatedReads = env.ALLOW_UNAUTHENTICATED_READS === 'true';
  let corsAllowedOrigins = (env.CORS_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (production && allowUnauthenticatedReads) {
    throw new Error('ALLOW_UNAUTHENTICATED_READS must not be enabled when NODE_ENV=production');
  }
  if (production && !readApiToken) throw new Error('READ_API_TOKEN is required when NODE_ENV=production');
  if (readApiToken && readApiToken.length < 24) throw new Error('READ_API_TOKEN must be at least 24 characters');
  if (corsAllowedOrigins.length === 0 && !production) corsAllowedOrigins = DEV_ORIGINS;
  return { readApiToken, allowUnauthenticatedReads, corsAllowedOrigins };
}

function tokensEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createCorsMiddleware(options: ApiSecurityOptions): RequestHandler {
  return (request, response, next) => {
    const origin = request.headers.origin;
    if (origin && options.corsAllowedOrigins.includes(origin)) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    if (request.method === 'OPTIONS') { response.sendStatus(204); return; }
    next();
  };
}

export function createReadAuthMiddleware(options: ApiSecurityOptions): RequestHandler {
  return (request, response, next) => {
    if (options.allowUnauthenticatedReads) { next(); return; }
    if (!options.readApiToken) {
      response.status(503).json({ code: 'READ_AUTH_NOT_CONFIGURED', error: 'Read API token is not configured' });
      return;
    }
    const presented = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1];
    if (!presented || !tokensEqual(presented, options.readApiToken)) {
      response.status(401).json({ code: 'UNAUTHORIZED', error: 'Missing or invalid read token' });
      return;
    }
    next();
  };
}
