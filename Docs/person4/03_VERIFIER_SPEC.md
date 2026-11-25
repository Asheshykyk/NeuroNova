# Independent auditor CLI verifier specification

## Purpose and boundary

The Person 4 CLI uses `@trusttrace/core` to independently validate an exported evidence bundle. It recomputes evidence hashes and Merkle material locally and reads the relevant commitment from the blockchain through read-only RPC. It does not trust a dashboard verdict, the vault index, or an API-provided verification result.

**PROPOSED — REQUIRES TEAM APPROVAL** The command name, flags, manifest version, archive format, contract-call details, and result schema below require the shared interface freeze. Person 1 owns the cryptographic and contract conventions. Person 2 exports the bundle. Person 3 supplies reproducible source and attack inputs.

## CLI input

Illustrative invocation:

```text
trusttrace verify --bundle <path> --rpc-url <url>
```

The verifier accepts a local exported bundle and a read-only RPC URL. The bundle must declare, or the user must provide through approved configuration, the chain ID, contract address, contract ABI/version reference, and batch identifier.

Optional host-comparison input may be a lossless host-record export. Its absence yields no host comparison verdict and does not prevent vault-and-chain verification.

## Evidence bundle requirements

The archive must include a deterministic manifest and sufficient material to validate every advertised finding.

| Bundle member | Requirement |
| --- | --- |
| `manifest` | bundle version, bundle ID, source ID, batch ID, chain ID, contract address, expected commitment fields, hashes of included files, and algorithm/version references |
| raw evidence | exact vault-preserved bytes for the selected sequence range, with vault sequence and stream identity |
| event metadata | source ID, stream ID, receipt time, payload hash, signature/key metadata, and reconciliation state |
| batch metadata | sequence range, leaf count, root, previous root or chain-head reference, creation time, and anchor transaction reference when known |
| proof material | inclusion proof(s) or the complete batch leaves needed to recompute the deterministic root |
| crypto contract reference | canonical encoding, hash, Merkle, proof, and signature algorithm version identifiers plus the applicable test-vector/version reference |
| optional host comparison | host observation bytes and clear provenance when a host comparison was requested |

The bundle must preserve raw evidence independently of parsed display fields. The verifier fails closed when a manifest-declared member is missing or its file hash differs. A vault SQLite index is never a required integrity source.

## Verification procedure

1. Read and validate the manifest shape and bundle-member hashes.
2. Load the approved algorithm implementation from `@trusttrace/core` using the declared compatible format version.
3. Recompute each payload hash from exact preserved bytes.
4. Recompute leaves and either validate inclusion proofs or recompute the deterministic batch root in vault-sequence order.
5. Query the declared contract through the supplied read-only RPC endpoint.
6. Compare source ID, batch ID, sequence range, root, and continuity reference with the on-chain commitment according to the frozen contract interface.
7. Validate host comparison input when present, preserving a distinct result for missing, altered, and unavailable host material.
8. Emit a machine-readable result and a concise human-readable summary. Exit status reflects the result class agreed at interface freeze.

The verifier reports an RPC failure as `UNVERIFIABLE` or a more specific transport status. It must not claim a successful blockchain check from a transaction hash stored only in the bundle.

An offline bundle check can establish only local bundle integrity and recomputed Merkle material. The overall result is `VERIFIED` only when the direct-RPC chain commitment check also succeeds. A successful local recomputation with unavailable RPC remains `UNVERIFIABLE` for independent blockchain verification.

## Result schema

```json
{
  "bundleId": "bundle-source-01-batch-000001",
  "subject": { "sourceId": "source-01", "batchId": "source-01-batch-000001" },
  "status": "VERIFIED",
  "checks": {
    "manifest": "VERIFIED",
    "payloadHashes": "VERIFIED",
    "merkleRoot": "VERIFIED",
    "chainCommitment": "VERIFIED",
    "sequenceContinuity": "VERIFIED",
    "hostComparison": "NOT_REQUESTED"
  },
  "expectedMerkleRoot": "0x...",
  "computedMerkleRoot": "0x...",
  "chain": {
    "chainId": "<approved-value>",
    "contractAddress": "0x...",
    "rpcUrl": "<redacted-or-identifier>",
    "transactionHash": "0x..."
  },
  "affectedSequences": [],
  "verifiedAt": "2026-11-20T10:05:00.000Z",
  "verifierVersion": "<package-version>"
}
```

Proposed result statuses are `VERIFIED`, `CONTENT_MISMATCH`, `MISSING_FROM_HOST`, `MISSING_FROM_VAULT`, `BATCH_NOT_ANCHORED`, `SEQUENCE_GAP`, `INVALID_PROOF`, `SIGNATURE_INVALID`, `COLLECTION_GAP`, and `UNVERIFIABLE`. `NOT_REQUESTED` applies only to an individual optional check.

## Failure reasons

**PROPOSED — REQUIRES TEAM APPROVAL** The machine-readable result includes a per-check reason code. The following minimum reasons keep a bundle-format failure distinct from a direct-RPC failure.

| Result | Example reason codes |
| --- | --- |
| `INVALID_PROOF` | `MANIFEST_MEMBER_MISSING`, `MANIFEST_HASH_MISMATCH`, `PROOF_STEP_INVALID`, `MERKLE_ROOT_MISMATCH` |
| `CONTENT_MISMATCH` | `PAYLOAD_HASH_MISMATCH`, `HOST_BYTES_DIFFER` |
| `BATCH_NOT_ANCHORED` | `CONTRACT_BATCH_NOT_FOUND`, `COMMITMENT_FIELDS_DIFFER` |
| `SEQUENCE_GAP` | `BUNDLE_RANGE_DISCONTINUITY`, `CHAIN_CONTINUITY_MISMATCH` |
| `SIGNATURE_INVALID` | `SOURCE_SIGNATURE_INVALID`, `ANCHOR_SIGNATURE_INVALID` |
| `UNVERIFIABLE` | `RPC_UNAVAILABLE`, `CHAIN_ID_MISMATCH`, `CONTRACT_ADDRESS_MISMATCH`, `UNSUPPORTED_FORMAT_VERSION` |

## Auditor-facing conclusions

The result must distinguish the following claims.

- `VERIFIED` means the available preserved bytes and proof material matched the queried commitment under the declared algorithms.
- `MISSING_FROM_HOST` means host-comparison input did not contain the corresponding record after it was expected for that comparison.
- `CONTENT_MISMATCH` means supplied compared bytes differ from the integrity subject or commitment.
- `COLLECTION_GAP` records an unobserved interval. It does not establish which event occurred in that interval.
- Evidence can be recovered only when the vault had already received and durably preserved it.

## Required negative cases

The CLI must reject a modified raw evidence file, manifest hash, proof node, batch root, sequence range, and chain identifier or contract address mismatch. It must report a missing bundle member, unsupported crypto format version, and unavailable RPC without degrading to a successful result. Its test fixture set must include Person 1’s approved canonical-encoding and Merkle test vectors before the CLI claims compatibility with the shared core.
