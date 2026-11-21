import { describe, expect, it } from 'vitest';
import type { EvidenceEvent } from '../types';
import { eventIdentity, mergeEvidenceEvents } from './eventOrdering';

function event(sourceId: string, sequence: string): EvidenceEvent {
  return {
    eventId: eventIdentity(sourceId, sequence),
    sourceId,
    streamId: 'auth.log',
    observationSource: 'host-agent',
    fileIdentity: 'fixture-file',
    byteOffset: 100,
    observedAt: '2026-11-20T10:43:02Z',
    vaultReceivedAt: '2026-11-20T10:43:03Z',
    rawEventLength: 42,
    vaultSequence: sequence,
    vaultPersistenceStatus: 'VAULT_PERSISTED',
    correlationStatus: 'MATCHED',
    demo: { rawPreview: 'same raw fixture bytes' },
  };
}

describe('source-local event identity and ordering', () => {
  it('derives event identity from sourceId and vaultSequence', () => {
    expect(eventIdentity('host-lab-01', '184')).toBe('host-lab-01:184');
    expect(eventIdentity('host-lab-01', '1')).not.toBe(eventIdentity('host-lab-02', '1'));
    expect(() => eventIdentity('host-lab-01', '1e3')).toThrow('vaultSequence must be a decimal string');
  });

  it('sorts by source and sequence without merging matching file offsets or bytes', () => {
    const merged = mergeEvidenceEvents(
      [event('host-lab-01', '3'), event('host-lab-01', '1')],
      [event('host-lab-01', '1'), event('host-lab-01', '2'), event('host-lab-02', '1')],
    );

    expect(merged.map(({ eventId }) => eventId)).toEqual([
      'host-lab-01:1',
      'host-lab-01:2',
      'host-lab-01:3',
      'host-lab-02:1',
    ]);
  });

  it('sorts decimal-string sequences without converting them to imprecise numbers', () => {
    const merged = mergeEvidenceEvents(
      [
        event('host-lab-01', '9007199254740993'),
        event('host-lab-01', '9007199254740992'),
      ],
      [],
    );

    expect(merged.map(({ eventId }) => eventId)).toEqual([
      'host-lab-01:9007199254740992',
      'host-lab-01:9007199254740993',
    ]);
  });
});
