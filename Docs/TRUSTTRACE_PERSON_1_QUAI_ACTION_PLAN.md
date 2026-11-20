# TRUSTTRACE: Person 1 Plan of Action — Quai Network Integration
**Mandatory Sponsor Requirement: Full Quai Network Integration & Deployment**  
**Project:** TRUSTTRACE (The Big Hack 2.0 | Track 02: Cybersecurity & Blockchain | Problem B3)  
**Role:** Person 1 (branch `person-a`) — Cryptographic Core, `EvidenceAnchor.sol`, ABI & Quai Checkpoint Engine  
**Status:** Plan Revised for Review (Implementation Halted Pending Approval)

---

## 1. Executive Architecture Summary

TRUSTTRACE implements a **Dual-Tier Tamper-Evident Architecture**:
1. **Tier 1 (Fast Path — Local Execution):** Local Hardhat EVM (Chain ID `31337`) provides low-latency, zero-gas batch anchoring for high-throughput live security evidence during host monitoring.
2. **Tier 2 (Public Proof of Work Checkpoint — Quai Network):** Periodic aggregate checkpoint digests are anchored to **Quai Network Orchard Testnet (Cyprus-1 Zone, Chain ID `15000`)**, replacing Polygon Amoy. This anchors immutable root state against local host compromise and chain resets using Quai's multi-threaded, proof-of-work consensus.

```mermaid
flowchart TD
    subgraph Monitored_Host ["Monitored Host (Person 3)"]
        AuthLog["/var/log/auth.log"] --> Agent["Host Agent (Ed25519)"]
    end

    subgraph Evidence_Vault ["Evidence Vault (Person 2)"]
        Ingest["Ingestion Receiver"] --> Store["Durable EvidenceStore (JSONL + SQLite)"]
        Store --> Tree["Build Merkle Tree (@trusttrace/core)"]
        Tree --> VaultSigner["Vault EIP-712 Signer (/run/secrets)"]
    end

    subgraph Tier1_Local ["Tier 1: Fast Path (Local Node)"]
        LocalRelayer["Local Relayer"] --> LocalContract["EvidenceAnchor.sol (Chain ID 31337)"]
        LocalContract --> LocalBatches["Local Batch Roots & Sequence Chain"]
    end

    subgraph Tier2_Quai ["Tier 2: Public Consensus (Quai Network)"]
        CheckpointEngine["Checkpoint Digest Engine"] --> QuaiRelayer["Quai Relayer (quais SDK, 0x00... Key)"]
        QuaiRelayer --> OrchardContract["EvidenceAnchor.sol (Cyprus-1, Chain ID 15000)"]
    end

    subgraph Verification ["Auditor Verification (Person 4)"]
        VerifierCLI["Auditor CLI & Dashboard"] --> LocalContract
        VerifierCLI --> OrchardContract
    end

    Agent -- "Signed Chunks (0xAA Tag)" --> Ingest
    VaultSigner -- "Signed Commitment" --> LocalRelayer
    LocalBatches -- "Epoch Aggregate Root" --> CheckpointEngine
    OrchardContract -- "Immutable Quai Checkpoint" --> VerifierCLI
```

---

## 2. Quai Network Technical Constraints & Architecture Invariants

| Invariant / Requirement | Quai Network Specification | TRUSTTRACE Implementation Strategy |
| :--- | :--- | :--- |
| **Active Zone / Shard** | **Cyprus-1** (Zone 0-0) | Target Zone for all smart contract interactions and state |
| **Chain ID** | `15000` (`0x3a98`) | Explicitly passed in EIP-712 domain and Hardhat network config |
| **RPC Endpoint** | `https://orchard.rpc.quai.network/cyprus1` | Configured with fallback to `https://orchard.rpc.quai.network` |
| **Block Explorer** | `https://orchard.quaiscan.io` | Used for transaction, block, and contract verification |
| **Faucet** | `https://orchard.faucet.quai.network` | Used by P1 (Deployer/Owner) and P2 (Relayer) for Cyprus-1 funding |
| **Address Shard Prefix** | **`0x00` byte prefix** | All in-zone accounts, deployers, relayers, and contracts MUST start with `0x00` |
| **Address Grinding** | Required for Contract Creation | Handled via `@quai/hardhat-deploy-metadata` or `quais.ContractFactory` |
| **EVM Target** | **`paris`** (No `PUSH0` Opcode) | Quai EVM does not support EIP-3855 (`PUSH0`). EVM version locked to `paris` |
| **Solidity Compiler** | **`0.8.19`** (or `0.8.24` with `evmVersion: "paris"`) | Pin `0.8.19` for Quai deployment compatibility |
| **JavaScript/TypeScript SDK** | **`quais`** (v1.0.0-alpha.x) | Official SDK for Quai RPC, address derivation, and contract interaction |
| **External Dependencies** | **Zero External Imports** in `EvidenceAnchor.sol` | Self-contained contract using native `ecrecover`; no OpenZeppelin conflicts |

