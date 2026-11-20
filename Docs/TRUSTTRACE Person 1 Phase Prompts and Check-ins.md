# TRUSTTRACE: Person 1 Phase Prompts and Check-ins

The Big Hack 2.0 · Problem B3 · For Person 1 (crypto core and contract) · Status: draft, assumptions pending confirmation at G0

## Purpose

This document turns the four frozen decisions into ready-to-paste coding-assistant prompts for each phase of Person 1’s work, together with the check-ins to send to Persons 2, 3 and 4. Every prompt ends with an acceptance test to run and paste back for review. Nothing here claims that any code works until its output has been pasted.

## Frozen decisions

1. **Leaf contents — include identity metadata, but never parse or normalize the event.**
   Hash the original event bytes exactly as received, along with fixed vault-assigned metadata: `sourceId`, `vaultSequence`, `rawEventLength`, `rawEventBytes`.
   The raw event remains untouched. We do not hash parsed JSON fields, normalized timestamps, or reconstructed log messages. The metadata identifies which event the bytes represent; it does not replace the original bytes.
   Canonical binary encoding with version/domain tag and SHA-256:
   `leafHash = SHA256(0x00 || version || sourceId || vaultSequence || rawEventLength || rawEventBytes)`.

2. **Odd-leaf rule — promote the unpaired node.**
   When a Merkle-tree level has an odd number of nodes, promote the final unpaired node unchanged to the next level. Do not duplicate it.
   Bind `leafCount` into the signed and on-chain batch commitment, which makes tree construction and proof interpretation unambiguous. The commitment includes at least:
   - `sourceId`
   - `sequenceStart` and `sequenceEnd`
   - `leafCount`
   - `merkleRoot`
   - `previousCheckpointHash` (for continuity chaining)

3. **Checkpoint mechanism — use a small Solidity contract.**
   Use a small contract with an `anchorBatch()` function and a `BatchAnchored` event.
   The contract validates the registered signer, source identity, sequence continuity, and duplicate-batch prevention before accepting a checkpoint.
   Person 1 owns the contract and ABI. The canonical encoding and hashing rules live in the shared `core` package under a versioned specification agreed upon by all four people.
   Avoid plain transactions with arbitrary data as the primary mechanism because they cannot enforce these on-chain integrity checks.

4. **Signer key custody — vault only.**
   The EIP-712 signing private key exists only in the vault environment. It must never be present on the monitored host, agent, frontend, or in Git.
   The vault signer and gas-paying relayer are separate keys:
   - Vault signer: signs the batch commitment.
   - Relayer: submits the signed commitment to the blockchain.
   For the Docker demo: mount the signer secret into the vault container as a secret or read-only file. Keep it out of source control and provide a separate test key for local development.
   Attestation boundary distinction: the vault signature proves that the vault attested to the batch. It does not, by itself, prove that the original host event was truthful.

## Assumptions to confirm at G0

These are not approved decisions until the team confirms them.

| ID | Assumption |
| --- | --- |
| A1 | Field widths: version 1 byte, `sourceId` 32 bytes, `vaultSequence` uint64 big-endian, `rawEventLength` uint32 big-endian. Leaf tag `0x00`, node tag `0x01`. |
| A2 | `sourceId` is a `bytes32` (a hash of the source name), used identically in the leaf, the commitment and the contract. |
| A3 | `previousCheckpointHash` is the EIP-712 struct hash of the previous accepted commitment for that source; genesis is 32 zero bytes; the first batch starts at sequence 1. |
| A4 | The same contract is deployed on Polygon Amoy. A public checkpoint is a commitment whose `merkleRoot` field holds the checkpoint digest. The signer signs separately for each chain’s domain. |
| A5 | An owner key registers and revokes sources. No function can overwrite or delete a batch. |
| A6 | One raw event is one log line’s bytes with the delimiter excluded. Persons 2 and 3 must agree on this. |

## What the freeze changes for the other people

| Person | Change they must make |
| --- | --- |
| P2 (vault) | Store `sourceId`, `vaultSequence` and raw bytes exactly (never parse or normalize). Call `core` to hash leaves instead of hashing locally. Use `core` to sign. Keep the relayer and signer keys separate. In Docker demo: mount vault signer secret as read-only file/secret, never commit to Git, use separate test key for dev. Use commitment fields `sequenceStart`, `sequenceEnd`, `leafCount` and `previousCheckpointHash`. |
| P3 (agent) | Preserve raw bytes exactly (no trimming, normalisation, reconstructed messages, or re-encoding). Agree on A6 (one line = one event, delimiter excluded). The agent holds only its Ed25519 chunk key, never the EIP-712 signer key. |
| P4 (CLI, UI) | Verify with `core` only. The evidence bundle carries version, `sourceId`, `leafCount`, signature, chain ID and contract address. The proof verifier needs `leafCount` and the leaf index. |

