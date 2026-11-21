import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { createDashboardDataSource } from './data/source';

afterEach(() => vi.unstubAllGlobals());

const verificationSourceId = '0x' + '11'.repeat(32);

function auditorResult(overrides: {
  directRpcStatus?: 'VERIFIED' | 'UNVERIFIABLE';
  directRpcReason?: string;
} = {}) {
  return {
    scope: 'vault-rest',
    sourceId: verificationSourceId,
    vaultSequence: '1',
    batchId: '0x' + '22'.repeat(32),
    status: 'UNVERIFIABLE',
    reasonCode: 'REQUIRED_EVIDENCE_MISSING',
    message: 'Tier 1 evidence is incomplete; Tier 2 checkpoint evidence is missing.',
    tier1: {
      status: 'UNVERIFIABLE',
      reasonCode: 'REQUIRED_EVIDENCE_MISSING',
      stages: [
        { stage: 'rest-fetch', status: 'VERIFIED', message: 'Event and batch details were fetched.' },
        { stage: 'vault-signature', status: 'UNVERIFIABLE', reasonCode: 'REQUIRED_EVIDENCE_MISSING', message: 'Vault signature is missing.' },
        { stage: 'commitment-matching', status: 'VERIFIED', message: 'Commitment fields match.' },
        {
          stage: 'raw-byte-validation',
          status: 'VERIFIED',
          message: 'Exact payload SHA-256 and canonical v1 leaf match the reported values.',
          checks: [
            { check: 'payload-sha256', status: 'VERIFIED', message: 'Exact raw bytes match the reported payload SHA-256.' },
            { check: 'canonical-leaf', status: 'VERIFIED', message: 'Exact raw bytes reproduce the canonical v1 leaf.' },
          ],
        },
        { stage: 'merkle-verification', status: 'VERIFIED', message: 'Merkle inclusion proof matches the batch root.' },
        {
          stage: 'direct-rpc',
          status: overrides.directRpcStatus ?? 'UNVERIFIABLE',
          reasonCode: overrides.directRpcReason ?? 'CONTRACT_LOOKUP_UNAVAILABLE',
          message: overrides.directRpcReason === 'RPC_UNAVAILABLE'
            ? 'Trusted local RPC is unavailable.'
            : 'Tier 1 RPC requires verified local evidence and a reported anchor.',
        },
      ],
    },
    tier2: {
      stage: 'public-checkpoint-verification',
      status: 'UNVERIFIABLE',
      reasonCode: 'REQUIRED_EVIDENCE_MISSING',
      message: 'Authenticated public checkpoint evidence is unavailable.',
    },
  };
}

