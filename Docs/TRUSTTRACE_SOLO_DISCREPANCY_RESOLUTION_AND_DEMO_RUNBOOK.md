# TRUSTTRACE: Solo Integration & Discrepancy Resolution Runbook

**The Big Hack 2.0 · Track 02: Cybersecurity & Blockchain · Problem B3**  
**Role:** Solo Full-Stack Engineer (Unifying Core Crypto, Smart Contracts, Vault Backend, Host Agent, Dashboard & Verifier)  
**Status:** Actionable Implementation Plan (Check-ins Omitted — Solo Execution Mode)  
**Tracking Repository:** `NeuroNova` · **Branch:** `person-a`

---

## Purpose

This document provides a battle-tested, phase-by-phase action plan to eliminate all discrepancies identified in the forensic audit. It translates every operational gap (Docker networking, `0.0.0.0` port bindings, Ed25519 key provisioning, local Hardhat chain anchoring, Live REST dashboard wiring, and 3-witness attack execution) into ready-to-run tasks with exact terminal commands and acceptance criteria. Check-ins to other teammates have been deliberately removed for solo development velocity.

---

## Frozen Invariants & System Boundaries

1. **Immutable Canonical Leaf ($46 + N$ Bytes):**  
   $$\text{leafHash} = \text{SHA256}(0x00 \parallel \text{version (1B)} \parallel \text{sourceId (32B)} \parallel \text{vaultSequence (8B)} \parallel \text{rawEventLength (4B)} \parallel \text{rawEventBytes (NB)})$$  
   *Terminating newline (`\n` / `0x0A`) is preserved verbatim.* Never trim or normalize event bytes.
2. **Odd-Node Merkle Tree Rule:**  
   Unpaired nodes are promoted unchanged to the next level (never duplicated).
3. **Monotonic Sequence Chaining on Blockchain:**  
   `startSequence == lastSequenceEnd + 1`. Genesis sequence is `1`. Previous checkpoint digest matches on-chain state.
4. **Strict Key Separation:**  
   - **Host Agent:** Holds only its Ed25519 signing seed (`agent-key-store.ts`).
   - **Vault Signer:** Holds EIP-712 private key (`vault-signer.key`). Off-chain only; never pays gas or connects to RPC.
   - **Relayer Account:** Holds funded EVM/Quai account. Pays gas to submit `anchorBatch()`; never signs batch commitments.
5. **Fail-Safe Integrity:**  
   Missing dependencies, network partitions, or RPC timeouts report `UNVERIFIABLE`. Tampering verdicts (`CHAIN_MISMATCH`, `VAULT_CORRUPTED`, `TAMPER_DETECTED`) require mathematical proof.

---

## Shared Header

Paste this at the top of any task prompt:

```text
PROJECT: TRUSTTRACE (The Big Hack 2.0, Problem B3). Full Monorepo Solo Execution.
LOCKED CRYPTO: leafHash = SHA256(0x00 || version || sourceId || vaultSequence || rawEventLength || rawEventBytes);
node = SHA256(0x01 || left || right); odd node promoted unchanged; EIP-712 commitment binds (sourceId,
sequenceStart, sequenceEnd, leafCount, merkleRoot, previousCheckpointHash).
CONTRACT: EvidenceAnchor.sol monotonic sequenceStart == lastEnd + 1; duplicate rejection; 0x00 Cyprus-1 / EVM.
SECURITY BOUNDARIES: Host Agent has Ed25519 chunk key only; Vault holds EIP-712 signer key only; Relayer holds
gas key only; Vault JSONL with fsync is source of truth; SQLite is a rebuildable index; raw bytes include terminating 0x0A.
RULES: No secrets in Git; no hardcoded ephemeral keys; verify every step with executable commands.
```

---

## Phase 0: Network Binding & Key Provisioning Defaults

