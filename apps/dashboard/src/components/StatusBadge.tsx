import type { DashboardState } from '../types';

const labels: Record<DashboardState, string> = {
  loading: 'Loading',
  empty: 'No evidence',
  error: 'Error',
  disconnected: 'Disconnected',
  stale: 'Stale',
  unanchored: 'Unanchored',
  pending: 'Pending',
  'anchored-server-reported': 'Anchored · API reported',
  verified: 'Independently verified',
  tampered: 'Tamper detected'
};

export function StatusBadge({ state }: { state: DashboardState }) {
  return <span className={`status status-${state}`}>{labels[state]}</span>;
}
