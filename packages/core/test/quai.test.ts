import assert from 'node:assert';
import {
  isCyprus1Address,
  assertCyprus1Address,
  formatQuaiAddress,
  getZoneFromAddress,
  QUAI_ORCHARD_CHAIN_ID,
  QUAI_ORCHARD_CYPRUS1_RPC,
  CYPRUS1_PREFIX_BYTE,
  CYPRUS1_PREFIX_HEX
} from '../src/quai.ts';

export function runQuaiTests(): void {
  console.log('Running Quai Network Cyprus-1 utilities tests...');

  // 1. Network Constants
  assert.strictEqual(QUAI_ORCHARD_CHAIN_ID, 15000, 'Chain ID must be 15000');
  assert.strictEqual(CYPRUS1_PREFIX_BYTE, 0x00, 'Cyprus-1 prefix byte must be 0x00');
  assert.strictEqual(CYPRUS1_PREFIX_HEX, '0x00', 'Cyprus-1 prefix hex must be 0x00');
  assert.strictEqual(QUAI_ORCHARD_CYPRUS1_RPC, 'https://orchard.rpc.quai.network/cyprus1');

  // 2. isCyprus1Address validation
  const validCyprus1 = '0x001234567890abcdef1234567890abcdef123456';
  const validCyprus1Mixed = '0x001234567890ABCDEF1234567890abcdef123456';
  const validCyprus1Zero = '0x0000000000000000000000000000000000000000';
  
  assert.strictEqual(isCyprus1Address(validCyprus1), true, 'Valid Cyprus-1 address should return true');
  assert.strictEqual(isCyprus1Address(validCyprus1Mixed), true, 'Mixed case Cyprus-1 address should return true');
  assert.strictEqual(isCyprus1Address(validCyprus1Zero), true, 'All zero Cyprus-1 address should return true');

  // Non-Cyprus-1 addresses (different zones or standard EVM addresses)
  assert.strictEqual(isCyprus1Address('0x011234567890abcdef1234567890abcdef123456'), false, '0x01 prefix is not Cyprus-1');
  assert.strictEqual(isCyprus1Address('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'), false, 'Standard Hardhat address is not Cyprus-1');
  assert.strictEqual(isCyprus1Address('0x1234567890abcdef1234567890abcdef12345678'), false, '0x12 prefix is not Cyprus-1');

  // Malformed inputs
  assert.strictEqual(isCyprus1Address('0x001234567890abcdef'), false, 'Too short address should return false');
  assert.strictEqual(isCyprus1Address('0x001234567890abcdef1234567890abcdef12345678'), false, 'Too long address should return false');
  assert.strictEqual(isCyprus1Address('0x001234567890abcdef1234567890abcdef12345g'), false, 'Invalid hex char should return false');
  assert.strictEqual(isCyprus1Address('001234567890abcdef1234567890abcdef12345678'), false, 'Missing 0x prefix should return false');
  // @ts-expect-error test invalid types
  assert.strictEqual(isCyprus1Address(null), false, 'null should return false');
  // @ts-expect-error test invalid types
  assert.strictEqual(isCyprus1Address(undefined), false, 'undefined should return false');
  // @ts-expect-error test invalid types
  assert.strictEqual(isCyprus1Address(12345), false, 'number should return false');

  // 3. assertCyprus1Address
  assert.doesNotThrow(() => {
    assertCyprus1Address(validCyprus1, 'TestDeployer');
  }, 'Valid address must not throw');

  assert.throws(
    () => {
      assertCyprus1Address('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', 'AttackerKey');
    },
    /Quai Shard Violation/,
    'Invalid address must throw descriptive Quai Shard Violation error'
  );

  // 4. formatQuaiAddress
  assert.strictEqual(
    formatQuaiAddress(validCyprus1Mixed),
    validCyprus1.toLowerCase(),
    'formatQuaiAddress should return lowercase normalized address'
  );
  assert.throws(() => {
    formatQuaiAddress('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  }, /Invalid Quai address/);

  // 5. getZoneFromAddress
  assert.strictEqual(getZoneFromAddress('0x001234567890abcdef1234567890abcdef123456'), 'cyprus-1');
  assert.strictEqual(getZoneFromAddress('0x1d1234567890abcdef1234567890abcdef123456'), 'cyprus-1');
  assert.strictEqual(getZoneFromAddress('0x1e1234567890abcdef1234567890abcdef123456'), 'cyprus-2');
  assert.strictEqual(getZoneFromAddress('0x3a1234567890abcdef1234567890abcdef123456'), 'cyprus-2');
  assert.strictEqual(getZoneFromAddress('0x3b1234567890abcdef1234567890abcdef123456'), 'cyprus-3');
  assert.strictEqual(getZoneFromAddress('0x571234567890abcdef1234567890abcdef123456'), 'cyprus-3');
  assert.strictEqual(getZoneFromAddress('0x581234567890abcdef1234567890abcdef123456'), 'other-zone');
  assert.strictEqual(getZoneFromAddress('invalid'), 'unknown');

  console.log('✓ All Quai Cyprus-1 utility tests passed.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runQuaiTests();
}
