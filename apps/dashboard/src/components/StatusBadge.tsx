import type { AuditorCliBadge, AuditorOutcome, StatusBadgeState } from '../types';

const labels: Record<StatusBadgeState, string> = {
  loading: 'Loading',
  empty: 'No records',
  error: 'Error',
  disconnected: 'Disconnected',
  stale: 'Stale',
  PENDING: 'Pending',
  VAULT_PERSISTED: 'Vault persisted',
  PERSISTENCE_FAILED: 'Persistence failed',
  ANCHORED_SERVER_REPORTED: 'Anchor reported by server',
  ANCHOR_FAILED: 'Anchor failed',
  RPC_VERIFIED: 'Independent RPC · checkpoint commitment',
  UNVERIFIABLE: 'Unverifiable · no integrity verdict',
  CHAIN_MISMATCH: 'Trusted chain mismatch',
  COLLECTION_GAP: 'Collection gap',
};

const auditorLabels: Record<AuditorOutcome, string> = {
  VERIFIED: 'Auditor CLI · VERIFIED',
  TAMPERED: 'Auditor CLI · TAMPERED',
  UNVERIFIABLE: 'Auditor CLI · UNVERIFIABLE',
};

export function StatusBadge({ state }: { state: StatusBadgeState | AuditorCliBadge }) {
  const classState = typeof state === 'object'
    ? `auditor-cli-${state.outcome.toLowerCase()}`
    : state.toLowerCase().replace(/_/g, '-');
  const label = typeof state === 'object' ? auditorLabels[state.outcome] : labels[state];
  const dataState = typeof state === 'object' ? `AUDITOR_CLI:${state.outcome}` : state;
  return (
    <span className={`status status-${classState}`} data-state={dataState}>
      {label}
    </span>
  );
}