### Context
`backend/src/config/index.ts` defaults `BACKEND_HOST` and `RSYSLOG_HOST` to `127.0.0.1`, which blocks container-to-container traffic in Docker. Additionally, `backend/src/api/ingest.ts` returns `HTTP 503` if `AGENT_PUBLIC_KEY_HEX` is missing.

### Prompt 0: Environment & Key Alignment

```text
[SHARED HEADER]
TASK:
1. Ensure backend/src/config/index.ts allows environment overrides for:
   - BACKEND_HOST (default 0.0.0.0 in Docker / production)
   - BACKEND_PORT (default 3000)
   - RSYSLOG_HOST (default 0.0.0.0 in Docker / production)
   - RSYSLOG_PORT (default 5140)
   - AGENT_PUBLIC_KEY_HEX (fallback wildcard '*' trusted key)
2. Create a canonical test environment file `lab/.env.lab` containing:
   - LAB_SSH_PASSWORD=labsecretpassword123
   - AGENT_SOURCE_ID=0x1111111111111111111111111111111111111111111111111111111111111111
   - AGENT_STREAM_ID=auth.log
   - AGENT_FILE_IDENTITY=auth.log
   - AGENT_PUBLIC_KEY_HEX=0x1111111111111111111111111111111111111111111111111111111111111111
   - VAULT_SIGNER_PRIVATE_KEY=0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
   - VAULT_BASE_URL=http://vault:3000
   - RSYSLOG_TARGET_HOST=vault
   - RSYSLOG_TARGET_PORT=5140
3. Verify that running the backend with these variables accepts both Ed25519 chunks and TCP rsyslog frames.

ACCEPTANCE:
Run:
npm test --prefix backend
Confirm all 71 unit and integration tests pass without error.
```

---

## Phase 1: Local Blockchain Anchoring Pipeline

### Context
The live demo requires real blockchain transactions to show judges on-chain Merkle roots and gas receipts, rather than relying exclusively on unit test in-memory mocks.

### Prompt 1: Deploy Contract & Configure Live EVM Relayer

```text
[SHARED HEADER]
TASK:
1. Create a deployment script `blockchain/scripts/deploy-local.ts` that:
   - Connects to a local JSON-RPC provider (http://127.0.0.1:8545).
   - Deploys `EvidenceAnchor.sol`.
   - Registers the Vault Signer address derived from VAULT_SIGNER_PRIVATE_KEY (0x0123...cdef)
     for AGENT_SOURCE_ID via `registerSource(sourceId, signerAddress)`.
   - Outputs the deployed contract address to `lab/contract-address.env`.
2. Configure the backend's AnchoringWorker environment to target this local node:
   - LOCAL_RPC_URL=http://127.0.0.1:8545
   - EVIDENCE_ANCHOR_LOCAL_ADDRESS=<deployed-address>
   - LOCAL_RELAYER_PRIVATE_KEY=<hardhat-account-0-private-key>
   - LOCAL_CHAIN_ID=31337 (or 15000 for Quai Cyprus-1 local node)
3. Write an integration verification test `backend/tests/liveAnchor.test.ts` that:
   - Starts Hardhat node in-process or connects to existing RPC.
   - Submits a signed batch via AnchoringWorker.
   - Calls `contract.getBatch(commitmentHash)` to verify the Merkle root on-chain.

ACCEPTANCE:
Run:
npm test --prefix blockchain
Confirm 9/9 standalone contract tests pass, and test local deployment script.
```

---

## Phase 2: Complete Docker Lab Environment (`lab/compose.yaml`)

### Context
`lab/compose.yaml` currently only specifies `victim` and `agent`. It is missing the `vault` service and the network bridging between them.

### Prompt 2: Multi-Container Lab Orchestration

