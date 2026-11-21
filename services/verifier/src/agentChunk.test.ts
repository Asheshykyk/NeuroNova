import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateAgentKeyPair, signAgentChunk } from '@trusttrace/core/agent';
import { describe, expect, it } from 'vitest';
import { verifyAgentChunkEvidence } from './agentChunk.js';
import { run } from './index.js';

const sourceId = `0x${'12'.repeat(32)}`;
const keyPair = generateAgentKeyPair();

interface FixtureChunk {
  sourceId: string;
  deliveryId: string;
  streamId: string;
  fileIdentity: string;
  fileGeneration?: string;
  byteOffset: bigint;
  observedAt: bigint;
  payload: Buffer;
}

function makeChunk(overrides: Partial<FixtureChunk> = {}): FixtureChunk {
  return {
    sourceId,
    deliveryId: 'seq-0001',
    streamId: 'auth.log',
    fileIdentity: '/var/log/auth.log',
    fileGeneration: 'dev:2049:ino:142857',
    byteOffset: 9_007_199_254_740_993n,
    observedAt: 1_700_000_000_000_000_001n,
    payload: Buffer.from('event bytes\n', 'utf8'),
    ...overrides,
  };
}

function makeEvidenceJson(
  chunk: FixtureChunk,
  signature: string,
  options: { payloadBase64?: string; extra?: Record<string, unknown> } = {},
): string {
  const json = JSON.stringify({
    chunk: {
      sourceId: chunk.sourceId,
      deliveryId: chunk.deliveryId,
      streamId: chunk.streamId,
      fileIdentity: chunk.fileIdentity,
      ...(Object.hasOwn(chunk, 'fileGeneration') && { fileGeneration: chunk.fileGeneration }),
      byteOffset: '__BYTE_OFFSET__',
      observedAt: '__OBSERVED_AT__',
      payload: options.payloadBase64 ?? chunk.payload.toString('base64'),
    },
    signature,
    ...options.extra,
  });
  return json
    .replace('"byteOffset":"__BYTE_OFFSET__"', `"byteOffset":${chunk.byteOffset}`)
    .replace('"observedAt":"__OBSERVED_AT__"', `"observedAt":${chunk.observedAt}`);
}

function sign(chunk: FixtureChunk): string {
  return `0x${signAgentChunk(chunk, keyPair.privateKey).toString('hex')}`;
}

function trustedKeys(publicKeyHex = keyPair.publicKeyHex): string {
  return JSON.stringify({ [sourceId]: publicKeyHex });
}

