export type ViewId =
  | 'overview'
  | 'live-feed'
  | 'verification'
  | 'explorer'
  | 'recovery'
  | 'checkpoints';

export type DashboardState =
  | 'loading'
  | 'empty'
  | 'error'
  | 'disconnected'
  | 'stale'
  | 'unanchored'
  | 'pending'
  | 'anchored-server-reported'
  | 'verified'
  | 'tampered';

export type CorrelationStatus =
  | 'MATCHED'
  | 'AGENT_ONLY'
  | 'SYSLOG_ONLY'
  | 'LATE_ARRIVAL';

export interface EvidenceEvent {
  id: string;
  sourceId: string;
  streamId: 'agent' | 'rsyslog';
  hostTimestamp?: string;
  vaultReceivedAt: string;
  vaultSequence: number;
  payloadHash: string;
  evidenceState: DashboardState;
  correlationStatus: CorrelationStatus;
  checkpointId?: string;
  rawPreview?: string;
}

export interface Checkpoint {
  id: string;
  sourceId: string;
  sequenceRange: string;
  merkleRoot: string;
  transactionHash?: string;
  blockReference?: string;
  state: DashboardState;
  createdAt: string;
}

export interface VerificationWitness {
  witness: 'Host' | 'Vault' | 'Blockchain';
  state: DashboardState;
  summary: string;
  details: Array<{ label: string; value?: string }>;
}

export interface MockDashboardAdapter {
  readonly mode: 'demo';
  getEvents(): EvidenceEvent[];
  getCheckpoints(): Checkpoint[];
  getVerification(): VerificationWitness[];
}
