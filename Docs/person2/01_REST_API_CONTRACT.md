# Person 2 REST API Contract

Base path: `/api/v1`

All timestamps are UTC RFC 3339 strings. Decimal uint64 values are JSON strings. Hashes and hexadecimal identifiers are `0x`-prefixed strings. Raw evidence is never included in list responses.

## Pagination

The implemented list endpoints accept:

- `limit`: optional positive decimal integer, default `100`, maximum `1000`
- `cursor`: optional opaque base64url cursor

Successful list responses use:

```json
{
  "items": [],
  "nextCursor": null
}
```

`nextCursor` is `null` when no later page exists. Pass it unchanged as the `cursor` query parameter to retrieve the next page.

Cursors are backend opaque values. Clients must not parse or construct them.

## Error response

```json
{
  "code": "INVALID_CURSOR",
  "error": "Malformed or invalid cursor"
}
```

- `code`: machine-readable error identifier
- `error`: safe human-readable message

Current codes include `INVALID_CURSOR`, `INVALID_LIMIT`, `INVALID_SOURCE_ID`, `SOURCE_ID_REQUIRED`, `INVALID_EVENT_IDENTITY`, `INVALID_VAULT_SEQUENCE`, `EVENT_NOT_FOUND`, `BAD_REQUEST`, and `INTERNAL_ERROR`. Implementations may add codes; clients should safely handle unknown codes.

## GET `/api/v1/sources`

Lists sources discovered from persisted evidence JSONL records.

### Query parameters

| Parameter | Required | Type | Description |
|---|---:|---|---|
| `limit` | No | decimal integer | 1–1000, default 100 |
| `cursor` | No | opaque string | Cursor returned by a prior response |

### Example response: `200 OK`

```json
{
  "items": [
    {
      "sourceId": "0x1111111111111111111111111111111111111111111111111111111111111111",
      "eventCount": 2,
      "latestVaultSequence": "2",
      "latestReceiptAt": "2026-11-21T07:00:00.000Z"
    }
  ],
  "nextCursor": null
}
```

### Field notes

- `sourceId`: 32-byte source identifier, normalized to `0x` plus 64 hexadecimal characters.
- `eventCount`: number of persisted evidence records for the source.
- `latestVaultSequence`: **decimal string**, not a JSON number.
- `latestReceiptAt`: UTC RFC 3339 timestamp from persisted vault receipt metadata.

### Status codes

- `200 OK`
- `400` for malformed `limit` or `cursor`
- `500` for an unexpected server/storage error

## GET `/api/v1/events`

Lists persisted evidence events. Evidence is read from JSONL; SQLite is not the integrity source.

### Query parameters

| Parameter | Required | Type | Description |
|---|---:|---|---|
| `sourceId` | No | bytes32 hex | Filter by a source identifier |
| `limit` | No | decimal integer | 1–1000, default 100 |
| `cursor` | No | opaque string | Cursor returned by a prior response |

### Example response: `200 OK`

```json
{
  "items": [
    {
      "eventId": "0x1111111111111111111111111111111111111111111111111111111111111111-000000000001",
      "sourceId": "0x1111111111111111111111111111111111111111111111111111111111111111",
      "vaultSequence": "1",
      "streamId": "host-agent",
      "hostTimestamp": "2024-11-20T23:31:40.000Z",
      "vaultReceivedAt": "2026-11-21T07:00:00.000Z",
      "deliveryId": "550e8400-e29b-41d4-a716-446655440000",
      "fileIdentity": "auth.log",
      "byteOffset": "1024",
      "observationSource": "host-agent",
      "payloadSha256": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "batchId": null,
      "verificationStatus": "VAULT_PERSISTED"
    }
  ],
  "nextCursor": null
}
```

### Field notes