---

## 3. Preservation of Locked Cryptographic Invariants

> [!IMPORTANT]
> **Strict Non-Regression Guarantee:**
> 1. **Leaf Preimage Layout:** Preserved at $46 + N$ bytes (`0x00 || version(1B) || sourceId(32B) || vaultSequence(8B BE) || rawEventLength(4B BE) || rawEventBytes`).
> 2. **Merkle Tree:** Preserved odd-node promotion without duplication; proof verification requires `(leaf, leafIndex, leafCount, proof, root)`.
> 3. **BatchCommitment Struct:** Exactly 6 fields: `sourceId`, `sequenceStart`, `sequenceEnd`, `leafCount`, `merkleRoot`, `previousCheckpointHash`.
> 4. **Sequence Continuity & Genesis:** Sequence starts at 1; `start == lastEnd + 1`; genesis `previousCheckpointHash` is `bytes32(0)`.
> 5. **Key Boundary:** EIP-712 Vault Signer key lives ONLY in Vault container (`/run/secrets`). Relayer key is completely separate and funded.

---

## 4. Phase-by-Phase Plan of Action

### Phase 0: Foundations, Specification & Test Vectors (COMPLETED & VERIFIED)
- [x] **0.1 Spec Definition:** Created `docs/spec/ENCODING.md` detailing canonical binary encoding, domain tags, odd-node promotion, and proof structure.
- [x] **0.2 Pure Reference Implementation:** Created `packages/core/src/canonical.ts`, `merkle.ts`, and `commitment.ts`.
- [x] **0.3 Merkle Test Vectors:** Generated `vectors/merkle.json` covering 1, 2, 3, 4, 5, 7 leaves + negative test cases.
- [x] **0.4 EIP-712 Verification:** Validated `BatchCommitmentVerifier.sol` with OpenZeppelin `EIP712` + `ECDSA`; generated `vectors/eip712-commitment.json` for chain ID `31337`.
- [x] **0.5 Verification:** 40/40 Core tests passing.

---

### Phase 1: Core API & EvidenceAnchor Contract (COMPLETED & VERIFIED)
- [x] **1.1 Core API:** Exported `encodeLeaf`, `hashLeaf`, `buildTree`, `getProof`, `verifyProof`, `hashCommitment`, `signCommitment`.
- [x] **1.2 Contract Implementation:** Built `blockchain/contracts/EvidenceAnchor.sol` with `registerSource`, `anchorBatch`, `getBatch`, `getLatest`, emitting `BatchAnchored`.
- [x] **1.3 ABI Generation:** Generated and exported `EvidenceAnchor.abi.json` in `packages/core/src/abi/`.
- [x] **1.4 Verification:** Core and standalone contract tests passing.

---

### Phase 2: Invariants, Negative Tests & Gas Benchmarking (COMPLETED & VERIFIED)
- [x] **2.1 On-Chain Rejection Rules:** Enforced source registration/revocation (A5), duplicate batch replay protection, sequence continuity gaps/overlaps, genesis zero check, leafCount contiguity.
- [x] **2.2 Negative Test Suite:** Asserted exact revert strings for all failure modes including field alteration after signing.
- [x] **2.3 Gas Measurement (Local Hardhat):** Logged measured gas: `registerSource`: 53,060; `anchorBatch` (Genesis): 177,479; `anchorBatch` (Chained): 163,833.
- [x] **2.4 Verification:** 33/33 Hardhat tests passing.

---

### Phase 3: Cross-Chain Checkpoint Digest & Chain Reset Simulation (NEXT UP)

**Goal:** Provide mathematical linkage between Tier 1 local batch roots and Tier 2 Quai Orchard checkpoints, proving that local chain resets or tampering are caught by the public Quai checkpoint.

#### Tasks:
1. **Checkpoint Digest Specification:**
   Implement `buildCheckpoint` in `packages/core/src/checkpoint.ts`:
   $$\text{checkpointDigest} = \text{SHA256}(\mathtt{0xCC} \parallel \text{prevDigest} \parallel \text{localChainId} \parallel \text{localBlockNumber} \parallel \text{localBlockHash} \parallel \text{latestBatchRoot} \parallel \text{latestSequence} \parallel \text{contractAddress})$$
