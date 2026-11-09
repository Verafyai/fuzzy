// Regenerate data/example-report.json: a real Sniff run on the deliberately
// vulnerable benchmark vault. `npm run example`.
import { readFileSync, writeFileSync } from 'node:fs';
import { fuzz } from '../src/engine/run.js';

const idl = JSON.parse(readFileSync('bench/example_vault.json', 'utf8'));
const program = new Uint8Array(readFileSync('bench/example_vault_vulnerable.so'));
const report = await fuzz({ program, idl, name: 'example_vault', seed: 'example', source: { file: 'example_vault_vulnerable.so', benchmark: true } });
report.seed = 'example';
writeFileSync('data/example-report.json', JSON.stringify(report, null, 2) + '\n');
console.log(`example_vault: ${report.score.score} ${report.score.grade}, ${report.findings.length} proven`);
