# Person 4 API and WebSocket contract proposal

## Status

**STATUS LABELS**

- **IMPLEMENTED:** only the confirmed backend operations listed below.
- **ARCHITECTURALLY APPROVED:** Person 2-reviewed architecture corrections included in this document.
- **PROPOSED:** resource structure or illustrative fields that still require final schema conventions.
- **PENDING FINAL SIGN-OFF:** finalized paths, fields, pagination, authentication, errors, WebSocket payloads, export layout, and implementation status.

This document consumes interfaces owned by Person 2. Person 2 owns API schemas
and Person 1 owns cryptographic representations.

All timestamps are UTC RFC 3339 strings. Hashes, roots, signatures, and transaction hashes are strings whose final encoding is defined by the shared contracts and crypto test vectors. Raw payloads remain losslessly encoded bytes. JSON object property order must never define a cryptographic digest.

## Implementation status

### IMPLEMENTED

- `POST /api/v1/logs/ingest` — confirmed implemented by Person 2.
- The currently implemented health route is `/health`. This route is not
  `/api/v1/health`, and its response schema is not inferred here.

### ARCHITECTURALLY APPROVED

The following Person 2 review corrections are conditionally architecture-approved:

- `vaultSequence` is assigned per source, not globally and not per stream.
- Host Agent HTTP and rsyslog TCP observations share the same per-source sequence space.
- `(sourceId, vaultSequence)` is the authoritative event identity, and
  `eventId` is exactly `sourceId + ":" + vaultSequence` (for example,
  `source-01:184`). `eventId` must not contradict `(sourceId, vaultSequence)`.
- The current auth.log source uses `streamId: "auth.log"`.
- `observationSource` distinguishes `host-agent` and `rsyslog-tcp`.
- `fileIdentity` and `byteOffset` are observation metadata, not a unique event ID.
- Repeated rsyslog observations remain separate records.
- Host Agent and rsyslog observations may be correlated later but remain separate Vault records.
- Identical Host Agent delivery-ID retries return the original receipt.
- Conflicting reuse of a delivery ID returns HTTP 409.
- The source-scoped event detail route is `GET /api/v1/sources/:sourceId/events/:vaultSequence`.
- A reconnect triggers REST refetch/reconciliation once approved read endpoints exist.
- WebSocket notification deduplication uses `messageId`.
- `event.persisted` replaces `event.received` and is emitted only after durable Vault persistence succeeds.

### PROPOSED / NOT IMPLEMENTED

Read resources, WebSocket server and payloads, evidence detail, and ZIP export
remain proposed or pending implementation.

## Evidence and anchoring status boundaries

**PROPOSED STATUS VOCABULARY — PENDING FINAL SIGN-OFF**

The dashboard must keep these findings separate:

| Boundary | Proposed meaning | What it does not prove |
| --- | --- | --- |
| Vault persistence | The vault read API reports that preserved bytes have durably reached the approved persistence point. | It does not prove host correctness or chain anchoring. |
| Batch creation | The vault reports a Merkle batch and sequence range. | It does not prove that an on-chain anchor exists. |
| Local Hardhat anchoring | An API reports a local-chain transaction or block reference. | It is not public proof and is not independent verification. |
| Public Quai anchoring | An API reports a public checkpoint transaction or block reference for Quai Orchard Cyprus-1, chain ID 15000. | A transaction reference is only `ANCHORED_SERVER_REPORTED`; it is not direct-RPC verification. |
| Independent verification | An approved verifier, imported CLI result, or direct-RPC result confirms the expected commitment. | It does not change a missing host-comparison result into proof of source behavior. |

Recommended dashboard labels:

| Label | Applicable boundary |
| --- | --- |
| `PENDING` | Receipt, persistence acknowledgement, batching, or verification work is incomplete. |
| `VAULT_PERSISTED` | Proposed API-confirmed durable vault evidence. |
| Local Hardhat anchor | The API or operational system reports an anchor in the local Hardhat network. It is separate from public anchoring. |
| `ANCHORED_SERVER_REPORTED` | A server reports an anchor or transaction reference. It is not independent verification. |
| Public Quai anchor | The API reports an anchor in Quai Orchard Cyprus-1, chain ID 15000. It remains server-reported until direct-RPC verification succeeds. |
| `RPC_VERIFIED` | Direct-RPC verification independently confirms the commitment. |
| `UNVERIFIABLE` | Required evidence or RPC access was unavailable. This is not a tamper finding. |
| `CHAIN_MISMATCH` | Independent verification found a commitment mismatch. |
| `COLLECTION_GAP` | A collection window was missed. It does not establish event occurrence. |

