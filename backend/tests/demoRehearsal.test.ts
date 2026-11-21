import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  runScenario1_HostTamper,
  runScenario2_VaultTamper,
  runScenario3_AgentKill
} from '../src/verification/demoRehearsal.ts';

test('Prompt 6a: 5-minute attack scenario rehearsal across all 3 witnesses', async (context) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trusttrace-test-rehearsal-'));
  context.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  // Attack 1: Host Log Tampering
  const r1 = await runScenario1_HostTamper(tempDir);
  assert.equal(r1.hostCheck, 'FAIL');
  assert.equal(r1.vaultCheck, 'OK');
  assert.equal(r1.blockchainCheck, 'OK');
  assert.equal(r1.verdict, 'TAMPER_DETECTED, EVIDENCE_RECOVERED');

  // Attack 2: Vault Tampering Attempt
  const r2 = await runScenario2_VaultTamper(tempDir);
  assert.equal(r2.vaultCheck, 'FAIL');
  assert.equal(r2.blockchainCheck, 'FAIL');
  assert.equal(r2.verdict, 'VAULT_CORRUPTED');

  // Attack 3: Agent Kill
  const r3 = await runScenario3_AgentKill(tempDir);
  assert.equal(r3.hostCheck, 'FAIL');
  assert.equal(r3.vaultCheck, 'OK');
  assert.equal(r3.verdict, 'AGENT_KILLED_COLLECTION_GAP');
});
