import { describe, expect, it } from 'vitest';
import type { EvidenceEvent } from '../types';
import { mergeEvidenceEvents } from './eventOrdering';

function event(id: string, sequence: number): EvidenceEvent {
  return {
    id,
    sourceId: 'host-lab-01',
    streamId: 'agent',
    vaultReceivedAt: '2026-11-20T10:43:03Z',
    vaultSequence: sequence,
    payloadHash: `hash-${sequence}`,
    evidenceState: 'pending',
    correlationStatus: 'MATCHED',
  };
}

describe('event ordering and duplicate suppression', () => {
  it('orders by source and vault sequence while suppressing duplicate IDs', () => {
    const merged = mergeEvidenceEvents(
      [event('event-3', 3), event('event-1', 1)],
      [event('event-1', 1), event('event-2', 2)],
    );

    expect(merged.map(({ id }) => id)).toEqual(['event-1', 'event-2', 'event-3']);
  });
});