`VAULT_PERSISTED` does not imply local or public anchoring. Local Hardhat
anchoring does not imply public Quai anchoring. `ANCHORED_SERVER_REPORTED`
does not become `RPC_VERIFIED` from an API response or transaction hash.
`RPC_VERIFIED` requires actual independent direct-RPC verification of the
relevant public commitment. It must not be equated with full event-level
`VERIFIED` unless all required evidence, cryptographic checks, and chain checks
have passed.

## Read models

### Event

**PROPOSED READ MODEL — PENDING FINAL SIGN-OFF — NOT IMPLEMENTED**

Illustrative list metadata:

```json
{
  "eventId": "source-01:1",
  "sourceId": "source-01",
  "vaultSequence": 1,
  "streamId": "auth.log",
  "observationSource": "host-agent",
  "fileIdentity": "illustrative-file-identity",
  "byteOffset": 12345,
  "observedAt": "2026-11-20T10:00:00.000Z",
  "vaultReceivedAt": "2026-11-20T10:00:01.000Z",
  "rawEventLength": 256,
  "vaultPersistenceStatus": "VAULT_PERSISTED",
  "correlationStatus": "PENDING"
}
```

- `eventId` is exactly `sourceId + ":" + vaultSequence`; `(sourceId, vaultSequence)`
  remains the authoritative parsed identity.
- `observedAt` is the source observation timestamp.
- `vaultReceivedAt` is the Vault receipt timestamp.
- `rawEventLength` is metadata only; raw event payloads are excluded from list responses.
- `observationSource` is `host-agent` or `rsyslog-tcp`.
- `fileIdentity` and `byteOffset` describe location and are not unique event identifiers.
- Signature and keyId are not promised until authorized retrieval is implemented.
- Raw bytes are available only through a future authorized evidence-detail endpoint.
  Its route and response schema are not finalized.

### Batch commitment

```json
{
  "batchId": "source-01-batch-000001",
  "sourceId": "source-01",
  "startSequence": 1,
  "endSequence": 100,
  "leafCount": 100,
  "merkleRoot": "0x...",
  "previousBatchRoot": "0x...",
  "createdAt": "2026-11-20T10:00:05.000Z",
  "sourceKeyId": "source-01-key-01",
  "transactionHash": "0x..."
}
```

The final commitment also needs the contract address, chain identifier, block reference, and anchor status if those values are available from the anchoring workstream.

### Verification result

```json
{
  "subject": { "kind": "event", "vaultSequence": 12, "batchId": "source-01-batch-000001" },
  "status": "CONTENT_MISMATCH",
  "checks": {
    "hostComparison": "MISSING_RECORDS",
    "vaultEvidence": "AVAILABLE",
    "proof": "VERIFIED",
    "chainCommitment": "VERIFIED"
  },
  "chainCommitmentFound": true,
  "expectedMerkleRoot": "0x...",
  "computedMerkleRoot": "0x...",
  "affectedSequences": [12, 18],
  "verifiedAt": "2026-11-20T10:05:00.000Z",
  "verificationOrigin": "server"
}
```

The final status enum must be shared by the vault, dashboard, attack scripts, and CLI.

## Illustrative HTTP operations

**PROPOSED — REQUIRES PERSON 2 APPROVAL — NOT IMPLEMENTED**
The resources below are an approval proposal for Person 2. None is implemented for dashboard live reads. The dashboard remains in demo mode until Person 2 approves and implements these contracts.

