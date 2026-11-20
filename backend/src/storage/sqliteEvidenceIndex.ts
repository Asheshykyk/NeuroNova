import Database from 'better-sqlite3';
import type { EvidenceJsonlRecord } from './types.ts';

export interface IndexedEvidenceRecord {
  vaultSequence: bigint;
  sourceId: string;
  receiptTimestamp: string;
  segmentName: string;
  lineOffset: number;
  rawEventLength: number;
  deliveryId: string | null;
  streamId: string | null;
  fileIdentity: string | null;
  byteOffset: string | null;
  observedAt: string | null;
  observationSource: 'host-agent' | 'rsyslog-tcp' | null;
}

export class SqliteEvidenceIndex {
  private readonly db: Database.Database;

  constructor(databasePath: string) {
    this.db = new Database(databasePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS evidence_records (
        source_id TEXT NOT NULL,
        vault_sequence TEXT NOT NULL,
        receipt_timestamp TEXT NOT NULL,
        raw_event_length INTEGER NOT NULL,
        segment_name TEXT NOT NULL,
        line_offset INTEGER NOT NULL,
        delivery_id TEXT,
        stream_id TEXT,
        file_identity TEXT,
        byte_offset TEXT,
        observed_at TEXT,
        observation_source TEXT,
        PRIMARY KEY (source_id, vault_sequence)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS evidence_records_delivery_id
        ON evidence_records(delivery_id)
        WHERE delivery_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS agent_heartbeats (
        source_id TEXT PRIMARY KEY,
        heartbeat_sequence TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        last_byte_offset TEXT NOT NULL,
        status TEXT NOT NULL,
        vault_received_at TEXT NOT NULL
      );
    `);

    const columns = this.db.prepare('PRAGMA table_info(evidence_records)').all() as Array<{ name: string }>;
    const existing = new Set(columns.map((column) => column.name));
    for (const [name, type] of [
      ['stream_id', 'TEXT'],
      ['file_identity', 'TEXT'],
      ['byte_offset', 'TEXT'],
      ['observed_at', 'TEXT'],
      ['observation_source', 'TEXT']
    ] as const) {
      if (!existing.has(name)) {
        this.db.exec(`ALTER TABLE evidence_records ADD COLUMN ${name} ${type}`);
      }
    }
  }

  rebuild(
    records: Array<EvidenceJsonlRecord & { segmentName: string; lineOffset: number }>,
    rawBytesByRecord: Buffer[]
  ): void {
    const insert = this.db.prepare(`
      INSERT INTO evidence_records (
        source_id, vault_sequence, receipt_timestamp, raw_event_length,
        segment_name, line_offset, delivery_id,
        stream_id, file_identity, byte_offset, observed_at, observation_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction(() => {
      this.db.exec('DELETE FROM evidence_records');
      for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        insert.run(
          record.sourceId,
          record.vaultSequence,
          record.receiptTimestamp,
          record.rawEventLength,
          record.segmentName,
          record.lineOffset,
          record.deliveryId ?? null,
          record.streamId ?? null,
          record.fileIdentity ?? null,
          record.byteOffset ?? null,
          record.observedAt ?? null,
          record.observationSource ?? null
        );
      }
    });

    transaction();
  }

  findByDeliveryId(deliveryId: string): IndexedEvidenceRecord | null {
    const row = this.db.prepare(`
      SELECT source_id AS sourceId, vault_sequence AS vaultSequence,
             receipt_timestamp AS receiptTimestamp, segment_name AS segmentName,
             line_offset AS lineOffset, raw_event_length AS rawEventLength,
             delivery_id AS deliveryId, stream_id AS streamId,
             file_identity AS fileIdentity, byte_offset AS byteOffset,
             observed_at AS observedAt, observation_source AS observationSource
      FROM evidence_records
      WHERE delivery_id = ?
    `).get(deliveryId) as
      | {
          sourceId: string;
          vaultSequence: string;
          receiptTimestamp: string;
          segmentName: string;
          lineOffset: number;
          rawEventLength: number;
          deliveryId: string;
          streamId: string | null;
          fileIdentity: string | null;
          byteOffset: string | null;
          observedAt: string | null;
          observationSource: 'host-agent' | 'rsyslog-tcp' | null;
        }
      | undefined;

    if (!row) return null;
    return {
      vaultSequence: BigInt(row.vaultSequence),
      sourceId: row.sourceId,
      receiptTimestamp: row.receiptTimestamp,
      segmentName: row.segmentName,
      lineOffset: row.lineOffset,
      rawEventLength: row.rawEventLength,
      deliveryId: row.deliveryId,
      streamId: row.streamId,
      fileIdentity: row.fileIdentity,
      byteOffset: row.byteOffset,
      observedAt: row.observedAt,
      observationSource: row.observationSource
    };
  }

  add(record: EvidenceJsonlRecord, segmentName: string, lineOffset: number): void {
    this.db.prepare(`
      INSERT INTO evidence_records (
        source_id, vault_sequence, receipt_timestamp, raw_event_length,
        segment_name, line_offset, delivery_id,
        stream_id, file_identity, byte_offset, observed_at, observation_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.sourceId,
      record.vaultSequence,
      record.receiptTimestamp,
      record.rawEventLength,
      segmentName,
      lineOffset,
      record.deliveryId ?? null,
      record.streamId ?? null,
      record.fileIdentity ?? null,
      record.byteOffset ?? null,
      record.observedAt ?? null,
      record.observationSource ?? null
    );
  }

  acceptHeartbeat(
    sourceId: string,
    heartbeatSequence: bigint,
    observedAt: bigint,
    lastByteOffset: bigint,
    status: string,
    vaultReceivedAt: string
  ): void {
    const row = this.db.prepare(`
      SELECT heartbeat_sequence AS heartbeatSequence
      FROM agent_heartbeats
      WHERE source_id = ?
    `).get(sourceId) as { heartbeatSequence: string } | undefined;

    const latest = row ? BigInt(row.heartbeatSequence) : 0n;
    if (heartbeatSequence <= latest) {
      throw new Error(`Heartbeat replay: sequence ${heartbeatSequence} is not greater than latest ${latest}`);
    }
    if (heartbeatSequence !== latest + 1n) {
      throw new Error(`Heartbeat out-of-order sequence: expected ${latest + 1n}, got ${heartbeatSequence}`);
    }

    this.db.prepare(`
      INSERT INTO agent_heartbeats (
        source_id, heartbeat_sequence, observed_at, last_byte_offset, status, vault_received_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id) DO UPDATE SET
        heartbeat_sequence = excluded.heartbeat_sequence,
        observed_at = excluded.observed_at,
        last_byte_offset = excluded.last_byte_offset,
        status = excluded.status,
        vault_received_at = excluded.vault_received_at
    `).run(
      sourceId,
      heartbeatSequence.toString(),
      observedAt.toString(),
      lastByteOffset.toString(),
      status,
      vaultReceivedAt
    );
  }

  getHeartbeat(sourceId: string): {
    sourceId: string;
    heartbeatSequence: bigint;
    observedAt: bigint;
    lastByteOffset: bigint;
    status: string;
    vaultReceivedAt: string;
  } | null {
    const row = this.db.prepare(`
      SELECT source_id AS sourceId, heartbeat_sequence AS heartbeatSequence,
             observed_at AS observedAt, last_byte_offset AS lastByteOffset,
             status, vault_received_at AS vaultReceivedAt
      FROM agent_heartbeats
      WHERE source_id = ?
    `).get(sourceId) as {
      sourceId: string;
      heartbeatSequence: string;
      observedAt: string;
      lastByteOffset: string;
      status: string;
      vaultReceivedAt: string;
    } | undefined;

    if (!row) return null;
    return {
      sourceId: row.sourceId,
      heartbeatSequence: BigInt(row.heartbeatSequence),
      observedAt: BigInt(row.observedAt),
      lastByteOffset: BigInt(row.lastByteOffset),
      status: row.status,
      vaultReceivedAt: row.vaultReceivedAt
    };
  }

  close(): void {
    this.db.close();
  }
}
