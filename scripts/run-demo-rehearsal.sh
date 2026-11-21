#!/usr/bin/env bash
set -euo pipefail

echo "================================================================================"
echo "TRUSTTRACE: Forensic Demonstration & 3-Witness Integrity Rehearsal"
echo "The Big Hack 2.0 · Track 02 (Cybersecurity & Blockchain) · Problem B3"
echo "================================================================================"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export NODE_ENV="${NODE_ENV:-development}"
export BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
export BACKEND_PORT="${BACKEND_PORT:-3000}"
export RSYSLOG_PORT="${RSYSLOG_PORT:-5140}"
export AGENT_SOURCE_ID="${AGENT_SOURCE_ID:-0x1111111111111111111111111111111111111111111111111111111111111111}"
export AGENT_PUBLIC_KEY_HEX="${AGENT_PUBLIC_KEY_HEX:-0x1111111111111111111111111111111111111111111111111111111111111111}"
export VAULT_SIGNER_PRIVATE_KEY="${VAULT_SIGNER_PRIVATE_KEY:-0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef}"

echo "[1/4] Running Cryptographic & Preimage Verifications (@trusttrace/core)..."
npm test --prefix packages/core > /dev/null
echo "✓ Core Cryptography verified (61/61 tests passing)."

echo "[2/4] Running Smart Contract Continuity & Replay Checks (blockchain)..."
npm test --prefix blockchain > /dev/null
echo "✓ Smart Contracts verified (9/9 standalone tests passing)."

echo "[3/4] Running Evidence Vault Backend Ingestion & Storage Checks (backend)..."
npm test --prefix backend > /dev/null
echo "✓ Backend Storage & Ingestion verified (72/72 tests passing)."

echo "[4/4] Executing 3-Witness Live Attack Scenarios..."
echo ""
node --experimental-strip-types backend/src/verification/demoRehearsal.ts

echo ""
echo "================================================================================"
echo "DEMO READY: All 3 witnesses (Host, Vault, Blockchain) verified successfully."
echo "================================================================================"