describe('AgentChunk-only verification', () => {
  it('verifies a valid signature using the trusted source key and lossless numeric fields', () => {
    const chunk = makeChunk();
    const result = verifyAgentChunkEvidence(makeEvidenceJson(chunk, sign(chunk)), trustedKeys());

    expect(result).toMatchObject({
      scope: 'agent-chunk-signature-only',
      status: 'VERIFIED',
      sourceId,
      deliveryId: 'seq-0001',
    });
    expect(result.message).toContain('Vault, Merkle, and public-chain checks were not performed');
  });

  it('detects a modified payload as a signature mismatch', () => {
    const chunk = makeChunk();
    const changed = makeChunk({ payload: Buffer.from('altered event\n', 'utf8') });

    expect(verifyAgentChunkEvidence(makeEvidenceJson(changed, sign(chunk)), trustedKeys()))
      .toMatchObject({ status: 'TAMPERED', reasonCode: 'SIGNATURE_INVALID' });
  });

  it('detects removal of a terminating newline', () => {
    const chunk = makeChunk({ payload: Buffer.from('event bytes\n', 'utf8') });
    const withoutNewline = makeChunk({ payload: Buffer.from('event bytes', 'utf8') });

    expect(verifyAgentChunkEvidence(makeEvidenceJson(withoutNewline, sign(chunk)), trustedKeys()))
      .toMatchObject({ status: 'TAMPERED', reasonCode: 'SIGNATURE_INVALID' });
  });

  it('detects a modified but well-formed fileGeneration', () => {
    const chunk = makeChunk();
    const changed = makeChunk({ fileGeneration: 'dev:2049:ino:999999' });

    expect(verifyAgentChunkEvidence(makeEvidenceJson(changed, sign(chunk)), trustedKeys()))
      .toMatchObject({ status: 'TAMPERED', reasonCode: 'SIGNATURE_INVALID' });
  });

  it('returns TAMPERED for a well-formed but incorrect signature', () => {
    const chunk = makeChunk();

    expect(verifyAgentChunkEvidence(
      makeEvidenceJson(chunk, `0x${'00'.repeat(64)}`),
      trustedKeys(),
    )).toMatchObject({ status: 'TAMPERED', reasonCode: 'SIGNATURE_INVALID' });
  });

  it('returns UNVERIFIABLE when no trusted key is configured for the source', () => {
    const chunk = makeChunk();

    expect(verifyAgentChunkEvidence(makeEvidenceJson(chunk, sign(chunk)), '{}'))
      .toMatchObject({ status: 'UNVERIFIABLE', reasonCode: 'TRUSTED_CONFIG_MISSING' });
  });

  it('does not trust a public key supplied only in the evidence', () => {
    const chunk = makeChunk();

    expect(verifyAgentChunkEvidence(
      makeEvidenceJson(chunk, sign(chunk), { extra: { publicKey: keyPair.publicKeyHex } }),
      '{}',
    )).toMatchObject({ status: 'UNVERIFIABLE', reasonCode: 'TRUSTED_CONFIG_MISSING' });
  });

  it('reports malformed fileGeneration without changing the signed value', () => {
    const chunk = makeChunk({ fileGeneration: 'dev:2049:inode:142857' });

    expect(verifyAgentChunkEvidence(makeEvidenceJson(chunk, sign(makeChunk())), trustedKeys()))
      .toMatchObject({ status: 'UNVERIFIABLE', reasonCode: 'AGENT_CHUNK_FORMAT_INVALID' });
  });

  it('accepts a legacy chunk with fileGeneration omitted', () => {
    const legacy = makeChunk();
    delete legacy.fileGeneration;
    const legacySignature = sign(legacy);

    expect(verifyAgentChunkEvidence(makeEvidenceJson(legacy, legacySignature), trustedKeys()))
      .toMatchObject({ status: 'VERIFIED' });
  });

  it.each([
    ['UUID', '550e8400-e29b-41d4-a716-446655440000'],
    ['idempotent sequence', 'seq-0001'],
  ])('accepts a valid %s deliveryId', (_label, deliveryId) => {
    const chunk = makeChunk({ deliveryId });

    expect(verifyAgentChunkEvidence(makeEvidenceJson(chunk, sign(chunk)), trustedKeys()))
      .toMatchObject({ status: 'VERIFIED', deliveryId });
  });

  it('rejects empty and oversized UTF-8 delivery IDs as malformed evidence', () => {
    const emptyId = makeChunk({ deliveryId: '' });
    const oversizedId = makeChunk({ deliveryId: 'é'.repeat(32_768) });
    const placeholderSignature = `0x${'00'.repeat(64)}`;

    expect(verifyAgentChunkEvidence(makeEvidenceJson(emptyId, placeholderSignature), trustedKeys()))
      .toMatchObject({ status: 'UNVERIFIABLE', reasonCode: 'AGENT_CHUNK_FORMAT_INVALID' });
    expect(verifyAgentChunkEvidence(makeEvidenceJson(oversizedId, placeholderSignature), trustedKeys()))
      .toMatchObject({ status: 'UNVERIFIABLE', reasonCode: 'AGENT_CHUNK_FORMAT_INVALID' });
  });

  it('verifies arbitrary binary payload bytes', () => {
    const chunk = makeChunk({ payload: Buffer.from([0xff, 0x00, 0x0a, 0x80]) });

    expect(verifyAgentChunkEvidence(makeEvidenceJson(chunk, sign(chunk)), trustedKeys()))
      .toMatchObject({ status: 'VERIFIED' });
  });

  it('rejects malformed Base64 instead of normalizing it', () => {
    const chunk = makeChunk();

    expect(verifyAgentChunkEvidence(
      makeEvidenceJson(chunk, sign(chunk), { payloadBase64: '%%%not-base64%%%' }),
      trustedKeys(),
    )).toMatchObject({ status: 'UNVERIFIABLE', reasonCode: 'AGENT_CHUNK_FORMAT_INVALID' });
  });

  it('fails closed for malformed trusted-key configuration', () => {
    const chunk = makeChunk();

    expect(verifyAgentChunkEvidence(makeEvidenceJson(chunk, sign(chunk)), JSON.stringify({ [sourceId]: 'not-a-key' })))
      .toMatchObject({ status: 'UNVERIFIABLE', reasonCode: 'TRUSTED_CONFIG_INVALID' });
  });

  it('labels CLI output as AgentChunk-only verification', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'trusttrace-agent-chunk-'));
    try {
      const evidencePath = join(directory, 'chunk.json');
      const keysPath = join(directory, 'trusted-agent-keys.json');
      const chunk = makeChunk();
      await writeFile(evidencePath, makeEvidenceJson(chunk, sign(chunk)));
      await writeFile(keysPath, trustedKeys());
      const output: string[] = [];

      await expect(run([
        'verify-agent-chunk',
        '--evidence', evidencePath,
        '--trusted-agent-keys', keysPath,
      ], (line) => output.push(line), () => undefined)).resolves.toBe(0);
      expect(output).toEqual([[
        'Scope: AgentChunk signature only; Vault, Merkle, and public-chain checks were not performed.',
        'Result: VERIFIED',
        'Reason: NONE',
        'AgentChunk signature verified; Vault, Merkle, and public-chain checks were not performed.',
        `Source: ${sourceId}`,
        `Delivery: ${chunk.deliveryId}`,
      ].join('\n')]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    { status: 'VERIFIED', exitCode: 0, reasonCode: undefined, modified: false },
    { status: 'TAMPERED', exitCode: 1, reasonCode: 'SIGNATURE_INVALID', modified: true },
  ])('returns $status in CLI JSON with exact decimal metadata', async ({ status, exitCode, reasonCode, modified }) => {
    const directory = await mkdtemp(join(tmpdir(), 'trusttrace-agent-chunk-'));
    try {
      const evidencePath = join(directory, 'chunk.json');
      const keysPath = join(directory, 'trusted-agent-keys.json');
      const signed = makeChunk();
      const presented = modified ? makeChunk({ payload: Buffer.from('altered event\n') }) : signed;
      await writeFile(evidencePath, makeEvidenceJson(presented, sign(signed)));
      await writeFile(keysPath, trustedKeys());
      const output: string[] = [];

      await expect(run([
        'verify-agent-chunk', '--evidence', evidencePath, '--trusted-agent-keys', keysPath, '--json',
      ], (line) => output.push(line))).resolves.toBe(exitCode);

      expect(output).toHaveLength(1);
      const result = JSON.parse(output[0]);
      expect(result).toMatchObject({
        scope: 'agent-chunk-signature-only',
        status,
        evidencePath,
        sourceId,
        deliveryId: signed.deliveryId,
        chunk: { observedAt: '1700000000000000001', byteOffset: '9007199254740993' },
      });
      expect(result.reasonCode).toBe(reasonCode);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
