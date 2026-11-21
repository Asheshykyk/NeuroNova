import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  it('does not present a server-reported anchor as independently verified', () => {
    render(<StatusBadge state="ANCHORED_SERVER_REPORTED" />);
    expect(screen.getByText('Anchor reported by server')).toBeInTheDocument();
    expect(screen.queryByText(/Independent RPC/i)).not.toBeInTheDocument();
  });

  it('keeps UNVERIFIABLE separate from a tampering verdict', () => {
    render(<StatusBadge state="UNVERIFIABLE" />);
    expect(screen.getByText('Unverifiable · no integrity verdict')).toBeInTheDocument();
    expect(screen.queryByText(/TAMPERED|Tamper/i)).not.toBeInTheDocument();
  });

  it('scopes RPC_VERIFIED to a checkpoint commitment', () => {
    render(<StatusBadge state="RPC_VERIFIED" />);
    expect(screen.getByText('Independent RPC · checkpoint commitment')).toBeInTheDocument();
  });

  it('retains the Auditor CLI outcome vocabulary', () => {
    render(<StatusBadge state={{ kind: 'auditor-cli', outcome: 'TAMPERED' }} />);
    expect(screen.getByText('Auditor CLI · TAMPERED')).toBeInTheDocument();
  });

  it('distinguishes an Auditor CLI UNVERIFIABLE result from API verification status', () => {
    const { rerender } = render(<StatusBadge state="UNVERIFIABLE" />);
    expect(screen.getByText('Unverifiable · no integrity verdict')).toBeInTheDocument();

    rerender(<StatusBadge state={{ kind: 'auditor-cli', outcome: 'UNVERIFIABLE' }} />);
    expect(screen.getByText('Auditor CLI · UNVERIFIABLE')).toBeInTheDocument();
  });
});