## Shared header

Paste this at the top of every prompt below.

```
PROJECT: TRUSTTRACE, The Big Hack 2.0, problem B3. TypeScript monorepo. I am Person 1
(branch person-a), owning the shared `core` package and EvidenceAnchor.sol + ABI.
LOCKED: leafHash = SHA256(0x00 || version || sourceId || vaultSequence || rawEventLength || rawEventBytes);
node = SHA256(0x01 || left || right); odd node promoted unchanged (never duplicated);
commitment binds sourceId, sequenceStart, sequenceEnd, leafCount, merkleRoot, previousCheckpointHash.
Contract: anchorBatch() + BatchAnchored event; validates registered signer, source, sequence
continuity, duplicate batches. EIP-712 signer key exists ONLY in the vault; relayer is a separate key.
ASSUMPTIONS (unconfirmed, label in code): A1 widths (version 1B, sourceId 32B, vaultSequence u64 BE,
rawEventLength u32 BE); A2 sourceId bytes32; A3 previousCheckpointHash = struct hash of previous
commitment, genesis zero, first batch starts at seq 1; A4 same contract on Amoy, checkpoint digest in
merkleRoot field; A5 owner registers/revokes sources, no overwrite/delete function.
RULES: do not change locked decisions; no secrets in code or Git; never use Hardhat default keys on a
public network; do not broadcast any transaction; do not invent gas, addresses or results; list files
changed; end with exact commands I should run and the output to paste back.
```

## Phase 0 (H0–2): freeze the spec

### Prompt 0a: spec and vectors

```
[SHARED HEADER]
TASK: create docs/spec/ENCODING.md (version 1) and packages/core test vectors.
1. Spec the byte layout, domain tags, node rule, odd-promotion rule, and the proof format. State that
   a proof needs (leafIndex, leafCount) so the verifier knows which levels have no sibling.
2. Write a minimal reference implementation in packages/core/src (encodeLeaf, hashLeaf, hashNode,
   buildTree, getProof, verifyProof).
3. Generate vectors/merkle.json for 1, 2, 3, 4, 5 and 7 leaves, including one proof per leaf and
   two negative cases (modified leaf, wrong leafCount).
ACCEPTANCE: `pnpm --filter core test` passes; vectors file committed; paste output.
```

### Prompt 0b: EIP-712 round trip

This is the biggest early risk, so do it first.

```
[SHARED HEADER]
TASK: define the BatchCommitment EIP-712 type in core (field order and types written once), then write
a Hardhat test that signs it in TypeScript with ethers and recovers the same address in a minimal
Solidity contract using OpenZeppelin EIP712 + ECDSA (confirm the dependency and license first).
Include chainId and verifyingContract in the domain. Add a vector file with the digest and signature.
ACCEPTANCE: `npx hardhat test` shows recovered address == signer; the TypeScript digest equals the
Solidity digest; paste output.
```

### Check-in before G0

```
To P2/P3/P4: spec v1 is in docs/spec/ENCODING.md and vectors in packages/core. Please (1) run
`pnpm --filter core test`, (2) confirm A1–A6, (3) tell me by H2 if any of your payloads need a field
I haven't included. P2: confirm sourceId bytes32 + your record stores raw bytes exactly. P3: confirm
A6 (one line = one event, delimiter excluded). P4: confirm your bundle fields.
```

## Phase 1 (H2–6): walking skeleton

### Prompt 1: core, contract and signed anchor

```
[SHARED HEADER]
TASK:
1. Finalise the core API: encodeLeaf, hashLeaf, buildTree, getProof, verifyProof(leaf, index,
   leafCount, proof, root), hashCommitment, signCommitment(signer, domain, commitment).
2. Write EvidenceAnchor.sol: registerSource(sourceId, signerAddress) owner-only; anchorBatch(commitment,
   signature) callable by any relayer; stores the commitment; emits BatchAnchored; getBatch and
   getLatest(sourceId) views. Enforce the checks you can in this phase: signer is registered.
3. Local deploy script (do not run any public deploy) and export the ABI to packages/core.
4. One test: relayer submits a vault-signed commitment, event is emitted, stored data matches.
ACCEPTANCE: `npx hardhat test` and `pnpm --filter core test` pass; paste both outputs.
```

### Check-ins before G1 (H6)

