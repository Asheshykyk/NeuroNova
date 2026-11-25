# TRUSTTRACE: Security Hygiene, Toolchain and CI Runbook

Repository NeuroNova · The Big Hack 2.0 · Problem B3 · Status: draft, built from the Step 0 and Step 1a audit outputs

## How to use this runbook

- Work on a branch (`chore/security-hygiene`) and open a pull request, even though `main` is not yet protected.
- After every commit run `npm run test:all`. The baseline is 410 checks plus the new tests added here; any drop is a regression.
- Never paste a full private key anywhere, including AI chats. Redact as `0xabcdef…REDACTED`.
- Tell teammates before merging step 1F: untracking `lab/.env.lab` deletes it from their working trees on pull.
- Nothing here is verified until you run it and paste the output.

## Findings that drive the work

1. **Critical:** the Orchard vault signer address in `deployments.json` (`0x00ec2241…`) belongs to a key committed in the public repo (`submit-checkpoint-orchard.ts` line 87 and the smoke test). Treat it as burned.
2. **Correction:** the `*` entry in `config/index.ts` maps to one configured Ed25519 public key shared by all sources. It does not accept any signature. The risk is one shared key for every source, plus compose and Render placeholders. Render’s `0x4fdca0…` is dangerous only if its private key is also committed.
3. `contractAddress` `0x00a89d…` is a placeholder (the dry-run calls it “grounded for tests”), yet the backend config uses it as the live default.
4. `submit-checkpoint-orchard.ts` anchors a fabricated commitment (sequence 1 to 100, leafCount 100) for `source-01`. Because the contract enforces continuity, a fake genesis would permanently occupy that source’s chain.
5. `deploy-orchard.ts` keeps deploying after the chain-ID check fails.
6. `deployments.json` says Solidity 0.8.19 but `hardhat.config.cjs` compiles 0.8.24; Quai’s docs list 0.8.19 or 0.8.20 as the maximum.
7. The rsyslog TCP receiver is unauthenticated by design. Keep it on loopback or a private network.
8. “Offline CI” means no blockchain RPC. `npm ci` and Hardhat’s solc download are allowed, so cache them.

## Step 1: secrets and fail-safe defaults

### 1A. Shared denylist

New file `packages/core/src/denylist.ts`:

```ts
// Addresses of keys that are committed to the public repo or are well-known defaults.
export const COMPROMISED_ADDRESSES: ReadonlySet<string> = new Set([
  '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', // Hardhat #0
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', // Hardhat #1
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', // Hardhat #2
  '0xFCAd0B19bB29D4674531d6f115237E16AfCE377c', // lab mock vault key
  '0x6A9296CEb89D12e1F53b2Dd5Df45d3ADB3A814c2', // backend test relayer
  '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf', // trivial test key
  '0x00ec2241529f64253d1239Ce336a15f1f454e839', // committed Orchard dry-run vault key
  '0x36EB00D4BF389F3323d1C66b35a8827Dddbae504'  // old render.yaml vault signer
].map((address) => address.toLowerCase()));

export const LOCAL_TEST_CHAIN_IDS: ReadonlySet<bigint> = new Set<bigint>([31337n, 1337n]);

export function isCompromisedAddress(address: string): boolean {
  return COMPROMISED_ADDRESSES.has(address.toLowerCase());
}

export function assertAddressNotCompromised(address: string, chainId: bigint | number, label: string): void {
  if (LOCAL_TEST_CHAIN_IDS.has(BigInt(chainId))) return;
  if (isCompromisedAddress(address)) {
    throw new Error(`SECURITY: ${label} ${address} is a publicly known or committed test key and must not be used on chain ${chainId}`);
  }
}
```

Expose it through the existing `quai` export (no `package.json` edit):

```bash
printf "\nexport * from './denylist.ts';\n" >> packages/core/src/quai.ts
```

Test `backend/tests/keyGuard.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAddressNotCompromised } from '@trusttrace/core/quai';

test('well-known key is allowed on local chains only', () => {
  const hardhat0 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
  assert.doesNotThrow(() => assertAddressNotCompromised(hardhat0, 31337n, 'relayer'));
  assert.throws(() => assertAddressNotCompromised(hardhat0, 15000n, 'relayer'), /publicly known/);
});
test('committed Orchard dry-run signer is rejected on Orchard', () => {
  assert.throws(() => assertAddressNotCompromised('0x00ec2241529f64253d1239Ce336a15f1f454e839', 15000n, 'vault signer'), /publicly known/);
});
test('an unlisted address passes', () => {
  assert.doesNotThrow(() => assertAddressNotCompromised('0x0000000000000000000000000000000000000001', 15000n, 'x'));
});
```

