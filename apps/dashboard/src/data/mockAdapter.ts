import type { Checkpoint, EvidenceEvent, MockDashboardAdapter, VerificationWitness } from '../types';

const events: EvidenceEvent[] = [
  {
    id: 'evt-000184',
    sourceId: 'host-lab-01',
    streamId: 'agent',
    hostTimestamp: '2026-11-20T10:42:12Z',
    vaultReceivedAt: '2026-11-20T10:42:13Z',
    vaultSequence: 184,
    payloadHash: '7f9a…d144',
    evidenceState: 'anchored-server-reported',
    correlationStatus: 'MATCHED',
    checkpointId: 'batch-2026-11-20-04',
    rawPreview: 'sshd[421]: Failed password for audit from 10.0.0.42'
  },
  {
    id: 'evt-000185',
    sourceId: 'host-lab-01',
    streamId: 'rsyslog',
    hostTimestamp: '2026-11-20T10:42:14Z',
    vaultReceivedAt: '2026-11-20T10:42:15Z',
    vaultSequence: 185,
    payloadHash: 'c381…2a99',
    evidenceState: 'tampered',
    correlationStatus: 'MATCHED',
    checkpointId: 'batch-2026-11-20-04',
    rawPreview: 'sshd[421]: Accepted publickey for audit from 10.0.0.42'
  },
  {
    id: 'evt-000186',
    sourceId: 'host-lab-01',
    streamId: 'agent',
    vaultReceivedAt: '2026-11-20T10:43:03Z',
    vaultSequence: 186,
    payloadHash: 'ea27…11bf',
    evidenceState: 'pending',
    correlationStatus: 'AGENT_ONLY'
  }
];

const checkpoints: Checkpoint[] = [
  {
    id: 'batch-2026-11-20-04',
    sourceId: 'host-lab-01',
    sequenceRange: '181–185',
    merkleRoot: 'a28b…f991',
    transactionHash: '0x18a4…f2d9',
    blockReference: 'local/31337 #82',
    state: 'anchored-server-reported',
    createdAt: '2026-11-20T10:42:20Z'
  },
  {
    id: 'batch-2026-11-20-05',
    sourceId: 'host-lab-01',
    sequenceRange: '186–186',
    merkleRoot: 'ea27…11bf',
    state: 'pending',
    createdAt: '2026-11-20T10:43:03Z'
  }
];

const verification: VerificationWitness[] = [
  {
    witness: 'Host',
    state: 'tampered',
    summary: 'The host comparison differs from preserved evidence.',
    details: [
      { label: 'Comparison input', value: 'available' },
      { label: 'Affected sequence', value: '185' }
    ]
  },
  {
    witness: 'Vault',
    state: 'pending',
    summary: 'Preserved bytes are available in the demo data set.',
    details: [
      { label: 'Vault sequence', value: '185' },
      { label: 'Payload hash', value: 'c381…2a99' }
    ]
  },
  {
    witness: 'Blockchain',
    state: 'anchored-server-reported',
    summary: 'An API-reported checkpoint is present. Direct RPC is not connected.',
    details: [
      { label: 'Checkpoint', value: 'batch-2026-11-20-04' },
      { label: 'RPC check', value: 'not performed' }
    ]
  }
];

export const mockDashboardAdapter: MockDashboardAdapter = {
  mode: 'demo',
  getEvents: () => events,
  getCheckpoints: () => checkpoints,
  getVerification: () => verification
};
