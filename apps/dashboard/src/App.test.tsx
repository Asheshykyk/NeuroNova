import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from './App';
import { createDashboardDataSource } from './data/source';

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

  it('shows missing-configuration live mode as unavailable without falling back to fixtures', async () => {
    const user = userEvent.setup();
    const liveSource = createDashboardDataSource({ VITE_TRUSTTRACE_DATA_MODE: 'live' });
    render(<App dataSource={liveSource} />);
    expect(screen.getByText('Live mode · not connected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Evidence explorer' }));

    expect(screen.getByText('Missing VITE_TRUSTTRACE_API_BASE_URL')).toBeInTheDocument();
    expect(screen.queryByText(/Accepted publickey/)).not.toBeInTheDocument();
    expect(screen.queryByText('LIVE BACKEND')).not.toBeInTheDocument();
  });
});
