# Person 4 acceptance checklist and demo gates

## Status

**PROPOSED — REQUIRES TEAM APPROVAL** This is the Person 4 integration checklist derived from the project blueprint and four-person action plan. Final command names, scenario IDs, test fixtures, timing limits, and expected enums require agreement with Persons 1, 2, and 3.

## Interface-freeze gate

- [ ] Person 1 publishes the canonical event bytes, leaf and node domain tags, hash algorithm, Merkle odd-leaf handling, proof format, commitment digest/signature format, contract ABI, and test vectors.
- [ ] Person 2 publishes the ingest and dashboard read contracts, vault sequence ownership, receipt/durable-ack semantics, batch metadata, error/status vocabulary, export response, and WebSocket delivery model.
- [ ] Person 3 publishes source and stream IDs, signed chunk and heartbeat behaviour, host-comparison input format, controlled scenario IDs, and expected attack outputs.
- [ ] Person 4 maps every UI and CLI state to the agreed vocabulary and records any unavailable integration field as unavailable rather than synthesising it.
- [ ] Person 1’s canonical encoding and Merkle test vectors produce identical results in the agent, vault, contract-related verification path, and auditor CLI.

## Dashboard acceptance

- [ ] A real SSH authentication event appears in the live feed with vault sequence, vault receipt time, source ID, and stream ID.
- [ ] Agent and rsyslog observations appear as distinct stream identities and reconciliation status is visible.
- [ ] An event moves through received, batched, and anchored states without the UI implying an anchor before it exists.
- [ ] A batch view displays its range, Merkle root, transaction reference, and previous-root or continuity reference when supplied.
- [ ] The verification view renders Host, Vault, and Blockchain separately, an overall verdict, affected sequences, and verification time.
- [ ] Edited and deleted host records show distinct comparison outcomes and permit retrieval of preserved vault evidence when available.
- [ ] A heartbeat timeout renders `COLLECTION_GAP` with stream identity and observed window.
- [ ] Live-transport loss renders a disconnected state while preserving the latest API-loaded history.
- [ ] Status colour is always accompanied by its text label and hashes/transaction references have an accessible full-value copy path.

## Evidence and verifier acceptance

- [ ] Exported bundle includes the manifest, exact raw evidence bytes, event and batch metadata, proof material, file hashes, algorithm/version references, chain target, and contract reference.
- [ ] The auditor CLI runs on the bundle without dashboard access and queries the chain through a supplied read-only RPC endpoint.
- [ ] The CLI recomputes payload hashes and the Merkle root or inclusion proof using `@trusttrace/core`.
- [ ] The CLI accepts the approved valid inclusion-proof vector and rejects an altered proof node, altered leaf, incorrect leaf count, and incorrect expected root.
- [ ] The CLI compares source ID, batch ID, root, and sequence range against direct contract data.
- [ ] A known-good anchored bundle returns `VERIFIED` with a machine-readable result.
- [ ] A modified exported raw-evidence file is rejected with an integrity result.
- [ ] A modified proof, root, manifest hash, sequence range, chain ID, or contract address is rejected.
- [ ] An unavailable RPC reports `UNVERIFIABLE` and never reports a chain verification based only on bundle metadata.
- [ ] Optional host comparison preserves the difference between altered content, missing host material, and no supplied host comparison.

## End-to-end and attack acceptance

- [ ] A real SSH event travels from the controlled victim through the vault to an anchored local-chain batch and is visible in the dashboard.
- [ ] Modify a host log after vault receipt. The dashboard reports the host mismatch and the CLI verifies the preserved vault bytes against the chain.
- [ ] Delete selected host records after vault receipt. The dashboard identifies affected comparison records and offers recovered evidence when it exists.
- [ ] Wipe the host log in the controlled lab. The result records host loss against available vault history without inventing events absent from the vault.
- [ ] Tamper with a controlled vault segment. Root or proof recomputation fails against the anchored commitment.
- [ ] Tamper with the SQLite index. The demo shows index inconsistency or rebuild evidence without using the index as an integrity authority.
- [ ] Kill the Node agent. The dashboard shows a liveness gap and the rsyslog path outcome reported by reconciliation.
- [ ] Interrupt one collection stream while the other continues. The dashboard displays the divergence state.
- [ ] Attempt a duplicate, replayed, invalid-signature, overlapping, or continuity-invalid anchor. The contract-side result is visible through the API/UI without front-end-only validation.
- [ ] Run an E2E smoke test covering normal ingest, anchor display, host tamper recovery, and independent CLI verification.
- [ ] Run an E2E check with the backend unavailable or a failed API request. The dashboard exposes `ERROR` or `STALE`, preserves prior data only with its observation time, and does not render a successful verification claim.
- [ ] Run an E2E check with WebSocket disconnect and reconnect. The dashboard marks the live feed stale, refetches agreed resources, and tolerates duplicate or out-of-order frames according to the approved contract.

## Demo runbook acceptance

- [ ] Opening statement identifies Host, Evidence Vault, and Blockchain as distinct witnesses and identifies the dashboard as operational rather than authoritative.
- [ ] Normal flow shows controlled SSH activity, vault receipt sequence, batch root, and anchored transaction.
- [ ] Host tamper flow shows the comparison outcome, recovered evidence, proof, and matching chain commitment.
- [ ] Vault/index tamper flow shows a failed integrity check.
- [ ] Agent-kill flow shows the liveness gap and accurately describes the two collection paths as separate processes on one potentially compromised host.
- [ ] Closing flow exports the bundle and runs the CLI against direct RPC without relying on dashboard/API verification output.
- [ ] A known-good bundle, known-good anchor, and backup demo capture are retained before rehearsal.
- [ ] Three timed rehearsals complete from the agreed clean-start procedure.

## Approval record

| Decision | Required approvers |
| --- | --- |
| Canonical crypto/proof and on-chain lookup conventions | Person 1 |
| API, WebSocket, export, sequence, and status/error conventions | Person 2 |
| Host input, liveness, scenario, and expected-outcome conventions | Person 3 |
| Dashboard mapping, CLI presentation, E2E smoke scope, and demo runbook | Person 4 with Persons 1–3 integration review |
