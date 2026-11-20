# TRUSTTRACE Person 4 team interface approval

## Purpose

This record lists the decisions required before Person 4 implements the dashboard, auditor CLI, and end-to-end tests. It reflects the current repository audit. Person 1's shared core and blockchain work are available only on `origin/feature/crypto-contract`. Person 2 and Person 3 implementation branches and contracts are not currently available.

**PROPOSED — REQUIRES TEAM APPROVAL** No item below is a final interface until its owner records an approved value in the shared implementation or contract documentation.

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

- [ ] Confirm the final dashboard read routes, request parameters, pagination, source scoping, and error response shape.
- [ ] Confirm the event, batch, verification-result, health, and evidence-detail response fields.
- [ ] Confirm vault-assigned sequence ownership, durable-receipt acknowledgement point, reconciliation state vocabulary, and retention of raw bytes.
- [ ] Confirm WebSocket endpoint, authentication, subscription scope, event envelope, replay or resumption semantics, duplicate handling, ordering, and liveness behaviour.
- [ ] Confirm evidence-export transport and bundle content, including manifest fields, file hashes, raw-evidence representation, proof material, and bundle-versioning rule.
- [ ] Confirm server verification labels are reported as server results and remain distinct from direct-RPC CLI verification.

## Person 3 approvals

- [ ] Confirm source IDs, agent and rsyslog stream IDs, source-key identity, and host timestamp representation.
- [ ] Confirm host-comparison input shape and how edits, deleted records, wiped files, and unavailable host records are represented.
- [ ] Confirm heartbeat cadence, timeout threshold, collector-gap payload, and the distinction between delayed delivery and an unobserved interval.
- [ ] Confirm controlled scenario IDs, execution ownership, expected event and verification outputs, and reset procedure.
- [ ] Confirm reproducible inputs for normal SSH activity, host tamper, agent interruption, and dual-stream divergence E2E cases.

## Approval gate

Person 4 Phase 0 is ready for team approval once Persons 1, 2, and 3 approve their respective sections and the group decides the repository workspace paths, one package manager with its lockfile, and the shared-core import name. Until then, the Person 4 specifications are implementation-ready proposals, while frontend and CLI source code remain intentionally deferred.
