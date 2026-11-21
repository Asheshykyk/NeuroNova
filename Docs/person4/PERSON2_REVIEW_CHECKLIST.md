# Person 2 interface review checklist

**Status: CONDITIONAL ARCHITECTURE APPROVAL — FINAL SIGN-OFF PENDING**

Person 2: review [api-contract-proposal.md](./api-contract-proposal.md) and
record final approval or requested changes. This document does not authorize
live dashboard mappings until Person 2 signs off the final schemas.

## Implementation status

| Item | Status |
| --- | --- |
| `POST /api/v1/logs/ingest` | **IMPLEMENTED — confirmed** |
| `/health` | **IMPLEMENTED — confirmed** |
| `GET /api/v1/sources` | **PROPOSED — NOT IMPLEMENTED** |
| `GET /api/v1/events` | **PROPOSED — NOT IMPLEMENTED** |
| `GET /api/v1/sources/:sourceId/events/:vaultSequence` | **PROPOSED — NOT IMPLEMENTED** |
| `GET /api/v1/batches` | **PROPOSED — NOT IMPLEMENTED** |
| `GET /api/v1/checkpoints` | **PROPOSED — NOT IMPLEMENTED** |
| `GET /api/v1/gaps` | **PROPOSED — NOT IMPLEMENTED** |
| WebSocket server | **NOT IMPLEMENTED** |
| ZIP export | **NOT IMPLEMENTED** |

## Resolved and acknowledged review corrections

- [x] `vaultSequence` is source-local and shared across Host Agent and rsyslog TCP
  observations; it is not global or stream-local.
- [x] Host Agent HTTP and rsyslog TCP observations share the source sequence space.
- [x] `(sourceId, vaultSequence)` is the authoritative event identity, with
  `eventId = sourceId + ":" + vaultSequence`.
- [x] The current auth.log source uses `streamId: "auth.log"`.
- [x] `observationSource` distinguishes `host-agent` and `rsyslog-tcp`.
- [x] `fileIdentity` and `byteOffset` are metadata, not unique event identifiers.
- [x] Pagination is default `50`, maximum `100`, uses `nextCursor`, and uses stable
  ordering by `sourceId`, then `vaultSequence` ascending.
- [x] Identical Host Agent delivery-ID retries return the original receipt.
- [x] Conflicting Host Agent delivery-ID reuse returns HTTP 409.
- [x] Repeated rsyslog observations remain separate Vault records.
- [x] Host Agent and rsyslog observations remain separate and may correlate later.
- [x] The proposed source-scoped event detail route is
  `GET /api/v1/sources/:sourceId/events/:vaultSequence`.
- [x] WebSocket notification deduplication uses `messageId`.
- [x] Event notifications use `event.persisted`, emitted only after durable Vault persistence.
- [x] The first integration has no guaranteed WebSocket replay or resumption.
- [x] Reconnect will trigger REST refetch/reconciliation once approved read endpoints exist.
- [x] Local Hardhat, public Quai, and independent verification remain distinct.
- [x] Public target is Quai Orchard Cyprus-1, chain ID 15000.
- [x] ZIP export is not implemented and no manifest layout is approved.

## Final approval sections

Mark each section: **APPROVED / REQUIRES CHANGE / PENDING**.

### 1. Event and source read schemas

Status: **APPROVED — AGREED CORRECTIONS**

- [x] Final event metadata field names and types
- [x] Required fields: `eventId`, `sourceId`, `vaultSequence`, `streamId`,
  `observationSource`, `fileIdentity`, `byteOffset`, `observedAt`,
  `vaultReceivedAt`, `rawEventLength`, `vaultPersistenceStatus`, and
  `correlationStatus`
- [x] Confirmation that `observedAt` means source observation time
- [x] Confirmation that `vaultReceivedAt` means Vault receipt time
- [x] Confirmation that list responses exclude raw payloads
- [x] Confirmation that signature/keyId remain excluded until retrieval exists
- [ ] Future evidence-detail route remains pending
- [x] Source and event detail resource structure uses
  `GET /api/v1/sources/:sourceId/events/:vaultSequence`

### 2. REST pagination, filtering, authentication, and errors

Status: **PENDING FINAL SCHEMA SIGN-OFF**

- [x] Pagination uses opaque `nextCursor`
- [x] Default page size is `50`; maximum is `100`
- [x] Stable ordering is `sourceId`, then `vaultSequence` ascending
- [ ] Event/source/batch/checkpoint/gap filter names
- [ ] Source scoping and ordering
- [ ] Authentication and authorization
- [ ] HTTP status mapping
- [ ] Machine-readable error envelope
- [ ] Empty-result and stale-refresh behavior
- [ ] Final confirmation of `/health` versus no `/api/v1/health`

### 3. Sequence and reconciliation

Status: **APPROVED — AGREED CORRECTIONS**

- [x] Confirm `eventId = sourceId + ":" + vaultSequence`
- [x] Confirm `(sourceId, vaultSequence)` as authoritative identity
- [ ] Confirm source-level continuity and gap rules
- [ ] Confirm delivery-ID retry and 409 behavior
- [x] Confirm rsyslog records remain separate
- [x] Confirm fileIdentity/byteOffset are not deduplication keys
- [ ] Confirm reconciliation/correlation response fields

### 4. WebSocket envelope and recovery

Status: **PENDING FINAL SCHEMA SIGN-OFF**

- [ ] Final endpoint and source subscription scope
- [ ] Authentication
- [x] `messageId`, `occurredAt`, `type`, `sourceId`, `payload` envelope
- [ ] `event.persisted` and all remaining event type names
- [ ] Payload structures for each type
- [x] `messageId` deduplication behavior
- [ ] No replay/resumption promise
- [ ] REST refetch/reconciliation after reconnect
- [ ] Heartbeat/ping behavior
- [ ] Out-of-order and duplicate delivery behavior

### 5. Status semantics

Status:

- [ ] `VAULT_PERSISTED`
- [ ] Local Hardhat anchoring
- [ ] Public Quai anchoring
- [ ] `ANCHORED_SERVER_REPORTED`
- [ ] `RPC_VERIFIED`
- [ ] `UNVERIFIABLE`
- [ ] `COLLECTION_GAP`
- [ ] Confirmation that RPC_VERIFIED requires direct-RPC evidence
- [ ] Confirmation that UNVERIFIABLE is not tampering
- [ ] Confirmation that public/server anchoring is not full event-level VERIFIED

### 6. Evidence export

Status:

- [ ] ZIP export member layout
- [ ] Manifest field and version conventions
- [ ] Original raw bytes representation
- [ ] Proof representation
- [ ] Signed commitment fields
- [ ] Chain metadata
- [ ] Manifest hashes bundle members except itself
- [ ] Approved fixtures and integrity validation

## Final Person 2 sign-off

- [ ] REST read contracts approved
- [ ] WebSocket contract approved
- [ ] Sequence and duplicate behavior approved
- [ ] Status vocabulary approved
- [ ] Evidence export remains pending or is approved separately
- [ ] Person 4 may begin live mapping only after this sign-off

Sign-off record:

```text
Decision: APPROVED / REQUIRES CHANGE / PENDING
Approved on:
Approved branch/commit:
Approved contract document or implementation reference:
Known deviations:
```
