import type { EvidenceEvent } from '../types';

function sequenceValue(vaultSequence: string): bigint {
  if (!/^\d+$/.test(vaultSequence)) {
    throw new TypeError('vaultSequence must be a decimal string');
  }
  return BigInt(vaultSequence);
}

export function eventIdentity(sourceId: string, vaultSequence: string): string {
  sequenceValue(vaultSequence);
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
    const leftSequence = sequenceValue(left.vaultSequence);
    const rightSequence = sequenceValue(right.vaultSequence);
    if (leftSequence !== rightSequence) return leftSequence < rightSequence ? -1 : 1;
    return left.vaultSequence.localeCompare(right.vaultSequence);
  });
}