### 1B. Read authentication and CORS allowlist

New file `backend/src/api/security.ts`:

```ts
import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

export interface ApiSecurityOptions {
  readApiToken: string | null;
  allowUnauthenticatedReads: boolean;
  corsAllowedOrigins: string[];
}

const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

export function resolveApiSecurity(env: NodeJS.ProcessEnv = process.env): ApiSecurityOptions {
  const production = env.NODE_ENV === 'production';
  const readApiToken = env.READ_API_TOKEN?.trim() || null;
  const allowUnauthenticatedReads = env.ALLOW_UNAUTHENTICATED_READS === 'true';
  let corsAllowedOrigins = (env.CORS_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (production && allowUnauthenticatedReads) {
    throw new Error('ALLOW_UNAUTHENTICATED_READS must not be enabled when NODE_ENV=production');
  }
  if (production && !readApiToken) throw new Error('READ_API_TOKEN is required when NODE_ENV=production');
  if (readApiToken && readApiToken.length < 24) throw new Error('READ_API_TOKEN must be at least 24 characters');
  if (corsAllowedOrigins.length === 0 && !production) corsAllowedOrigins = DEV_ORIGINS;
  return { readApiToken, allowUnauthenticatedReads, corsAllowedOrigins };
}

function tokensEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createCorsMiddleware(options: ApiSecurityOptions): RequestHandler {
  return (request, response, next) => {
    const origin = request.headers.origin;
    if (origin && options.corsAllowedOrigins.includes(origin)) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    if (request.method === 'OPTIONS') { response.sendStatus(204); return; }
    next();
  };
}

export function createReadAuthMiddleware(options: ApiSecurityOptions): RequestHandler {
  return (request, response, next) => {
    if (options.allowUnauthenticatedReads) { next(); return; }
    if (!options.readApiToken) {
      response.status(503).json({ code: 'READ_AUTH_NOT_CONFIGURED', error: 'Read API token is not configured' });
      return;
    }
    const presented = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1];
    if (!presented || !tokensEqual(presented, options.readApiToken)) {
      response.status(401).json({ code: 'UNAUTHORIZED', error: 'Missing or invalid read token' });
      return;
    }
    next();
  };
}
```

Edits to `backend/src/api/app.ts`:

1. Add the import `import { createCorsMiddleware, createReadAuthMiddleware, resolveApiSecurity, type ApiSecurityOptions } from './security.ts';` and the field `security?: ApiSecurityOptions;` in `CreateAppOptions`.
2. Replace the whole first `app.use((_request, response, next) => { ... });` block (the CORS wildcard) with:

```ts
  const security = options.security ?? resolveApiSecurity();
  const requireReadAuth = createReadAuthMiddleware(security);
  app.use(createCorsMiddleware(security));
```

3. Insert `requireReadAuth,` as the second argument on all seven read routes, for example `app.get('/api/v1/events', requireReadAuth, createEventsHandler(readOptions));`. This covers `sources`, `events`, both `events/:…` routes, `batches`, `checkpoints` and `gaps`.

Existing read tests would now get a 503, so add `backend/tests/setup-env.ts`:

```ts
process.env.ALLOW_UNAUTHENTICATED_READS ??= 'true';
```

and change the backend test script to `node --experimental-strip-types --import ./tests/setup-env.ts --test tests/**/*.test.ts`.

New `backend/tests/apiSecurity.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/api/app.ts';
import { resolveApiSecurity, type ApiSecurityOptions } from '../src/api/security.ts';
import type { EvidenceStore } from '../src/storage/evidenceStore.ts';

const TOKEN = 'test-token-0123456789abcdef0123';
const base: ApiSecurityOptions = { readApiToken: TOKEN, allowUnauthenticatedReads: false, corsAllowedOrigins: ['http://localhost:5173'] };

async function call(security: ApiSecurityOptions, path: string, headers: Record<string, string> = {}) {
  const app = createApp({ store: {} as unknown as EvidenceStore, security });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const { port } = server.address() as AddressInfo;
    return await fetch(`http://127.0.0.1:${port}${path}`, { headers });
  } finally { server.close(); }
}

