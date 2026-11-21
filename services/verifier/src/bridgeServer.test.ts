import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVerificationBridgeServer } from './bridgeServer.js';
import type { verifyRest } from './rest.js';

const sourceId = '0x' + 'ab'.repeat(32);
const dashboardOrigin = 'http://127.0.0.1:5174';
const bridgePath = '/api/verifier/verify-rest';
const servers: Server[] = [];

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}${bridgePath}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  })));
});

describe('read-only verification bridge', () => {
  it('accepts only source-local identity and returns the structured Auditor result', async () => {
    const result: Awaited<ReturnType<typeof verifyRest>> = {
      scope: 'vault-rest',
      sourceId,
      vaultSequence: '1',
      status: 'UNVERIFIABLE',
      reasonCode: 'REQUIRED_EVIDENCE_MISSING',
      message: 'Required evidence is missing.',
      tier1: { status: 'UNVERIFIABLE', reasonCode: 'REQUIRED_EVIDENCE_MISSING', stages: [] },
      tier2: {
        stage: 'public-checkpoint-verification',
        status: 'UNVERIFIABLE',
        reasonCode: 'REQUIRED_EVIDENCE_MISSING',
        message: 'Public checkpoint evidence is missing.',
      },
    };
    const verify = vi.fn(async () => result);
    const url = await listen(createVerificationBridgeServer(verify));
    const response = await fetch(url, {
      method: 'POST',
      headers: { origin: dashboardOrigin, 'content-type': 'application/json' },
      body: JSON.stringify({ sourceId: sourceId.toUpperCase().replace('0X', '0x'), sequence: '1' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(verify).toHaveBeenCalledWith({ sourceId, sequence: '1' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects malformed, oversized, and browser-supplied transport configuration', async () => {
    const verify = vi.fn(async () => {
      throw new Error('must not run');
    });
    const url = await listen(createVerificationBridgeServer(verify));
    const headers = { origin: dashboardOrigin, 'content-type': 'application/json' };
    const extraConfig = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sourceId, sequence: '1', rpcUrl: 'http://attacker.invalid' }),
    });
    const invalidIdentity = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sourceId: 'not-bytes32', sequence: '1' }),
    });
    const oversized = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sourceId, sequence: '1', padding: 'x'.repeat(5000) }),
    });

    expect(extraConfig.status).toBe(400);
    expect(invalidIdentity.status).toBe(400);
    expect(oversized.status).toBe(413);
    expect(verify).not.toHaveBeenCalled();
  });

  it('checks the Dashboard origin and returns a safe error if the Auditor cannot run', async () => {
    const failedUrl = await listen(createVerificationBridgeServer(async () => {
      throw new Error('private configuration detail');
    }));
    const badOrigin = await fetch(failedUrl, {
      method: 'POST',
      headers: { origin: 'https://untrusted.example', 'content-type': 'application/json' },
      body: JSON.stringify({ sourceId, sequence: '1' }),
    });
    const failure = await fetch(failedUrl, {
      method: 'POST',
      headers: { origin: dashboardOrigin, 'content-type': 'application/json' },
      body: JSON.stringify({ sourceId, sequence: '1' }),
    });
    const payload = await failure.json();

    expect(badOrigin.status).toBe(403);
    expect(failure.status).toBe(502);
    expect(payload).toEqual({
      error: { code: 'AUDITOR_UNAVAILABLE', message: 'Independent verification could not be completed.' },
    });
    expect(JSON.stringify(payload)).not.toContain('private configuration detail');
  });
});
