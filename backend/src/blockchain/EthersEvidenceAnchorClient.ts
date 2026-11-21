import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import { EvidenceAnchorABI } from '@trusttrace/core';
import type { BatchCommitment } from '@trusttrace/core';
import type { EvidenceAnchorClient, AnchorReceipt, AnchoringTransaction } from './types.ts';

export interface EthersEvidenceAnchorClientOptions {
  rpcUrl: string;
  contractAddress: string;
  relayerPrivateKey: string;
}

export class EthersEvidenceAnchorClient implements EvidenceAnchorClient {
  private readonly provider: JsonRpcProvider;
  private readonly contract: Contract;

  constructor(options: EthersEvidenceAnchorClientOptions) {
    if (!/^https?:\/\//.test(options.rpcUrl)) throw new Error('RPC URL must use http or https');
    if (!/^0x[0-9a-fA-F]{40}$/.test(options.contractAddress)) throw new Error('Contract address must be a 20-byte hex address');
    this.provider = new JsonRpcProvider(options.rpcUrl);
    const relayer = new Wallet(options.relayerPrivateKey, this.provider);
    this.contract = new Contract(options.contractAddress, EvidenceAnchorABI, relayer);
  }

  async chainId(): Promise<bigint> {
    const network = await this.provider.getNetwork();
    return network.chainId;
  }

  async isBatchAnchored(commitmentHash: string): Promise<boolean> {
    return Boolean(await this.contract.isBatchAnchored(commitmentHash));
  }

  async getBatch(commitmentHash: string): Promise<BatchCommitment | null> {
    const anchored = await this.contract.isBatchAnchored(commitmentHash);
    if (!anchored) return null;
    try {
      const row = await this.contract.getBatch(commitmentHash);
      return {
        sourceId: row.sourceId,
        sequenceStart: BigInt(row.sequenceStart),
        sequenceEnd: BigInt(row.sequenceEnd),
        leafCount: BigInt(row.leafCount),
        merkleRoot: row.merkleRoot,
        previousCheckpointHash: row.previousCheckpointHash
      };
    } catch {
      return null;
    }
  }

  async submitBatch(commitment: BatchCommitment, signature: string): Promise<AnchoringTransaction> {
    const transaction = await this.contract.anchorBatch(commitment, signature);
    return { transactionHash: transaction.hash };
  }

  async getTransactionReceipt(transactionHash: string): Promise<AnchorReceipt | null> {
    const receipt = await this.provider.getTransactionReceipt(transactionHash);
    if (!receipt) return null;
    return {
      transactionHash: receipt.hash,
      blockNumber: receipt.blockNumber === null ? null : BigInt(receipt.blockNumber),
      status: receipt.status === null ? null : Number(receipt.status)
    };
  }
}