test('read route without token is 401', async () => assert.equal((await call(base, '/api/v1/events')).status, 401));
test('read route with wrong token is 401', async () => assert.equal((await call(base, '/api/v1/events', { Authorization: 'Bearer nope' })).status, 401));
test('valid token passes the auth gate', async () => assert.notEqual((await call(base, '/api/v1/events', { Authorization: `Bearer ${TOKEN}` })).status, 401));
test('no token configured and unauthenticated reads off is 503', async () =>
  assert.equal((await call({ ...base, readApiToken: null }, '/api/v1/gaps')).status, 503));
test('lab mode allows reads past the gate', async () => {
  const status = (await call({ ...base, readApiToken: null, allowUnauthenticatedReads: true }, '/api/v1/gaps')).status;
  assert.ok(status !== 401 && status !== 503);
});
test('health stays open', async () => assert.equal((await call(base, '/health')).status, 200));
test('CORS echoes only allowed origins', async () => {
  const ok = await call(base, '/health', { Origin: 'http://localhost:5173' });
  const bad = await call(base, '/health', { Origin: 'https://evil.example' });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});
test('production refuses open reads and requires a token', () => {
  assert.throws(() => resolveApiSecurity({ NODE_ENV: 'production', ALLOW_UNAUTHENTICATED_READS: 'true', READ_API_TOKEN: TOKEN }));
  assert.throws(() => resolveApiSecurity({ NODE_ENV: 'production' }));
});
```

The dashboard and verifier must send `Authorization: Bearer <token>` before any real deployment. That needs files not yet reviewed, and the token must not go in a `VITE_` variable for a public site.

### 1C. `backend/src/config/index.ts` (three edits)

1. Import: `import { assertCyprus1Address, assertAddressNotCompromised } from '@trusttrace/core/quai';`
2. Replace the two global-key lines with:

```ts
  const globalKey = process.env.AGENT_PUBLIC_KEY_HEX?.trim();
  if (globalKey) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('AGENT_PUBLIC_KEY_HEX (one shared key for all sources) is lab-only; set TRUSTED_AGENT_PUBLIC_KEYS_JSON per sourceId in production.');
    }
    if (process.env.ALLOW_SHARED_LAB_AGENT_KEY !== 'true') {
      throw new Error('AGENT_PUBLIC_KEY_HEX requires ALLOW_SHARED_LAB_AGENT_KEY=true (lab only).');
    }
    keys.set('*', globalKey);
  }
```

3. In `getQuaiOrchardConfig()`, after the two `assertCyprus1Address` blocks, add the guard and reuse `chainId` in the return (`chainId,`):

```ts
  const chainId = BigInt(process.env.QUAI_CHAIN_ID || orchard.chainId);
  if (relayerAddress) assertAddressNotCompromised(relayerAddress, chainId, 'Quai relayer address');
  if (orchard.vaultSignerAddress) assertAddressNotCompromised(orchard.vaultSignerAddress, chainId, 'Quai vault signer address');
