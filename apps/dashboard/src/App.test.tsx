import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('dashboard navigation', () => {
  it('opens the evidence feed from primary navigation', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Live evidence feed' }));
    expect(screen.getByRole('heading', { name: 'Live evidence feed' })).toBeInTheDocument();
    expect(screen.getAllByText('DEMO DATA').length).toBeGreaterThan(0);
  });

  it('shows the Quai Orchard Cyprus-1 checkpoint label without implying verification', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Checkpoint status' }));

    expect(screen.getAllByText(/Quai Orchard Cyprus-1/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Chain ID 15000/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Anchored · API reported').length).toBeGreaterThan(0);
    expect(screen.queryByText('Verified · direct RPC')).not.toBeInTheDocument();
  });
});