| Operation | Illustrative path | Dashboard need |
| --- | --- | --- |
| List sources | `GET /api/v1/sources` | source health and source selection |
| Query event index | `GET /api/v1/events` | paged history, filters, source/stream status |
| List batches | `GET /api/v1/batches` | local batch metadata and sequence ranges |
| List checkpoints | `GET /api/v1/checkpoints` | local/public anchor and independent-verification status |
| List collection gaps | `GET /api/v1/gaps` | heartbeat and collection-gap observations |
| Fetch source event detail | `GET /api/v1/sources/:sourceId/events/:vaultSequence` | proposed source-scoped event metadata; raw-byte detail route remains pending |
| Fetch batch | `GET /api/v1/batches/:batchId` | batch detail and chain reference |
| Verify batch | `POST /api/v1/verify/batch/:batchId` | server-reported verification run |
| Verify event | `POST /api/v1/verify/event/:sequence` | server-reported event verification run |
| Export bundle | `GET /api/v1/export/:batchId` | auditor download |
| Controlled scenario | `POST /api/v1/simulations/:scenario` | demo control only if approved |

The ingest operation is confirmed implemented:

```text
POST /api/v1/logs/ingest
```

This confirmed ingestion route is not evidence for a read contract. Its request and
response fields remain governed by Person 2's ingest implementation and are not
proposed or consumed as dashboard live read models here.

The currently implemented health route is `/health`. It must not be interpreted
as `GET /api/v1/health`. The `/health` response schema is pending documentation
and is not a proposed dashboard read mapping.

## Proposed read-resource contracts

### Common list query parameters

**PROPOSED — NOT IMPLEMENTED**

| Parameter | Type | Proposed meaning |
| --- | --- | --- |
| `sourceId` | string | Scope the result to one source. |
| `nextCursor` | string | Opaque continuation cursor; cursor contents must not be interpreted by the dashboard. |
| `limit` | integer | Requested page size. Default `50`; maximum `100`. Values above `100` must be rejected or capped by the final approved API convention. |
| `observedAtFrom` | RFC 3339 UTC string | Inclusive lower observation-time bound. |
| `observedAtTo` | RFC 3339 UTC string | Inclusive upper observation-time bound. |

All list responses should include the server observation time and an opaque
`nextCursor` if another page exists. List order is stable by `sourceId`, then
`vaultSequence` ascending. `vaultSequence` is source-local and is shared across
Host Agent and rsyslog TCP observations for the same source.

```json
{
  "observedAt": "2026-11-20T10:43:03.000Z",
  "items": [],
  "nextCursor": null
}
```

The exact field names and pagination encoding are proposed only.

### Proposed `GET /api/v1/sources`

**PROPOSED — REQUIRES PERSON 2 APPROVAL — NOT IMPLEMENTED**

Optional filters: `status` and `sourceId`.

```json
{
  "observedAt": "2026-11-20T10:43:03.000Z",
  "items": [
    {
      "sourceId": "host-lab-01",
      "healthStatus": "PENDING",
      "latestVaultSequence": 186,
      "latestVaultReceivedAt": "2026-11-20T10:43:03.000Z",
      "observedAt": "2026-11-20T10:43:03.000Z"
    }
  ],
  "nextCursor": null
}
```

`healthStatus` is proposed and must not be confused with a cryptographic finding.

### Proposed `GET /api/v1/events`

**PROPOSED — REQUIRES PERSON 2 APPROVAL — NOT IMPLEMENTED**

Supported proposed filters:

| Parameter | Proposed meaning |
| --- | --- |
| `sourceId` | Source identifier. |
| `streamId` | Stream identifier; the agreed auth.log source stream is `auth.log`. |
| `observationSource` | Proposed values `host-agent` or `rsyslog-tcp`. |
| `sequenceFrom` | Inclusive vault-sequence lower bound for one source. |
| `sequenceTo` | Inclusive vault-sequence upper bound for one source. |
| `batchId` | Batch containing or associated with the event. |
| `correlationStatus` | Proposed `PENDING`, `MATCHED`, `AGENT_ONLY`, `SYSLOG_ONLY`, or `LATE_ARRIVAL`. Final vocabulary requires approval. |
| `evidenceStatus` | Proposed operational status filter. |
| `nextCursor`, `limit`, `observedAtFrom`, `observedAtTo` | Common paging and time filters. |

