import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load ABI JSON safely in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const abiPath = path.join(__dirname, 'EvidenceAnchor.abi.json');

export const EvidenceAnchorABI = JSON.parse(fs.readFileSync(abiPath, 'utf-8'));
export default EvidenceAnchorABI;
