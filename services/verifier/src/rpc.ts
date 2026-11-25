import { EvidenceAnchorABI, validateSequenceContinuity } from '@trusttrace/core';
import deployments from '@trusttrace/core/deployments' with { type: 'json' };
import { Contract, FetchRequest, Interface, JsonRpcProvider } from 'quais';
import type { BatchCommitment } from '@trusttrace/core/types';
import { commitmentHash, isCommitment, result } from './core.js';
import type { BatchEvidence, TrustedBatchConfig } from './core.js';
import type { StageResult } from './types.js';

type ReadMethod = 'isBatchAnchored' | 'getBatch' | 'getLatest' | 'getSource';
const maxUint64 = (1n << 64n) - 1n;
export const RPC_REQUEST_TIMEOUT_MS = 15_000;

const orchard = deployments.quai_orchard_cyprus1;
export const QUAI_ORCHARD_REGISTRY = {
  network: 'Quai Orchard Cyprus-1',
  chainId: BigInt(orchard.chainId),
  rpcUrl: orchard.rpcUrl,
  contractAddress: orchard.contractAddress ? orchard.contractAddress.toLowerCase() : '',
  expectedVaultSigner: orchard.vaultSignerAddress ?? '',
} as const;

const local = deployments.local_hardhat;
export const LOCAL_VAULT_TRUST: TrustedBatchConfig = {
  signer: local.vaultSignerAddress,
  domain: {
    name: 'EvidenceAnchor', version: '1', chainId: BigInt(local.chainId), verifyingContract: local.contractAddress,
  },
};

export const createLocalEvidenceAnchor: ConnectEvidenceAnchor = (rpcUrl, address, abi) => {
  const contract = new Interface(abi as ConstructorParameters<typeof Interface>[0]);
  async function call(method: string, params: unknown[]) {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(RPC_REQUEST_TIMEOUT_MS),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('RPC request failed');
    const message = await response.json();
    if (message?.jsonrpc !== '2.0' || message.id !== 1 || message.error || typeof message.result !== 'string') {
      throw new Error('Invalid RPC response');
    }
    return message.result;
  }

  return {
    getNetwork: async () => {
      const chainId = await call('eth_chainId', []);
      if (!/^0x[0-9a-f]+$/i.test(chainId)) throw new Error('Invalid RPC chain ID');
      return { chainId: BigInt(chainId) };
    },
    read: async (method, ...args) => {
      const data = contract.encodeFunctionData(method, args);
      const value = await call('eth_call', [{ to: address, data }, 'latest']);
      const decoded = contract.decodeFunctionResult(method, value);
      return decoded.length === 1 ? decoded[0] : decoded;
    },
  };
};

export function redactRpcUrl(_rpcUrl: string): string {
  return '[redacted]';
}

function withRequestTimeout<T>(request: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error('RPC request timed out')), RPC_REQUEST_TIMEOUT_MS);
  });
  return Promise.race([request, deadline]).finally(() => {
    if (timeout !== undefined) clearTimeout(timeout);
  });
}

/** Connect a zoned, read-only provider to the trusted deployment with the supplied ABI. */
export type ConnectEvidenceAnchor = (rpcUrl: string, address: string, abi: typeof EvidenceAnchorABI) => {
  getNetwork(): Promise<{ chainId: bigint }>;
  read(method: ReadMethod, ...args: string[]): Promise<unknown>;
};

export function createQuaiEvidenceAnchor(
  rpcUrl: string,
  address: string,
  abi: typeof EvidenceAnchorABI,
): {
  getNetwork(): Promise<{ chainId: bigint }>;
  read(method: ReadMethod, ...args: string[]): Promise<unknown>;
} {
  const request = new FetchRequest(rpcUrl);
  request.timeout = RPC_REQUEST_TIMEOUT_MS;
  const provider = new JsonRpcProvider(request);
  const contract = new Contract(address, abi, provider);
  return {
    getNetwork: async () => {
      const network = await provider.getNetwork();
      return { chainId: BigInt(network.chainId) };
    },
    read: async (method, ...args) => {
      const methodFunction = contract.getFunction(method);
      return methodFunction(...args);
    },
  };
}

function decodeCommitment(value: unknown): BatchCommitment | undefined {
  const tuple = Array.isArray(value)
    ? value
    : typeof value === 'object' && value !== null
      ? [
          (value as Record<string, unknown>).sourceId,
          (value as Record<string, unknown>).sequenceStart,
          (value as Record<string, unknown>).sequenceEnd,
          (value as Record<string, unknown>).leafCount,
          (value as Record<string, unknown>).merkleRoot,
          (value as Record<string, unknown>).previousCheckpointHash,
        ]
      : undefined;
  if (!tuple || tuple.length !== 6) return undefined;
  const [sourceId, sequenceStart, sequenceEnd, leafCount, merkleRoot, previousCheckpointHash] = tuple;
  if (typeof sourceId !== 'string' || typeof merkleRoot !== 'string' || typeof previousCheckpointHash !== 'string'
      || typeof sequenceStart !== 'bigint' || typeof sequenceEnd !== 'bigint' || typeof leafCount !== 'bigint') {
    return undefined;
  }
  const commitment = { sourceId, sequenceStart, sequenceEnd, leafCount, merkleRoot, previousCheckpointHash };
  return isCommitment(commitment) && sequenceStart > 0n && sequenceEnd >= sequenceStart
    && leafCount === sequenceEnd - sequenceStart + 1n ? commitment : undefined;
}