```

This guard makes the config fail at import until 1D is done, which is intended.

### 1D. Placeholders and fresh keys

1. In `packages/core/src/deployments.json`, under `quai_orchard_cyprus1`, set `contractAddress`, `deployerAddress`, `relayerAddress` and `vaultSignerAddress` to `null`. Add `"deployTxHash": null` and `"status": "NOT_DEPLOYED"`.
2. Run `git grep -n "deployments" -- '*.ts'`. Any test that reads those fields should use its own constant instead. Run `npm run test:all` and review failures; smoke-test and quai-test failures are expected.
3. Generate fresh wallets. First check that the generator is random:

```bash
for i in 1 2; do node --experimental-strip-types blockchain/scripts/generate-quai-wallet.ts | grep -i address; done
```

If both runs print the same address, the generator is deterministic and its keys are derivable; do not use them. Store each key in a password manager, never in a chat or Git.

### 1E. Orchard scripts and compiler

`blockchain/hardhat.config.cjs`: remove `AMOY_RPC_URL`, `RELAYER_PRIVATE_KEY` and the `amoy` network. Delete `deploy:amoy` from `blockchain/package.json`. In `solidity.compilers`, add a second entry:

```js
{ version: '0.8.19', settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris' } }
```

and change `overrides['contracts/EvidenceAnchor.sol'].version` from `'0.8.24'` to `'0.8.19'`. Verify with `cd blockchain && npx hardhat compile && npx hardhat test`. Expect all 48 to pass, with gas numbers changing slightly; re-measure before quoting any.

`deploy-orchard.ts`:

- Add `assertAddressNotCompromised` to the imports from `packages/core/src/quai.ts`.
- Require explicit confirmation to broadcast. Directly after `const isDryRun = ...`, add:

```ts
  if (!isDryRun && !process.argv.includes('--confirm-broadcast')) {
    throw new Error('Refusing to broadcast without --confirm-broadcast');
  }
```

- After `assertCyprus1Address(wallet.address, 'Deployer');` add `assertAddressNotCompromised(wallet.address, BigInt(QUAI_ORCHARD_CHAIN_ID), 'Deployer');`
- Replace the `try { ... getNetwork ... } catch (err) { console.warn(...) }` block with:

```ts
  const net = await provider.getNetwork();
  if (BigInt(net.chainId) !== BigInt(QUAI_ORCHARD_CHAIN_ID)) {
    throw new Error(`Wrong network: expected ${QUAI_ORCHARD_CHAIN_ID}, got ${net.chainId}`);
  }
  console.log(`Connected to Network: ${net.name} (Chain ID: ${net.chainId})`);
```

`submit-checkpoint-orchard.ts`:

- Remove the committed dry-run key. Replace `const testVaultKey = '0x767c35…';` with `const testVaultKey = '0x' + randomBytes(32).toString('hex'); // ephemeral, dry-run only`, add `import { randomBytes } from 'node:crypto';` at the top, and change the dry-run print label to say the key is ephemeral and not in-zone.
- In the live path, after the two `assertCyprus1Address` calls, add `assertAddressNotCompromised` for both `relayerWallet.address` and `signed.signer`, and require `--confirm-broadcast`.
- Do not run the live path with the hardcoded `source-01` and sequence 1 to 100. Take the checkpoint digest, source ID and range from real data, using a dedicated checkpoint source ID.

### 1F. Compose, Render and lab env

Replace `lab/compose.yaml` fully:

```yaml
services:
  victim:
    build:
      context: ./victim
    environment:
      LAB_SSH_PASSWORD: ${LAB_SSH_PASSWORD:?run node scripts/gen-lab-env.mjs}
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
      NODE_ENV: development              # lab only; overrides any image default
      ALLOW_SHARED_LAB_AGENT_KEY: "true" # lab only
      ALLOW_UNAUTHENTICATED_READS: "true" # lab only; ports are bound to 127.0.0.1
      CORS_ALLOWED_ORIGINS: ${CORS_ALLOWED_ORIGINS:-http://localhost:5173,http://127.0.0.1:5173}
      BACKEND_HOST: "0.0.0.0"
      BACKEND_PORT: "3000"
      RSYSLOG_HOST: "0.0.0.0"
      RSYSLOG_PORT: "5140"
      AGENT_PUBLIC_KEY_HEX: ${AGENT_PUBLIC_KEY_HEX:?set in lab/.env.lab}
      VAULT_SIGNER_PRIVATE_KEY: ${VAULT_SIGNER_PRIVATE_KEY:?run node scripts/gen-lab-env.mjs}
      EVIDENCE_DIRECTORY: /data/vault
      EVIDENCE_SQLITE_PATH: /data/vault/evidence-index.sqlite3
      LOCAL_RPC_URL: ${LOCAL_RPC_URL:-http://host.docker.internal:8545}
      EVIDENCE_ANCHOR_LOCAL_ADDRESS: ${EVIDENCE_ANCHOR_LOCAL_ADDRESS:-}
      LOCAL_RELAYER_PRIVATE_KEY: ${LOCAL_RELAYER_PRIVATE_KEY:?set by blockchain/scripts/deploy-local.ts}
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
      AGENT_SOURCE_ID: ${AGENT_SOURCE_ID:?set in lab/.env.lab}
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

Start the lab with `docker compose --env-file lab/.env.lab --env-file lab/contract-address.env -f lab/compose.yaml up`, and update the demo runbook with this command.

In `render.yaml`, remove the `AGENT_PUBLIC_KEY_HEX` and `VAULT_SIGNER_PRIVATE_KEY` entries and add:

```yaml
      - key: VAULT_SIGNER_PRIVATE_KEY
        sync: false
      - key: TRUSTED_AGENT_PUBLIC_KEYS_JSON
        sync: false
      - key: READ_API_TOKEN
        sync: false
      - key: CORS_ALLOWED_ORIGINS
        sync: false
```

New `scripts/gen-lab-env.mjs`:

```js
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';

const target = new URL('../lab/.env.lab', import.meta.url);
if (existsSync(target) && !process.argv.includes('--force')) {
  console.error('lab/.env.lab already exists (use --force to overwrite)');
  process.exit(1);
}
const lines = [
  `LAB_SSH_PASSWORD=${randomBytes(18).toString('base64url')}`,
  `AGENT_SOURCE_ID=0x${'11'.repeat(32)}`,
  'AGENT_STREAM_ID=auth.log',
  'AGENT_FILE_IDENTITY=auth.log',
  'AGENT_PUBLIC_KEY_HEX=',   // fill from the agent key setup (see “Still needed”)
  `VAULT_SIGNER_PRIVATE_KEY=0x${randomBytes(32).toString('hex')}`
];
writeFileSync(target, lines.join('\n') + '\n', { mode: 0o600 });
console.log('Wrote lab/.env.lab (values not printed).');
```

`.gitignore` additions:

```
.env.*
!.env.example
!**/.env.example
!apps/dashboard/.env.development
lab/.env.lab
lab/contract-address.env
*.sqlite
*.sqlite3
*.sqlite3-wal
*.sqlite3-shm
data/
vault-data/
```

Then untrack the two lab files:

```bash
git rm --cached lab/.env.lab lab/contract-address.env
```

`.env.example` additions (names only): `READ_API_TOKEN=`, `CORS_ALLOWED_ORIGINS=`, `ALLOW_SHARED_LAB_AGENT_KEY=`, `ALLOW_UNAUTHENTICATED_READS=`, `TRUSTED_AGENT_PUBLIC_KEYS_JSON=`.

### 1G. Production-path key check

`scripts/check-no-committed-keys.mjs` (no new dependency):

```js
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SCAN = [/^render\.yaml$/, /^lab\//, /^backend\/src\/config\//, /^blockchain\/scripts\//, /^packages\/core\/src\/deployments\.json$/, /^\.env\.example$/, /^apps\/dashboard\/\.env/];
const HARDHAT_PREFIXES = ['0xac0974', '0x59c699', '0x5de411']; // public Hardhat keys
const HARDHAT_OK_FILES = new Set(['blockchain/scripts/deploy-local.ts']);
const KEYISH = /(PRIVATE_?KEY|SECRET|MNEMONIC|SEED)/i;
const HEX64 = /0x[0-9a-fA-F]{64}/g;

const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter((f) => SCAN.some((re) => re.test(f)));
const problems = [];
for (const file of files) {
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (!KEYISH.test(line)) return;
    for (const hit of line.match(HEX64) ?? []) {
      if (HARDHAT_OK_FILES.has(file) && HARDHAT_PREFIXES.some((p) => hit.startsWith(p))) continue;
      problems.push(`${file}:${i + 1} key-like value ${hit.slice(0, 8)}…`);
    }
  });
}
if (problems.length) { console.error('Committed key-like values in production paths:\n' + problems.join('\n')); process.exit(1); }
console.log(`check-no-committed-keys: ${files.length} files scanned, clean.`);
```

It will fail until `blockchain/scripts/deploy-local.ts` line 33 is fixed. Replace its fallback with a required variable:

```ts
const vaultSignerKey = process.env.VAULT_SIGNER_PRIVATE_KEY?.trim();
if (!vaultSignerKey) throw new Error('VAULT_SIGNER_PRIVATE_KEY is required (run: node scripts/gen-lab-env.mjs)');
```

## Step 2: toolchain and unified scripts

```bash
git rm pnpm-workspace.yaml apps/dashboard/package-lock.json services/verifier/package-lock.json
printf "24\n" > .nvmrc
npm install -D --save-exact quais@"$(node -p "require('quais/package.json').version")"
npm pkg set engines.node=">=22.12.0 <25"
```

Replace the `scripts` block in the root `package.json`, keeping `benchmark` and `demo:rehearsal`:

```json
"test": "npm run test:all",
"test:core": "node --experimental-strip-types packages/core/test/run-tests.ts",
"test:blockchain": "npm run test --workspace=@trusttrace/blockchain && npm run test:hardhat --workspace=@trusttrace/blockchain",
"test:backend": "npm run test --workspace=@trusttrace/backend",
"test:agent": "npm run test --workspace=@trusttrace/host-agent",
"test:verifier": "npm run test --workspace=@trusttrace/verifier",
"test:dashboard": "npm run test --workspace=@trusttrace/dashboard",
"test:all": "npm run test:core && npm run test:blockchain && npm run test:backend && npm run test:agent && npm run test:verifier && npm run test:dashboard",
"typecheck:all": "npm run typecheck --workspace=@trusttrace/backend && npm run typecheck --workspace=@trusttrace/verifier && npm run typecheck --workspace=@trusttrace/dashboard",
"build:all": "npm run build --workspace=@trusttrace/verifier && npm run build --workspace=@trusttrace/dashboard",
"check:secrets": "node scripts/check-no-committed-keys.mjs"
```

Notes: `core` and `agent` have no typecheck script, so `typecheck:all` skips them (add one later). `build:all` skips `backend`, whose build script is a no-emit typecheck. Move `quais` to `dependencies` of whichever package imports it.

Reinstall cleanly and verify:

```bash
rm -rf node_modules apps/*/node_modules services/*/node_modules && npm install && npm ci
npm run test:all 2>&1 | tail -n 30
```

Expected: the total equals 410 plus the new tests.

## Step 3: CI workflow

`.github/workflows/ci.yml`:

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    strategy:
      fail-fast: false
      matrix:
        node: ['22.12.0', '24']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: npm
      - uses: actions/cache@v4
        with:
          path: ~/.cache/hardhat-nodejs
          key: solc-${{ hashFiles('blockchain/hardhat.config.cjs') }}
      - run: npm ci
      - run: npm run check:secrets
      - run: npm run typecheck:all
      - run: npm run test:all
      - run: npm run build:all
```