2. **Deterministic Checkpoint Test Vectors:**
   Generate `vectors/checkpoint.json` containing known local state inputs, expected checkpoint digest, and chained sequence.
3. **Auditor Verification Helpers:**
   Expose `checkLocalChain(...)` and `checkCheckpoint(...)` in `@trusttrace/core` for Person 4's CLI verifier.
4. **Chain Reset Hardhat Simulation Test:**
   Create `blockchain/test/chain-reset.test.ts`:
   - Anchor batches 1..5 on local chain.
   - Compute checkpoint digest and record public anchor.
   - Simulate an attacker resetting/rewriting local chain history (e.g. erasing or substituting batch 3).
   - Assert that `checkCheckpoint(...)` detects the state divergence and fails closed.

#### Files & Deliverables:
- `packages/core/src/checkpoint.ts`
- `packages/core/src/index.ts` (re-export)
- `vectors/checkpoint.json`
- `packages/core/test/checkpoint.test.ts`
- `blockchain/test/chain-reset.test.ts`

---

### Phase 4: Quai Network Tooling, Configuration & Orchard Deployment

**Goal:** Fully integrate Quai Network Orchard testnet (Cyprus-1, Chain ID 15000) using official tooling and `quais`, deploy `EvidenceAnchor.sol`, and generate live deployment artifacts.

#### 4.1 Dependency & Tooling Integration
- In `blockchain/package.json`, add:
  - `"quais": "^1.0.0-alpha.12"` (Official Quai SDK)
  - `"@quai/hardhat-deploy-metadata": "^1.0.1"` (Metadata & IPFS deployment plugin)
- Keep standard `ethers` and `hardhat` for Tier 1 local tests.

#### 4.2 Hardhat Multi-Network Configuration (`blockchain/hardhat.config.cjs`)
Update configuration with compiler compatibility and dual-network routing:
```javascript
module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.19",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          evmVersion: "paris" // CRITICAL: Quai does not support PUSH0 (EIP-3855)
        }
      },
      {
        version: "0.8.24",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          evmVersion: "paris"
        }
      }
    ]
  },
  networks: {
    hardhat: {
      chainId: 31337
    },
    quai_orchard: {
      url: process.env.QUAI_RPC_URL || "https://orchard.rpc.quai.network/cyprus1",
      chainId: 15000,
      accounts: process.env.QUAI_DEPLOYER_PRIVATE_KEY ? [process.env.QUAI_DEPLOYER_PRIVATE_KEY] : []
    }
  }
};
```

#### 4.3 Quai Address Validation & Shard Verification
- Create helper `packages/core/src/quai.ts`:
  - `isCyprus1Address(address: string): boolean`: Validates `0x00` byte prefix and 20-byte length.
  - `formatQuaiAddress(address: string): string`: Normalizes address to checksum format with shard assertion.
- Provide key generation utility `blockchain/scripts/generate-quai-wallet.ts` to derive dedicated Cyprus-1 testnet keys (`0x00...`) for P1 (Contract Owner) and P2 (Relayer).

#### 4.4 Orchard Deployment Script (`blockchain/scripts/deploy-orchard.ts`)
Implement automated deployment to Quai Orchard Cyprus-1:
1. Verify deployer wallet address has `0x00` prefix (Cyprus-1 shard).
2. Connect using `quais.providers.JsonRpcProvider("https://orchard.rpc.quai.network/cyprus1")`.
3. Check `provider.getNetwork()` matches `chainId == 15000`.
4. Deploy `EvidenceAnchor.sol` using `quais.ContractFactory` with byte grinding / metadata upload.
5. Wait for deployment receipt, verify deployed address has `0x00` prefix.
6. Register the initial Vault Signer address via `registerSource(sourceId, vaultSignerAddress)`.
7. Output deployment record to `packages/core/src/deployments.json`:
   ```json
   {
     "quai_orchard_cyprus1": {
       "chainId": 15000,
       "zone": "cyprus-1",
       "rpcUrl": "https://orchard.rpc.quai.network/cyprus1",
       "contractAddress": "0x00...",
       "deployerAddress": "0x00...",
       "deployTxHash": "0x...",
       "deployedAt": "2026-11-21T..."
     }
   }
   ```

#### 4.5 Quai Orchard Checkpoint Submission Script (`blockchain/scripts/submit-checkpoint-orchard.ts`)
- Submits an aggregate epoch checkpoint commitment to Quai Orchard using `quais`.
- Verifies EIP-712 domain with `chainId: 15000` and the Orchard contract address.
- Handles pending status, exponential backoff, transaction hash logging, and confirmations.

