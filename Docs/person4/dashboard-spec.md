# TRUSTTRACE dashboard specification

## Scope

This document defines the Person 4 dashboard contract for the React, Vite, and Tailwind workstream. The dashboard is an operational view. It must present server-reported results as such and must not be treated as the authority for an integrity finding.

**PROPOSED — REQUIRES TEAM APPROVAL** All data shapes, route names, state vocabulary, and UI-to-service mappings below remain provisional until the interface-freeze gate. The shared contracts package and the crypto test vectors are authoritative once created.

## Route map

| Screen | Purpose | Primary information |
| --- | --- | --- |
| Overview | Establish the current operational picture | source health, events received, batches anchored, unresolved findings |
| Live events | Follow vault-received observations as they arrive | sequence, receipt time, stream, correlation, batch state |
| Evidence explorer | Inspect a preserved record and its recovery status | raw bytes, hashes, host comparison, proof, related batch |
| Verification | Display the Host, Vault, and Blockchain comparison for a selected event or batch | per-witness state, overall verdict, affected sequences |
| Blockchain anchors | Browse commitments without presenting the chain as an event-content store | batch range, root, prior root, transaction, block reference |
| Export and auditor | Download a proof bundle and display local CLI output supplied by the user or a demo fixture | bundle identity, CLI result, direct-RPC source |
| Demo scenarios | Present controlled scenario progress and expected findings | scenario ID, run state, expected and actual status |

The screens may be implemented as routes or a compact route-driven shell. No screen requires a backend mutation beyond the controlled scenario capability agreed with Person 3 and Person 2.

## Shared state vocabulary

Use the following labels consistently in the UI. Values supplied by a service remain service-reported until independently verified.

| State | Meaning in the dashboard |
| --- | --- |
| `VERIFIED` | Evidence and proof matched the relevant commitment under the selected verification run. |
| `CONTENT_MISMATCH` | Compared content differs from preserved or committed evidence. |
| `MISSING_FROM_HOST` | A vault-preserved record was unavailable in the host comparison input. |
| `MISSING_FROM_VAULT` | Requested preserved bytes were unavailable. |
| `BATCH_NOT_ANCHORED` | A matching accepted chain commitment was unavailable. |
| `SEQUENCE_GAP` | Expected continuity could not be established. |
| `INVALID_PROOF` | Inclusion proof, root recomputation, or proof metadata failed validation. |
| `SIGNATURE_INVALID` | A required source signature failed validation. |
| `COLLECTION_GAP` | A liveness or heartbeat window was missed. It does not establish which events occurred in that interval. |
| `UNVERIFIABLE` | Required material or chain access was unavailable. |
| `PENDING` | Receipt, reconciliation, batching, anchoring, or verification has not completed. |

Visual treatment uses green for `VERIFIED`, amber for `PENDING`, delayed delivery, and `COLLECTION_GAP`, red for integrity or proof failures, and grey for unavailable or unverified material. Pair every colour with its text label.

## Screen behaviour

### Overview

Show the selected source, service connection state, current sequence, latest anchored batch, and counts for unresolved mismatch, collection-gap, and unverified findings. A latest-activity strip links to the selected event, batch, or alert.

Empty state explains that no vault-received events are available. Loading state retains stable layout. Connection loss keeps the last rendered snapshot, shows its observation time, and marks live status unavailable.

### Live events

Rows are ordered by vault sequence, with a deliberate indication when arrival or reconciliation is out of order. Each row displays source ID, stream ID, vault sequence, vault receipt time, host time when available, correlation status, and anchoring state. Filters may include source, stream, reconciliation state, batch, and verification state after the API contract supports them.

The live transport appends new events without claiming that a UI message proves durable storage. The durable receipt and batch/anchor fields are supplied by the vault API.

### Evidence explorer and recovery

An event detail view presents the host observation, preserved vault bytes, and chain-proof metadata in separate sections. Raw event bytes use a lossless base64 representation with an explicit decoded-text preview only when decoding is safe for display. The recovery panel identifies evidence as recoverable only when the vault returns the preserved bytes.

