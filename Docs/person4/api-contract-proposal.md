# Person 4 API and WebSocket contract proposal

## Status

**PROPOSED — REQUIRES TEAM APPROVAL** This document consumes interfaces owned by Person 2. It describes the minimum dashboard and auditor-facing contract suggested by the project blueprint and does not define final backend endpoints. Person 2 owns API schemas and Person 1 owns cryptographic representations.

All timestamps are UTC RFC 3339 strings. Hashes, roots, signatures, and transaction hashes are strings whose final encoding is defined by the shared contracts and crypto test vectors. Raw payloads remain losslessly encoded bytes. JSON object property order must never define a cryptographic digest.

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

**PROPOSED — REQUIRES TEAM APPROVAL** The paths below reproduce the blueprint’s suggested resource names solely to make the UI contract concrete. They are not final endpoint commitments.

| Operation | Illustrative path | Dashboard need |
| --- | --- | --- |
| Query event index | `GET /api/v1/events` | paged history, filters, source/stream status |
| Fetch evidence record | `GET /api/v1/events/:sequence` | preserved bytes, comparison and proof metadata |
| List batches | `GET /api/v1/batches` | anchor list and latest commitment |
| Fetch batch | `GET /api/v1/batches/:batchId` | batch detail and chain reference |
| Verify batch | `POST /api/v1/verify/batch/:batchId` | server-reported verification run |
| Verify event | `POST /api/v1/verify/event/:sequence` | server-reported event verification run |
| Export bundle | `GET /api/v1/export/:batchId` | auditor download |
| Service health | `GET /api/v1/health` | connection and dependency display |
| Controlled scenario | `POST /api/v1/simulations/:scenario` | demo control only if approved |

List responses need a stable cursor or equivalent pagination mechanism, an explicit `observedAt` timestamp, and a source-scoping rule. Error responses should include a machine-readable `code`, safe message, and correlation/request ID where available.

## Client request states

**PROPOSED — REQUIRES TEAM APPROVAL** Each HTTP-backed dashboard view uses `LOADING`, `READY`, `EMPTY`, `ERROR`, and `STALE` states. `STALE` means a previously successful response remains visible but cannot be refreshed. An event, batch, proof, or raw-evidence detail is never inferred from a failed or empty response.

| Condition | Required client state | Required display |
| --- | --- | --- |
| Initial query pending | `LOADING` | stable skeleton or progress text |
| Successful query with no records | `EMPTY` | query scope and absence of returned records |
| Timeout, unavailable service, or non-success response | `ERROR` | safe message, response code when supplied, retry action |
| Refresh or live transport unavailable after prior data | `STALE` | last successful observation time and reconnect or retry state |
| Evidence member unavailable | `ERROR` for that member | explicit `MISSING_FROM_VAULT` or `UNVERIFIABLE` result when verification reports it |

## WebSocket event envelope

**PROPOSED — REQUIRES TEAM APPROVAL** A single topic-based WebSocket is sufficient for the dashboard’s live feed. Final connection URL, authentication, subscription model, replay behavior, and delivery guarantee belong to Person 2.

```json
{
  "type": "event.received",
  "occurredAt": "2026-11-20T10:00:01.000Z",
  "sourceId": "source-01",
  "data": {
    "eventId": "source-01-agent-000001",
    "vaultSequence": 1,
    "streamId": "agent",
    "vaultReceivedAt": "2026-11-20T10:00:01.000Z",
    "correlationStatus": "PENDING"
  }
}
```

Proposed `type` values are `event.received`, `event.reconciled`, `batch.created`, `batch.anchored`, `verification.completed`, `collector.heartbeat`, `collector.gap`, and `scenario.updated`.

Every live message needs an event/message ID and an `occurredAt` value. The client treats it as a freshness signal and refetches the affected resource after reconnect or an out-of-order message. A WebSocket message never substitutes for vault durable-receipt semantics.

**PROPOSED — REQUIRES TEAM APPROVAL** The WebSocket contract must define whether messages are replayable, how the client resumes after a disconnect, source subscription scope, heartbeat or ping behaviour, authentication, and whether a received frame may be duplicated. Until this is approved, the dashboard must treat reconnect as a refetch boundary and label the live feed stale during the gap.

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