interface RegisteredSource {
  signer: string;
  registered: boolean;
  revoked: boolean;
  lastSequenceEnd: bigint;
  lastCheckpointHash: string;
  batchCount: bigint;
}

function decodeSource(value: unknown): RegisteredSource | undefined {
  let tuple: unknown[] | undefined;
  if (Array.isArray(value)) {
    tuple = value;
  } else if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    tuple = [
      record.signer,
      record.registered,
      record.revoked,
      record.lastSequenceEnd,
      record.lastCheckpointHash,
      record.batchCount,
    ];
  }
  if (!tuple || tuple.length !== 6) return undefined;
  const [signer, registered, revoked, lastSequenceEnd, lastCheckpointHash, batchCount] = tuple;
  if (typeof signer !== 'string' || typeof registered !== 'boolean' || typeof revoked !== 'boolean'
      || typeof lastSequenceEnd !== 'bigint' || typeof lastCheckpointHash !== 'string'
      || typeof batchCount !== 'bigint' || !/^0x[0-9a-f]{40}$/i.test(signer)
      || !/^0x[0-9a-f]{64}$/i.test(lastCheckpointHash)
      || lastSequenceEnd < 0n || lastSequenceEnd > maxUint64 || batchCount < 0n) return undefined;
  return { signer, registered, revoked, lastSequenceEnd, lastCheckpointHash, batchCount };
}

function decodeLatest(value: unknown): { commitment: BatchCommitment; commitmentHash: string } | undefined {
  if (Array.isArray(value) && value.length === 2) {
    const commitment = decodeCommitment(value[0]);
    return commitment && typeof value[1] === 'string' && /^0x[0-9a-f]{64}$/i.test(value[1])
      ? { commitment, commitmentHash: value[1].toLowerCase() }
      : undefined;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const commitment = decodeCommitment(record.commitment);
    return commitment && typeof record.commitmentHash === 'string' && /^0x[0-9a-f]{64}$/i.test(record.commitmentHash)
      ? { commitment, commitmentHash: record.commitmentHash.toLowerCase() }
      : undefined;
  }
  return undefined;
}

type CommitmentEvidence = Pick<BatchEvidence, 'commitment' | 'commitmentHash' | 'previousCommitment'>;

export async function lookupBatch(evidence: CommitmentEvidence, trusted: TrustedBatchConfig, rpcUrl: string,
  connect?: ConnectEvidenceAnchor): Promise<StageResult> {
  const contractMismatch = QUAI_ORCHARD_REGISTRY.contractAddress
    ? trusted.domain.verifyingContract.toLowerCase() !== QUAI_ORCHARD_REGISTRY.contractAddress
    : !trusted.domain.verifyingContract.toLowerCase().startsWith('0x00');

  if (trusted.domain.name !== 'EvidenceAnchor' || trusted.domain.version !== '1'
      || BigInt(trusted.domain.chainId) !== QUAI_ORCHARD_REGISTRY.chainId
      || contractMismatch) {
    return result('direct-rpc', 'The verifier is not configured for the trusted Quai Orchard deployment domain.', 'CHAIN_ID_MISMATCH', 'UNVERIFIABLE');
  }
  return lookupAnchoredCommitment(evidence, trusted, rpcUrl, connect);
}

export function lookupLocalBatch(evidence: CommitmentEvidence, rpcUrl = local.rpcUrl,
  connect = createLocalEvidenceAnchor): Promise<StageResult> {
  return lookupAnchoredCommitment(evidence, LOCAL_VAULT_TRUST, rpcUrl, connect);
}

