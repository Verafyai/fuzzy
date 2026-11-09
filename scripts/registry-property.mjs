// Property fuzzing for every registry program that publishes an IDL. Writes data/registry-property.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { propertyFuzz } from '../worker/jobs/property.mjs';

const { programs } = JSON.parse(readFileSync('data/registry.json', 'utf8'));
const out = { kind: 'fuzzy.registry-property/1', generatedAt: new Date().toISOString(), programs: {} };
for (const p of programs.filter((x) => x.idl)) {
  try {
    const r = await propertyFuzz({ address: p.address, network: 'mainnet', sequences: 300 }, { budgetMs: 60_000 });
    out.programs[p.address] = { ...r, violations: (r.violations || []).slice(0, 10) };
    console.error(`${p.name}: ${r.ran ? `${r.invariants.filter((i) => i.held).length}/${r.invariants.length} invariants held, ${r.transactions} txs` : r.reason}`);
  } catch (e) {
    out.programs[p.address] = { ran: false, reason: e.message };
    console.error(`${p.name}: ${e.message}`);
  }
  writeFileSync('data/registry-property.json', JSON.stringify(out) + '\n');
}
