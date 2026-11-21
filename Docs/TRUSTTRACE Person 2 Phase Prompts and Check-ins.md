# TRUSTTRACE: Person 2 Phase Prompts and Check-ins

The Big Hack 2.0 · Problem B3 · For Person 2 (Vault Backend, Storage, Ingestion, Batching & REST APIs) · Status: Phase 5 & 6 Ready

## Purpose

This document turns the remaining plan of action and compatibility requirements from `TRUSTTRACE_Person2_Progress_and_POA.md` into ready-to-paste coding-assistant prompts for Person 2's final phases (Phases 5 and 6), together with the exact check-in messages to send to Persons 1, 3, and 4. Every prompt ends with an acceptance test to run and paste back for review. Nothing here claims that any code works until its command output has been verified.

---

## Frozen Decisions & Vault Architectural Invariants

1. **Vault Sequence Ownership:**
   `vaultSequence` is strictly source-local, monotonic uint64 (represented as a decimal string in JSON/API), allocated sequentially starting at 1. Host Agent HTTP chunks and rsyslog TCP observations share the source sequence space. Sequences must never be reused, even across restarts or partial write failures.

2. **Durable Write Before Receipt:**
   Every event chunk must be appended to the active append-only JSONL segment and flushed to disk (`fsync`) before any HTTP 200/201 receipt is returned to the client.

3. **Raw Byte Preservation (Never Parse or Normalize):**
   Raw event bytes must be preserved byte-for-byte in their original binary format (decoded from Base64). No whitespace trimming, no normalization, and no stripping of the terminating newline (`\n` / `0x0A`). Merkle leaf preimage hashing relies on the exact raw bytes ($46 + N$ format).

4. **Signer Key Custody & Relayer Separation:**
   The EIP-712 Vault Signer private key resides exclusively in the vault environment (e.g. `/run/secrets/vault-signer.key`). It is never exposed in Git, on the monitored host, or to the relayer. The Quai/EVM relayer is an independent funded account (`0x00...` in-zone Cyprus-1 prefix for Quai).

5. **JSONL as Authority, SQLite as Index:**
   The append-only JSONL log is the single source of truth. SQLite is a throwaway, rebuildable index. If SQLite fails or is deleted, it must be reconstructed from JSONL upon startup without data loss.

6. **Status Code Semantics:**
   RPC network failures or timeouts must report `UNVERIFIABLE`. Under no circumstances should an RPC or connection error be misreported as `CHAIN_MISMATCH` or `TAMPERED`.

---

## Shared Header

Paste this at the top of every prompt below:

```
PROJECT: TRUSTTRACE, The Big Hack 2.0, problem B3. TypeScript monorepo. I am Person 2
(branch personb), owning the Evidence Vault backend (storage engine, JSONL append-only,
rebuildable SQLite index, Ed25519 agent ingestion, rsyslog TCP receiver, Merkle batcher,
Quai/EVM anchoring worker, and REST read APIs).
LOCKED: vaultSequence is source-local monotonic uint64 decimal string; durable fsync to JSONL
before returning HTTP receipt; raw payload bytes preserved untouched including terminating LF;
JSONL is authoritative, SQLite is rebuildable cache; EIP-712 vault signer key is separate from
relayer; Quai Orchard Cyprus-1 zone prefix is 0x00, Chain ID 15000; RPC errors report
UNVERIFIABLE, never CHAIN_MISMATCH.
RULES: do not alter shared @trusttrace/core crypto without Person 1 agreement; no secrets in
Git; keep rsyslog unsigned path separate from signed agent chunks; list files changed; end
with exact verification commands and the output to paste back.
```

---

## Phase 5a (H16): Frozen Interface Compatibility & Cryptographic Audit

### Prompt 5a.1: Host Agent `fileGeneration` Ingestion Compatibility

```
[SHARED HEADER]
TASK: Complete the Host Agent ingestion compatibility in backend/src/api/ingest.ts and backend/src/storage/evidenceStore.ts.
1. In authenticated ingest (POST /api/v1/logs/ingest), require fileGeneration (string) from request body alongside fileIdentity.
2. Construct the AgentChunk object for @trusttrace/core/agent verifyAgentChunk passing:
   { sourceId, deliveryId, streamId, fileIdentity, fileGeneration, byteOffset, observedAt, payload }.
3. Ensure the Ed25519 signature verifies against the 8-field preimage using vectors/agent-chunk.json.
4. Persist fileGeneration in the append-only JSONL record and SQLite index column file_generation.
5. Verify duplicate deliveryId retry returns original receipt without duplicating records or reallocating sequences; conflicting deliveryId reuse returns HTTP 409.
6. Keep rsyslog TCP receiver path separate (unsigned, fileGeneration null/omitted).
ACCEPTANCE: Run `npm --prefix backend test tests/ingest.test.ts` and paste passing output showing all chunk vectors pass verification.
```

### Prompt 5a.2: Raw Payload Byte-for-Byte Preservation Test (Terminating LF)

