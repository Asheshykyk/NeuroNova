# TRUSTTRACE Person 4 team interface approval

## Purpose

This record lists the decisions required before Person 4 implements the dashboard,
auditor CLI, and end-to-end tests. It reflects the current repository audit.
Person 2 confirms implementation of `POST /api/v1/logs/ingest`; Event, source,
batch, checkpoint, and gap read APIs and WebSocket support remain unimplemented
unless separately approved and documented.

**PROPOSED — REQUIRES TEAM APPROVAL** No item below is a final interface until its owner records an approved value in the shared implementation or contract documentation.

## Current confirmed and pending status

### Confirmed implementation

- [x] Person 2 implements `POST /api/v1/logs/ingest`. This is confirmed ingest
  implementation, not approval of any dashboard read contract.
- [x] Person 2 confirms that `/health` is the currently implemented health route.
  `/api/v1/health` is not confirmed and must not be claimed.

### Person 2 conditional architecture approval

The following corrections are acknowledged by the team record and remain subject
to final schema and implementation sign-off:

- [x] `vaultSequence` is assigned per source and is source-local, not global or stream-local.
- [x] Host Agent HTTP and rsyslog TCP observations share a source-level sequence
  space and use separate `observationSource` values.
- [x] `(sourceId, vaultSequence)` is the authoritative event identity, and
  `eventId = sourceId + ":" + vaultSequence`.
- [x] The current auth.log source uses `streamId: "auth.log"`.
- [x] Event metadata includes source, sequence, stream, observation source,
  file location, observed receipt timestamps, raw length, persistence,
  and correlation fields in the proposed read model.
- [x] Raw payload bytes are excluded from event list responses. A future evidence
  detail route is not finalized.
- [x] Signature and keyId are not promised in read responses until retrieval is implemented.
- [x] Identical Host Agent delivery-ID retries return the original receipt; conflicting
  delivery-ID reuse returns HTTP 409.
- [x] Repeated rsyslog observations remain separate records.
- [x] Host Agent and rsyslog observations remain separate records and may later correlate.
- [x] `fileIdentity` and `byteOffset` are not event identities.
- [x] Pagination uses default `50`, maximum `100`, `nextCursor`, and stable
  ordering by `sourceId`, then `vaultSequence`.
- [x] The REST request parameter is `cursor`; the response continuation field is
  `nextCursor`.
- [x] If `sequenceFrom` or `sequenceTo` is supplied, `sourceId` must also be supplied.
  Missing `sourceId` is invalid input.
- [x] Event metadata detail does not automatically return original raw bytes.
  Raw-evidence retrieval is separately authorization-controlled and not finalized.
- [x] WebSocket notifications are deduplicated by `messageId`.
- [x] `event.persisted` is emitted only after durable Vault persistence succeeds.
- [x] No replay/resumption promise is made in the first integration.
- [x] Reconnect will trigger REST refetch/reconciliation after approved read APIs exist.
- [x] ZIP export is pending; no manifest or bundle layout is approved.

### Confirmed Person 4 boundaries

- [x] The dashboard remains in DEMO mode until approved live read APIs are available.
- [x] No backend, Host Agent, crypto, or blockchain files are changed for read-contract proposals.
- [x] WebSocket replay or resumption is not promised; reconnect uses REST refetch.
- [x] The public checkpoint target is **Quai Orchard Cyprus-1, chain ID 15000**.
- [x] Vault persistence, local Hardhat anchoring, public Quai anchoring, and independent
  direct-RPC verification are separate conclusions.

### Not yet implemented or approved

- [ ] Event, source, batch, checkpoint, and gap read API implementations.
- [ ] WebSocket server and approved message schemas.
- [ ] ZIP evidence export.
- [ ] Evidence detail and verification read contracts.
- [ ] Raw-evidence endpoint, permissions, and response schema.
- [ ] Final filtering and cursor/filter validation conventions.
- [ ] HTTP status mapping and machine-readable error vocabulary.
- [ ] Authentication requirements and authorization boundaries for read endpoints.
- [ ] Final read-model field names and status enum values.
- [ ] WebSocket endpoint, authentication, subscription, liveness and reconnect/reconciliation details.

## Cross-team repository decisions

