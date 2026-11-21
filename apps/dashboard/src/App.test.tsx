import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { createDashboardDataSource } from './data/source';

afterEach(() => vi.unstubAllGlobals());

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
    expect(screen.getByText(/independent RPC verification are unavailable/)).toBeInTheDocument();
    expect(fetch.mock.calls.every(([url]) => /^\/api\/v1\/(sources|events|gaps|batches)\?/.test(url))).toBe(true);
  });
});