```
[SHARED HEADER]
TASK: Implement a focused regression test in backend/tests/evidenceStore.test.ts proving exact raw payload byte preservation.
1. Create a test case appending raw payloads containing mixed binary bytes, UTF-8 strings, and explicit trailing newlines (0x0A) and CRLF (0x0D 0x0A).
2. Read the raw persisted JSONL file directly from disk, parse the rawEventBytesBase64 field, decode from Base64, and assert strict byte-by-byte Buffer equality with the original input.
3. Confirm that EvidenceBatchManager passes this exact unmodified Buffer into @trusttrace/core encodeLeaf so that the leaf preimage (46 + N bytes) matches P1's canonical hashing format.
ACCEPTANCE: Run `npm --prefix backend test tests/evidenceStore.test.ts` and paste passing output showing the terminating LF survives JSONL persistence byte-for-byte.
```

### Prompt 5a.3: Heartbeat Durability and Core Preimage Audit

```
[SHARED HEADER]
TASK: Audit and harden the Heartbeat ingestion path in backend/src/api/heartbeat.ts and backend/src/storage/evidenceStore.ts.
1. Confirm import and usage of verifyAgentHeartbeat from @trusttrace/core/agent.
2. Ensure the signed heartbeat preimage fields match: { sourceId, deliveryId, streamId, sequence, observedAt }.
3. Enforce strict sequence monotonicity per sourceId (heartbeat sequence must increment).
4. Persist heartbeats into heartbeat-*.jsonl and the SQLite heartbeat cache.
5. Handle retries with identical deliveryId idempotently; reject conflicting deliveryId reuse.
ACCEPTANCE: Run `npm --prefix backend test tests/heartbeat.test.ts` (or backend suite) and paste passing output confirming heartbeat verification and replay semantics.
```

### Prompt 5a.4: Quai Relayer & Signer Key Separation Audit

```
[SHARED HEADER]
TASK: Audit Quai Network Orchard anchoring configuration in backend/src/blockchain/AnchoringWorker.ts and config/storage.ts.
1. Confirm that contract deployments and network configuration are read from @trusttrace/core/deployments.
2. Confirm Quai Orchard target: Cyprus-1 zone, Chain ID 15000 (0x3a98), RPC https://orchard.rpc.quai.network/cyprus1.
3. Assert that the Quai Relayer address has the mandatory Cyprus-1 0x00 prefix using assertCyprus1Address from @trusttrace/core/quai.
4. Verify strict key separation: the Vault EIP-712 batch signer key is loaded from SECRETS_DIR/vault-signer.key, while the Quai Relayer key is loaded from QUAI_RELAYER_KEY. Under no circumstances may the relayer key sign commitments or the signer key pay gas.
ACCEPTANCE: Run `npm --prefix backend test tests/anchoring.test.ts` and paste output confirming Quai configuration and key separation.
```

### Check-in after Phase 5a (Send to P1, P3, P4)

```
To P1: Phase 5a compatibility complete. Ingestion strictly matches your 8-field Ed25519 chunk preimage with fileGeneration and terminating LF intact. Quai anchoring verified against deployments.json, Cyprus-1 Chain ID 15000, 0x00 relayer address, and separate EIP-712 signer key.
To P3: Ingest endpoint POST /api/v1/logs/ingest requires fileGeneration string. Ensure Host Agent includes fileGeneration in chunk payloads and signs the 8-field preimage. Heartbeat endpoint POST /api/v1/agents/heartbeat enforces monotonic sequence.
To P4: REST APIs are ready for live dashboard connection. All data formats match Docs/person2/REST_API_CONTRACT.md.
```

---

## Phase 5b (H16.5): Full Regression & Verification Consolidation

### Prompt 5b: Backend Typecheck and Regression Suite

```
[SHARED HEADER]
TASK: Consolidate and execute the full backend regression suite.
1. Run backend TypeScript typecheck with zero errors.
2. Run all backend unit and integration tests (storage, recovery, batching, anchoring, verification, and REST read APIs).
3. Confirm that no tests depend on unmocked external network access.
4. Verify that the SQLite auto-rebuild test correctly restores all source sequences, batches, and delivery IDs from JSONL segments.
ACCEPTANCE: Run `npm --prefix backend run typecheck && npm --prefix backend test && npm test` and paste output showing all backend tests and all 61 core crypto tests passing.
```

### Check-in before Gate G5 (H17)

```
Gate G5 readiness from Person 2:
- Backend typecheck: PASS
- Backend unit suite: ALL PASS
- Core crypto suite: 61/61 PASS
- Published commit on personb: <commit_hash>
- Working tree: clean
- Blockers: none. Ready for Person 4 live dashboard hookup and Person 3 lab stream.
```

---

## Phase 5c (H17): Live Cross-Team Integration

### Prompt 5c.1: Live Dashboard Integration (with Person 4)

