import type { EvidenceEvent } from '../types';

export function eventIdentity(sourceId: string, vaultSequence: number): string {
  return `${sourceId}:${vaultSequence}`;
}

export function mergeEvidenceEvents(
  existing: readonly EvidenceEvent[],
  incoming: readonly EvidenceEvent[],
): EvidenceEvent[] {
  const byId = new Map<string, EvidenceEvent>();
  for (const event of existing) {
    byId.set(eventIdentity(event.sourceId, event.vaultSequence), event);
  }
  for (const event of incoming) {
    byId.set(eventIdentity(event.sourceId, event.vaultSequence), event);
  }

  return [...byId.values()].sort((left, right) => {
    if (left.sourceId !== right.sourceId) {
      return left.sourceId.localeCompare(right.sourceId);
    }
    return left.vaultSequence - right.vaultSequence;
  });
}
