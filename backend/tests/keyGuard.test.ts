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
