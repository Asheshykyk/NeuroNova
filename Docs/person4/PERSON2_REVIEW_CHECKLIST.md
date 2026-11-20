# Person 2 interface review checklist

**Status: PROPOSED — SIGN-OFF REQUIRED**

Person 2: review the proposed REST and WebSocket interfaces in
[api-contract-proposal.md](./api-contract-proposal.md). Sign-off is required
before Person 4 may implement provisional live mappings.

## Confirmed

- [x] `POST /api/v1/logs/ingest` is implemented.
- [ ] Event read APIs are implemented.
- [ ] Source read APIs are implemented.
- [ ] Batch read APIs are implemented.
- [ ] Checkpoint read APIs are implemented.
- [ ] Gap read APIs are implemented.
- [ ] WebSocket server is implemented.
- [ ] ZIP export is implemented.
- [ ] Dashboard live mode is enabled.

## REST review

Approve or replace each item:

- [ ] Final paths and HTTP methods for sources, events, batches, checkpoints, gaps,
  evidence detail, health, verification, and export.
- [ ] Event, batch, checkpoint, gap, and source success field names.
- [ ] Query filters and source-scoping rules.
- [ ] Stable cursor pagination and page-size limits.
- [ ] UTC observation timestamp field and empty-page behavior.
- [ ] HTTP status mapping and machine-readable error envelope.
- [ ] Authentication and authorization requirements.
- [ ] Durable vault persistence acknowledgement point.
- [ ] Raw payload retention and whether it is exposed in list/detail responses.

## Sequence and duplicate review

- [ ] Is `vaultSequence` global, source-local, or stream-local?
- [ ] Which fields create the unique event identity?
- [ ] Is ascending `vaultSequence` the required read/API order?
- [ ] How are gaps, late arrivals, reassignment, and reconciliation represented?
- [ ] Which fields identify an exact duplicate WebSocket frame?
- [ ] What duplicate-suppression window is available or required?

## WebSocket review

- [ ] Confirm the final endpoint and connection authentication.
- [ ] Confirm subscription and source-scope behavior.
- [ ] Confirm or replace `messageId`, `occurredAt`, `type`, `sourceId`, and `payload`.
- [ ] Confirm or replace the proposed event type names.
- [ ] Confirm ping/pong and heartbeat behavior.
- [ ] Confirm whether reconnect resume or replay is supported.
- [ ] Confirm no replay is promised for the first Phase 1C integration.
- [ ] Confirm REST refetch after reconnect is sufficient to recover missed frames.
- [ ] Confirm duplicate-frame delivery behavior.
- [ ] Confirm payload identity fields for each event type.

## Status boundary review

- [ ] `VAULT_PERSISTED` means the approved durable-receipt point.
- [ ] Local Hardhat anchor status remains separate from public Quai status.
- [ ] Public Quai anchor status remains
  `ANCHORED_SERVER_REPORTED` unless direct-RPC verification succeeds.
- [ ] Public target is **Quai Orchard Cyprus-1, chain ID 15000**.
- [ ] Independent verification status is based only on direct-RPC or approved CLI output.
- [ ] Missing chain proof is not displayed as tampering.
- [ ] `COLLECTION_GAP` is not interpreted as evidence that an event occurred.

## Final sign-off

- [ ] Person 2 approves the REST contract.
- [ ] Person 2 approves the WebSocket contract.
- [ ] Person 2 approves the sequence and duplicate rules.
- [ ] Person 2 approves status and error vocabulary.
- [ ] Person 4 may begin only REST/WebSocket mapping work after sign-off.

Sign-off record (Person 2):

```text
Approved on:
Approved branch/commit:
Approved contract document or implementation reference:
Known deviations from this proposal:
```
