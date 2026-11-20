import { EvidenceAnchorABI } from '@trusttrace/core';
import type { BatchCommitment } from '@trusttrace/core/types';
import { commitmentHash, isCommitment, result } from './core.js';
import type { BatchEvidence, TrustedBatchConfig } from './core.js';
import type { StageResult } from './types.js';

type ReadMethod = 'isBatchAnchored' | 'getBatch';

/** Connect a zoned, read-only provider to the trusted deployment with the supplied ABI. */
export type ConnectEvidenceAnchor = (rpcUrl: string, address: string, abi: typeof EvidenceAnchorABI) => {
  getNetwork(): Promise<{ chainId: bigint }>;
  read(method: ReadMethod, hash: string): Promise<unknown>;
};

function decodeCommitment(value: unknown): BatchCommitment | undefined {
  if (!Array.isArray(value) || value.length !== 6) return undefined;
  const [sourceId, sequenceStart, sequenceEnd, leafCount, merkleRoot, previousCheckpointHash] = value;
  if (typeof sourceId !== 'string' || typeof merkleRoot !== 'string' || typeof previousCheckpointHash !== 'string'
      || typeof sequenceStart !== 'bigint' || typeof sequenceEnd !== 'bigint' || typeof leafCount !== 'bigint') {
    return undefined;
  }
  const commitment = { sourceId, sequenceStart, sequenceEnd, leafCount, merkleRoot, previousCheckpointHash };
  return isCommitment(commitment) && sequenceStart > 0n && sequenceEnd >= sequenceStart
    && leafCount === sequenceEnd - sequenceStart + 1n ? commitment : undefined;
}

export async function lookupBatch(evidence: BatchEvidence, trusted: TrustedBatchConfig, rpcUrl: string,
  connect?: ConnectEvidenceAnchor): Promise<StageResult> {
  const stage = 'direct-rpc';
  if (!connect) {
    return result(stage, 'A read-only EvidenceAnchor provider is required.', 'CONTRACT_LOOKUP_UNAVAILABLE', 'UNVERIFIABLE');
  }

  let stored: unknown;
  try {
    const url = new URL(rpcUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Unsupported RPC URL');
    const reader = connect(url.href, trusted.domain.verifyingContract, EvidenceAnchorABI);
    const network = await reader.getNetwork();
    if (network.chainId !== BigInt(trusted.domain.chainId)) {
      return result(stage, 'RPC chain ID differs from the trusted deployment.', 'CHAIN_ID_MISMATCH', 'UNVERIFIABLE');
    }
    const hash = commitmentHash(evidence.commitment);
    if (await reader.read('isBatchAnchored', hash) !== true) {
      return result(stage, 'RPC did not confirm this commitment is anchored.', 'CONTRACT_LOOKUP_UNAVAILABLE', 'UNVERIFIABLE');
    }
    stored = await reader.read('getBatch', hash);
  } catch {
    return result(stage, 'Unable to complete the read-only EvidenceAnchor lookup.', 'RPC_UNAVAILABLE', 'UNVERIFIABLE');
  }

  const commitment = decodeCommitment(stored);
  if (!commitment) {
    return result(stage, 'RPC returned an incomplete EvidenceAnchor batch.', 'RPC_RESPONSE_INVALID', 'UNVERIFIABLE');
  }
  if (commitmentHash(commitment) !== commitmentHash(evidence.commitment)) {
    return result(stage, 'EvidenceAnchor returned a different commitment.', 'COMMITMENT_MISMATCH', 'TAMPERED');
  }
  return result(stage, 'The commitment matches the stored EvidenceAnchor batch.');
}