```text
[SHARED HEADER]
TASK:
1. Update `lab/compose.yaml` to include all three essential live services:
   a) `victim`:
      - Builds from `./victim`.
      - Ports: `127.0.0.1:2222:22`.
      - Forwards syslog to `vault:5140` via TCP in `lab/victim/rsyslog.conf`.
      - Shared volume: `victim_logs:/var/log`.
   b) `agent`:
      - Builds from `services/agent/Dockerfile`.
      - Mounts `victim_logs:/var/log:ro`.
      - Mounts persistent volume `agent_state:/var/lib/trusttrace-agent`.
      - Sends HTTP chunks to `http://vault:3000/api/v1/logs/ingest`.
      - Sends heartbeats to `http://vault:3000/api/v1/agents/heartbeat`.
   c) `vault`:
      - Builds from root or `backend/Dockerfile`.
      - Exposes ports `3000:3000` (HTTP REST) and `5140:5140` (rsyslog TCP).
      - Environment:
        BACKEND_HOST=0.0.0.0
        BACKEND_PORT=3000
        RSYSLOG_HOST=0.0.0.0
        RSYSLOG_PORT=5140
        AGENT_PUBLIC_KEY_HEX=0x1111111111111111111111111111111111111111111111111111111111111111
        VAULT_SIGNER_PRIVATE_KEY=0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
      - Mounts persistent volume `vault_data:/data/vault`.
2. Configure Docker network `trusttrace_net` so all containers resolve each other by service name.
3. Add a healthcheck to `vault` probing `GET http://127.0.0.1:3000/health`.

ACCEPTANCE:
Run:
docker compose -f lab/compose.yaml config
Confirm valid configuration syntax with zero schema warnings.
```

---

## Phase 3: Live REST Dashboard Wiring & CORS Alignment

### Context
In `apps/dashboard`, the UI defaults to `demo` mode (static fixtures). When switched to `live` mode, it uses `LiveDashboard.tsx` to query the Vault REST APIs.

### Prompt 3: Dashboard Live Mode & Endpoint Verification

```text
[SHARED HEADER]
TASK:
1. In `backend/src/api/app.ts`, verify that CORS middleware permits requests from the
   Vite development server (`http://localhost:5173` or `http://127.0.0.1:5173`) with headers:
   `Content-Type`, `Authorization`.
2. In `apps/dashboard/.env.development`:
   - Set `VITE_DASHBOARD_MODE=live`
   - Set `VITE_TRUSTTRACE_API_BASE_URL=http://localhost:3000/api/v1`
   - Set `VITE_REQUEST_TIMEOUT_MS=5000`
3. Verify that `apps/dashboard/src/data/liveDashboardAdapter.ts` handles:
   - `getSources()` -> `/api/v1/sources`
   - `getEvents()` -> `/api/v1/events`
   - `getBatches()` -> `/api/v1/batches`
   - `getSequenceGaps()` -> `/api/v1/gaps`
   - `getEventDetail()` -> `/api/v1/events/:sourceId/:vaultSequence`
4. Confirm `apps/dashboard` builds cleanly with zero TypeScript errors.

ACCEPTANCE:
Run:
node --test tests/e2e/readiness.test.mjs
npm run build --prefix apps/dashboard
Confirm build produces clean production assets in `apps/dashboard/dist`.
```

---

## Phase 4: Independent CLI Verifier & 3-Witness Demo Script

### Context
The ultimate proof in the hackathon presentation is running the independent auditor CLI (`services/verifier`) to prove that log tampering on the victim host is detected and the original log line is cryptographically verified against the blockchain.

### Prompt 4: Rehearsal Automation & Verification Runbook

```text
[SHARED HEADER]
TASK:
1. Review `backend/src/verification/demoRehearsal.ts` to ensure it executes the complete
   3-witness attack cycle:
   - Step 1: Ingest genuine SSH login event from host.
   - Step 2: Vault seals event in JSONL segment and anchors batch commitment to chain.
   - Step 3: Attacker gains root on host and modifies /var/log/auth.log line.
   - Step 4: Auditor Verifier checks all 3 witnesses:
       * Host Witness: Checks /var/log/auth.log -> FAILS (content altered).
       * Vault Witness: Retrieves verbatim bytes from JSONL -> OK.
       * Blockchain Witness: Validates Merkle proof against anchored root -> OK.
       * Output Verdict: TAMPER_DETECTED, EVIDENCE_RECOVERED.
   - Step 5: Attacker terminates the agent process:
       * Heartbeat freezes; rsyslog continues -> AGENT_KILLED_COLLECTION_GAP.