For an edited or deleted host record, show the host comparison outcome, the recovered vault payload hash, the inclusion proof status, and the batch transaction reference. A missing host record must be labelled `MISSING_FROM_HOST`, never as proof of a particular missing event beyond the comparison input.

### Three-way verification

The verification screen has three equal witness cards and an overall verdict.

| Witness | Required display |
| --- | --- |
| Host | comparison input availability, host record/hash when supplied, comparison status |
| Vault | vault sequence, receipt time, raw-payload hash, stream observations, recovery availability |
| Blockchain | batch ID, committed root, sequence range, transaction hash, block reference when supplied, direct-RPC verification result when available |

The overall verdict must list which checks produced it and its time. A server-computed result is labelled `Server-reported verification`. An imported auditor result is labelled `Auditor CLI result from direct RPC` only when its output declares direct RPC use.

### Blockchain anchors

List batch commitments by source and sequence range. A batch detail displays the root, previous root or chain-head reference, leaf count, transaction hash, and contract-event or block reference when supplied. The screen must not imply that raw logs are on-chain.

**PROPOSED — REQUIRES TEAM APPROVAL** Checkpoint presentation distinguishes `NOT_BATCHED`, `ANCHOR_PENDING`, `ANCHORED_SERVER_REPORTED`, `RPC_VERIFIED`, `CHAIN_MISMATCH`, and `RPC_UNAVAILABLE`. A transaction hash or block reference supplied by the API supports `ANCHORED_SERVER_REPORTED` only. `RPC_VERIFIED` requires a verifier result that confirms matching direct-RPC contract data.

### Export and auditor

Offer the exact bundle file supplied by the vault export interface. The view lists its manifest ID, source and batch identity, included sequence range, file hashes, and declared chain target. It accepts a machine-readable CLI result for display, preserving the original result text or JSON alongside the rendered summary.

### Demo scenarios

Scenarios are supplied by the agreed Person 3 and Person 2 contract. UI states are `READY`, `RUNNING`, `SUCCEEDED`, `FAILED`, and `UNAVAILABLE`. Each scenario displays its expected evidence outcome, including the limited conclusion for collection gaps.

## Client data boundaries

The dashboard receives indexed event metadata and raw-evidence retrieval results from the vault/API workstream. It does not rebuild cryptographic proofs on its own for the Phase 0 plan. The independent CLI uses `@trusttrace/core` and queries the chain directly. A future browser verifier may reuse that same core only after shared test vectors and browser support are agreed.

The dashboard cannot prove that the host was uncompromised, that a source event was truthful, or what occurred during a collection gap. Recovery applies only to bytes that the vault received and durably preserved before the loss or alteration under investigation. Agent and rsyslog streams are distinct collection paths on the same host, not separate trust domains.

## Required integration states

| Situation | UI behaviour |
| --- | --- |
| Event received but not batched | Event is visible as `PENDING` with no batch reference. |
| Batch exists but anchor pending | Show batch metadata and `PENDING` anchoring state. |
| Anchor exists | Show commitment and transaction reference. |
| Checkpoint has direct-RPC confirmation | Show `RPC_VERIFIED` with verifier time and chain target. |
| Checkpoint cannot be queried | Show `RPC_UNAVAILABLE` and preserve the server-reported anchor reference separately. |
| Host edit or deletion | Preserve the comparison result and make the vault record discoverable. |
| Vault segment tamper | Show failed root or proof validation and retain the last known commitment reference. |
| SQLite/index inconsistency | Identify the index as operational metadata and expose the evidence/chain result supplied by verification. |
| Agent heartbeat gap | Raise a `COLLECTION_GAP` alert with the observed window and stream identity. |
| WebSocket interruption | Mark live transport disconnected while retaining API-loaded history. |
| RPC unavailable to auditor | Render `UNVERIFIABLE` with the RPC endpoint identifier and error category supplied by the CLI. |

## Accessibility and evidence presentation

Use text labels for status, keyboard-accessible evidence selection, copy controls for hashes and transaction references, and readable timestamps with UTC availability. Do not truncate a hash, sequence, or raw-byte representation without an accessible full-value copy path.