Success shape:

```json
{
  "observedAt": "2026-11-20T10:43:03.000Z",
  "items": [
    {
      "eventId": "source-01:1",
      "sourceId": "source-01",
      "vaultSequence": 1,
      "streamId": "auth.log",
      "observationSource": "host-agent",
      "fileIdentity": "illustrative-file-identity",
      "byteOffset": 12345,
      "observedAt": "2026-11-20T10:00:00.000Z",
      "vaultReceivedAt": "2026-11-20T10:00:01.000Z",
      "rawEventLength": 256,
      "vaultPersistenceStatus": "VAULT_PERSISTED",
      "correlationStatus": "PENDING"
    }
  ],
  "nextCursor": null
}
```

Raw event payloads are excluded by default. `signature` and `keyId` are not
promised in this read model. The authoritative event identity is
`(sourceId, vaultSequence)`. `vaultSequence` starts and advances independently
within each source; it is not global and is shared by both Host Agent and
rsyslog observations for that source.

### Proposed `GET /api/v1/batches`

**PROPOSED — REQUIRES PERSON 2 APPROVAL — NOT IMPLEMENTED**

Filters: `sourceId`, `sequenceFrom`, `sequenceTo`, `anchorStatus`, common paging,
and common observation-time filters. `anchorStatus` is proposed only.

```json
{
  "observedAt": "2026-11-20T10:43:03.000Z",
  "items": [
    {
      "batchId": "source-01-batch-000001",
      "sourceId": "source-01",
      "startSequence": 1,
      "endSequence": 100,
      "leafCount": 100,
      "merkleRoot": "0x...",
      "previousBatchRoot": "0x...",
      "createdAt": "2026-11-20T10:00:05.000Z",
      "localAnchorStatus": "PENDING",
      "publicAnchorStatus": "PENDING",
      "independentVerificationStatus": "UNVERIFIABLE"
    }
  ],
  "nextCursor": null
}
```

This shape intentionally separates vault batch creation from local anchoring,
public anchoring, and independent verification.

### Proposed `GET /api/v1/checkpoints`

**PROPOSED — REQUIRES PERSON 2 APPROVAL — NOT IMPLEMENTED**

Filters: `sourceId`, `batchId`, `targetType`, `anchorStatus`,
`verificationStatus`, common paging, and common observation-time filters.
The target type and verification vocabulary require approval.

The proposed target levels are:

| Target | Meaning |
| --- | --- |
| `VAULT_LOCAL_BATCH` | The vault has a batch commitment, not an on-chain anchor. |
| `LOCAL_HARDHAT` | API/configuration reports a local chain anchor. Independent verification remains separate. |
| `PUBLIC_QUAI` | API/configuration reports a Quai public checkpoint. Person 1 must confirm chain and contract data. |
| `INDEPENDENT_AUDITOR` | A direct-RPC CLI result imported into or obtained by the dashboard. |

Success shape:

```json
{
  "observedAt": "2026-11-20T10:43:03.000Z",
  "items": [
    {
      "checkpointId": "checkpoint-source-01-batch-000001",
      "batchId": "source-01-batch-000001",
      "sourceId": "source-01",
      "targetType": "LOCAL_HARDHAT",
      "anchorStatus": "ANCHORED_SERVER_REPORTED",
      "transactionHash": "0x...",
      "blockReference": "chain-reference",
      "contractAddress": "0x...",
      "chainId": 31337,
      "reportedAt": "2026-11-20T10:43:02.000Z",
      "independentVerificationStatus": "UNVERIFIABLE"
    }
  ],
  "nextCursor": null
}
```

For the public row, the public target name must be
`PUBLIC_QUAI`, and the approved chain display target must be
`Quai Orchard Cyprus-1 (chain ID 15000)`. Public anchoring by API is not an
independent direct-RPC verification result.

### Proposed `GET /api/v1/gaps`

**PROPOSED — REQUIRES PERSON 2 APPROVAL — NOT IMPLEMENTED**

Filters: `sourceId`, `streamId`, `status`, `openedFrom`, `openedTo`, common
`nextCursor` and `limit` values, and common observation-time filters.