describe('dashboard views and data boundaries', () => {
  it('labels the evidence feed as demo and does not fabricate WebSocket notifications', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Live evidence feed' }));

    expect(screen.getByRole('heading', { name: 'Live evidence feed' })).toBeInTheDocument();
    expect(screen.getAllByText('DEMO DATA').length).toBeGreaterThan(0);
    expect(screen.getByText('No event.persisted notifications are fabricated from fixture data.')).toBeInTheDocument();
  });

  it('shows separate checkpoint dimensions for Quai Orchard Cyprus-1', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Checkpoint status' }));

    expect(screen.getByText('Quai Orchard Cyprus-1 · Chain ID 15000')).toBeInTheDocument();
    expect(screen.getByText('Local Hardhat anchoring')).toBeInTheDocument();
    expect(screen.getByText('Public Quai anchoring')).toBeInTheDocument();
    expect(screen.getByText('Independent verification')).toBeInTheDocument();
    expect(screen.getAllByText('Anchor reported by server')).toHaveLength(2);
    expect(screen.getAllByText('Unverifiable · no integrity verdict')).toHaveLength(2);
  });

  it('does not render an UNVERIFIABLE demo snapshot as an Auditor tampering result', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Three-way verification' }));

    expect(screen.getByText('DEMO comparison differs; this is not an Auditor CLI result.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No Auditor CLI result is loaded' })).toBeInTheDocument();
    expect(screen.queryByText('Auditor CLI · TAMPERED')).not.toBeInTheDocument();
  });

  it('keeps collection gaps separate from event persistence', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Recovery & continuity' }));

    expect(screen.getAllByText('Collection gap', { exact: true })).toHaveLength(2);
    expect(screen.getByText('Vault persistence', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Does not prove what happened before collection')).toBeInTheDocument();
  });

  it('keeps LIVE failures separate from DEMO records', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })));
    render(<App dataSource={createDashboardDataSource({ VITE_TRUSTTRACE_DATA_MODE: 'live' })} />);

    expect(await screen.findByText('API request failed (503)', { exact: true })).toBeInTheDocument();
    expect(screen.queryByText('DEMO DATA')).not.toBeInTheDocument();
  });

  it('submits only event identity to the LIVE Auditor bridge and displays its actual stage results', async () => {
    const user = userEvent.setup();
    const fetch = vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://127.0.0.1:5174');
      if (url.pathname === '/api/v1/sources') {
        return Response.json({
          items: [{ sourceId: verificationSourceId, eventCount: 1, latestVaultSequence: '1', latestReceiptAt: '2026-11-21T07:00:00Z' }],
          nextCursor: null,
        });
      }
      if (url.pathname === '/api/verifier/verify-rest') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({ sourceId: verificationSourceId, sequence: '1' });
        return Response.json(auditorResult());
      }
      return Response.json({ items: [], nextCursor: null });
    });
    vi.stubGlobal('fetch', fetch);
    render(<App dataSource={createDashboardDataSource({ VITE_TRUSTTRACE_DATA_MODE: 'live' })} />);
    await user.click(screen.getByRole('button', { name: 'Three-way verification' }));
    await waitFor(() => expect(screen.getByLabelText('Verification source ID')).toHaveValue(verificationSourceId));
    await user.click(screen.getByRole('button', { name: 'Verify evidence' }));

    expect(await screen.findByRole('heading', { name: 'Overall verdict' })).toBeInTheDocument();
    expect(screen.getByText('Payload SHA-256', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Canonical leaf', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Merkle inclusion', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Commitment consistency', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Vault EIP-712 signature', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Tier 1 RPC', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Tier 2 checkpoint', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Vault signature is missing.')).toBeInTheDocument();
    expect(screen.getByText('Authenticated public checkpoint evidence is unavailable.')).toBeInTheDocument();
    expect(fetch.mock.calls.some(([input]) => String(input).startsWith('/api/verifier/'))).toBe(true);
    expect(screen.queryByText('DEMO DATA')).not.toBeInTheDocument();
  });

  it('rejects malformed verification identities before sending them to the bridge', async () => {
    const user = userEvent.setup();
    const fetch = vi.fn(async (input: string) => {
      const url = new URL(input, 'http://127.0.0.1:5174');
      if (url.pathname === '/api/v1/sources') return Response.json({ items: [], nextCursor: null });
      return Response.json({ items: [], nextCursor: null });
    });
    vi.stubGlobal('fetch', fetch);
    render(<App dataSource={createDashboardDataSource({ VITE_TRUSTTRACE_DATA_MODE: 'live' })} />);
    await user.click(screen.getByRole('button', { name: 'Three-way verification' }));
    await user.clear(screen.getByLabelText('Verification source ID'));
    await user.type(screen.getByLabelText('Verification source ID'), 'not-a-source-id');
    await user.click(screen.getByRole('button', { name: 'Verify evidence' }));

    expect(screen.getByRole('alert')).toHaveTextContent('bytes32 source ID and positive decimal uint64 sequence');
    expect(fetch.mock.calls.some(([input]) => String(input).startsWith('/api/verifier/'))).toBe(false);
  });

  it('shows bridge errors and does not fall back to demo evidence', async () => {
    const user = userEvent.setup();
    const fetch = vi.fn(async (input: string) => {
      const url = new URL(input, 'http://127.0.0.1:5174');
      if (url.pathname === '/api/v1/sources') {
        return Response.json({
          items: [{ sourceId: verificationSourceId, eventCount: 1, latestVaultSequence: '1', latestReceiptAt: '2026-11-21T07:00:00Z' }],
          nextCursor: null,
        });
      }
      return new Response(null, { status: 503 });
    });
    vi.stubGlobal('fetch', fetch);
    render(<App dataSource={createDashboardDataSource({ VITE_TRUSTTRACE_DATA_MODE: 'live' })} />);
    await user.click(screen.getByRole('button', { name: 'Three-way verification' }));
    await waitFor(() => expect(screen.getByLabelText('Verification source ID')).toHaveValue(verificationSourceId));
    await user.click(await screen.findByRole('button', { name: 'Verify evidence' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('API request failed (503)');
    expect(screen.queryByText('DEMO DATA')).not.toBeInTheDocument();
  });

  it('renders an unavailable Tier 1 RPC result without upgrading the overall verdict', async () => {
    const user = userEvent.setup();
    const fetch = vi.fn(async (input: string) => {
      const url = new URL(input, 'http://127.0.0.1:5174');
      if (url.pathname === '/api/v1/sources') {
        return Response.json({
          items: [{ sourceId: verificationSourceId, eventCount: 1, latestVaultSequence: '1', latestReceiptAt: '2026-11-21T07:00:00Z' }],
          nextCursor: null,
        });
      }
      return Response.json(auditorResult({ directRpcReason: 'RPC_UNAVAILABLE' }));
    });
    vi.stubGlobal('fetch', fetch);
    render(<App dataSource={createDashboardDataSource({ VITE_TRUSTTRACE_DATA_MODE: 'live' })} />);
    await user.click(screen.getByRole('button', { name: 'Three-way verification' }));
    await waitFor(() => expect(screen.getByLabelText('Verification source ID')).toHaveValue(verificationSourceId));
    await user.click(await screen.findByRole('button', { name: 'Verify evidence' }));

    expect(await screen.findByText('Trusted local RPC is unavailable.')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Overall Auditor status: UNVERIFIABLE' })).toBeInTheDocument();
    expect(screen.getAllByText('Auditor CLI · UNVERIFIABLE').length).toBeGreaterThan(0);
  });

  it('uses stable source filters through pagination, stops at an empty final page, and refreshes', async () => {
    const user = userEvent.setup();
    const sourceId = '0x' + '11'.repeat(32);
    const timestamp = '2026-11-21T07:00:00.000Z';
    const summary = {
      eventId: 'opaque event', sourceId, vaultSequence: '9007199254740993', streamId: null,
      hostTimestamp: null, vaultReceivedAt: timestamp, deliveryId: null, payloadSha256: '0x' + 'aa'.repeat(32),
      batchId: null, verificationStatus: 'VAULT_PERSISTED',
    };
    const fetch = vi.fn(async (input: string) => {
      const url = new URL(input, 'http://localhost');
      if (url.pathname.endsWith('/sources')) {
        return Response.json({
          items: [{ sourceId, eventCount: 1, latestVaultSequence: summary.vaultSequence, latestReceiptAt: timestamp }],
          nextCursor: null,
        });
      }
      if (url.pathname.endsWith('/events/' + sourceId + '/' + summary.vaultSequence)) {
        return Response.json({
          ...summary, rawPayloadBase64: '/wAKgA==', signature: null, keyId: null, correlationStatus: null, merkleProof: null,
        });
      }
      if (url.pathname.endsWith('/events') && url.searchParams.get('sourceId') === sourceId && !url.searchParams.has('cursor')) {
        return Response.json({
          items: [{ ...summary, observationSource: null, fileIdentity: null, byteOffset: '9007199254740995' }],
          nextCursor: 'opaque+/cursor',
        });
      }
      return Response.json({ items: [], nextCursor: null });
    });
    vi.stubGlobal('fetch', fetch);
    render(<App dataSource={createDashboardDataSource({ VITE_TRUSTTRACE_DATA_MODE: 'live' })} />);
    await user.click(screen.getByRole('button', { name: 'Live evidence feed' }));
    expect(await screen.findByText('No events returned by Vault.')).toBeInTheDocument();
    await screen.findByRole('option', { name: sourceId + ' (1 events)' });
    await user.selectOptions(screen.getByLabelText('Vault source'), sourceId);
    expect(await screen.findByText('opaque event')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Load more$/ }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Load more$/ })).not.toBeInTheDocument());
    expect(screen.getByText('opaque event')).toBeInTheDocument();
    expect(fetch.mock.calls.some(([url]) => {
      const query = new URL(url, 'http://localhost').searchParams;
      return query.get('sourceId') === sourceId && query.get('cursor') === 'opaque+/cursor';
    })).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('button', { name: /^Load more$/ })).toBeInTheDocument();
    expect(screen.getByText('Live push is unavailable. Use Refresh to retrieve a new REST page.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Evidence explorer' }));
    await user.click(await screen.findByRole('button', { name: 'Inspect #9007199254740993' }));
    expect(await screen.findByRole('textbox', { name: 'Raw event bytes in hexadecimal' })).toHaveValue('ff 00 0a 80');
    expect(screen.getByText('9007199254740995')).toBeInTheDocument();
  });

  it('shows honest unsupported states and renders distinct sequence gaps', async () => {
    const user = userEvent.setup();
    const sourceId = '0x' + '11'.repeat(32);
    const fetch = vi.fn(async (url: string) => Response.json({
      items: url.includes('/gaps') ? [{ sourceId, gapType: 'SEQUENCE_GAP', startSequence: '1', endSequence: '3', missingSequences: [] }] : [],
      nextCursor: null,
    }));
    vi.stubGlobal('fetch', fetch);
    render(<App dataSource={createDashboardDataSource({ VITE_TRUSTTRACE_DATA_MODE: 'live' })} />);
    await user.click(screen.getByRole('button', { name: 'Recovery & continuity' }));
    expect(await screen.findByText('SEQUENCE_GAP')).toBeInTheDocument();
    expect(screen.getByText('Recovery status and collection-gap data are unavailable.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Checkpoint status' }));
    expect(await screen.findByText('No batches returned by Vault.')).toBeInTheDocument();
    expect(screen.getByText('Public checkpoints are unavailable. Batch anchoring is server reported.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Three-way verification' }));
    expect(screen.getByText('LIVE REST can request the server-side Auditor. DEMO fixtures never produce verification results.')).toBeInTheDocument();
    expect(fetch.mock.calls.every(([url]) => /^\/api\/v1\/(sources|events|gaps|batches)\?/.test(url))).toBe(true);
  });
});