- `vaultSequence`: **decimal string**, not a JSON number.
- `hostTimestamp`: converted from persisted `observedAt` nanoseconds. The value is UTC ISO-8601. It is `null` when `observedAt` is absent or invalid.
- `payloadSha256`: SHA-256 of the original raw event bytes, with `0x` prefix.
- `deliveryId`, `fileIdentity`, `byteOffset`, and `observationSource`: `null` when absent from the persisted record.
- `byteOffset`: decimal string when present.
- `batchId`: `null` until the evidence is included in a persisted batch.
- `verificationStatus`: local backend status known from batch/anchor state: `VAULT_PERSISTED`, `ANCHOR_PENDING`, `ANCHORED`, or `ANCHOR_FAILED`.

### Status codes

- `200 OK`
- `400 INVALID_SOURCE_ID` for malformed `sourceId`
- `400 INVALID_LIMIT` for malformed or out-of-range `limit`
- `400 INVALID_CURSOR` for malformed `cursor`
- `500` for an unexpected server/storage error

## GET `/api/v1/events/:sourceId/:vaultSequence`

Fetches one persisted evidence record by source-local identity.

### Path parameters

| Parameter | Required | Type | Description |
|---|---:|---|---|
| `sourceId` | Yes | bytes32 hex | 32-byte source identifier |
| `vaultSequence` | Yes | decimal string | Positive uint64 vault sequence |

### Example response: `200 OK`

```json
{
  "eventId": "0x1111111111111111111111111111111111111111111111111111111111111111-000000000001",
  "sourceId": "0x1111111111111111111111111111111111111111111111111111111111111111",
  "vaultSequence": "1",
  "streamId": "host-agent",
  "hostTimestamp": "2024-11-20T23:31:40.000Z",
  "vaultReceivedAt": "2026-11-21T07:00:00.000Z",
  "deliveryId": "550e8400-e29b-41d4-a716-446655440000",
  "rawPayloadBase64": "ZXZlbnQtZGV0YWls",
  "payloadSha256": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "signature": null,
  "keyId": null,
  "correlationStatus": null,
  "batchId": null,
  "verificationStatus": "VAULT_PERSISTED",
  "merkleProof": null
}
```

### Field notes

- `vaultSequence`: **decimal string**, not a JSON number.
- `hostTimestamp`: nanosecond `observedAt` converted to UTC ISO-8601, or `null` if unavailable or invalid.
- `rawPayloadBase64`: exact persisted raw evidence bytes encoded as Base64.
- `payloadSha256`: SHA-256 of the decoded original raw bytes, with `0x` prefix.
- `signature`: `null` when unavailable. Evidence JSONL records do not currently persist an event signature or key ID for detail responses.
- `keyId`: `null` when unavailable.
- `correlationStatus`: `null` when unavailable. The implementation does not synthesize `PENDING`.
- `merkleProof`: core Merkle proof object when the event belongs to a batch; otherwise `null`.
- `batchId`: `null` while the evidence is not batched.

### Status codes

- `200 OK`
- `400 INVALID_EVENT_IDENTITY` for an invalid source or missing identity
- `400 INVALID_VAULT_SEQUENCE` for malformed, negative, zero, or out-of-uint64-range sequence values
- `404 EVENT_NOT_FOUND` when no matching JSONL evidence record exists
- `500` for an unexpected server/storage error

## GET `/api/v1/events/:vaultSequence`

Source-scoped convenience route. Vault sequences are source-local, so it also requires `sourceId`.

### Path parameters

| Parameter | Required | Type | Description |
|---|---:|---|---|
| `vaultSequence` | Yes | decimal string | Positive uint64 source-local sequence |

### Query parameters

| Parameter | Required | Type | Description |
|---|---:|---|---|
| `sourceId` | Yes | bytes32 hex | 32-byte source identifier |

The response and status codes are identical to `GET /api/v1/events/:sourceId/:vaultSequence`.

- Missing `sourceId`: `400 SOURCE_ID_REQUIRED`
- Malformed `sourceId`: `400 INVALID_EVENT_IDENTITY` or `400 INVALID_SOURCE_ID`
- Malformed `vaultSequence`: `400 INVALID_VAULT_SEQUENCE`

## GET `/api/v1/batches`

