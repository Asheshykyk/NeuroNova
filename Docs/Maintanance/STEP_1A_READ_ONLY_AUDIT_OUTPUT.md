# TRUSTTRACE: Step 1a Read-Only Security Audit & Source Inventory
**The Big Hack 2.0 · Track 02 (Cybersecurity & Blockchain) · Problem B3**  
*Document Location: `Docs/Maintanance/STEP_1A_READ_ONLY_AUDIT_OUTPUT.md` | Date: November 25, 2026*

---

## 1. Overview

This document records the exact read-only outputs from **Step 1a**. All 64-hex private keys and signatures have been strictly redacted (`0x123456…REDACTED`), and no tracked files were modified during this execution.

---

## 2. Committed Keys to Addresses Mapping

```text
$ cp /tmp/audit-key-addresses.mjs ./_audit.mjs && node _audit.mjs; rm -f _audit.mjs
0x012345… 0xFCAd0B19bB29D4674531d6f115237E16AfCE377c backend/src/verification/demoRehearsal.ts:105, backend/src/verification/demoRehearsal.ts:196, backend/src/verification/demoRehearsal.ts:225, backend/tests/anchoring.test.ts:143, backend/tests/liveAnchor.test.ts:21, blockchain/scripts/deploy-local.ts:33, lab/.env.lab:6, lab/compose.yaml:29, scripts/run-demo-rehearsal.sh:18
0xfedcba… 0x6A9296CEb89D12e1F53b2Dd5Df45d3ADB3A814c2 backend/tests/anchoring.test.ts:144
0xac0974… 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 backend/tests/liveAnchor.test.ts:22, blockchain/scripts/deploy-local.ts:74, lab/compose.yaml:34, lab/contract-address.env:5, packages/core/src/test-vectors.ts:99, packages/core/test/quai.test.ts:55
0x767c35… 0x00ec2241529f64253d1239Ce336a15f1f454e839 blockchain/scripts/submit-checkpoint-orchard.ts:87, blockchain/test/quai-orchard-smoke.test.ts:42
0x000000… 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf blockchain/test/contract-standalone.test.ts:232
0x111111… 0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A lab/.env.lab:5, lab/compose.yaml:28, scripts/run-demo-rehearsal.sh:17
```

> **Note on `render.yaml`:** In `render.yaml`, `- key: VAULT_SIGNER_PRIVATE_KEY` was on line 29 and its value on line 30, so the single-line regex skipped line 30. Its value `0xcb29ee…` maps to address `0x36EB00D4BF389F3323d1C66b35a8827Dddbae504`.

---

## 3. Addresses in `packages/core/src/deployments.json`

```json
{
  "quai_orchard_cyprus1": {
    "network": "quai_orchard_cyprus1",
    "displayName": "Quai Network Orchard Testnet (Cyprus-1 Zone)",
    "tier": "Tier 2 Public PoW Checkpoint",
    "chainId": 15000,
    "zone": "cyprus-1",
    "shard": "0x00",
    "rpcUrl": "https://orchard.rpc.quai.network/cyprus1",
    "fallbackRpcUrl": "https://orchard.rpc.quai.network",
    "explorerUrl": "https://orchard.quaiscan.io",
    "faucetUrl": "https://orchard.faucet.quai.network",
    "contractAddress": "0x00a89d7494cb3d16858a74e5cae1a965d14df5a2",
    "deployerAddress": "0x00Ad94833F32Ab9C8E450715E77EA5854ed8b008",
    "relayerAddress": "0x006479b2cD168F4640d1117BcfC68496924ee9Ff",
    "vaultSignerAddress": "0x00ec2241529f64253d1239Ce336a15f1f454e839",
    "evmVersion": "paris",
    "solidityVersion": "0.8.19"
  },
  "local_hardhat": {
    "network": "local_hardhat",
    "displayName": "Local Hardhat EVM (Tier 1 Fast Path)",
    "tier": "Tier 1 High-Throughput Ingestion",
    "chainId": 31337,
    "rpcUrl": "http://127.0.0.1:8545",
    "contractAddress": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    "deployerAddress": "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    "relayerAddress": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "vaultSignerAddress": "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
  },
  "polygon_amoy": {
    "network": "polygon_amoy",
    "displayName": "Polygon Amoy Testnet (Legacy Tier 2)",
    "tier": "Tier 2 Legacy",
    "chainId": 80002,
    "rpcUrl": "https://rpc-amoy.polygon.technology",
    "explorerUrl": "https://amoy.polygonscan.com"
  }
}
```

---

## 4. Source Files (Redacted)

