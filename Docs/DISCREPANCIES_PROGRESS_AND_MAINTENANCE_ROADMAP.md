# TRUSTTRACE: Discrepancy Resolution, Progress & Maintenance Roadmap
**The Big Hack 2.0 · Track 02 (Cybersecurity & Blockchain) · Problem B3**  
**Evidence That Survives Root Compromise**  
*Document Version: 1.0.0 | Date: November 25, 2026 | Repository: NeuroNova*

---

## 1. Executive Summary

This document synthesizes the complete transition of the TRUSTTRACE project from initial hackathon prototyping to a hardened, fully integrated, and maintainable enterprise evidence infrastructure. It captures:

1. **Initial Discrepancy Audit:** Forensic gaps between the Problem B3 specifications and the initial repository state.
2. **Resolution Progress:** The implementation history across Phase 0 through Phase 4, resulting in 362/362 passing tests and successful 3-witness attack verification.
3. **Long-Term Maintenance & Updates Roadmap:** The post-demo engineering roadmap focused on CI/CD automation, production telemetry, database maintenance, type safety, and production deployment.

---

## 2. Initial System Discrepancies (Problem B3 Audit)

During the forensic audit comparing the hackathon problem statement against the codebase, eight critical operational and architectural discrepancies were identified:

### Discrepancy 1: Docker Multi-Container Lab Omission
* **Issue:** `lab/compose.yaml` originally contained only the `victim` and `agent` services.
* **Impact:** The central `vault` service was missing, no container network bridging (`trusttrace_net`) existed, and victim rsyslog TCP traffic (`@@vault:5140`) could not resolve or route to the Vault.
* **Root Cause:** Phase 2 multi-container integration had not been consolidated into the compose configuration.

### Discrepancy 2: Network Host & Port Binding Hardcoding
* **Issue:** `backend/src/config/index.ts` hardcoded `127.0.0.1` for `BACKEND_HOST` and `RSYSLOG_HOST`.
* **Impact:** Binding strictly to loopback prevented containers in Docker from communicating across bridge networks, resulting in connection refused errors.
* **Root Cause:** Local development defaults were not overridden with dynamic environment variable checks (`0.0.0.0` in containerized environments).

### Discrepancy 3: Live Blockchain Anchoring vs. Mock Anchoring
* **Issue:** Backend tests relied exclusively on in-memory mocks (`InMemoryAnchorClient`) rather than deploying `EvidenceAnchor.sol` and submitting transactions to an EVM JSON-RPC provider.
* **Impact:** No verifiable on-chain gas receipts, block numbers, or contract addresses were generated.
* **Root Cause:** Absence of an automated local deployment script and live anchoring integration test.

### Discrepancy 4: Dashboard Live REST Disconnect & Missing CORS
* **Issue:** `apps/dashboard/src/data/liveDashboardAdapter.ts` contained a stub error string (`"Person 2 has not approved live REST/WebSocket response mappings; no backend paths or fields are used"`), keeping the dashboard in static demo mode. Furthermore, backend REST endpoints lacked CORS headers for Vite dev server origins (`http://localhost:5173`).
* **Impact:** Switching the dashboard from demo to live mode crashed with network and CORS errors.
* **Root Cause:** Frontend adapter and backend CORS middleware were developed asynchronously without contract reconciliation.

### Discrepancy 5: Absence of Automated 3-Witness Demonstration
* **Issue:** No unified script existed to orchestrate the end-to-end 3-witness attack verification sequence (Host log tampering $\rightarrow$ Vault recovery $\rightarrow$ Blockchain proof $\rightarrow$ Agent kill evasion detection).
* **Impact:** Demonstrating the solution required manual commands across multiple terminals, increasing the risk of operator error during presentations.
* **Root Cause:** Rehearsal routines were split across isolated component unit tests.

### Discrepancy 6: Heartbeat Protocol Wire Envelope Mismatch
* **Issue:** Person 3's Host Agent client expected an HTTP 201/200 envelope with specific fields (`duplicate: true/false`), whereas the Vault heartbeat endpoint originally returned a distinct response schema.
* **Impact:** Agent crashed on heartbeat acknowledgement or triggered continuous retries.
* **Root Cause:** Uncoordinated endpoint schema updates between Person 2's backend and Person 3's agent.

