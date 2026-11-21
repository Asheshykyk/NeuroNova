import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  it('does not present an API-reported checkpoint as independently verified', () => {
    render(<StatusBadge state="anchored-server-reported" />);
    expect(screen.getByText('Anchored · API reported')).toBeInTheDocument();
    expect(screen.queryByText('Independently verified')).not.toBeInTheDocument();
  });

  it('presents tampering with a text label', () => {
    render(<StatusBadge state="tampered" />);
    expect(screen.getByText('Tamper detected')).toBeInTheDocument();
  });

  it('shows direct-RPC wording only for verified status', () => {
    render(<StatusBadge state="verified" />);
    expect(screen.getByText('Verified · direct RPC')).toBeInTheDocument();
  });

  it('does not label missing checkpoint data as verified', () => {
    render(<StatusBadge state="unanchored" />);
    expect(screen.getByText('Unanchored')).toBeInTheDocument();
    expect(screen.queryByText(/verified/i)).not.toBeInTheDocument();
  });

  it('keeps API-reported anchoring separate from independent verification', () => {
    render(<StatusBadge state="anchored-server-reported" />);
    expect(screen.getByText('Anchored · API reported')).toBeInTheDocument();
    expect(screen.queryByText(/direct RPC/i)).not.toBeInTheDocument();
  });
});