### `backend/src/config/index.ts`
```typescript
import { createRequire } from 'node:module';
import { assertCyprus1Address } from '@trusttrace/core/quai';

const require = createRequire(import.meta.url);
const deployments = require('@trusttrace/core/deployments');

export interface RsyslogConfig {
  host: string;
  port: number;
  maxFrameBytes: number;
}

export interface QuaiOrchardConfig {
  network: string;
  displayName: string;
  tier: string;
  chainId: bigint;
  zone: string;
  shard: string;
  rpcUrl: string;
  fallbackRpcUrl: string;
  explorerUrl: string;
  contractAddress: string;
  relayerAddress: string;
  vaultSignerAddress: string;
  relayerPrivateKey: string | null;
}

export interface BackendConfig {
  host: string;
  port: number;
  anchorRpcUrl: string | null;
  anchorContractAddress: string | null;
  anchorRelayerPrivateKey: string | null;
  anchorChainId: bigint | null;
  vaultSignerPrivateKey: string | null;
  vaultSignerSecretPath: string | null;
  trustedAgentPublicKeys: Map<string, string>;
  trustedAgentPublicKeyHistory: Map<string, string[]>;
  rsyslog: RsyslogConfig;
  quai: QuaiOrchardConfig;
}

function readPort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return 3000;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid BACKEND_PORT: ${value}`);
  }
  return port;
}

function readPortWithName(value: string | undefined, name: string, defaultValue: number): number {
  if (value === undefined || value.trim() === '') return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return parsed;
}

function readPositiveInteger(value: string | undefined, name: string, defaultValue: number): number {
  if (value === undefined || value.trim() === '') return defaultValue;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return parsed;
}

function readTrustedAgentPublicKeyHistory(): Map<string, string[]> {
  const history = new Map<string, string[]>();
  const json = process.env.TRUSTED_AGENT_PUBLIC_KEY_HISTORY_JSON;
  if (json?.trim()) {
    const parsed = JSON.parse(json) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Invalid TRUSTED_AGENT_PUBLIC_KEY_HISTORY_JSON: expected an object');
    }
    for (const [sourceId, keys] of Object.entries(parsed)) {
      if (!Array.isArray(keys) || keys.some((key) => typeof key !== 'string')) {
        throw new Error(`Invalid trusted agent public key history for sourceId ${sourceId}`);
      }
      history.set(sourceId, keys);
    }
  }
  return history;
}

function readTrustedAgentPublicKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  const json = process.env.TRUSTED_AGENT_PUBLIC_KEYS_JSON;
  if (json?.trim()) {
    const parsed = JSON.parse(json) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Invalid TRUSTED_AGENT_PUBLIC_KEYS_JSON: expected an object');
    }
    for (const [sourceId, publicKey] of Object.entries(parsed)) {
      if (typeof publicKey !== 'string') {
        throw new Error(`Invalid trusted agent public key for sourceId ${sourceId}`);
      }
      keys.set(sourceId, publicKey);
    }
  }

  const globalKey = process.env.AGENT_PUBLIC_KEY_HEX?.trim();
  if (globalKey) keys.set('*', globalKey);
  return keys;
}

export function getQuaiOrchardConfig(): QuaiOrchardConfig {
  const orchard = deployments.quai_orchard_cyprus1;
  const relayerAddress = process.env.QUAI_RELAYER_ADDRESS?.trim() || orchard.relayerAddress;
  const contractAddress = process.env.EVIDENCE_ANCHOR_QUAI_ADDRESS?.trim() || orchard.contractAddress;

  if (relayerAddress) {
    assertCyprus1Address(relayerAddress, 'Quai Relayer Address');
  }
  if (contractAddress) {
    assertCyprus1Address(contractAddress, 'EvidenceAnchor Quai Contract Address');
  }

  return {
    network: orchard.network,
    displayName: orchard.displayName,
    tier: orchard.tier,
    chainId: BigInt(process.env.QUAI_CHAIN_ID || orchard.chainId),
    zone: orchard.zone,
    shard: orchard.shard,
    rpcUrl: process.env.QUAI_ORCHARD_RPC_URL?.trim() || orchard.rpcUrl,
    fallbackRpcUrl: orchard.fallbackRpcUrl,
    explorerUrl: orchard.explorerUrl,
    contractAddress,
    relayerAddress,
    vaultSignerAddress: orchard.vaultSignerAddress,
    relayerPrivateKey: process.env.QUAI_RELAYER_PRIVATE_KEY?.trim() || null
  };
}

export function verifyKeySeparation(vaultSignerKey: string | null, relayerKey: string | null): boolean {
  if (!vaultSignerKey || !relayerKey) return true;
  return vaultSignerKey.trim().toLowerCase() !== relayerKey.trim().toLowerCase();
}

const defaultHost = process.env.NODE_ENV === 'production' || process.env.DOCKER === 'true' ? '0.0.0.0' : '127.0.0.1';