No secrets and no live RPC are used, and no tests run against Orchard. Action versions are tags for now; pin them to commit SHAs later (Dependabot can do this). If the backend job fails with a connection-refused error, `liveAnchor.test.ts` needs a local node: add a step that starts `npx hardhat node` in the background. If the Node 22.12 leg fails, narrow `engines` to what passes.

After CI is green, turn on branch protection for `main` in GitHub Settings: require a pull request, require both `verify` checks, and block force pushes.

## Step 4: documentation corrections

Find the offending claims:

```bash
git grep -nEi "unalterable|production-ready|surviv(e|es|ed) (kernel|root)|500,000|normaliz|Amoy|validated on Quai|deployed on|49,120|28,340|0\.8\.24"
```

| Replace | With |
| --- | --- |
| “unalterable”, “prevents” | “tamper-evident: we detect, prove and recover” |
| “>500,000 EPS” next to SIEMs | “hashing throughput 490,000 leaves/s; durable vault ingestion 87 EPS (measured)” |
| 49,120 gas and the `verifyProof` row | measured 163,867 (chained) and 177,525 (genesis), re-measured after the 0.8.19 change |
| USD per-event table for Quai | remove (Quai pricing is UNKNOWN) |
| “normalized”, “45 + N” | “serialized into the canonical preimage”, “46 + N bytes” |
| “175 tests”, “55 verifier tests” | the verified current counts |
| “production-ready”, “validated on Quai” | “not yet deployed to Orchard (no transaction hash)” |
| Node 22.12 in the benchmark | the Node version actually used |

