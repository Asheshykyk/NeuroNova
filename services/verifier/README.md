# TRUSTTRACE independent verifier CLI

The Person 4 verifier checks exact event bytes, Merkle inclusion, commitment consistency, a Vault EIP-712 signature, and the stored EvidenceAnchor commitment. The CLI returns `UNVERIFIABLE` for ZIP and JSON exports until the backend approves the export layout.

## Install and run

Use Node.js 24 or later with its default TypeScript stripping enabled. The shared workspace package exports TypeScript source.

```sh
cd services/verifier
npm ci --workspaces=false
npm run build
node dist/index.js --help
node dist/index.js verify --bundle ./evidence-bundle.zip --rpc-url <rpc-url> --json
```

The verifier declares `@trusttrace/core` as a local `file:` dependency. Disabling workspace installation here keeps npm operations scoped to the verifier. The verifier uses a temporary declaration for the consumed core exports because the shared source has a TypeScript diagnostic in `merkle.ts`. The compiled verifier imports the actual linked package.

## Verify a REST event

```sh
node dist/index.js verify-rest --base-url http://127.0.0.1:3000/api/v1 --source-id <bytes32-source-id> --sequence 1 --json
```

Tier 1 checks exact event bytes, the canonical version-1 leaf, Merkle inclusion against the local batch root, and the Vault EIP-712 signature against the frozen local Hardhat deployment. If Vault reports an anchor and the evidence passes those checks, the Auditor independently reads the trusted EvidenceAnchor deployment over RPC. Use `--rpc-url` to override the Tier 1 transport endpoint. The expected chain ID, contract, and signer come from `@trusttrace/core/deployments`.

Tier 2 requires an authenticated Orchard checkpoint, its preimage, and applicable predecessor evidence. The REST API does not supply them. Even a verified Tier 1 result leaves the overall verdict `UNVERIFIABLE` with `REQUIRED_EVIDENCE_MISSING` in that case. AgentChunk verification requires the original signed envelope and a trusted agent key via the separate `verify-agent-chunk` command.

## Verification inputs

`verifyEvidence` in `src/verify.ts` accepts normalized inputs from a future approved bundle adapter. Each selected event needs exact bytes, a recorded SHA-256 payload hash, canonical leaf fields, and the ordered Merkle siblings. The batch needs the commitment, its struct hash, and Vault signature. If the immediately preceding commitment is supplied, the verifier checks the link to it. A successful result covers the supplied event proofs and the identified batch.

The verifier requires a Vault signer and EIP-712 domain supplied independently of the bundle. For the read-only provider adapter, use a `quais.JsonRpcProvider` configured for the trusted zone and a `quais.Contract` bound to that provider with the supplied EvidenceAnchor ABI. Implement `getNetwork()` with the provider's network lookup and `read(method, hash)` with the contract's static call. Give the provider bounded request deadlines. The verifier checks the network chain ID, calls `isBatchAnchored` and `getBatch` by commitment struct hash, and compares the stored commitment. [Quai SDK integration](https://www.qu.ai/integrations/ethers-js)

The adapter currently checks a directly anchored event batch. Checking a separate Orchard aggregate checkpoint needs evidence that links the local batch to the checkpoint preimage and the approved public deployment. The shared `checkCheckpoint` helper compares a checkpoint preimage with a digest. The export adapter will also need the approved ZIP member layout, manifest validation rules, and exact representation of raw evidence and proofs.

## Local Dashboard verification bridge

The read-only bridge lets the LIVE Dashboard request `verify-rest` without running Node.js in browser code:

```sh
npm --prefix services/verifier run bridge
```

It listens only on `127.0.0.1:3001` and accepts `POST /api/verifier/verify-rest` from the local Dashboard origin. The request contains only `sourceId` and decimal-string `sequence`; Vault REST, local Hardhat RPC, chain, contract, and signer configuration are fixed on the server. The Dashboard Vite server proxies this route. The bridge is a local development integration, not an authenticated public service.

The response scope is `vault-rest`. `VERIFIED`/`TAMPERED`/`UNVERIFIABLE` applies only to the Auditor's reported scope; Tier 2 remains separately `UNVERIFIABLE` when authenticated public-checkpoint evidence is unavailable. The endpoint is read-only and does not accept RPC URLs, credentials, or trusted deployment settings from the browser.

## Exit codes

| Code | Result |
| --- | --- |
| `0` | `VERIFIED` |
| `1` | `TAMPERED` |
| `2` | `UNVERIFIABLE` |
| `64` | Invalid command or arguments |

## Checks

```sh
npm run typecheck
npm run test
npm run build
```
