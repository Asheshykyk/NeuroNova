# Phase 6 demo — Exact evidence and an honest verification verdict

Show the same persisted event through the LIVE Dashboard and the independent REST Auditor. The local byte, Merkle, and commitment checks pass. The overall result is `UNVERIFIABLE` because this demo has no Vault signature, confirmed Tier 1 anchor, or authenticated Tier 2 checkpoint.

## Prerequisites

- Node.js 24+, the installed Dashboard and Auditor dependencies, and the Person 4 checkout at `9d752d371d48b55017873b1019a9a29e01583897` or a later compatible revision.
- The detached Vault worktree at `/private/tmp/trusttrace-personb.rFGAja`, on Person 2 commit `cf38801dd244a80cd14ac706540ada8f94f944c0`. Preserve its `backend/data/evidence/` directory, including the persisted JSONL and SQLite data. The demo reads the existing event.
- Vault at [127.0.0.1:3000](http://127.0.0.1:3000/health) and the [LIVE Dashboard](http://127.0.0.1:5174/). This fixture requires no signing key or blockchain RPC to demonstrate local checks.

## Preflight and restart

Check both URLs before the demo:

```sh
curl --noproxy '*' -fsS --max-time 5 -w ' HTTP %{http_code}\n' http://127.0.0.1:3000/health
curl --noproxy '*' -fsS --max-time 5 -o /dev/null -w 'Dashboard HTTP %{http_code}\n' http://127.0.0.1:5174/
```

Expect `{"status":"ok"} HTTP 200` and `Dashboard HTTP 200`. Leave existing healthy servers running. If Vault is stopped, use a dedicated terminal:

```sh
cd /private/tmp/trusttrace-personb.rFGAja
git rev-parse HEAD
vault_trusted_keys=$(node --input-type=module -e 'import fs from "node:fs"; const v = JSON.parse(fs.readFileSync("vectors/agent-chunk.json","utf8")); const canonical = "0x" + Buffer.from(v.chunk.sourceId).toString("hex").padEnd(64, "0"); console.log(JSON.stringify({[v.chunk.sourceId]:v.keyPair.publicKeyRaw,[canonical]:v.keyPair.publicKeyRaw}));')
env -i PATH="$PATH" BACKEND_HOST=127.0.0.1 BACKEND_PORT=3000 RSYSLOG_HOST=127.0.0.1 RSYSLOG_PORT=1514 TRUSTED_AGENT_PUBLIC_KEYS_JSON="$vault_trusted_keys" npm run dev --workspace=@trusttrace/backend
```

If the Dashboard is stopped, use another terminal:

```sh
cd /Users/dev/Documents/neuronova/apps/dashboard
VITE_TRUSTTRACE_DATA_MODE=live npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

## Show the evidence

1. Open the Dashboard and check the **LIVE REST** badge. Overview shows source `0x686f73742d6167656e742d6379707275732d3031000000000000000000000000` with one event.
2. Open **Live evidence feed**. Sequence **1** appears with **Vault persisted** and **Pending**.
3. Open **Evidence explorer** and choose **Inspect #1**. The detail shows **126 bytes**, the Merkle proof as **Supplied by Vault**, and the exact hex preview ending in `0a` for the terminating LF.
4. Open **Checkpoint status**. The Vault batch covers **Sequences 1–1**, shows **Pending**, and has no transaction hash. Public checkpoints are unavailable.

## Run the independent Auditor

From the Person 4 repository root, run both formats:

```sh
cd /Users/dev/Documents/neuronova
npm --prefix services/verifier run build
demo_source=0x686f73742d6167656e742d6379707275732d3031000000000000000000000000
demo_capture=$(mktemp -d /private/tmp/trusttrace-phase6.XXXXXX)
demo_text_exit=0
node services/verifier/dist/index.js verify-rest --base-url http://127.0.0.1:3000/api/v1 --source-id "$demo_source" --sequence 1 > "$demo_capture/auditor.txt" || demo_text_exit=$?
demo_json_exit=0
node services/verifier/dist/index.js verify-rest --base-url http://127.0.0.1:3000/api/v1 --source-id "$demo_source" --sequence 1 --json > "$demo_capture/auditor.json" || demo_json_exit=$?
cat "$demo_capture/auditor.txt" "$demo_capture/auditor.json"
printf 'Text exit: %s\nJSON exit: %s\nCapture: %s\n' "$demo_text_exit" "$demo_json_exit" "$demo_capture"
```

Both exits should be **2**. The observed text output was:

```text
Overall: UNVERIFIABLE (REQUIRED_EVIDENCE_MISSING)
Tier 1: UNVERIFIABLE
  rest-fetch: VERIFIED — Event detail and matching batch fetched.
  vault-signature: UNVERIFIABLE — Vault signed commitment or signature is missing.
  commitment-matching: VERIFIED — Local batch fields and struct hash agree.
  raw-byte-validation: VERIFIED — Exact payload SHA-256 and canonical v1 leaf match the reported values.
  merkle-verification: VERIFIED — Canonical leaf and inclusion proof match the independently fetched local batch root.
  direct-rpc: UNVERIFIABLE — Tier 1 RPC requires verified local evidence and a reported anchor for the trusted deployment.
Tier 2: UNVERIFIABLE — The REST API does not supply an authenticated Tier 2 checkpoint and its preimage.
```

The JSON has `scope: "vault-rest"`, `vaultSequence: "1"`, and batch ID `0x4fe7c6edb3ff81861822c73127a1d46c8cab068e8c3ea79814bd826d50995a22`. Its overall `status` is `UNVERIFIABLE` and `reasonCode` is `REQUIRED_EVIDENCE_MISSING`. Read the individual results under `tier1.stages` and the public-checkpoint result under `tier2`.

## Explain the result

| Stage | Meaning in this demo |
|---|---|
| REST fetch | The Auditor fetched the event by source and sequence and selected its matching batch independently of the Dashboard. |
| Raw bytes | The exact bytes reproduce the reported payload SHA-256 and canonical version-1 leaf, including the final newline. |
| Merkle | The single-leaf proof reproduces the local batch root fetched from Vault. The root is still unauthenticated in this run. |
| Commitment | The local batch fields reproduce the reported EIP-712 struct hash. |
| Vault signature | The local test Vault returns a null signature, so the Auditor cannot authenticate the commitment signer. |
| Tier 1 RPC | The batch is pending. No anchor was independently confirmed. |
| Tier 2 | The authenticated Orchard checkpoint and preimage are unavailable. |

**Say to judges:** “The Dashboard shows persisted evidence. The Auditor separately downloads the exact bytes, recomputes the leaf, and checks inclusion and the commitment hash. Those local checks pass. This fixture has no Vault signature or confirmed chain anchor, so the final verdict is UNVERIFIABLE. The original AgentChunk was checked at ingestion. Rechecking that host signature independently requires its original signed envelope.”

## Troubleshooting

- **Vault connection refused:** Restart the detached worktree with the command above. Check ports 3000 and 1514 and preserve `backend/data/evidence/`. If an unrelated process owns a port, identify it before taking any action.
- **Dashboard unreachable or showing DEMO:** Check port 5174 and restart with `VITE_TRUSTTRACE_DATA_MODE=live`. If Vault health works but the UI shows a request error, check the Vite proxy directly with `curl --noproxy '*' -fsS http://127.0.0.1:5174/api/v1/sources`.
- **No event or a different batch:** Check the detached commit and confirm the server opened the preserved local data directory. Stop the walkthrough until sequence 1 returns for the expected source. Avoid reseeding during the presentation.
- **Missing signature or pending anchor:** This is the expected demo state. Exit 2 preserves the distinction between local consistency and authenticated verification.
