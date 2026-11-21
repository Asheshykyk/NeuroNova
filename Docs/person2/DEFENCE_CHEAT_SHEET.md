# TRUSTTRACE: Person 2 Defence Technical Q&A & Architecture Cheat Sheet

The Big Hack 2.0 · Problem B3 · Track 02  
**Role:** Person 2 — Evidence Vault Backend (Storage Engine, Ingestion, Batching, Anchoring & REST APIs)  
**Branch:** `personb` · **Status:** Phase 6 Defence Ready  

---

## 1. Core Judge Q&A (Frozen Invariants)

### Q1: Why is append-only JSONL the source of truth rather than SQLite or a relational database?
> **Answer:** Write-ahead append-only log with explicit `fsync` guarantees cryptographic immutability, zero-overhead durability, and simple forensic reproducibility. An append-only file cannot be silently updated or reorganized. SQLite is strictly a derived, disposable index for fast query lookups. If SQLite is corrupted or deleted, the Vault automatically reconstructs all source sequences, delivery IDs, and batch mappings from the authoritative JSONL segments on startup without data loss.

### Q2: How does the Vault prove it didn't fabricate an event?
> **Answer:** The Vault verifies the Host Agent’s Ed25519 digital signature across the 8-field preimage (`sourceId`, `deliveryId`, `streamId`, `fileIdentity`, `fileGeneration`, `byteOffset`, `observedAt`, `payload`) before persisting any record. The verbatim raw bytes and original attestation metadata are preserved byte-for-byte in the Vault. Auditors independently re-verify the Host Agent's signature against the trusted public key, proving the record originated on the monitored host and was not fabricated by the Vault.

### Q3: What happens if the blockchain RPC is down?
> **Answer:** The verifier fails safe to `UNVERIFIABLE`. Under no circumstances is a connection timeout, network partition, or RPC error misreported as `CHAIN_MISMATCH` or `TAMPERED`. A tampering verdict requires definitive cryptographic proof of divergent data. When external dependencies are unreachable, the system reports `UNVERIFIABLE` with safe machine-readable reason codes (`RPC_UNAVAILABLE`).

### Q4: How do you distinguish a network failure from an attacker killing the collection agent?
> **Answer:** Through dual-stream correlation and dedicated agent heartbeats:
> 1. **Heartbeat Liveness:** Monitored agents emit signed, strictly monotonic heartbeats on a fixed interval (e.g., 5 seconds). An agent kill immediately freezes the heartbeat sequence, triggering a `COLLECTION_GAP` alert in `/api/v1/gaps`.
> 2. **Secondary Corroboration:** The parallel, unauthenticated rsyslog TCP stream (port 5140) operates independently of the agent process. If rsyslog frames continue arriving while agent heartbeats freeze, the host network is healthy and the agent process was specifically targeted and terminated.

---

## 2. Technical Deep-Dive Q&A

### Q5: How are dual ingestion streams handled in the Vault?
> **Answer:**
> - **Primary Stream (Host Agent HTTP):** Authenticated via Ed25519 signatures covering 8 fields (`POST /api/v1/logs/ingest`). Guarantees host-origin integrity, deduplication via `deliveryId`, and replay resistance.
> - **Secondary Stream (Rsyslog TCP):** Fast, kernel-level observation via RFC 5425 octet-counted framing on TCP port 5140. Bypasses the local agent daemon to guard against agent tampering.
> - **Shared Sequence Space:** Both streams share the source-local monotonic `vaultSequence` space, ensuring unambiguous chronological total ordering and cross-stream correlation.

### Q6: Why are raw payload bytes preserved untouched including terminating `0x0A`?
> **Answer:** Normalizing, trimming whitespace, or stripping newlines alters the cryptographic leaf preimage. In TRUSTTRACE, canonical leaf preimages use the locked $46 + N$ format:
> $$\text{preimage} = \text{0x00} \parallel \text{version (1B)} \parallel \text{sourceId (32B)} \parallel \text{vaultSequence (8B)} \parallel \text{length (4B)} \parallel \text{rawEventBytes (NB)}$$
> Any modification—even stripping a terminating `\n` (`0x0A`)—causes SHA-256 leaf hash divergence, breaking the Merkle inclusion proof against the on-chain root.