```json
{
  "observedAt": "2026-11-20T10:43:03.000Z",
  "items": [
    {
      "gapId": "gap-source-01-agent-2026-11-20T10",
      "sourceId": "source-01",
      "streamId": "auth.log",
      "windowStart": "2026-11-20T10:40:00.000Z",
      "windowEnd": "2026-11-20T10:42:00.000Z",
      "status": "COLLECTION_GAP",
      "observedAt": "2026-11-20T10:43:03.000Z"
    }
  ],
  "nextCursor": null
}
```

A gap means delivery or observation was missed in the declared window. It does
not establish whether a source event occurred or did not occur in that window.

## Client request states

**PROPOSED — REQUIRES TEAM APPROVAL** Each HTTP-backed dashboard view uses `LOADING`, `READY`, `EMPTY`, `ERROR`, and `STALE` states. `STALE` means a previously successful response remains visible but cannot be refreshed. An event, batch, proof, or raw-evidence detail is never inferred from a failed or empty response.

| Condition | Required client state | Required display |
| --- | --- | --- |
| Initial query pending | `LOADING` | stable skeleton or progress text |
| Successful query with no records | `EMPTY` | query scope and absence of returned records |
| Timeout, unavailable service, or non-success response | `ERROR` | safe message, response code when supplied, retry action |
| Refresh or live transport unavailable after prior data | `STALE` | last successful observation time and reconnect or retry state |
| Evidence member unavailable | `ERROR` for that member | explicit `MISSING_FROM_VAULT` or `UNVERIFIABLE` result when verification reports it |

## Proposed success and error conventions

**PROPOSED — REQUIRES PERSON 2 APPROVAL — NOT IMPLEMENTED**

Successful list responses use the common shape above with `nextCursor`. The
stable ordering and opaque cursor convention are agreed architecture decisions;
the exact HTTP cursor encoding remains a final schema convention. The dashboard
must treat cursor opacity as an implementation detail.

Successful detail responses may return the resource object directly or through
an approved object envelope. Until Person 2 approves a convention, Person 4
cannot map detail responses.

Proposed error response:

```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "The requested resource is unavailable.",
    "correlationId": "optional-safe-request-id",
    "retryable": false
  }
}
```

These fields are proposed, not implementation fields. The minimum Person 2
contract should include a machine-readable code, a safe message that omits
secrets, and an optional correlation/request identifier. HTTP status and
safe error-code ownership remain pending approval.

Examples of proposed status mapping, not approved enum values:

| HTTP status | Proposed dashboard state | Meaning |
| --- | --- | --- |
| 200 with items | `READY` | Successful resource page. |
| 200 with no items | `EMPTY` | No records in the requested scope. |
| 400 | `ERROR` | Invalid or unsupported query. |
| 404 | `ERROR` | Resource is not present. |
| 401/403 | `ERROR` | Authentication or authorization unavailable. |
| 408 or 504 | `ERROR` | Request timeout or gateway timeout. |
| 5xx or network failure | `ERROR` or `STALE` | Initial failure is `ERROR`; refresh failure after history is `STALE`. |

## WebSocket event envelope

**PROPOSED — REQUIRES PERSON 2 APPROVAL — NOT IMPLEMENTED**
A single topic-based WebSocket is sufficient for discussion, but its endpoint,
authentication, subscription model, replay behavior, delivery guarantee, and
message schema are not implemented.

```json
{
  "messageId": "01J...",
  "occurredAt": "2026-11-20T10:00:01.000Z",
  "type": "event.persisted",
  "sourceId": "source-01",
  "payload": {
    "eventId": "source-01:1",
    "vaultSequence": 1,
    "streamId": "auth.log",
    "observationSource": "host-agent",
    "vaultReceivedAt": "2026-11-20T10:00:01.000Z",
    "correlationStatus": "PENDING"
  }
}
```

The envelope fields shown above are proposed:

| Field | Requirement |
| --- | --- |
| `messageId` | Unique server-assigned ID for duplicate suppression. |
| `occurredAt` | UTC RFC 3339 timestamp for the server event. |
| `type` | One of the approved Person 2 event types. |
| `sourceId` | Required when a source applies; may be omitted for source-independent scenario or service events. |
| `payload` | Type-specific object; fields and identifiers are unapproved until Person 2 signs off. |

