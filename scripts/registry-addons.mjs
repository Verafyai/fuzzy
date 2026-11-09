// Run the source add-ons (verified source, dependency advisories) for every registry program
// and write data/registry-addons.json. Read only: public APIs and raw GitHub files.
import { readFileSync, writeFileSync } from 'node:fs';
import { runSourceAddons } from '../src/addons/source.js';

const { programs } = JSON.parse(readFileSync('data/registry-programs.json', 'utf8'));
const out = { kind: 'fuzzy.registry-addons/1', generatedAt: new Date().toISOString(), programs: {} };
let next = 0;
async function worker() {
  while (next < programs.length) {
    const p = programs[next++];
    try { out.programs[p.address] = { ...(await runSourceAddons(p.address, ['advisories'])), checkedAt: new Date().toISOString() }; }
    catch (e) { out.programs[p.address] = { error: e.message }; }
    const r = out.programs[p.address];
    console.error(`${p.name}: ${r.verified?.verified ? 'verified' : 'not verified'}${r.advisories?.ran ? `, ${r.advisories.vulnerabilities} vulns, ${r.advisories.warnings} warnings` : ''}`);
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
writeFileSync('data/registry-addons.json', JSON.stringify(out) + '\n');