```
[SHARED HEADER]
TASK: Verify live REST integration between backend and apps/dashboard.
1. Start backend service on localhost:3000.
2. Connect apps/dashboard liveDashboardAdapter to backend endpoints:
   - GET /api/v1/sources
   - GET /api/v1/events?limit=50
   - GET /api/v1/events/:sourceId/:vaultSequence
   - GET /api/v1/batches
   - GET /api/v1/gaps
3. Confirm pagination: verify limit and cursor return items and nextCursor correctly.
4. Confirm /api/v1/checkpoints returns empty list [] gracefully without crashing the UI.
5. Confirm decimal string uint64 sequences and 0x-prefixed hex hashes render cleanly in the UI.
ACCEPTANCE: Curl each endpoint against live backend; paste response JSON for sources, events, batches, and gaps showing real data flow.
```

### Prompt 5c.2: Monitored Host Agent Ingestion Hookup (with Person 3)

```
[SHARED HEADER]
TASK: Verify end-to-end ingestion from Person 3's Docker victim lab.
1. Start backend with Ingestion Receiver listening on port 3000 and rsyslog receiver on TCP port 5140.
2. Ingest real SSH auth log chunks emitted by Person 3's Node agent:
   - Validate Ed25519 signature
   - Assign vaultSequence
   - Check durable JSONL write
   - Return 201 receipt
3. Ingest parallel rsyslog stream over TCP port 5140:
   - Parse octet-counted syslog frames
   - Assign independent vaultSequence in the shared source sequence space
4. Trigger batch construction and confirm both streams appear in the resulting Merkle batch.
ACCEPTANCE: Paste backend log output showing successful receipt of signed chunk, receipt of rsyslog frame, and batch Merkle root creation.
```

---

## Phase 6 (H17–H20): End-to-End Demo Rehearsal & Defence Preparation

### Prompt 6a: 5-Minute Attack Scenario Rehearsal

```
[SHARED HEADER]
TASK: Execute and validate the 5-minute hackathon demo scenario across all 3 witnesses.
1. Normal Flow: Ingest real SSH login event -> verify receipt -> create Merkle batch -> anchor to local EVM / Quai.
2. Attack 1 (Host Log Tampering): Person 3 deletes/alters local /var/log/auth.log. Run EvidenceVerifier:
   - Host check: FAIL
   - Vault check: OK (original raw event retrieved from JSONL)
   - Blockchain check: OK (Merkle proof matches on-chain root)
   - Final verdict: TAMPER_DETECTED, EVIDENCE_RECOVERED.
3. Attack 2 (Vault Tampering Attempt): Deliberately modify a byte in vault JSONL or SQLite.
   - Run verification -> Merkle leaf hash diverges -> on-chain root mismatch -> VAULT_CORRUPTED detected.
4. Attack 3 (Agent Kill): Stop agent -> show heartbeat sequence freeze -> collection gap alert in /api/v1/gaps while rsyslog continues or flags silence.
ACCEPTANCE: Paste EvidenceVerifier terminal output for all 3 scenarios showing exact expected verdicts.
```

### Prompt 6b: Defence Preparation (Technical Q&A)

```
[SHARED HEADER]
TASK: Prepare precise technical explanations and answers for judges from Person 2's implementation.
Write concise, unembellished answers to:
1. Why is append-only JSONL the source of truth rather than SQLite or a relational database?
   (Answer: Write-ahead append-only log with fsync guarantees immutability and simple forensic reproducibility. SQLite is strictly a derived index that can be dropped and rebuilt at any time.)
2. How does the Vault prove it didn't fabricate an event?
   (Answer: The Vault verifies the Host Agent's Ed25519 signature on the 8-field preimage before storing. The original signature and raw bytes are preserved so auditors can independently verify host attestation.)
3. What happens if the blockchain RPC is down?
   (Answer: The verifier fails safe to UNVERIFIABLE. It never falsely claims CHAIN_MISMATCH or TAMPERED without definitive proof.)
4. How do you distinguish a network failure from an attacker killing the collection agent?
   (Answer: Heartbeats provide liveness tracking. An agent kill results in a silence window with no heartbeats, while rsyslog or network metrics reveal host reachability.)
ACCEPTANCE: Output defense cheat sheet document ready for rehearsal review.
```

---

## Gate Check-in Template

Send at each gate milestone:

```
Gate <G#> status from Person 2:
- Done: <list of completed components / fixes>
- Verified by pasted output: <test names and pass counts>
- Blocked: <none or specific dependency>
- Interface changes: <none or list with reasons>
- Needs from you by <hour>:
  - P1: <contract / crypto needs>
  - P3: <ingest chunk / lab needs>
  - P4: <REST / UI needs>
```

---

## Working Rules

1. **Commit small, push often:** Push working changes to `personb` with clear commit messages (`feat(backend): ...`, `fix(ingest): ...`).
2. **Never change `@trusttrace/core` unilaterally:** Any cryptographic change requires agreement from Person 1.
3. **No secrets in Git:** Never commit private keys, `.env` files, or vault signer secrets.
4. **Honest reporting:** If a feature (like WebSocket push or ZIP export) is deferred or mocked, state it openly as proposed/pending.
5. **Paste before claiming:** No task is complete until the acceptance test command has been executed and its output verified.
