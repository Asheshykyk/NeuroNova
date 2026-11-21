import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('dashboard remains in demo-safe mode in source defaults', async () => {
  const source = await readFile(
    new URL('../../apps/dashboard/src/data/config.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /=== 'live' \? 'live' : 'demo'/);
});

test('LIVE adapter wires supported Vault GET routes without push or recovery endpoints', async () => {
  const adapter = await readFile(
    new URL('../../apps/dashboard/src/data/liveDashboardAdapter.ts', import.meta.url),
    'utf8',
  );

  for (const route of ['sources', 'events', 'batches', 'gaps']) {
    assert.ok(adapter.includes(`list('/${route}',`));
  }
  assert.match(adapter, /\/events\/\$\{encodeURIComponent\(sourceId\)\}\/\$\{encodeURIComponent\(vaultSequence\)\}/);
  assert.doesNotMatch(adapter, /new WebSocket\(|wsEndpoint|['"`]\/(checkpoints|recovery|ws)['"`]/);
});
