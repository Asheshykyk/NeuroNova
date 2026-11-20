export type SourceIdInput = string | Uint8Array | Buffer;

export interface AppendEvidenceRequest {
  sourceId: SourceIdInput;
  rawEventBytes: Uint8Array | Buffer;
  deliveryId?: string;
}

export interface EvidenceReceipt {
  sourceId: string;
  vaultSequence: bigint;
  receiptTimestamp: string;
  rawEventLength: number;
  segmentName: string;
  duplicate: boolean;
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
}
