import type { AuditorCliBadge, AuditorOutcome, StatusBadgeState } from '../types';

const labels: Record<string, string> = {
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
  const isAuditorOutcome = typeof state === 'object';
  const statusValue = typeof state === 'string' ? state : undefined;
  const isKnownStatus = statusValue !== undefined && Object.hasOwn(labels, statusValue);
  const classState = typeof state === 'object'
    ? `auditor-cli-${state.outcome.toLowerCase()}`
    : isKnownStatus
      ? state.toLowerCase().replace(/_/g, '-')
      : 'unknown';
  const label = isAuditorOutcome
    ? auditorLabels[state.outcome]
    : labels[state] ?? `Unknown status · ${state}`;
  const dataState = typeof state === 'object' ? `AUDITOR_CLI:${state.outcome}` : state;
  return (
    <span className={`status status-${classState}`} data-state={dataState}>
      {label}
    </span>
  );
}
