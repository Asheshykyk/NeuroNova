import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/api/app.ts';
import { resolveApiSecurity, type ApiSecurityOptions } from '../src/api/security.ts';
import type { EvidenceStore } from '../src/storage/evidenceStore.ts';

const TOKEN = 'test-token-0123456789abcdef0123';
const base: ApiSecurityOptions = { readApiToken: TOKEN, allowUnauthenticatedReads: false, corsAllowedOrigins: ['http://localhost:5173'] };

async function call(security: ApiSecurityOptions, path: string, headers: Record<string, string> = {}) {
  const app = createApp({ store: {} as unknown as EvidenceStore, security });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const { port } = server.address() as AddressInfo;
    return await fetch(`http://127.0.0.1:${port}${path}`, { headers });
  } finally { server.close(); }
}

test('read route without token is 401', async () => assert.equal((await call(base, '/api/v1/events')).status, 401));
test('read route with wrong token is 401', async () => assert.equal((await call(base, '/api/v1/events', { Authorization: 'Bearer nope' })).status, 401));
test('valid token passes the auth gate', async () => assert.notEqual((await call(base, '/api/v1/events', { Authorization: `Bearer ${TOKEN}` })).status, 401));
test('no token configured and unauthenticated reads off is 503', async () =>
  assert.equal((await call({ ...base, readApiToken: null }, '/api/v1/gaps')).status, 503));
test('lab mode allows reads past the gate', async () => {
  const status = (await call({ ...base, readApiToken: null, allowUnauthenticatedReads: true }, '/api/v1/gaps')).status;
  assert.ok(status !== 401 && status !== 503);
});
test('health stays open', async () => assert.equal((await call(base, '/health')).status, 200));
test('CORS echoes only allowed origins', async () => {
  const ok = await call(base, '/health', { Origin: 'http://localhost:5173' });
  const bad = await call(base, '/health', { Origin: 'https://evil.example' });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});
test('production refuses open reads and requires a token', () => {
  assert.throws(() => resolveApiSecurity({ NODE_ENV: 'production', ALLOW_UNAUTHENTICATED_READS: 'true', READ_API_TOKEN: TOKEN }));
  assert.throws(() => resolveApiSecurity({ NODE_ENV: 'production' }));
});
