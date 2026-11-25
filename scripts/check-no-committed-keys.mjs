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