### Q7: How does cryptographic key separation work between the Vault and Relayer?
> **Answer:** Privileges are strictly isolated across process and network boundaries:
> - **Vault EIP-712 Signer:** Holds the EIP-712 private key (loaded exclusively from `/run/secrets/vault-signer.key`). It signs batch commitment digests off-chain and **never pays gas or connects to the network**.
> - **Quai Relayer Account:** Holds a funded Quai Orchard account (`0x00...` Cyprus-1 in-zone prefix). It pays gas to invoke `anchorBatch()` on the smart contract and **never possesses signing authority over batch commitments**.
> - An assertion in `backend/src/config/index.ts` enforces that signer and relayer keys are never identical.

### Q8: How does the Vault handle retries and idempotency?
> **Answer:** Every chunk carries a client-generated UUID `deliveryId`:
> - **Identical Retry:** Replaying an identical `deliveryId` with identical payload and signed metadata returns the original receipt with HTTP 200 and `"duplicate": true`, allocating zero new sequences and performing zero duplicate disk writes.
> - **Conflicting Reuse:** Reusing an existing `deliveryId` with altered payload or metadata returns HTTP 409 Conflict, preventing payload substitution attacks.

### Q9: How are batches anchored to Quai Network Orchard?
> **Answer:**
> - Contract address, chain ID (`15000` / `0x3a98`), and zone (`Cyprus-1`) are resolved directly from `@trusttrace/core/deployments`.
> - Addresses are validated using `assertCyprus1Address` to guarantee the mandatory `0x00` in-zone prefix.
> - Relayer submits EIP-712 commitments consisting of `{ sourceId, sequenceStart, sequenceEnd, leafCount, merkleRoot, previousCheckpointHash }`.

---

## 3. Cryptographic Verification & Status Reference

| Status / Verdict | Meaning | Condition |
|---|---|---|
| `VAULT_PERSISTED` | Sealed in Vault JSONL | Evidence written and fsynced to disk; not yet batched |
| `ANCHOR_PENDING` | Batch created; pending chain | Merkle tree generated; submitted to relayer or waiting for mining confirmation |
| `ANCHORED` | Fully confirmed on blockchain | Transaction mined; on-chain root matches local Merkle root |
| `ANCHOR_FAILED` | Relayer / chain submission failed | Transaction reverted or dropped; retried up to max configured limit |
| `UNVERIFIABLE` | Insufficient information / RPC down | Network error, missing bundle, or unconfigured verifier dependency (fails safe) |
| `CHAIN_MISMATCH` | Cryptographic tampering detected | Merkle root or commitment fields diverge from immutable on-chain record |
| `TAMPER_DETECTED, EVIDENCE_RECOVERED` | Host log altered; evidence recovered | Host check fails, but Vault raw bytes and on-chain Merkle proof verify |
| `VAULT_CORRUPTED` | Vault internal data modified | Recomputed leaf hash diverges from batch mapping / on-chain root |
| `AGENT_KILLED_COLLECTION_GAP` | Host agent stopped / silenced | Heartbeat sequence frozen while host activity or silence window detected |

---

## 4. REST API Endpoint Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Health check (`{ "status": "ok" }`) |
| `POST` | `/api/v1/logs/ingest` | Ingest Ed25519 signed chunk (8-field preimage) |
| `POST` | `/api/v1/agents/heartbeat` | Ingest signed monotonic heartbeat |
| `GET` | `/api/v1/sources` | Discovered sources list with sequence counts & timestamps |
| `GET` | `/api/v1/events` | Cursor-paginated events (limit, cursor, sourceId filter) |
| `GET` | `/api/v1/events/:sourceId/:vaultSequence` | Event detail with raw bytes & Merkle inclusion proof |
| `GET` | `/api/v1/batches` | Batches list with EIP-712 commitment, Merkle root & signatures |
| `GET` | `/api/v1/checkpoints` | Checkpoints endpoint (returns `[]` gracefully) |
| `GET` | `/api/v1/gaps` | Unobserved sequence / collection gaps |
