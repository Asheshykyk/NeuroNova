import type { EvidenceEvent } from '../types';

export function mergeEvidenceEvents(
  existing: readonly EvidenceEvent[],
  incoming: readonly EvidenceEvent[],
): EvidenceEvent[] {
  const byId = new Map<string, EvidenceEvent>();
  for (const event of existing) byId.set(event.id, event);
  for (const event of incoming) byId.set(event.id, event);

  return [...byId.values()].sort((left, right) => {
    if (left.sourceId !== right.sourceId) {
      return left.sourceId.localeCompare(right.sourceId);
    }
    return left.vaultSequence - right.vaultSequence;
  });
}