export const config: BackendConfig = {
  host: process.env.BACKEND_HOST?.trim() || (process.env.NODE_ENV === 'production' || process.env.PORT ? '0.0.0.0' : '127.0.0.1'),
  port: readPort(process.env.BACKEND_PORT || process.env.PORT),
  anchorRpcUrl: process.env.LOCAL_RPC_URL?.trim() || null,
  anchorContractAddress: process.env.EVIDENCE_ANCHOR_LOCAL_ADDRESS?.trim() || null,
  anchorRelayerPrivateKey: process.env.LOCAL_RELAYER_PRIVATE_KEY?.trim() || null,
  anchorChainId: process.env.LOCAL_CHAIN_ID?.trim() ? BigInt(process.env.LOCAL_CHAIN_ID) : null,
  vaultSignerPrivateKey: process.env.VAULT_SIGNER_PRIVATE_KEY?.trim() || null,
  vaultSignerSecretPath: process.env.VAULT_SIGNER_SECRET_PATH?.trim() || null,
  trustedAgentPublicKeys: readTrustedAgentPublicKeys(),
  trustedAgentPublicKeyHistory: readTrustedAgentPublicKeyHistory(),
  rsyslog: {
    host: process.env.RSYSLOG_HOST?.trim() || (process.env.NODE_ENV === 'production' || process.env.PORT ? '0.0.0.0' : '127.0.0.1'),
    port: readPortWithName(process.env.RSYSLOG_PORT, 'RSYSLOG_PORT', 5140),
    maxFrameBytes: readPositiveInteger(process.env.RSYSLOG_MAX_FRAME_BYTES, 'RSYSLOG_MAX_FRAME_BYTES', 65536)
  },
  quai: getQuaiOrchardConfig()
};
```

---

### `backend/src/api/app.ts`
```typescript
import express, { type Express, type ErrorRequestHandler } from 'express';
import type { EvidenceStore } from '../storage/evidenceStore.ts';
import { createIngestHandler, type TrustedAgentPublicKeyProvider } from './ingest.ts';
import { createHeartbeatHandler } from './heartbeat.ts';
import type { EvidenceBatchManager } from '../batching/EvidenceBatchManager.ts';
import type { AnchoringWorker } from '../blockchain/AnchoringWorker.ts';
import type { EvidenceVerifier } from '../verification/EvidenceVerifier.ts';
import {
  createSourcesHandler,
  createEventsHandler,
  createEventDetailHandler,
  createBatchesHandler,
  createCheckpointsHandler,
  createGapsHandler
} from './read.ts';

