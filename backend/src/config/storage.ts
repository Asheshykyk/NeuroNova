export interface StorageConfig {
  evidenceDirectory: string;
  sqliteDatabasePath: string;
  segmentMaxBytes: number;
  batchMaxLeaves: number;
}

function readSegmentMaxBytes(value: string | undefined): number {
  if (!value) return 64 * 1024 * 1024;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid EVIDENCE_SEGMENT_MAX_BYTES: ${value}`);
  }
  return parsed;
}

export const storageConfig: StorageConfig = {
  evidenceDirectory: process.env.EVIDENCE_DIRECTORY?.trim() || 'data/evidence',
  sqliteDatabasePath:
    process.env.EVIDENCE_SQLITE_PATH?.trim() || 'data/evidence/evidence-index.sqlite3',
  segmentMaxBytes: readSegmentMaxBytes(process.env.EVIDENCE_SEGMENT_MAX_BYTES),
  batchMaxLeaves: readSegmentMaxBytes(process.env.EVIDENCE_BATCH_MAX_LEAVES)
};
