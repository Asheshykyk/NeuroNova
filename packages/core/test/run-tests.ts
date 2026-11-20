/**
 * TRUSTTRACE Core Test Runner
 * Executes all unit tests for packages/core without third-party test runners.
 */

import { runCanonicalTests } from './canonical.test.ts';
import { runMerkleTests } from './merkle.test.ts';
import { runCommitmentTests } from './commitment.test.ts';
import { runAgentChunkTests } from './agent.test.ts';
import { runCheckpointTests } from './checkpoint.test.ts';

console.log('============================================================');
console.log('TRUSTTRACE @trusttrace/core Test Suite');
console.log('Person 1: Cryptographic Engine, Merkle Trees, & EIP-712 Core');
console.log('============================================================\n');

try {
  runCanonicalTests();
  console.log('');
  runMerkleTests();
  console.log('');
  runCommitmentTests();
  console.log('');
  runAgentChunkTests();
  console.log('');
  runCheckpointTests();
  console.log('\n============================================================');
  console.log('ALL CORE CRYPTO TESTS PASSED SUCCESSFULLY! (61/61 checks)');
  console.log('============================================================');
} catch (err) {
  console.error('\n❌ Test Failure:');
  console.error(err);
  process.exit(1);
}