export interface CreateAppOptions {
  store?: EvidenceStore;
  trustedAgentPublicKeyProvider?: TrustedAgentPublicKeyProvider;
  trustedAgentPublicKeyHistoryProvider?: (sourceId: string) => string[];
  batchManager?: EvidenceBatchManager;
  anchoringWorker?: AnchoringWorker;
  verifier?: EvidenceVerifier;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  app.use((_request, response, next) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    if (_request.method === 'OPTIONS') {
      response.sendStatus(204);
      return;
    }
    next();
  });
  app.use(express.json({ limit: '10mb' }));

  app.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  if (options.store) {
    const keyProvider = options.trustedAgentPublicKeyProvider ?? (() => undefined);
    app.post('/api/v1/logs/ingest', createIngestHandler({
      store: options.store,
      trustedAgentPublicKeyProvider: keyProvider
    }));
    app.post('/api/v1/agents/heartbeat', createHeartbeatHandler({
      store: options.store,
      trustedAgentPublicKeyProvider: keyProvider,
      trustedAgentPublicKeyHistoryProvider: options.trustedAgentPublicKeyHistoryProvider
    }));

    const readOptions = {
      store: options.store,
      batchManager: options.batchManager,
      anchoringWorker: options.anchoringWorker,
      verifier: options.verifier
    };
    app.get('/api/v1/sources', createSourcesHandler(readOptions));
    app.get('/api/v1/events', createEventsHandler(readOptions));
    app.get('/api/v1/events/:sourceId/:vaultSequence', createEventDetailHandler(readOptions));
    app.get('/api/v1/events/:vaultSequence', createEventDetailHandler(readOptions));
    app.get('/api/v1/batches', createBatchesHandler(readOptions));
    app.get('/api/v1/checkpoints', createCheckpointsHandler(readOptions));
    app.get('/api/v1/gaps', createGapsHandler(readOptions));
  }

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    const statusCode = error instanceof SyntaxError && 'body' in error
      ? 400
      : typeof error === 'object' && error !== null && 'statusCode' in error
      ? (error as { statusCode?: number }).statusCode
      : 500;
    response.status(typeof statusCode === 'number' ? statusCode : 500).json({
      code: typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code: unknown }).code)
        : statusCode === 400 ? 'BAD_REQUEST' : 'INTERNAL_ERROR',
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  };
  app.use(errorHandler);

  return app;
}
```

---

### `lab/compose.yaml`
```yaml
services:
  victim:
    build:
      context: ./victim
    environment:
      LAB_SSH_PASSWORD: ${LAB_SSH_PASSWORD:-labsecretpassword123}
    healthcheck:
      test: ["CMD-SHELL", "test -f /var/log/auth.log"]
      interval: 1s
      timeout: 1s
      retries: 30
    ports:
      - "127.0.0.1:2222:22"
    volumes:
      - victim_logs:/var/log
    networks:
      - trusttrace_net

  vault:
    build:
      context: ..
      dockerfile: backend/Dockerfile
    environment:
      BACKEND_HOST: "0.0.0.0"
      BACKEND_PORT: "3000"
      RSYSLOG_HOST: "0.0.0.0"
      RSYSLOG_PORT: "5140"
      AGENT_PUBLIC_KEY_HEX: ${AGENT_PUBLIC_KEY_HEX:-0x111111…REDACTED}
      VAULT_SIGNER_PRIVATE_KEY: ${VAULT_SIGNER_PRIVATE_KEY:-0x012345…REDACTED}
      EVIDENCE_DIRECTORY: /data/vault
      EVIDENCE_SQLITE_PATH: /data/vault/evidence-index.sqlite3
      LOCAL_RPC_URL: ${LOCAL_RPC_URL:-http://host.docker.internal:8545}
      EVIDENCE_ANCHOR_LOCAL_ADDRESS: ${EVIDENCE_ANCHOR_LOCAL_ADDRESS:-}
      LOCAL_RELAYER_PRIVATE_KEY: ${LOCAL_RELAYER_PRIVATE_KEY:-0xac0974…REDACTED}
      LOCAL_CHAIN_ID: ${LOCAL_CHAIN_ID:-31337}
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://127.0.0.1:3000/health || exit 1"]
      interval: 2s
      timeout: 2s
      retries: 20
    ports:
      - "127.0.0.1:3000:3000"
      - "127.0.0.1:5140:5140"
    volumes:
      - vault_data:/data/vault
    networks:
      - trusttrace_net

  agent:
    build:
      context: ..
      dockerfile: services/agent/Dockerfile
    depends_on:
      victim:
        condition: service_healthy
      vault:
        condition: service_healthy
    environment:
      AGENT_SOURCE_ID: ${AGENT_SOURCE_ID:-0x111111…REDACTED}
      AGENT_STREAM_ID: ${AGENT_STREAM_ID:-auth.log}
      AGENT_FILE_IDENTITY: ${AGENT_FILE_IDENTITY:-auth.log}
      VAULT_BASE_URL: ${VAULT_BASE_URL:-http://vault:3000}
      AUTH_LOG_PATH: /var/log/auth.log
      AGENT_STATE_DIR: /var/lib/trusttrace-agent
      AGENT_POLL_INTERVAL_MS: ${AGENT_POLL_INTERVAL_MS:-250}
      HEARTBEAT_INTERVAL_MS: ${HEARTBEAT_INTERVAL_MS:-5000}
      AGENT_RETRY_DELAY_MS: ${AGENT_RETRY_DELAY_MS:-1000}
    volumes:
      - victim_logs:/var/log:ro
      - agent_state:/var/lib/trusttrace-agent
    networks:
      - trusttrace_net

volumes:
  victim_logs:
  agent_state:
  vault_data:

networks:
  trusttrace_net:
    driver: bridge
```

---

### `render.yaml`
```yaml
services:
  - type: web
    name: trusttrace-vault
    runtime: docker
    dockerfilePath: backend/Dockerfile
    plan: starter
    healthCheckPath: /health
    disk:
      name: vault-data
      mountPath: /data/vault
      sizeGB: 1
    envVars:
      - key: NODE_ENV
        value: production
      - key: DOCKER
        value: "true"
      - key: BACKEND_HOST
        value: 0.0.0.0
      - key: RSYSLOG_HOST
        value: 0.0.0.0
      - key: RSYSLOG_PORT
        value: "5140"
      - key: EVIDENCE_DIRECTORY
        value: /data/vault
      - key: EVIDENCE_SQLITE_PATH
        value: /data/vault/evidence-index.sqlite3
      - key: AGENT_PUBLIC_KEY_HEX
        value: "0x4fdca0…REDACTED"
      - key: VAULT_SIGNER_PRIVATE_KEY
        value: "0xcb29ee…REDACTED"
```

---

### `blockchain/hardhat.config.cjs`
```javascript
require('ts-node/register');
require("@nomicfoundation/hardhat-toolbox");
const { subtask } = require("hardhat/config");
const { TASK_TEST_GET_TEST_FILES } = require("hardhat/builtin-tasks/task-names");
const path = require("path");
const { globSync } = require("glob");

subtask(TASK_TEST_GET_TEST_FILES).setAction(async ({ testFiles }, { config }) => {
  if (testFiles && testFiles.length > 0) {
    return testFiles.map((f) => path.resolve(process.cwd(), f));
  }
  const testsDir = path.resolve(config.paths.tests);
  return globSync(path.join(testsDir, "**/*.test.{ts,js,cjs}").replace(/\\/g, '/'));
});

const LOCAL_RPC_URL = process.env.LOCAL_RPC_URL || 'http://127.0.0.1:8545';
const AMOY_RPC_URL = process.env.AMOY_RPC_URL || 'https://rpc-amoy.polygon.technology';
const QUAI_ORCHARD_RPC_URL = process.env.QUAI_RPC_URL || 'https://orchard.rpc.quai.network/cyprus1';
const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY;
const QUAI_DEPLOYER_PRIVATE_KEY = process.env.QUAI_DEPLOYER_PRIVATE_KEY || process.env.QUAI_PRIVATE_KEY;

// Known Hardhat default test keys
const HARDHAT_DEFAULT_KEYS = [
  '0xac0974…REDACTED',
  '0x59c699…REDACTED',
  '0x5de411…REDACTED'
];

/**
 * Safety validator for public network accounts.
 * RULE: Never use Hardhat default keys on a public network!
 */
function getPublicNetworkAccounts(key) {
  if (!key) {
    return [];
  }
  const cleanKey = key.toLowerCase();
  for (const defaultKey of HARDHAT_DEFAULT_KEYS) {
    if (cleanKey === defaultKey.toLowerCase() || cleanKey === defaultKey.slice(2).toLowerCase()) {
      throw new Error(
        'SECURITY VIOLATION: Attempted to configure Hardhat default key for a public network! (RULE)'
      );
    }
  }
  return [key.startsWith('0x') ? key : `0x${key}`];
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    compilers: [
      {
        version: '0.8.24',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          },
          evmVersion: 'cancun'
        }
      }
    ],
    overrides: {
      'contracts/EvidenceAnchor.sol': {
        version: '0.8.24',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          },
          evmVersion: 'paris'
        }
      }
    }
  },
  networks: {
    hardhat: {
      chainId: 31337
    },
    localhost: {
      url: LOCAL_RPC_URL,
      chainId: 31337
    },
    amoy: {
      url: AMOY_RPC_URL,
      chainId: 80002,
      // RULE: Never use Hardhat default keys on a public network!
      accounts: getPublicNetworkAccounts(RELAYER_PRIVATE_KEY)
    },
    quai_orchard: {
      url: QUAI_ORCHARD_RPC_URL,
      chainId: 15000,
      // RULE: Never use Hardhat default keys on a public network!
      accounts: getPublicNetworkAccounts(QUAI_DEPLOYER_PRIVATE_KEY)
    }
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts'
  },
  mocha: {
    timeout: 40000,
    extension: ['ts', 'js', 'cjs']
  }
};
```

---

### `blockchain/scripts/deploy-orchard.ts`
```typescript
/**
 * TRUSTTRACE: Quai Network Orchard Testnet Deployment Script
 *
 * Target: Quai Orchard Testnet | Zone: Cyprus-1 (0-0) | Chain ID: 15000
 *
 * RULES & INVARIANTS ENFORCED:
 * 1. Target EVM: paris (No PUSH0 opcode).
 * 2. In-Zone Address: Deployer and Contract MUST have '0x00' prefix.
 * 3. Never use Hardhat default keys on Quai Network.
 * 4. Key Custody: Vault signer key is kept separate from deployer/relayer.
 * 5. Dry-run support allows deterministic verification without requiring live faucet quota.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as quais from 'quais';
import {
  isCyprus1Address,
  assertCyprus1Address,
  QUAI_ORCHARD_CHAIN_ID,
  QUAI_ORCHARD_CYPRUS1_RPC,
  QUAI_ORCHARD_FALLBACK_RPC,
  QUAI_ORCHARD_EXPLORER_URL,
  QUAI_ORCHARD_FAUCET_URL
} from '../../packages/core/src/quai.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('============================================================');
  console.log('TRUSTTRACE: Quai Orchard (Cyprus-1) Smart Contract Deployment');
  console.log(`Target Chain ID:  ${QUAI_ORCHARD_CHAIN_ID} (0x3a98)`);
  console.log(`Zone:             Cyprus-1 (Zone 0-0, Shard 0x00)`);
  console.log(`RPC URL:          ${QUAI_ORCHARD_CYPRUS1_RPC}`);
  console.log(`Explorer:         ${QUAI_ORCHARD_EXPLORER_URL}`);
  console.log('============================================================\n');

  const artifactPath = path.resolve(
    __dirname,
    '../artifacts/contracts/EvidenceAnchor.sol/EvidenceAnchor.json'
  );
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`EvidenceAnchor artifact not found at ${artifactPath}. Run 'npx hardhat compile' first.`);
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
  const abi = artifact.abi;
  const bytecode = artifact.bytecode;

  // Verify that bytecode does not use PUSH0 opcode under paris EVM
  const buildInfoDir = path.resolve(__dirname, '../artifacts/build-info');
  const buildFiles = fs.readdirSync(buildInfoDir);
  let parisTargetConfirmed = false;
  for (const bf of buildFiles) {
    const buildData = JSON.parse(fs.readFileSync(path.join(buildInfoDir, bf), 'utf-8'));
    if (
      buildData.input?.sources?.['contracts/EvidenceAnchor.sol'] &&
      buildData.input?.settings?.evmVersion === 'paris'
    ) {
      parisTargetConfirmed = true;
      break;
    }
  }

  console.log(`[✓] Compiler EVM Target: 'paris' confirmed (PUSH0 forbidden): ${parisTargetConfirmed}`);

  const rawKey = process.env.QUAI_DEPLOYER_PRIVATE_KEY || process.env.QUAI_PRIVATE_KEY;
  const isDryRun = process.argv.includes('--dry-run') || !rawKey;

  if (isDryRun) {
    console.log('\n[!] RUNNING IN VERIFICATION / DRY-RUN MODE:');
    console.log('    No live funded private key provided or --dry-run specified.');
    console.log('    Validating contract bytecode, shard assertions, and deployment schema...\n');

    // Reference Cyprus-1 address grounded for tests
    const sampleAddress = '0x00a89d7494cb3d16858a74e5cae1a965d14df5a2';
    assertCyprus1Address(sampleAddress, 'SampleContractAddress');

    console.log(`[✓] ABI Functions:        ${abi.filter((f: any) => f.type === 'function').length} functions`);
    console.log(`[✓] Bytecode Size:        ${bytecode.length / 2 - 1} bytes`);
    console.log(`[✓] Cyprus-1 Shard Rule:  Strict 0x00 byte prefix verified`);
    console.log(`[✓] Gas Optimization:     200 runs, paris EVM`);
    console.log('\nDry-run verification completed successfully.');
    console.log('To execute a live on-chain deployment:');
    console.log(`1. Generate Cyprus-1 wallet: node --experimental-strip-types blockchain/scripts/generate-quai-wallet.ts`);
    console.log(`2. Fund deployer via faucet: ${QUAI_ORCHARD_FAUCET_URL}`);
    console.log(`3. Run: QUAI_DEPLOYER_PRIVATE_KEY=0x... node --experimental-strip-types blockchain/scripts/deploy-orchard.ts`);
    return;
  }

  const cleanKey = rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`;
  const provider = new quais.JsonRpcProvider(QUAI_ORCHARD_CYPRUS1_RPC);
  const wallet = new quais.Wallet(cleanKey, provider);

  console.log(`Deployer Address: ${wallet.address}`);
  assertCyprus1Address(wallet.address, 'Deployer');

  // Check network connectivity
  try {
    const net = await provider.getNetwork();
    console.log(`Connected to Network: ${net.name} (Chain ID: ${net.chainId})`);
  } catch (err: any) {
    console.warn(`[!] Primary Cyprus-1 RPC notice: ${err?.message || err}. Checking fallback...`);
  }

  console.log('\nDeploying EvidenceAnchor to Quai Orchard Cyprus-1 with address grinding...');
  const factory = new quais.ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy();
  await contract.waitForDeployment();

  const deployedAddress = await contract.getAddress();
  const txHash = contract.deploymentTransaction()?.hash || 'N/A';

  console.log('\n============================================================');
  console.log('DEPLOYMENT SUCCEEDED ON QUAI ORCHARD (CYPRUS-1)!');
  console.log(`Contract Address: ${deployedAddress}`);
  console.log(`Tx Hash:          ${txHash}`);
  console.log(`Explorer Link:    ${QUAI_ORCHARD_EXPLORER_URL}/address/${deployedAddress}`);
  console.log('============================================================\n');

  assertCyprus1Address(deployedAddress, 'DeployedContract');

  // Update deployments.json
  const deploymentsPath = path.resolve(__dirname, '../../packages/core/src/deployments.json');
  if (fs.existsSync(deploymentsPath)) {
    const deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf-8'));
    deployments.quai_orchard_cyprus1.contractAddress = deployedAddress;
    deployments.quai_orchard_cyprus1.deployerAddress = wallet.address;
    deployments.quai_orchard_cyprus1.deployTxHash = txHash;
    deployments.quai_orchard_cyprus1.deployedAt = new Date().toISOString();
    fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
    console.log(`[✓] Updated ${deploymentsPath}`);
  }
}

main().catch((err) => {
  console.error('\n❌ Deployment Failed:');
  console.error(err);
  process.exit(1);
});
```

---

### `blockchain/scripts/submit-checkpoint-orchard.ts`
```typescript
/**
 * TRUSTTRACE: Quai Orchard Tier 2 Cross-Chain Checkpoint Submission Script
 *
 * Anchors aggregate epoch checkpoint digests to Quai Network Orchard Cyprus-1.
 * Enforces strict Cyprus-1 (0x00) shard addressing and EIP-712 structured signing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as quais from 'quais';
import {
  isCyprus1Address,
  assertCyprus1Address,
  QUAI_ORCHARD_CHAIN_ID,
  QUAI_ORCHARD_CYPRUS1_RPC,
  QUAI_ORCHARD_FALLBACK_RPC,
  QUAI_ORCHARD_EXPLORER_URL
} from '../../packages/core/src/quai.ts';
import {
  computeCommitmentStructHashHex,
  GENESIS_CHECKPOINT_HASH
} from '../../packages/core/src/commitment.ts';
import { signCommitment } from '../../packages/core/src/signer.ts';
import type { BatchCommitment } from '../../packages/core/src/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('============================================================');
  console.log('TRUSTTRACE: Quai Orchard Tier 2 Checkpoint Anchor Submission');
  console.log(`Target Network:   Quai Orchard (Cyprus-1, Chain ID: ${QUAI_ORCHARD_CHAIN_ID})`);
  console.log('============================================================\n');

  const deploymentsPath = path.resolve(__dirname, '../../packages/core/src/deployments.json');
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error(`deployments.json not found at ${deploymentsPath}`);
  }

  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf-8'));
  const orchardConfig = deployments.quai_orchard_cyprus1;
  const contractAddress = orchardConfig.contractAddress;

  console.log(`Target Contract:  ${contractAddress}`);
  assertCyprus1Address(contractAddress, 'TargetContract');

  // Checkpoint digest argument (ignoring CLI flags) or default test digest
  const positionalArgs = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const checkpointDigest = positionalArgs[0] || '0x2e02f2…REDACTED';
  console.log(`Checkpoint Digest to Anchor: ${checkpointDigest}`);

  const sourceId = '0x736f75…REDACTED'; // "source-01"

  const commitment: BatchCommitment = {
    sourceId,
    sequenceStart: 1n,
    sequenceEnd: 100n,
    leafCount: 100n,
    merkleRoot: checkpointDigest,
    previousCheckpointHash: GENESIS_CHECKPOINT_HASH
  };

  const domain = {
    name: 'EvidenceAnchor',
    version: '1',
    chainId: QUAI_ORCHARD_CHAIN_ID,
    verifyingContract: contractAddress
  };

  const structHash = computeCommitmentStructHashHex(commitment);
  console.log(`Commitment StructHash:       ${structHash}`);

  const relayerKey = process.env.QUAI_RELAYER_PRIVATE_KEY;
  const vaultKey = process.env.QUAI_VAULT_SIGNER_PRIVATE_KEY;

  if (!relayerKey || !vaultKey || process.argv.includes('--dry-run')) {
    console.log('\n[!] RUNNING IN DRY-RUN / SIMULATION MODE');
    console.log('    QUAI_RELAYER_PRIVATE_KEY or QUAI_VAULT_SIGNER_PRIVATE_KEY not set.');
    console.log('    Validating EIP-712 signature generation under Quai Orchard domain...\n');

    // Use test vault signer key
    const testVaultKey = '0x767c35…REDACTED';
    const signed = signCommitment(testVaultKey, domain, commitment);

    console.log(`[✓] Test Vault Signer:     ${signed.signer} (starts with 0x00: ${isCyprus1Address(signed.signer)})`);
    console.log(`[✓] EIP-712 Digest:        ${signed.digest}`);
    console.log(`[✓] EIP-712 Signature:     ${signed.signature}`);
    console.log('\nDry-run simulation complete. Checkpoint payload is ready for submission.');
    return;
  }

  // Live Submission
  const provider = new quais.JsonRpcProvider(QUAI_ORCHARD_CYPRUS1_RPC);
  const relayerWallet = new quais.Wallet(relayerKey, provider);
  assertCyprus1Address(relayerWallet.address, 'QuaiRelayer');

  console.log(`\nQuai Relayer Address: ${relayerWallet.address}`);
  console.log('Signing commitment with Vault Signer key...');
  const signed = signCommitment(vaultKey, domain, commitment);
  assertCyprus1Address(signed.signer, 'VaultSigner');

  const artifactPath = path.resolve(
    __dirname,
    '../artifacts/contracts/EvidenceAnchor.sol/EvidenceAnchor.json'
  );
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
  const contract = new quais.Contract(contractAddress, artifact.abi, relayerWallet);

  console.log('Submitting anchorBatch transaction to Quai Orchard Cyprus-1...');
  const tx = await contract.anchorBatch(commitment, signed.signature);
  console.log(`Transaction broadcast: ${tx.hash}`);

  const receipt = await tx.wait();
  console.log('\n============================================================');
  console.log('CHECKPOINT ANCHORED SUCCESSFULLY ON QUAI ORCHARD!');
  console.log(`Block Number:  ${receipt.blockNumber}`);
  console.log(`Tx Hash:       ${tx.hash}`);
  console.log(`Explorer Link: ${QUAI_ORCHARD_EXPLORER_URL}/tx/${tx.hash}`);
  console.log('============================================================\n');
}

main().catch((err) => {
  console.error('\n❌ Submission Failed:');
  console.error(err);
  process.exit(1);
});
```

---

## 5. Environment Files (Names Only) & `.gitignore`

### `lab/.env.lab`
```text
LAB_SSH_PASSWORD=<value hidden>
AGENT_SOURCE_ID=<value hidden>
AGENT_STREAM_ID=<value hidden>
AGENT_FILE_IDENTITY=<value hidden>
AGENT_PUBLIC_KEY_HEX=<value hidden>
VAULT_SIGNER_PRIVATE_KEY=<value hidden>
VAULT_BASE_URL=<value hidden>
RSYSLOG_TARGET_HOST=<value hidden>
RSYSLOG_TARGET_PORT=<value hidden>
BACKEND_HOST=<value hidden>
BACKEND_PORT=<value hidden>
RSYSLOG_HOST=<value hidden>
RSYSLOG_PORT=<value hidden>
```

### `lab/contract-address.env`
```text
# Generated by blockchain/scripts/deploy-local.ts at 2026-11-21T06:49:10.462Z
EVIDENCE_ANCHOR_LOCAL_ADDRESS=<value hidden>
LOCAL_RPC_URL=<value hidden>
LOCAL_CHAIN_ID=<value hidden>
LOCAL_RELAYER_PRIVATE_KEY=<value hidden>
VAULT_SIGNER_ADDRESS=<value hidden>
AGENT_SOURCE_ID=<value hidden>
```

### `.env.example`
```text
# =<value hidden>
# TRUSTTRACE Environment Configuration Template (.env.example)
# RULE: DO NOT COMMIT REAL PRIVATE KEYS OR RPC CREDENTIALS TO GIT.
# =<value hidden>

# RPC Endpoints
LOCAL_RPC_URL=<value hidden>
LOCAL_CHAIN_ID=<value hidden>

# Quai Network (Orchard Testnet, Cyprus-1 Zone)
QUAI_ORCHARD_RPC_URL=<value hidden>
QUAI_CHAIN_ID=<value hidden>

# Smart Contract Addresses (populated after deployment)
EVIDENCE_ANCHOR_LOCAL_ADDRESS=<value hidden>
EVIDENCE_ANCHOR_QUAI_ADDRESS=<value hidden>

# Role & Key Separation:
# 1. EIP-712 Vault Signer: Signs batch commitments inside the isolated Evidence Vault ONLY.
#    In production, mounted via Docker secret (/run/secrets/vault_signer_key).
VAULT_SIGNER_PRIVATE_KEY=<value hidden>
VAULT_SIGNER_SECRET_PATH=<value hidden>

# 2. Local Relayer: Submits Tier 1 fast-path transactions to local Hardhat node.
LOCAL_RELAYER_PRIVATE_KEY=<value hidden>

# 3. Quai Relayer: Submits Tier 2 public checkpoints to Quai Orchard Cyprus-1.
#    MUST be an in-zone address with the mandatory 0x00 prefix funded via orchard.faucet.quai.network!
#    RULE: Never use Hardhat default keys on a public network!
QUAI_RELAYER_PRIVATE_KEY=<value hidden>
```

### `apps/dashboard/.env.example`
```text
VITE_TRUSTTRACE_DATA_MODE=<value hidden>
VITE_TRUSTTRACE_API_BASE_URL=<value hidden>
VITE_TRUSTTRACE_API_TIMEOUT_MS=<value hidden>
```

### `apps/dashboard/.env.development`
```text
VITE_TRUSTTRACE_DATA_MODE=<value hidden>
VITE_TRUSTTRACE_API_BASE_URL=<value hidden>
VITE_TRUSTTRACE_API_TIMEOUT_MS=<value hidden>
```

### `.gitignore`
```text
# Dependencies
node_modules/
.pnp
.pnp.js

# Hardhat & Foundry artifacts
artifacts/
cache/
typechain-types/

# Build outputs
dist/
build/
*.tsbuildinfo

# Environment and secrets (NEVER commit secrets!)
.env
.env.local
.env.*.local
*.pem
*.key

# Logs
logs/
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# OS / Editor
.DS_Store
.idea/
.vscode/
*.swp
*.swo

# Test coverage
coverage/
.nyc_output/
```
