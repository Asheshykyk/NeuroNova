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
- [x] REST request pagination uses `cursor`; response pagination uses `nextCursor`.
- [x] `sequenceFrom` or `sequenceTo` requires `sourceId`; omission is invalid input.
- [x] Metadata detail does not automatically include raw bytes.
- [x] Raw-evidence retrieval remains separate, authorization-controlled and pending.
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

### 2. REST pagination, HTTP errors, and authentication

Status: **PROPOSED CONVENTIONS — PENDING IMPLEMENTATION REVIEW**

- [x] Pagination uses opaque `nextCursor`
- [x] Request parameter is `cursor`
- [x] Default page size is `50`; maximum is `100`
- [x] Stable ordering is `sourceId`, then `vaultSequence` ascending
- [x] `sequenceFrom`/`sequenceTo` require `sourceId`
- [ ] Event/source/batch/checkpoint/gap filter names
- [ ] Source scoping and ordering
- [ ] Review proposed error envelope fields: `code`, `message`,
  `correlationId`, and `retryable`
- [ ] Review recommended HTTP mapping: 400 malformed request/invalid query;
  401 missing/invalid authentication; 403 insufficient permissions; 404
  resource not found; 409 conflicting sequence/resource; 422 invalid field
  combination; 429 rate limit; 500 internal error; 503 dependency unavailable
- [ ] Approve final machine-readable `error.code` values and their mapping;
  recommended HTTP statuses are not finalized code values
- [ ] Validation error convention for missing sourceId, invalid cursor or limit, and out-of-range sequence filters
- [ ] Empty-result and stale-refresh behavior
- [ ] Final confirmation of `/health` versus no `/api/v1/health`
- [ ] Confirm deployed dashboard read APIs require authenticated access and
  source-level authorization
- [ ] Decide dashboard identity provider and token format; neither is specified
  by this proposal
- [ ] Confirm Host Agent Ed25519 authentication remains separate from dashboard
  authentication

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

Status: **PROPOSED FINAL CONVENTIONS — PENDING FINAL SIGN-OFF, IMPLEMENTATION, AND SECURITY REVIEW**

- [ ] Proposed endpoint `/api/v1/ws`; require `wss` in deployment
- [ ] Authenticated connection using a short-lived, single-use ticket
- [ ] Never place credentials in the WebSocket URL
- [ ] Explicit client subscriptions to source IDs
- [ ] Enforce authorization for every subscribed source ID
- [x] `messageId`, `occurredAt`, `type`, `sourceId`, `payload` envelope
- [x] `messageId` deduplicates notifications, not evidence records
- [ ] Proposed clarification: `event.persisted` is emitted only after durable
  JSONL persistence succeeds
- [ ] Approval of remaining event type names and payload structures
- [ ] Payload structures for each type
- [ ] Native WebSocket ping/pong; proposed server ping interval is 30 seconds
- [x] No replay/resumption promise
- [x] REST refetch/reconciliation after reconnect
- [ ] Out-of-order and duplicate delivery behavior
- [ ] Implementation/security review of ticket issuance route, ticket TTL,
  ticket consumption semantics, and subscription message schema
- [ ] Confirm authenticated deployment access and source-level authorization
- [ ] Confirm bounded reconnect and REST reconciliation details when the
  approved read APIs are available

### 5. Status semantics

Status: **PROPOSED FINAL CONVENTIONS — PENDING IMPLEMENTATION AND SECURITY REVIEW**

- [ ] Vault persistence: `PENDING`, `VAULT_PERSISTED`, `PERSISTENCE_FAILED`
- [ ] Local Hardhat anchoring: `PENDING`, `ANCHORED_SERVER_REPORTED`,
  `ANCHOR_FAILED`
- [ ] Public Quai anchoring: `PENDING`, `ANCHORED_SERVER_REPORTED`,
  `ANCHOR_FAILED`
- [ ] Independent verification: `PENDING`, `RPC_VERIFIED`, `UNVERIFIABLE`,
  `CHAIN_MISMATCH`
- [ ] Keep `COLLECTION_GAP` separate from persistence, anchoring, and verification
- [ ] Confirm dimensions are separate, not one linear state machine
- [ ] Confirm proposed transition rules remain pending implementation review
- [ ] Confirm `RPC_VERIFIED` requires independent direct-RPC verification
- [ ] Confirm `UNVERIFIABLE` does not mean `TAMPERED`
- [ ] Assign `CHAIN_MISMATCH` only when trusted direct-RPC evidence establishes
  a mismatch, never merely because RPC is unavailable
- [ ] Keep public-chain commitment verification distinct from event-level
  cryptographic verification
- [ ] Preserve verifier CLI outcomes `VERIFIED`, `TAMPERED`, and
  `UNVERIFIABLE`; do not remap them to API status dimensions

### 6. Security review

Status: **PENDING**

- [ ] Review dashboard REST authentication and source-level authorization
- [ ] Review WebSocket authentication, single-use connection ticket handling,
  and per-source subscription authorization
- [ ] Confirm credentials are excluded from WebSocket URLs
- [ ] Review ticket issuance/TTL/consumption design and subscription schema
- [ ] Confirm error messages and correlation identifiers do not expose secrets
- [ ] Confirm API status values cannot be misrepresented as independent
  verification or event-level integrity results

### 7. Evidence export

Status: **NOT IMPLEMENTED — PENDING SEPARATE APPROVAL**

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
- [ ] HTTP error envelope, recommended status mapping, and final error codes
  approved
- [ ] Deployment dashboard authentication and source-level authorization
  approved
- [ ] WebSocket endpoint, connection-ticket approach, source subscription
  authorization, liveness, and reconnect behavior approved
- [ ] Sequence and duplicate behavior approved
- [ ] Separate status dimensions, transitions, and security review approved
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