2. Create a top-level executable script `scripts/run-demo-rehearsal.sh` that:
   - Validates environment variables.
   - Executes the automated 3-witness verification suite.
   - Prints clear, formatted forensic output suitable for presenting to hackathon judges.

ACCEPTANCE:
Run:
node --experimental-strip-types backend/src/verification/demoRehearsal.ts
Confirm output prints:
Host Witness:       FAIL
Vault Witness:      OK
Blockchain Witness: OK
Final Verdict:      TAMPER_DETECTED, EVIDENCE_RECOVERED
```

---

## Phase 5: Live Presentation Runbook (The 5-Minute Demo)

Follow this exact sequence when presenting to the judges:

```text
[0:00 - 1:00] THE PROBLEM & 3-WITNESS ARCHITECTURE
- State: "When an attacker gets root, local logs cannot be trusted. TrustTrace maintains 3 independent witnesses: Host, Off-Host Vault, and Blockchain."
- Show: Terminal with monitored victim machine and running Vault.

[1:00 - 2:00] NORMAL INGESTION & ANCHORING
- Trigger SSH login in victim container:
  ssh testuser@localhost -p 2222
- Show Vault REST API:
  curl -s http://localhost:3000/api/v1/events | jq .
- Show Dashboard in Live Mode:
  Point out new event sequence, SHA-256 payload hash, and ANCHORED status.

[2:00 - 3:15] ATTACK SCENARIO: ROOT COMPROMISE & LOG TAMPERING
- Attacker alters auth.log:
  docker exec -it victim-container sed -i 's/Accepted publickey/Failed password/' /var/log/auth.log
- Run Independent Auditor CLI:
  node --experimental-strip-types services/verifier/src/index.ts --sourceId <id> --sequence 1
- Point out the terminal verdict:
  [Host Witness]: FAIL (Line modified on disk)
  [Vault Witness]: OK (Original uncorrupted bytes preserved in JSONL with fsync)
  [Blockchain Witness]: OK (Merkle proof matches on-chain root)
  VERDICT: TAMPER_DETECTED, EVIDENCE_RECOVERED

[3:15 - 4:15] ATTACK SCENARIO: AGENT TERMINATION (EVASION)
- Attacker kills agent process:
  docker stop agent-container
- Show Collection Gap detection:
  curl -s http://localhost:3000/api/v1/gaps | jq .
- Explain: "Heartbeats stopped while host rsyslog kept running, proving targeted agent evasion."

[4:15 - 5:00] CONCLUSION & JUDGING CRITERIA
- Summarize: "We don't claim logs can never be deleted. We mathematically prove when they were altered, what was lost, and recover the original evidence without trusting the dashboard."
```

---

## Acceptance Verification Matrix

Execute these commands sequentially to guarantee that every discrepancy is resolved:

```bash
# 1. Verify Core Cryptography (Preimages, Merkle trees, EIP-712)
npm test --prefix packages/core

# 2. Verify Smart Contracts (Monotonicity, replay protection, on-chain Merkle checks)
npm test --prefix blockchain

# 3. Verify Backend Ingestion, Storage, Rsyslog TCP & Rehearsals
npm test --prefix backend

# 4. Verify Dashboard REST Adapter & Contract Guardrails
node --test tests/e2e/readiness.test.mjs

# 5. Execute 3-Witness Forensic Attack Rehearsal
node --experimental-strip-types backend/src/verification/demoRehearsal.ts
```