| Decision | Current observation | Approval required |
| --- | --- | --- |
| Dashboard location | Blueprint recommends `apps/dashboard/`. It is absent locally and from the available remote refs. | All Persons, with Person 4 owner |
| Auditor CLI location | Blueprint recommends `services/verifier/`. It is absent locally and from the available remote refs. | All Persons, with Person 4 owner |
| E2E test location | Blueprint recommends `tests/e2e/`. It is absent locally and from the available remote refs. | All Persons, with Person 4 owner |
| API location | Blueprint recommends `apps/api/`. It is absent locally and from the available remote refs. | Person 2 and integration owner |
| Vault and agent locations | Blueprint recommends `services/vault/` and `services/agent/`, with `lab/` for the controlled environment. | Persons 2 and 3 |
| Workspace entries | Person 1’s current `pnpm-workspace.yaml` lists only `packages/*` and `blockchain`. | Integration owner and all Persons |
| Package manager | The Person 1 branch has npm workspaces and `package-lock.json`, plus `pnpm-workspace.yaml`, with no `pnpm-lock.yaml` or `packageManager` declaration. | Integration owner and all Persons |
| Core import name | `packages/core/package.json` currently declares `"name": "core"`. Person 4 specifications expect `@trusttrace/core`. | Person 1 and integration owner |

## Person 1 approvals

- [ ] Confirm the published workspace import name for the shared core. If the name is `@trusttrace/core`, align `packages/core/package.json` before Person 4 writes imports.
- [ ] Confirm the canonical event byte layout, schema version, source-ID representation, vault-sequence semantics, SHA-256 domain tags, Merkle odd-node rule, and test-vector version.
- [ ] Confirm proof serialization, including leaf index, leaf count, sibling order, and expected root representation.
- [ ] Confirm EIP-712 commitment fields, signer/relayer roles, contract ABI/version, contract read method, commitment lookup key, and continuity reference.
- [ ] Confirm the permitted direct-RPC targets and expected chain IDs for local demonstration and any optional public checkpoint.

## Person 2 approvals

- [ ] Final-sign-off the architecture corrections in this record.
- [ ] Confirm or replace the proposed `GET /api/v1/sources` read contract.
- [ ] Confirm or replace the proposed `GET /api/v1/events` read contract.
- [ ] Confirm or replace `GET /api/v1/sources/:sourceId/events/:vaultSequence`
  as the source-scoped event detail route.
- [ ] Confirm or replace the proposed `GET /api/v1/batches` read contract.
- [ ] Confirm or replace the proposed `GET /api/v1/checkpoints` read contract.
- [ ] Confirm or replace the proposed `GET /api/v1/gaps` read contract.
- [ ] Confirm the final dashboard read routes, request parameters, source scoping, and error response shape.
- [ ] Confirm the event, batch, verification-result, health, and evidence-detail response fields.
- [ ] Confirm vault-assigned sequence ownership, durable-receipt acknowledgement point, reconciliation state vocabulary, and retention of raw bytes.
- [ ] Confirm WebSocket endpoint, authentication, subscription scope, event envelope, replay or resumption semantics, duplicate handling, ordering, and liveness behaviour.
- [ ] Confirm no guaranteed replay/resumption and the final reconnect/REST reconciliation behavior.
- [ ] Confirm HTTP status mapping and error code vocabulary.
- [ ] Confirm authentication for read endpoints and authorization boundaries, including raw evidence.
- [ ] Confirm proposed status dimensions and transitions or replace them with approved enums.
- [ ] Confirm the exact source-scoped read route and response schema.
- [ ] Confirm whether reconnect-triggered REST refetch is sufficient and whether
  the server promises any replay.
- [ ] Confirm source-local sequencing and stable
  `sourceId`, then `vaultSequence` ordering.
- [ ] Confirm `messageId` WebSocket deduplication and `event.persisted` semantics.
- [ ] Confirm evidence-export transport and bundle content, including manifest fields, file hashes, raw-evidence representation, proof material, and bundle-versioning rule.
- [ ] Confirm server verification labels are reported as server results and remain distinct from direct-RPC CLI verification.
- [ ] Confirm local Hardhat and public Quai anchor fields remain distinct from direct-RPC verified status.

The proposed contract is documented in
[api-contract-proposal.md](./api-contract-proposal.md). It is not implementation
authorization. The dashboard transport remains deliberately unimplemented for
these read mappings until Person 2 signs off.

## Person 3 approvals

- [ ] Confirm source IDs, agent and rsyslog stream IDs, source-key identity, and host timestamp representation.
- [ ] Confirm host-comparison input shape and how edits, deleted records, wiped files, and unavailable host records are represented.
- [ ] Confirm heartbeat cadence, timeout threshold, collector-gap payload, and the distinction between delayed delivery and an unobserved interval.
- [ ] Confirm controlled scenario IDs, execution ownership, expected event and verification outputs, and reset procedure.
- [ ] Confirm reproducible inputs for normal SSH activity, host tamper, agent interruption, and dual-stream divergence E2E cases.

## Approval gate

Person 4 live read integration is not ready until Person 2 approves the read
REST and WebSocket contracts. The dashboard intentionally remains in DEMO mode.
The resource structure corrections above are conditional architecture approval,
not implementation approval.
Person 1, Person 2, and Person 3 approval remains required for the broader
interface freeze, including shared cryptography, read models, source semantics,
and bundle formats.
