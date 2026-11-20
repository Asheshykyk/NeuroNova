import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const artifactPath = path.join(
  __dirname,
  '../artifacts/contracts/EvidenceAnchor.sol/EvidenceAnchor.json'
);
const targetAbiPath = path.join(
  __dirname,
  '../../packages/core/src/abi/EvidenceAnchor.abi.json'
);

if (!fs.existsSync(artifactPath)) {
  console.error(`Artifact not found at ${artifactPath}. Run 'npx hardhat compile' first.`);
  process.exit(1);
}

const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
fs.writeFileSync(targetAbiPath, JSON.stringify(artifact.abi, null, 2), 'utf-8');
console.log(`✓ Synchronized EvidenceAnchor ABI to ${targetAbiPath}`);