#### 4.6 Quai Orchard Test Vector & Smoke Test
- Generate `vectors/quai-orchard-commitment.json` with chain ID `15000`.
- Create smoke test `blockchain/test/quai-orchard-smoke.test.ts` validating:
  - Domain separator derivation with chain ID `15000`.
  - Signature recovery on Cyprus-1.
  - Re-measurement of gas on Quai Orchard.

---

### Phase 5: Cross-Team Integration & Monorepo Synchronization

**Goal:** Ensure seamless interoperation across all 4 team roles.

#### Dependencies & Handoffs:
1. **To Person 2 (Vault Backend & Ingestion):**
   - Provide `packages/core/src/deployments.json` and updated ABI.
   - Confirm P2's Relayer uses `quais` with a funded Cyprus-1 address (`0x00...`).
   - Confirm P2's EIP-712 domain generator dynamically sets `chainId: 15000` and the Orchard contract address for Quai checkpoints.
   - Confirm Host Agent Ed25519 verification (`verifyAgentChunk`) at the Vault Ingestion Receiver.
2. **To Person 3 (Host Agent & Victim Lab):**
   - Confirm Host Agent holds only the Ed25519 chunk signing key (NEVER any blockchain key).
   - Provide `vectors/agent-chunk.json` for deterministic chunk generation.
   - Confirm P3 attack scripts remain deterministic for demonstration.
3. **To Person 4 (Auditor CLI & Dashboard):**
   - Provide Quai Orchard RPC endpoint (`https://orchard.rpc.quai.network/cyprus1`), deployed contract address, and explorer URL (`https://orchard.quaiscan.io`).
   - Export `checkLocalChain` and `checkCheckpoint` for Ablation rows C and D.
   - Update Dashboard Ablation Matrix: Row D = "Public Checkpoint (Quai Orchard Cyprus-1)".

---

### Phase 6: Final Verification, Gas Audit & Defence Preparation

1. **Monorepo Test Suite Execution:**
   - Run `npm run test:all`: Core tests (49/49), Blockchain tests (33/33 + Quai tests), Backend storage tests (15/15).
2. **Gas Audit Report:**
   - Publish final measured gas comparison:
     - Local Hardhat vs Quai Orchard testnet.
3. **Defence Package (Prompt 6):**
   - 60-second walkthrough:
     - Why EIP-712 over raw transactions on-chain.
     - Why Quai Orchard Cyprus-1 provides tamper-evidence against root attacker.
     - What the contract proves (source authorization, sequence continuity, Merkle root immutability).
     - What the contract does NOT prove (truthfulness of original host logs before agent ingestion).
     - How local chain reset or host log wipe is mathematically detected by the Quai checkpoint.

---

## 5. Summary of Files to be Created / Modified

| File Path | Action | Description |
| :--- | :---: | :--- |
| `packages/core/src/checkpoint.ts` | Create | Checkpoint digest builder, `checkLocalChain`, `checkCheckpoint` |
| `packages/core/src/quai.ts` | Create | Quai Cyprus-1 address validation (`0x00` shard prefix) |
| `packages/core/src/deployments.json` | Create | Authoritative registry of contract addresses, chain IDs, and RPC URLs |
| `vectors/checkpoint.json` | Create | Test vector for cross-chain checkpoint digest |
| `vectors/quai-orchard-commitment.json` | Create | EIP-712 test vector with chain ID 15000 |
| `blockchain/package.json` | Modify | Add `quais` and `@quai/hardhat-deploy-metadata` dependencies |
| `blockchain/hardhat.config.cjs` | Modify | Add `quai_orchard` network, Solidity 0.8.19, `evmVersion: "paris"` |
| `blockchain/scripts/generate-quai-wallet.ts` | Create | Derives Cyprus-1 in-zone testnet addresses (`0x00...`) |
| `blockchain/scripts/deploy-orchard.ts` | Create | Quai Orchard Cyprus-1 automated deployment script |
| `blockchain/scripts/submit-checkpoint-orchard.ts` | Create | Checkpoint submission script using `quais` |
| `blockchain/test/chain-reset.test.ts` | Create | Simulates local chain history reset and asserts checkpoint detection |
| `blockchain/test/quai-orchard-smoke.test.ts` | Create | Validates EIP-712 recovery on chain ID 15000 |
| `Docs/TRUSTTRACE_PERSON_1_QUAI_ACTION_PLAN.md` | Create | Git-tracked team copy of this action plan |
