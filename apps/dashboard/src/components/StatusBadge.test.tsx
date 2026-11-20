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
});
