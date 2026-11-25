import { randomBytes, generateKeyPairSync } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';

const target = new URL('../lab/.env.lab', import.meta.url);
if (existsSync(target) && !process.argv.includes('--force')) {
  console.error('lab/.env.lab already exists (use --force to overwrite)');
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const spki = publicKey.export({ type: 'spki', format: 'der' });
const pubHex = spki.subarray(spki.length - 32).toString('hex');
const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'der' });
const privHex = pkcs8.subarray(pkcs8.length - 32).toString('hex');

const lines = [
  `LAB_SSH_PASSWORD=${randomBytes(18).toString('base64url')}`,
  `AGENT_SOURCE_ID=0x${'11'.repeat(32)}`,
  'AGENT_STREAM_ID=auth.log',
  'AGENT_FILE_IDENTITY=auth.log',
  `AGENT_PUBLIC_KEY_HEX=0x${pubHex}`,
  `AGENT_PRIVATE_KEY_HEX=0x${privHex}`,
  `VAULT_SIGNER_PRIVATE_KEY=0x${randomBytes(32).toString('hex')}`
];
writeFileSync(target, lines.join('\n') + '\n', { mode: 0o600 });
console.log('Wrote lab/.env.lab (values not printed).');
