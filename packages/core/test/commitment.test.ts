import assert from 'node:assert';
import {
  BATCH_COMMITMENT_TYPEHASH,
  computeCommitmentStructHashHex,
  computeDomainSeparatorHex,
  computeEIP712DigestHex,
  EIP712_DOMAIN_TYPEHASH,
  GENESIS_CHECKPOINT_HASH,
  hashCommitment,
  validateSequenceContinuity
} from '../src/commitment.ts';
import {
  getEthereumAddress,
  recoverCommitmentSigner,
  recoverSignerAddress,
  signBatchCommitment,
  signCommitment,
  verifyCommitmentSignature
} from '../src/signer.ts';
import {
  TEST_AMOY_BATCH,
  TEST_AMOY_STRUCT_HASH,
  TEST_BATCH_1,
  TEST_BATCH_1_STRUCT_HASH,
  TEST_BATCH_2,
  TEST_BATCH_2_STRUCT_HASH,
  TEST_DOMAIN_SEPARATOR,
  TEST_EIP712_DOMAIN,
  TEST_SIGNED_BATCH_1,
  TEST_VAULT_SIGNER_ADDRESS,
  TEST_VAULT_SIGNER_KEY
} from '../src/test-vectors.ts';

export function runCommitmentTests() {
  console.log('--- Running Commitment, EIP-712 & Vault Signer Tests ---');

  // Test 1: EIP-712 TypeHashes
  assert.strictEqual(
    EIP712_DOMAIN_TYPEHASH.length,
    32,
    'EIP712_DOMAIN_TYPEHASH must be 32 bytes'
  );
  assert.strictEqual(
    BATCH_COMMITMENT_TYPEHASH.length,
    32,
    'BATCH_COMMITMENT_TYPEHASH must be 32 bytes'
  );

  // Test 2: Domain separator matches test vector
  const computedDomainSep = computeDomainSeparatorHex(TEST_EIP712_DOMAIN);
  assert.strictEqual(
    computedDomainSep,
    TEST_DOMAIN_SEPARATOR,
    'Domain separator must match frozen test vector'
  );

  // Test 3: Batch 1 struct hash matches test vector (LOCKED: binds sourceId, sequenceStart, sequenceEnd, leafCount, merkleRoot, previousCheckpointHash)
  const computedStructHash1 = computeCommitmentStructHashHex(TEST_BATCH_1);
  assert.strictEqual(
    computedStructHash1,
    TEST_BATCH_1_STRUCT_HASH,
    'Batch 1 struct hash must match frozen test vector'
  );

  // Test 4: Batch 2 struct hash matches test vector
  const computedStructHash2 = computeCommitmentStructHashHex(TEST_BATCH_2);
  assert.strictEqual(
    computedStructHash2,
    TEST_BATCH_2_STRUCT_HASH,
    'Batch 2 struct hash must match frozen test vector'
  );

  // Test 5: Vault signer address derivation
  const signerAddress = getEthereumAddress(TEST_VAULT_SIGNER_KEY);
  assert.strictEqual(
    signerAddress.toLowerCase(),
    TEST_VAULT_SIGNER_ADDRESS.toLowerCase(),
    'Vault signer address must match expected'
  );

  // Test 6: Sign Batch 1 and recover exact signer address
  const signed1 = signBatchCommitment(TEST_VAULT_SIGNER_KEY, TEST_EIP712_DOMAIN, TEST_BATCH_1);
  assert.strictEqual(signed1.signature, TEST_SIGNED_BATCH_1.signature);
  const recoveredSigner1 = recoverCommitmentSigner(TEST_EIP712_DOMAIN, TEST_BATCH_1, signed1.signature);
  assert.strictEqual(
    recoveredSigner1.toLowerCase(),
    TEST_VAULT_SIGNER_ADDRESS.toLowerCase(),
    'Recovered signer must match vault signer address'
  );

  // Test 7: Signature verification helper
  const isValid = verifyCommitmentSignature(
    TEST_EIP712_DOMAIN,
    TEST_BATCH_1,
    signed1.signature,
    TEST_VAULT_SIGNER_ADDRESS
  );
  assert.strictEqual(isValid, true, 'verifyCommitmentSignature must return true for valid signature');

  // Test 8: Signature verification fails with wrong signer
  const isInvalid = verifyCommitmentSignature(
    TEST_EIP712_DOMAIN,
    TEST_BATCH_1,
    signed1.signature,
    '0x0000000000000000000000000000000000000001'
  );
  assert.strictEqual(isInvalid, false, 'verifyCommitmentSignature must return false for wrong address');

  // Test 9: Signature verification fails if batch data is tampered
  const tamperedBatch = { ...TEST_BATCH_1, leafCount: 4n };
  const isTamperedValid = verifyCommitmentSignature(
    TEST_EIP712_DOMAIN,
    tamperedBatch,
    signed1.signature,
    TEST_VAULT_SIGNER_ADDRESS
  );
  assert.strictEqual(isTamperedValid, false, 'verifyCommitmentSignature must fail on tampered batch');

  // Test 10: Genesis sequence continuity (ASSUMPTION A3: first batch starts at seq 1, previousCheckpointHash is zero)
  const genesisCheck = validateSequenceContinuity(null, TEST_BATCH_1);
  assert.strictEqual(genesisCheck.valid, true, 'Genesis batch continuity check must pass');

  // Test 11: Negative - Genesis starting at seq 2 fails (A3)
  const badGenesis1 = { ...TEST_BATCH_1, sequenceStart: 2n };
  const badGenesisCheck1 = validateSequenceContinuity(null, badGenesis1);
  assert.strictEqual(badGenesisCheck1.valid, false, 'Genesis batch starting at seq 2 must fail');

  // Test 12: Negative - Genesis non-zero checkpoint hash fails (A3)
  const badGenesis2 = {
    ...TEST_BATCH_1,
    previousCheckpointHash: '0x1111111111111111111111111111111111111111111111111111111111111111'
  };
  const badGenesisCheck2 = validateSequenceContinuity(null, badGenesis2);
  assert.strictEqual(badGenesisCheck2.valid, false, 'Genesis batch with non-zero previousCheckpointHash must fail');

  // Test 13: Chained sequence continuity (ASSUMPTION A3: Batch 2 binds struct hash of Batch 1)
  const chainedCheck = validateSequenceContinuity(TEST_BATCH_1, TEST_BATCH_2);
  assert.strictEqual(chainedCheck.valid, true, 'Chained continuation from Batch 1 to Batch 2 must pass');

  // Test 14: Negative - Sequence gap fails (Batch 2 starts at seq 5 instead of 4)
  const gapBatch = { ...TEST_BATCH_2, sequenceStart: 5n, sequenceEnd: 6n };
  const gapCheck = validateSequenceContinuity(TEST_BATCH_1, gapBatch);
  assert.strictEqual(gapCheck.valid, false, 'Sequence gap must fail continuity check');

  // Test 15: Negative - Checkpoint hash mismatch fails
  const wrongHashBatch = { ...TEST_BATCH_2, previousCheckpointHash: GENESIS_CHECKPOINT_HASH };
  const wrongHashCheck = validateSequenceContinuity(TEST_BATCH_1, wrongHashBatch);
  assert.strictEqual(wrongHashCheck.valid, false, 'Incorrect previousCheckpointHash must fail continuity check');

  // Test 16: Amoy Checkpoint format (ASSUMPTION A4: checkpoint digest in merkleRoot field)
  const amoyStructHash = computeCommitmentStructHashHex(TEST_AMOY_BATCH);
  assert.strictEqual(
    amoyStructHash,
    TEST_AMOY_STRUCT_HASH,
    'Amoy checkpoint struct hash must match expected (A4)'
  );

  // Test 17: Prompt 1 API - hashCommitment matches computeCommitmentStructHash
  const hashComResult = hashCommitment(TEST_BATCH_1);
  assert.strictEqual(
    '0x' + hashComResult.toString('hex'),
    TEST_BATCH_1_STRUCT_HASH,
    'hashCommitment must produce expected struct hash'
  );

  // Test 18: Prompt 1 API - signCommitment produces valid signature
  const signedCom = signCommitment(TEST_VAULT_SIGNER_KEY, TEST_EIP712_DOMAIN, TEST_BATCH_1);
  assert.strictEqual(
    signedCom.signature,
    TEST_SIGNED_BATCH_1.signature,
    'signCommitment must produce valid signature'
  );

  console.log('✓ Commitment, EIP-712 & Vault Signer tests passed (18/18)');
}