## Still needed (not yet reviewed)

1. **Agent key handling** (`services/agent/src/main.ts` and anything reading a signing key). If the agent signs with a key from the repo or vectors, Render’s `0x4fdca0…` public key trusts a key anyone can use, and `gen-lab-env.mjs` needs to generate a real pair.
2. `scripts/run-demo-rehearsal.sh` and `blockchain/scripts/deploy-local.ts` (lines 60 to 90).
3. `backend/src/index.ts` and the file that builds the relayer wallet (probably `AnchoringWorker`); the denylist guard belongs where the wallet is constructed.
4. `liveDashboardAdapter.ts` and the verifier bridge fetch code, so both can send the read token.
5. The checkpoint-building code path, so `submit-checkpoint-orchard.ts` can use real data instead of the fabricated commitment.

## Verification checklist

- [ ] `npm run test:all` after each commit: baseline 410 plus new tests, no drops.
- [ ] `npm run check:secrets` is clean.
- [ ] `cd blockchain && npx hardhat compile && npx hardhat test` passes under Solidity 0.8.19 (48 tests).
- [ ] `docker compose` refuses to start when a required variable is missing.
- [ ] Production start refuses `AGENT_PUBLIC_KEY_HEX`, open reads and a missing `READ_API_TOKEN`.
- [ ] CI is green on both Node legs before enabling branch protection.
- [ ] No Orchard transaction is claimed anywhere until a real deployment hash exists.