Lists persisted evidence batches and known local anchor references.

### Query parameters

| Parameter | Required | Type | Description |
|---|---:|---|---|
| `sourceId` | No | bytes32 hex | Filter by source identifier |
| `limit` | No | decimal integer | 1–1000, default 100 |
| `cursor` | No | opaque string | Cursor returned by a prior response |

### Example response: `200 OK`

```json
{
  "items": [
    {
      "batchId": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "sourceId": "0x1111111111111111111111111111111111111111111111111111111111111111",
      "startSequence": "1",
      "endSequence": "2",
      "leafCount": 2,
      "merkleRoot": "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "previousBatchRoot": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "commitmentHash": "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      "createdAt": "2026-11-21T07:00:05.000Z",
      "transactionHash": null,
      "chainId": null,
      "blockNumber": null,
      "anchorStatus": "ANCHOR_PENDING"
    }
  ],
  "nextCursor": null
}
```

### Field notes

- `startSequence` and `endSequence`: **decimal strings**, not JSON numbers.
- `leafCount`: JSON integer.
- `previousBatchRoot`: persisted `previousCheckpointHash`, not a separately persisted previous Merkle root.
- `commitmentHash`: EIP-712 batch commitment struct hash.
- `transactionHash`: `null` until a submitted local anchor transaction is recorded.
- `chainId`: `null` until known from a recorded anchor status.
- `blockNumber`: `null` until confirmed receipt metadata provides a block number.
- `anchorStatus`: `ANCHOR_PENDING`, `ANCHOR_FAILED`, or `ANCHORED` according to local worker status. A batch with no worker status is reported as `ANCHOR_PENDING`.
- `sourceKeyId` and `contractAddress`: not implemented in this response.

### Status codes

- `200 OK`
- `400 INVALID_SOURCE_ID` for malformed `sourceId`
- `400 INVALID_LIMIT` for malformed or out-of-range `limit`
- `400 INVALID_CURSOR` for malformed `cursor`
- `500` for an unexpected server/storage error

## GET `/api/v1/checkpoints`

Lists public aggregate checkpoints.

### Query parameters

| Parameter | Required | Type | Description |
|---|---:|---|---|
| `limit` | No | decimal integer | 1–1000, default 100 |

### Example response: `200 OK`

```json
{
  "items": [],
  "nextCursor": null
}
```

The response is intentionally empty because this implementation does not persist or expose public checkpoint records.

### Status codes

- `200 OK`
- `400 INVALID_LIMIT` for malformed or out-of-range `limit`
- `500` for an unexpected server/storage error

## GET `/api/v1/gaps`

Lists missing source-local vault sequences reconstructed from persisted evidence JSONL.

### Query parameters

| Parameter | Required | Type | Description |
|---|---:|---|---|
| `sourceId` | No | bytes32 hex | Filter by source identifier |
| `limit` | No | decimal integer | 1–1000, default 100 |
| `cursor` | No | opaque string | Cursor returned by a prior response |

### Example response: `200 OK`

```json
{
  "items": [
    {
      "sourceId": "0x1111111111111111111111111111111111111111111111111111111111111111",
      "gapType": "SEQUENCE_GAP",
      "startSequence": "3",
      "endSequence": "5",
      "missingSequences": ["3", "4", "5"]
    }
  ],
  "nextCursor": null
}
```

### Field notes

- `sourceId`: source whose local sequence range contains gaps.
- `startSequence` and `endSequence`: **decimal strings**, not JSON numbers.
- `missingSequences`: decimal strings.
- `gapType`: always `SEQUENCE_GAP`. This endpoint does not generate heartbeat or collection-gap records.
- The gap is reconstructed by comparing existing JSONL evidence sequences from 1 through each source's observed sequence list.

### Status codes

- `200 OK`
- `400 INVALID_SOURCE_ID` for malformed `sourceId`
- `400 INVALID_LIMIT` for malformed or out-of-range `limit`
- `400 INVALID_CURSOR` for malformed `cursor`
- `500` for an unexpected server/storage error