Architecturally approved/Person 2-proposed event type names:
`event.persisted`,
`event.reconciled`,
`batch.created`,
`batch.anchored`,
`verification.completed`,
`collector.heartbeat`,
`collector.gap`,
and `scenario.updated`. Exact payload structures and type-name approval remain pending.

`event.persisted` is emitted only after successful durable Vault persistence.
It must not be emitted merely on ingest or socket reception.

### Reconnect behavior

**PROPOSED — REQUIRES PERSON 2 APPROVAL — NOT IMPLEMENTED**

The dashboard does not promise durable WebSocket replay or ordered delivery.
After any reconnect, the dashboard must:

1. mark live transport as reconnecting/disconnected during the gap;
2. keep the last successful REST snapshot visible and show its observation time;
3. reconnect using bounded backoff;
4. after a successful WebSocket open, trigger a REST refetch of the affected
   source/event/batch/gap resources;
5. move to connected only after the socket opens and do not move live history
   to durable state merely because a frame was received.

An individual message may trigger a REST refetch only when approved, but no
dashboard view may append a live frame as proof of vault persistence. If replay
or resume semantics are unavailable, REST refetch is the recovery boundary.

### Ordering and duplicate suppression

**PROPOSED — REQUIRES PERSON 2 APPROVAL — NOT IMPLEMENTED**

For a source, the Vault-assigned `vaultSequence` is monotonically ordered within
that source and is shared by Host Agent and rsyslog TCP observations. The
dashboard should display rows in ascending `vaultSequence` order for one source.
Sequence gaps and continuity interpretation require final approval.

The dashboard should suppress:

- exact duplicate `messageId` values in WebSocket notifications;
- exact duplicate event identities `(sourceId, vaultSequence)` returned by REST;
- duplicate batched or gap notifications until approved resource identity rules
  are defined.

The dashboard must not deduplicate evidence records using `fileIdentity` or
`byteOffset`. Identical Host Agent delivery-ID retries return the original
receipt and conflicting reuse returns HTTP 409. Repeated rsyslog observations
remain separate Vault records. Host Agent and rsyslog observations of the same
line remain separate and may be correlated later.

Suppression must be bounded and must not discard a REST snapshot. A lower or
missing `vaultSequence` than the current rendered high-water mark should be
marked out of order and reconciled by REST, not reordered by socket arrival.

No WebSocket frame is an acknowledgement of durable vault persistence. The
event read API and `vaultPersistenceStatus` are the proposed durable-evidence
authority.

## Evidence export response

**PROPOSED / ZIP EXPORT NOT IMPLEMENTED — PENDING FINAL SIGN-OFF**

ZIP export is not implemented. Planned export content includes the manifest,
original raw bytes, Merkle proofs, the signed batch commitment, and chain
metadata. The final manifest schema and fixture layout remain pending.

For the planned integrity design, the manifest may hash included bundle members
except itself to avoid circular hashing. The exact manifest hash convention,
member names, ZIP layout, and file metadata are not approved and must not be
invented as an implementation contract.

The transport may expose a manifest JSON response with a bundle download URL
only if Person 2 defines and approves an explicit integrity binding.

```json
{
  "bundleId": "bundle-source-01-batch-000001",
  "batchId": "source-01-batch-000001",
  "sourceId": "source-01",
  "contentSha256": "0x...",
  "download": {
    "filename": "trusttrace-source-01-batch-000001.bundle",
    "mediaType": "application/octet-stream"
  }
}
```

## Contract questions for interface freeze

- Person 1 confirms canonical byte encoding, domain tags, Merkle odd-leaf rule, proof format, EIP-712 commitment digest, contract ABI, and test vectors.
- Person 2 confirms API paths, pagination, status/error vocabulary, access control, WebSocket replay and ordering behaviour, durable-receipt meaning, and evidence-export transport.
- Person 3 confirms source and stream identifiers, host-comparison inputs, heartbeat timing, scenario IDs, and expected scenario outputs.