```
To P2: ABI + signCommitment are on person-a (commit <hash>). Wire your anchorer: vault
signer signs with core, relayer submits. Send me one real batch's commitment JSON so I can test it.
To P4: verifyProof and the bundle field list are in core; build the CLI against them.
To P3: any change to the raw-event bytes you send must be announced to me and P2.
```

## Phase 2 (H6–10): rejection rules and negative tests

### Prompt 2

```
[SHARED HEADER]
TASK: in EvidenceAnchor.sol enforce: registered and non-revoked signer; duplicate batch rejection;
sequenceStart == lastEnd+1 (first batch starts at 1); sequenceEnd >= sequenceStart; previousCheckpointHash
matches the stored latest commitment hash (genesis zero); leafCount == sequenceEnd-sequenceStart+1
[ASSUMPTION: confirm with P2 that batches are contiguous]. Add revokeSource (stops new anchors, never
invalidates existing ones). Confirm no function can overwrite or delete a batch.
Write one negative test per rule plus a "field altered after signing" test; assert each revert reason.
Log receipt.gasUsed in tests (measured only).
ACCEPTANCE: `npx hardhat test` all pass; paste output including revert reasons.
```

### Check-ins before G2 (H10)

```
To P2: contract rejects gaps/overlaps. Confirm your batcher emits contiguous ranges and
leafCount == end-start+1. Send me one deliberate bad batch to see the revert.
To P3/P4: scenario IDs and expected verdicts for "replay anchor" must match the contract revert reason.
```

## Phase 3 (H10–13): checkpoint digest and reset scenario

### Prompt 3

```
[SHARED HEADER]
TASK: ASSUMPTION (confirm fields at G3): checkpointDigest = SHA256(tag || previousCheckpointDigest ||
localChainId || localBlockNumber || localBlockHash || latestBatchRoot || latestSequence ||
contractAddress). Implement buildCheckpoint in core with vectors. Write a script and test:
anchor batches, build a checkpoint, simulate a local chain reset and re-anchor of rewritten history,
and show the checkpoint check fails. Expose checkLocalChain(...) and checkCheckpoint(...) for P4.
ACCEPTANCE: test shows reset detected; paste output. Do not restart the chain after publishing.
```

### Check-ins

```
To P2: send me your checkpoint scheduler's N and where you persist the digest.
To P4: ablation rows C and D call checkLocalChain and checkCheckpoint; send me what inputs you need.
```

## Phase 4 (H13–16): public checkpoint script

### Prompt 4

```
[SHARED HEADER]
TASK: prepare (do not run) a deploy + checkpoint-submit script for Polygon Amoy using env vars
(RPC_URL, RELAYER_KEY, SIGNER address), with an eth_chainId check against the configured chain ID
(I will verify the Amoy chain ID from official docs). Reuse EvidenceAnchor per A4. Add a "pending"
fallback status when RPC or funds fail. Document that Hardhat default keys must never be used.
ACCEPTANCE: dry-run prints the target chain ID and aborts on mismatch; I will approve before any real
broadcast. Paste output.
```

### Check-ins before G4 (H16)

```
To P2: send me the checkpoint status states you persist (pending/confirmed). To P4: CLI needs Amoy
RPC + contract address; I'll send them after I deploy. To everyone: no local chain restarts after
the checkpoint is published.
```

## Phases 5 and 6 (H16–20): freeze and defend

### Prompt 5: freeze triage

```
[SHARED HEADER]
TASK: no new features. Triage this failing test/output: <paste>. Classify the root cause (core, contract,
signing, config), propose the smallest general fix, list regression tests to rerun.
```

### Prompt 6: defence preparation

```
[SHARED HEADER]
TASK: from the repo and my pasted test outputs only, write a 60-second explanation of my layer plus
answers to: why EIP-712 over Ed25519 on-chain; what the contract does not prove; what a stolen signer
key allows; how the local chain reset is caught; what we have not measured. No invented claims.
```

## Gate check-in template

Send at the end of every gate.

```
Gate <G#> status from P1: done: <>; verified by pasted output: <>; blocked: <>; interface changes:
<none/list>; needs from you by <hour>: <>.
```

## Working rules

- Run each prompt, then paste the command outputs back for review before moving to the next phase.
- Never use Hardhat default accounts on a public network, and never commit keys or `.env` files.
- Any change to the leaf encoding, commitment struct, ABI or checkpoint format requires agreement from P2, P3 and P4 before implementation.
- Not yet measured: gas costs, Amoy faucet availability and the Amoy chain ID (verify from official documentation).
