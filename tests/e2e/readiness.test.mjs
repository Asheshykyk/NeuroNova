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

test('live adapter does not contain backend read mappings', async () => {
  const adapter = await readFile(
    new URL('../../apps/dashboard/src/data/liveDashboardAdapter.ts', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(adapter, /fetch\(|new WebSocket\(/);
  assert.match(adapter, /Person 2 has not approved live REST\/WebSocket response mappings/);
});
