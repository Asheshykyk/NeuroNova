export type ViewId =
  | 'overview'
  | 'live-feed'
  | 'verification'
  | 'explorer'
  | 'recovery'
  | 'checkpoints';

export type ViewState = 'loading' | 'empty' | 'error' | 'disconnected' | 'stale';

export type ExtensibleStatus<Known extends string> = Known | (string & {});

export type VaultPersistenceStatus =
  | 'PENDING'
  | 'VAULT_PERSISTED'
  | 'PERSISTENCE_FAILED'
  | (string & {});

export type AnchorStatus =
  | 'PENDING'
  | 'ANCHORED_SERVER_REPORTED'
  | 'ANCHOR_FAILED'
  | (string & {});

export type IndependentVerificationStatus =
  | 'PENDING'
  | 'RPC_VERIFIED'
  | 'UNVERIFIABLE'
  | 'CHAIN_MISMATCH'
  | (string & {});

export type CollectionGapStatus = ExtensibleStatus<'COLLECTION_GAP'>;
export type AuditorOutcome = 'VERIFIED' | 'TAMPERED' | 'UNVERIFIABLE';
export interface AuditorCliBadge {
  kind: 'auditor-cli';
  outcome: AuditorOutcome;
}

export type StatusBadgeState =
  | ViewState
  | VaultPersistenceStatus
  | AnchorStatus
  | IndependentVerificationStatus
  | CollectionGapStatus;

export type ProposedCorrelationStatus =
  | 'PENDING'
  | 'MATCHED'
  | 'AGENT_ONLY'
  | 'SYSLOG_ONLY'
  | 'LATE_ARRIVAL'
  | (string & {});

export interface DemoEventDetails {
  payloadHash?: string;
  rawPreview?: string;
  batchId?: string;
  hostComparison?: 'DIFFERENT';
}

export interface EvidenceEvent {
  eventId: string;
  sourceId: string;
  vaultSequence: string;
  streamId: 'auth.log';
  observationSource: 'host-agent' | 'rsyslog-tcp';
  fileIdentity: string;
  byteOffset: number;
  observedAt: string;
  vaultReceivedAt: string;
  rawEventLength: number;
  vaultPersistenceStatus: VaultPersistenceStatus;
  correlationStatus: ProposedCorrelationStatus;
  demo?: DemoEventDetails;
}

export interface Checkpoint {
  id: string;
  sourceId: string;
  sequenceRange: string;
  merkleRoot: string;
  transactionHash?: string;
  blockReference?: string;
  createdAt: string;
  vaultPersistenceStatus: VaultPersistenceStatus;
  localAnchorStatus: AnchorStatus;
  publicAnchorStatus: AnchorStatus;
  independentVerificationStatus: IndependentVerificationStatus;
}

export interface VerificationWitness {
  summary: string;
  details: Array<{ label: string; value?: string }>;
}

export interface VerificationSnapshot {
  host: VerificationWitness & { demoComparison?: 'DIFFERENT' };
  vault: VerificationWitness & { persistenceStatus: VaultPersistenceStatus };
  blockchain: VerificationWitness & {
    localAnchorStatus: AnchorStatus;
    publicAnchorStatus: AnchorStatus;
    independentVerificationStatus: IndependentVerificationStatus;
  };
}

export interface CollectionGap {
  sourceId: string;
  streamId: 'auth.log';
  windowStart: string;
  windowEnd: string;
  status: CollectionGapStatus;
}

export interface DashboardAdapter {
  readonly mode: 'demo' | 'live';
  getEvents(): EvidenceEvent[];
  getCheckpoints(): Checkpoint[];
  getVerification(): VerificationSnapshot | undefined;
  getCollectionGaps(): CollectionGap[];
}