async function lookupAnchoredCommitment(evidence: CommitmentEvidence, trusted: TrustedBatchConfig, rpcUrl: string,
  connect?: ConnectEvidenceAnchor): Promise<StageResult> {
  const stage = 'direct-rpc';
  if (!connect) {
    return result(stage, 'A read-only EvidenceAnchor provider is required.', 'CONTRACT_LOOKUP_UNAVAILABLE', 'UNVERIFIABLE');
  }

  let sourceId: string;
  try {
    sourceId = '0x' + evidence.commitment.sourceId.slice(2).toLowerCase();
  } catch {
    return result(stage, 'The evidence source identifier is malformed.', 'RPC_RESPONSE_INVALID', 'UNVERIFIABLE');
  }

  let source: RegisteredSource;
  let latest: { commitment: BatchCommitment; commitmentHash: string };
  let stored: BatchCommitment | undefined;
  try {
    const url = new URL(rpcUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Unsupported RPC URL');
    const reader = connect(url.href, trusted.domain.verifyingContract, EvidenceAnchorABI);
    const network = await withRequestTimeout(reader.getNetwork());
    if (network.chainId !== BigInt(trusted.domain.chainId)) {
      return result(stage, 'RPC chain ID differs from the trusted deployment.', 'CHAIN_ID_MISMATCH', 'UNVERIFIABLE');
    }

    const sourceValue = await withRequestTimeout(reader.read('getSource', sourceId));
    const decodedSource = decodeSource(sourceValue);
    if (!decodedSource) {
      return result(stage, 'RPC returned an incomplete source registration.', 'RPC_RESPONSE_INVALID', 'UNVERIFIABLE');
    }
    source = decodedSource;
    if (!source.registered) {
      return result(stage, 'The evidence source is not registered.', 'CONTRACT_LOOKUP_UNAVAILABLE', 'UNVERIFIABLE');
    }
    if (source.signer.toLowerCase() !== trusted.signer.toLowerCase()) {
      return result(stage, 'The registered Vault signer differs from the trusted configured signer.', 'TRUSTED_CONFIG_MISMATCH', 'UNVERIFIABLE');
    }

    // Registrations cannot be overwritten. Revocation prevents new anchors but preserves existing ones.
    const hash = commitmentHash(evidence.commitment);
    if (await withRequestTimeout(reader.read('isBatchAnchored', hash)) !== true) {
      return result(stage, 'RPC did not confirm this commitment is anchored.', 'CONTRACT_LOOKUP_UNAVAILABLE', 'UNVERIFIABLE');
    }
    const latestValue = await withRequestTimeout(reader.read('getLatest', sourceId));
    const decodedLatest = decodeLatest(latestValue);
    if (!decodedLatest) {
      return result(stage, 'RPC returned an incomplete latest batch lookup.', 'RPC_RESPONSE_INVALID', 'UNVERIFIABLE');
    }
    latest = decodedLatest;
    const storedValue = await withRequestTimeout(reader.read('getBatch', hash));
    stored = decodeCommitment(storedValue);
    if (evidence.commitment.sequenceStart > 1n) {
      const previousHash = evidence.commitment.previousCheckpointHash.toLowerCase();
      if (await withRequestTimeout(reader.read('isBatchAnchored', previousHash)) !== true) {
        return result(stage, 'RPC did not confirm the preceding source-local commitment is anchored.', 'CONTRACT_LOOKUP_UNAVAILABLE', 'UNVERIFIABLE');
      }
      const previousValue = await withRequestTimeout(reader.read('getBatch', previousHash));
      const previous = decodeCommitment(previousValue);
      if (!previous) {
        return result(stage, 'RPC returned an incomplete preceding commitment.', 'RPC_RESPONSE_INVALID', 'UNVERIFIABLE');
      }
      if (commitmentHash(previous) !== previousHash
          || (evidence.previousCommitment && commitmentHash(previous) !== commitmentHash(evidence.previousCommitment))
          || !validateSequenceContinuity(previous, evidence.commitment).valid) {
        return result(stage, 'The anchored preceding commitment does not link to this source-local sequence.', 'COMMITMENT_MISMATCH', 'TAMPERED');
      }
    }
  } catch {
    return result(stage, 'Unable to complete the read-only EvidenceAnchor lookup.', 'RPC_UNAVAILABLE', 'UNVERIFIABLE');
  }

  if (!stored) {
    return result(stage, 'RPC returned an incomplete EvidenceAnchor batch.', 'RPC_RESPONSE_INVALID', 'UNVERIFIABLE');
  }
  if (commitmentHash(stored) !== commitmentHash(evidence.commitment)) {
    return result(stage, 'EvidenceAnchor returned a different commitment.', 'COMMITMENT_MISMATCH', 'TAMPERED');
  }
  if (latest.commitmentHash !== source.lastCheckpointHash.toLowerCase()
      || source.lastSequenceEnd !== latest.commitment.sequenceEnd) {
    return result(stage, 'RPC returned inconsistent latest-batch and source-registration state.', 'RPC_RESPONSE_INVALID', 'UNVERIFIABLE');
  }
  if (commitmentHash(latest.commitment) !== latest.commitmentHash) {
    return result(stage, 'RPC latest commitment does not match its reported commitment hash.', 'RPC_RESPONSE_INVALID', 'UNVERIFIABLE');
  }
  if (evidence.commitmentHash.toLowerCase() === latest.commitmentHash
      && commitmentHash(latest.commitment) !== commitmentHash(evidence.commitment)) {
    return result(stage, 'The latest EvidenceAnchor commitment differs from the evidence.', 'COMMITMENT_MISMATCH', 'TAMPERED');
  }
  return result(stage, 'The registered source, latest batch, and stored commitment match the direct-RPC lookup.');
}
