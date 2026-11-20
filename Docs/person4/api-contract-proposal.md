# Person 4 API and WebSocket contract proposal

## Status

**PROPOSED — REQUIRES TEAM APPROVAL** This document consumes interfaces owned by Person 2. It describes the minimum dashboard and auditor-facing contract suggested by the project blueprint and does not define final backend endpoints. Person 2 owns API schemas and Person 1 owns cryptographic representations.

All timestamps are UTC RFC 3339 strings. Hashes, roots, signatures, and transaction hashes are strings whose final encoding is defined by the shared contracts and crypto test vectors. Raw payloads remain losslessly encoded bytes. JSON object property order must never define a cryptographic digest.

## Evidence and anchoring status boundaries

**PROPOSED — REQUIRES TEAM APPROVAL — NOT IMPLEMENTED**

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
| `LOCAL_ANCHOR_SERVER_REPORTED` | API reports a local Hardhat anchor. |
| `PUBLIC_ANCHOR_SERVER_REPORTED` | API reports a public Quai anchor. |
| `RPC_VERIFIED` | Direct-RPC verification independently confirms the commitment. |
| `UNVERIFIABLE` | RPC or required evidence was unavailable. |
| `CHAIN_MISMATCH` | Independent verification found a commitment mismatch. |
| `COLLECTION_GAP` | A collection window was missed. It does not establish event occurrence. |

All names above are proposals and require Person 2 and shared-interface
approval. The dashboard must retain separate fields or cards when multiple
levels exist; it must not replace local/public status with a generic
`VERIFIED` badge.

## Read models

### Event

```json
{
  "eventId": "source-01-agent-000001",
  "sourceId": "source-01",
  "streamId": "agent",
  "hostTimestamp": "2026-11-20T10:00:00.000Z",
  "vaultReceivedAt": "2026-11-20T10:00:01.000Z",
  "vaultSequence": 1,
  "rawPayloadBase64": "BASE64_ENCODED_ORIGINAL_BYTES",
  "payloadSha256": "0x...",
  "signature": "0x...",
  "keyId": "source-01-key-01",
  "correlationStatus": "PENDING"
}
```

`rawPayloadBase64`, `signature`, and host-comparison material may be withheld from list responses and supplied by an evidence-detail response. `vaultSequence` is assigned by the vault. The final uniqueness and ordering rule requires Person 2 approval.

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
| Fetch evidence record | `GET /api/v1/events/:sequence` | preserved bytes, comparison and proof metadata |
| Fetch batch | `GET /api/v1/batches/:batchId` | batch detail and chain reference |
| Verify batch | `POST /api/v1/verify/batch/:batchId` | server-reported verification run |
| Verify event | `POST /api/v1/verify/event/:sequence` | server-reported event verification run |
| Export bundle | `GET /api/v1/export/:batchId` | auditor download |
| Service health | `GET /api/v1/health` | connection and dependency display |
| Controlled scenario | `POST /api/v1/simulations/:scenario` | demo control only if approved |

The ingest operation is confirmed implemented:

```text
POST /api/v1/logs/ingest
```

This confirmed ingestion route is not evidence for a read contract. Its request and
response fields remain governed by Person 2's ingest implementation and are not
proposed or consumed as dashboard live read models here.

## Proposed read-resource contracts

### Common list query parameters

**PROPOSED — NOT IMPLEMENTED**

| Parameter | Type | Proposed meaning |
| --- | --- | --- |
| `sourceId` | string | Scope the result to one source. |
| `cursor` | string | Opaque stable cursor; cursor contents must not be interpreted by the dashboard. |
| `limit` | integer | Maximum page size. Person 2 must define the allowed range and default. |
| `observedAtFrom` | RFC 3339 UTC string | Inclusive lower observation-time bound. |
| `observedAtTo` | RFC 3339 UTC string | Inclusive upper observation-time bound. |

All list responses should include the server observation time and an opaque continuation
cursor if another page exists.

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
| `streamId` | Proposed values `agent` or `rsyslog`. Person 3 owns final identifiers. |
| `sequenceFrom` | Inclusive vault-sequence lower bound for one source. |
| `sequenceTo` | Inclusive vault-sequence upper bound for one source. |
| `batchId` | Batch containing or associated with the event. |
| `correlationStatus` | Proposed `PENDING`, `MATCHED`, `AGENT_ONLY`, `SYSLOG_ONLY`, or `LATE_ARRIVAL`. Final vocabulary requires approval. |
| `evidenceStatus` | Proposed operational status filter. |
| `cursor`, `limit`, `observedAtFrom`, `observedAtTo` | Common paging and time filters. |

Success shape:

```json
{
  "observedAt": "2026-11-20T10:43:03.000Z",
  "items": [
    {
      "eventId": "source-01-agent-000001",
      "sourceId": "source-01",
      "streamId": "agent",
      "hostTimestamp": "2026-11-20T10:00:00.000Z",
      "vaultReceivedAt": "2026-11-20T10:00:01.000Z",
      "vaultSequence": 1,
      "payloadSha256": "0x...",
      "correlationStatus": "PENDING",
      "vaultPersistenceStatus": "PERSISTED",
      "batchId": null
    }
  ],
  "nextCursor": null
}
```

List events may omit raw bytes and proof material. The proposal requires explicit
`vaultPersistenceStatus` so a UI frame cannot infer durable preservation from
reception alone.

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
cursor and limit values, and common observation-time filters.

```json
{
  "observedAt": "2026-11-20T10:43:03.000Z",
  "items": [
    {
      "gapId": "gap-source-01-agent-2026-11-20T10",
      "sourceId": "source-01",
      "streamId": "agent",
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

Successful list responses use the common shape above. Person 2 must confirm
whether a paged response may use an HTTP `Link` header, a response `nextCursor`,
or both. The dashboard must treat cursor opacity as an implementation detail.

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
  "type": "event.received",
  "sourceId": "source-01",
  "payload": {
    "eventId": "source-01-agent-000001",
    "vaultSequence": 1,
    "streamId": "agent",
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

Person 2 proposes the following event type names:
`event.received`,
`event.reconciled`,
`batch.created`,
`batch.anchored`,
`verification.completed`,
`collector.heartbeat`,
`collector.gap`,
and `scenario.updated`.

These names are not final and no dashboard mapping is implemented.

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

For a source, the vault-assigned `vaultSequence` is proposed as the monotonic
display key. The dashboard should display rows in ascending `vaultSequence`
order. Person 2 must confirm the exact source-and-stream sequence scope, whether
`vaultSequence` is global per vault, source-local, or stream-local, and whether
sequence gaps are possible or indicate continuity failure.

The dashboard should suppress:

- exact duplicate `messageId` values;
- exact duplicate event identities returned by REST or WebSocket mapping;
- duplicate batched or gap notifications until approved resource identity rules
  are defined.

Suppression must be bounded by a retained-message/event ID window and must not
discard a REST snapshot. A lower or missing `vaultSequence` than the current
rendered high-water mark should be marked out of order and refetched rather
than rewritten by arrival order. Sequence reassignment after a message is
received is a REST-authoritative change and must be handled by refetch.

No WebSocket frame is an acknowledgement of durable vault persistence. The
event read API and `vaultPersistenceStatus` are the proposed durable-evidence
authority.

## Evidence export response

**PROPOSED — REQUIRES TEAM APPROVAL** Export must return a binary archive or directory representation plus a manifest that the independent CLI can validate without dashboard state. The transport may expose a manifest JSON response with a bundle download URL only if its integrity binding is explicit.

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
