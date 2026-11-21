export type SourceIdInput = string | Uint8Array | Buffer;

export interface AppendEvidenceRequest {
  sourceId: SourceIdInput;
  rawEventBytes: Uint8Array | Buffer;
  deliveryId?: string;
  streamId?: string;
  fileIdentity?: string;
  fileGeneration?: string;
  byteOffset?: bigint;
  observedAt?: bigint;
  observationSource?: 'host-agent' | 'rsyslog-tcp';
}

export interface EvidenceReceipt {
  sourceId: string;
  vaultSequence: bigint;
  receiptTimestamp: string;
  rawEventLength: number;
  segmentName: string;
  duplicate: boolean;
  deliveryId?: string;
  streamId?: string;
  fileIdentity?: string;
  fileGeneration?: string;
  byteOffset?: bigint;
  observedAt?: bigint;
  observationSource?: 'host-agent' | 'rsyslog-tcp';
}

export interface HeartbeatReceipt {
  sourceId: string;
  heartbeatSequence: bigint;
  observedAt: bigint;
  lastByteOffset: bigint;
  status: string;
  vaultReceivedAt: string;
  availability: 'available' | 'unavailable';
}

export interface HeartbeatJsonlRecord {
  recordVersion: 1;
  recordType: 'heartbeat';
  heartbeatId: string;
  sourceId: string;
  sourceIdBytes32: string;
  heartbeatSequence: string;
  observedAt: string;
  lastByteOffset: string;
  status: string;
  signature: string | null;
  signedPayloadCanonicalHex: string;
  vaultReceivedAt: string;
  migration: {
    status: 'native' | 'migrated';
    originalSignaturePreserved: boolean;
    migratedAt: string | null;
    migrationSource: string | null;
  };
}

export interface PersistedHeartbeat {
  sourceId: string;
  heartbeatSequence: bigint;
  observedAt: bigint;
  lastByteOffset: bigint;
  status: string;
  vaultReceivedAt: string;
}

export interface EvidenceIndexStatus {
  state: 'healthy' | 'degraded';
  lastHealthyAt: string | null;
  lastError: string | null;
}

export interface EvidenceJsonlRecord {
  recordVersion: 1;
  sourceId: string;
  vaultSequence: string;
  receiptTimestamp: string;
  rawEventEncoding: 'base64';
  rawEventBytesBase64: string;
  rawEventLength: number;
  deliveryId?: string;
  streamId?: string;
  fileIdentity?: string;
  fileGeneration?: string;
  byteOffset?: string;
  observedAt?: string;
  observationSource?: 'host-agent' | 'rsyslog-tcp';
}
