import type {
  Checkpoint,
  CollectionGap,
  DashboardAdapter,
  EvidenceEvent,
  ProposedCorrelationStatus,
  VerificationSnapshot,
} from '../types';
import { eventIdentity, mergeEvidenceEvents } from './eventOrdering';

function demoEvent(
  sourceId: string,
  vaultSequence: number,
  observationSource: EvidenceEvent['observationSource'],
  fileIdentity: string,
  byteOffset: number,
  observedAt: string,
  vaultReceivedAt: string,
  rawEventLength: number,
  vaultPersistenceStatus: EvidenceEvent['vaultPersistenceStatus'],
  correlationStatus: ProposedCorrelationStatus,
  demo?: EvidenceEvent['demo'],
): EvidenceEvent {
  return {
    eventId: eventIdentity(sourceId, vaultSequence),
    sourceId,
    vaultSequence,
    streamId: 'auth.log',
    observationSource,
    fileIdentity,
    byteOffset,
    observedAt,
    vaultReceivedAt,
    rawEventLength: demo?.rawPreview
      ? new TextEncoder().encode(demo.rawPreview).length
      : rawEventLength,
    vaultPersistenceStatus,
    correlationStatus,
    demo,
  };
}

const events = mergeEvidenceEvents([], [
  demoEvent(
    'host-lab-01',
    184,
    'host-agent',
    'file-auth-log-01',
    8912,
    '2026-11-20T10:43:02Z',
    '2026-11-20T10:43:03Z',
    0,
    'VAULT_PERSISTED',
    'MATCHED',
    {
      payloadHash: 'sha256:5c84f2...a19d',
      rawPreview: 'Nov 20 10:43:02 auth-gateway sshd[812]: Accepted publickey for service.deploy',
      batchId: 'batch-04',
    },
  ),
  demoEvent(
    'host-lab-01',
    185,
    'rsyslog-tcp',
    'file-auth-log-01',
    8998,
    '2026-11-20T10:43:07Z',
    '2026-11-20T10:43:08Z',
    0,
    'VAULT_PERSISTED',
    'MATCHED',
    {
      payloadHash: 'sha256:9a1f2c...7b3e',
      rawPreview: 'Nov 20 10:43:07 auth-gateway sshd[815]: Failed password for operator from 10.1.4.22',
      batchId: 'batch-04',
      hostComparison: 'DIFFERENT',
    },
  ),
  demoEvent(
    'host-lab-01',
    186,
    'host-agent',
    'file-auth-log-01',
    9112,
    '2026-11-20T10:43:12Z',
    '2026-11-20T10:43:13Z',
    126,
    'PENDING',
    'PENDING',
  ),
  demoEvent(
    'host-lab-02',
    1,
    'rsyslog-tcp',
    'file-auth-log-02',
    0,
    '2026-11-20T10:44:01Z',
    '2026-11-20T10:44:02Z',
    0,
    'VAULT_PERSISTED',
    'MATCHED',
    {
      payloadHash: 'sha256:03ce72...dd18',
      rawPreview: 'Nov 20 10:44:01 auth-gateway sshd[901]: Accepted publickey for service.readonly',
    },
  ),
]);

const checkpoints: Checkpoint[] = [
  {
    id: 'batch-04',
    sourceId: 'host-lab-01',
    sequenceRange: '184–185',
    merkleRoot: '0x8f4c2b9e...d71a',
    transactionHash: '0x2a91e7c4...6b0f',
    blockReference: 'Orchard block #218,491',
    createdAt: '2026-11-20T10:44:12Z',
    vaultPersistenceStatus: 'VAULT_PERSISTED',
    localAnchorStatus: 'ANCHORED_SERVER_REPORTED',
    publicAnchorStatus: 'ANCHORED_SERVER_REPORTED',
    independentVerificationStatus: 'UNVERIFIABLE',
  },
];

const verification: VerificationSnapshot = {
  host: {
    summary: 'A host comparison differs in this demo fixture.',
    demoComparison: 'DIFFERENT',
    details: [
      { label: 'Compared event', value: 'host-lab-01:185' },
      { label: 'Comparison source', value: 'Simulated fixture only' },
    ],
  },
  vault: {
    summary: 'The fixture represents durable vault persistence.',
    persistenceStatus: 'VAULT_PERSISTED',
    details: [
      { label: 'Persistence record', value: 'batch-04' },
      { label: 'Raw evidence', value: 'Not included in metadata response' },
    ],
  },
  blockchain: {
    summary: 'Reported anchoring and independent verification are separate.',
    localAnchorStatus: 'ANCHORED_SERVER_REPORTED',
    publicAnchorStatus: 'ANCHORED_SERVER_REPORTED',
    independentVerificationStatus: 'UNVERIFIABLE',
    details: [
      { label: 'Public network', value: 'Quai Orchard Cyprus-1 · chain ID 15000' },
      { label: 'Verification scope', value: 'Public-chain commitment; no direct RPC result loaded' },
    ],
  },
};

const collectionGaps: CollectionGap[] = [
  {
    sourceId: 'host-lab-01',
    streamId: 'auth.log',
    windowStart: '2026-11-20T10:42:00Z',
    windowEnd: '2026-11-20T10:43:00Z',
    status: 'COLLECTION_GAP',
  },
];

export const mockAdapter: DashboardAdapter = {
  mode: 'demo',
  getEvents: () => [...events],
  getCheckpoints: () => [...checkpoints],
  getVerification: () => verification,
  getCollectionGaps: () => [...collectionGaps],
};