### Discrepancy 7: Lack of Empirical Performance Benchmarks
* **Issue:** The repository lacked an automated benchmarking suite to measure SHA-256 leaf hashing, odd-node Merkle tree scaling, proof verification, and on-chain gas consumption.
* **Impact:** Performance claims (e.g. 500k+ leaves/sec, $O(1)$ gas scaling) could not be verified by evaluators.
* **Root Cause:** Focus had been directed on functional unit tests rather than profiling tools.

### Discrepancy 8: Key Provisioning & Fallback Rigidity
* **Issue:** `backend/src/api/ingest.ts` returned `HTTP 503 Service Unavailable` if `AGENT_PUBLIC_KEY_HEX` was missing or mismatched.
* **Impact:** Ingest rejected chunks if dynamic public key rotational headers were not pre-configured.
* **Root Cause:** Missing fallback wildcard (`*`) key support for controlled lab environments.

---

## 3. Progress on Planned Improvements & Resolution Matrix

All identified discrepancies were systematically resolved across Phases 0 through 4, accompanied by contract alignment and benchmark suite development:

| Phase / Component | Goal & Implementation Details | Status | Verified Artifacts |
| :--- | :--- | :---: | :--- |
| **Phase 0: Environment & Keys** | Dynamic `0.0.0.0` bindings, environment variable overrides for `BACKEND_HOST`, `BACKEND_PORT`, `RSYSLOG_HOST`, `RSYSLOG_PORT`, wildcard fallback key `*`, and canonical lab environment. | **100% DONE** | [`backend/src/config/index.ts`](file:///Users/sukruthasrigadde/stuff/NeuroNova/backend/src/config/index.ts)<br>[`lab/.env.lab`](file:///Users/sukruthasrigadde/stuff/NeuroNova/lab/.env.lab) |
| **Phase 1: Local Blockchain Pipeline** | Real `EvidenceAnchor.sol` deployment script connecting to JSON-RPC, registering Vault Signer address for source, exporting contract address, and live EVM verification. | **100% DONE** | [`blockchain/scripts/deploy-local.ts`](file:///Users/sukruthasrigadde/stuff/NeuroNova/blockchain/scripts/deploy-local.ts)<br>[`lab/contract-address.env`](file:///Users/sukruthasrigadde/stuff/NeuroNova/lab/contract-address.env)<br>[`backend/tests/liveAnchor.test.ts`](file:///Users/sukruthasrigadde/stuff/NeuroNova/backend/tests/liveAnchor.test.ts) |
| **Phase 2: Multi-Container Lab** | Multi-container Docker Compose setup with `victim`, `vault`, and `agent` on isolated bridge `trusttrace_net`, rsyslog TCP forwarding (`@@vault:5140`), and multi-stage backend Dockerfile. | **100% DONE** | [`backend/Dockerfile`](file:///Users/sukruthasrigadde/stuff/NeuroNova/backend/Dockerfile)<br>[`lab/compose.yaml`](file:///Users/sukruthasrigadde/stuff/NeuroNova/lab/compose.yaml)<br>[`lab/victim/rsyslog.conf`](file:///Users/sukruthasrigadde/stuff/NeuroNova/lab/victim/rsyslog.conf) |
| **Phase 3: Live Dashboard & CORS** | CORS middleware in Express app, live REST polling for sources, events, batches, and gaps, independent auditor verifier bridge, and Vite development environment. | **100% DONE** | [`backend/src/api/app.ts`](file:///Users/sukruthasrigadde/stuff/NeuroNova/backend/src/api/app.ts)<br>[`apps/dashboard/src/components/LiveVerification.tsx`](file:///Users/sukruthasrigadde/stuff/NeuroNova/apps/dashboard/src/components/LiveVerification.tsx)<br>[`apps/dashboard/src/data/verifierBridge.ts`](file:///Users/sukruthasrigadde/stuff/NeuroNova/apps/dashboard/src/data/verifierBridge.ts)<br>[`apps/dashboard/.env.development`](file:///Users/sukruthasrigadde/stuff/NeuroNova/apps/dashboard/.env.development) |
| **Phase 4: 3-Witness Demo Script** | Top-level automated demonstration rehearsal executing host tampering, vault corruption check, on-chain Merkle proof validation, and agent kill gap detection. | **100% DONE** | [`scripts/run-demo-rehearsal.sh`](file:///Users/sukruthasrigadde/stuff/NeuroNova/scripts/run-demo-rehearsal.sh)<br>[`backend/src/verification/demoRehearsal.ts`](file:///Users/sukruthasrigadde/stuff/NeuroNova/backend/src/verification/demoRehearsal.ts) |
| **Heartbeat Wire Alignment** | Aligned wire contract between Agent and Vault backend so Agent validates HTTP 200 duplicate envelope safely without modifying Vault storage invariants. | **100% DONE** | [`services/agent/src/vault-heartbeat-client.ts`](file:///Users/sukruthasrigadde/stuff/NeuroNova/services/agent/src/vault-heartbeat-client.ts)<br>100/100 Agent tests passing |
| **Benchmark Suite & Report** | Created comprehensive micro-benchmark suite measuring leaf hashing, odd-node tree scaling (up to 10k leaves), proof generation/verification, Ed25519 ops, and gas amortization. | **100% DONE** | [`scripts/benchmark.ts`](file:///Users/sukruthasrigadde/stuff/NeuroNova/scripts/benchmark.ts)<br>[`Docs/BENCHMARK_REPORT.md`](file:///Users/sukruthasrigadde/stuff/NeuroNova/Docs/BENCHMARK_REPORT.md)<br>`npm run benchmark` |
| **Cloud Deployment Blueprint** | Infrastructure-as-code configuration for Render deployment with persistent volume mount, provisioned agent public key, and secure vault signer key pair. | **100% DONE** | [`render.yaml`](file:///Users/sukruthasrigadde/stuff/NeuroNova/render.yaml) |

---

## 4. Current Verification Baseline

The complete monorepo test suite and live multi-witness rehearsal are verified and passing:

### Test Suite Matrix (362 / 362 Tests Passing)
- **Core Cryptography (`@trusttrace/core`):** 61 / 61 passed (`npm run test:core`)
- **Blockchain Smart Contracts (`blockchain`):** 9 / 9 passed (`npm run test:blockchain`)
- **Evidence Vault Backend (`backend`):** 72 / 72 passed (`npm run test:backend`)
- **Verifier Service (`services/verifier`):** 73 / 73 passed (`npm test --prefix services/verifier`)
- **Dashboard UI (`apps/dashboard`):** 47 / 47 passed (`npm test --prefix apps/dashboard`)
- **Host Agent Daemon (`services/agent`):** 100 / 100 passed (`npm test --prefix services/agent`)

### Automated Attack Rehearsal Verdicts (`bash scripts/run-demo-rehearsal.sh`)
- **Scenario 1 (Host Log Tampering):** `TAMPER_DETECTED, EVIDENCE_RECOVERED` (Pass)
- **Scenario 2 (Vault Tampering Attempt):** `VAULT_CORRUPTED` (Pass)
- **Scenario 3 (Agent Kill / Silence):** `AGENT_KILLED_COLLECTION_GAP` (Pass)

### Measured Performance Summary
- **Canonical Leaf Hashing:** 489,935 leaves/sec (74.29 MB/s)
- **Merkle Tree Build (10,000 leaves):** 14.22 ms (703,398 leaves/sec)
- **Merkle Proof Verification:** 14.56 µs/proof (68,701 checks/sec)
- **Smart Contract Gas (Chained Batch):** 163,867 gas flat (re-measured under Solidity 0.8.19 / Paris EVM; $\approx$ 16.39 gas/event for 10,000 events)

---

## 5. Post-Demo Maintenance, Hardening & Updates Roadmap

With demo milestones successfully completed, the project transitions to long-term reliability, code hygiene, and enterprise production readiness.

### Priority 1: Monorepo Tooling & CI/CD Hardening

1. **Unified Root Test & Build Pipeline (`package.json`):**
   - **Problem:** Currently, `npm run test:all` only tests `core`, `blockchain`, and `backend`, omitting `agent`, `verifier`, and `dashboard`.
   - **Target:** Expand root `package.json` with unified scripts:
     - `npm run test:all` $\rightarrow$ Executes all 362 tests across all 6 workspaces.
     - `npm run typecheck:all` $\rightarrow$ Strict TypeScript compilation across all packages.
     - `npm run build:all` $\rightarrow$ Production builds for `core`, `backend`, `verifier`, and `dashboard`.

2. **Automated GitHub Actions Workflow (`.github/workflows/ci.yml`):**
   - **Problem:** No automated CI workflow currently validates incoming commits or pull requests.
   - **Target:** Establish a matrix GitHub Actions workflow on Node.js 22 running:
     - Dependency install with frozen lockfile.
     - Typecheck across all workspaces.
     - Standalone contract compilation & tests.
     - Full test suite execution across all 6 workspaces.

3. **Git & Secret Hygiene:**
   - **Problem:** SQLite runtime artifacts and sensitive files risk accidental commit. Hardcoded development keys exist in `render.yaml`.
   - **Target:**
     - Update [`.gitignore`](file:///Users/sukruthasrigadde/stuff/NeuroNova/.gitignore) to exclude `*.sqlite3`, `*.sqlite3-wal`, `*.sqlite3-shm`, `data/`, and `vault-data/`.
     - Sanitize [`render.yaml`](file:///Users/sukruthasrigadde/stuff/NeuroNova/render.yaml) by switching `VAULT_SIGNER_PRIVATE_KEY` to secret references (`sync: false`).

---

### Priority 2: Backend & Vault Operational Maintenance

1. **Structured Logging & Observability:**
   - **Problem:** Backend handlers currently rely on raw `console.log` / `console.error` calls.
   - **Target:** Implement structured JSON logging (e.g. `pino`) with standard log levels (`debug`, `info`, `warn`, `error`).
   - **Target:** Expose a Prometheus `/metrics` endpoint tracking:
     - Log ingestion rate (Events Per Second).
     - Merkle batch sealing duration.
     - On-chain anchor transaction latency and gas consumption.
     - Active agent heartbeat gap counters.

2. **Storage Compaction & Retention:**
   - **Problem:** Append-only JSONL files grow unbounded without an automated rotation policy.
   - **Target:** Implement segment archiving and compression (gzip) for segments older than configurable thresholds (e.g. CERT-In 180-day compliance).
   - **Target:** Periodic SQLite maintenance task running `PRAGMA optimize` and `VACUUM`.

---

### Priority 3: Type Safety & Code Quality

1. **Strict TypeScript & Cast Reduction:**
   - **Problem:** Select utility routines in `services/verifier` and `backend/src/api/read.ts` use loose type assertions (`any`, unchecked index signatures).
   - **Target:** Replace all remaining `any` types with explicit Zod or TypeScript schemas, eliminating compiler warnings.

2. **Dead Code & Scratch Audit:**
   - **Problem:** Transient experiment scripts from earlier hackathon phases clutter scratch folders.
   - **Target:** Archive obsolete scripts and keep the repository root clean.

---

### Priority 4: Production Network Integration

1. **Persistent Quai Network Orchard Anchoring:**
   - **Problem:** Smart contract anchoring is currently validated against local EVM Hardhat (Chain ID 31337).
   - **Target:** Wire relayer and anchor configuration to persistent Quai Orchard testnet (Chain ID 15000, Cyprus-1 zone `0x00` address prefix) with live transaction submission and receipt reconciliation.

2. **Multi-Tenant Dashboard Enhancements:**
   - **Target:** Expand [`apps/dashboard`](file:///Users/sukruthasrigadde/stuff/NeuroNova/apps/dashboard) to support multi-source filtering, custom date-range queries, and one-click cryptographic bundle exports for forensic auditors.
