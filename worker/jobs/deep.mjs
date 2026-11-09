// Deep Fuzz: the Fuzzy engine at the deep tier, with branch coverage traced in agave-ledger-tool.
// Input: { address, network, rpcUrl? } for a deployed program, or { programPath, idlPath? } for a file.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fuzz } from '../../src/engine/run.js';
import { fetchProgram } from '../../src/engine/ingest.js';
import { measureCoverage } from '../lib/coverage.mjs';

export async function deepFuzz(input, { ledger = process.env.FUZZY_LEDGER, tool = process.env.AGAVE_LEDGER_TOOL || 'agave-ledger-tool', onEvent = () => {} } = {}) {
  let program, idl = null, source = {};
  if (input.address) {
    const got = await fetchProgram(input.address, { network: input.network || 'mainnet', rpcUrl: input.rpcUrl });
    program = got.program; idl = input.idl || got.idl;
    source = { address: input.address, network: input.network || 'mainnet', upgradeable: got.upgradeable, upgradeAuthority: got.upgradeAuthority };
  } else {
    program = new Uint8Array(readFileSync(input.programPath));
    idl = input.idlPath ? JSON.parse(readFileSync(input.idlPath, 'utf8')) : null;
    source = { file: input.programPath.split('/').pop() };
  }
  const dir = mkdtempSync(join(tmpdir(), 'fuzzy-deep-'));
  const programPath = join(dir, 'program.so');
  writeFileSync(programPath, program);
  const measure = ledger ? async (_bytes, inputs) => measureCoverage({ programPath, inputs, ledger, tool }) : undefined;
  if (!measure) onEvent({ type: 'note', text: 'No ledger configured, so branch coverage is skipped.' });
  const report = await fuzz({ program, idl, source, tier: 'deep', rpcUrl: input.rpcUrl, onEvent, measureCoverage: measure, name: input.name });
  report.seed = report.program.sha256.slice(0, 16);
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = JSON.parse(process.argv[2]);
  const report = await deepFuzz(input, { onEvent: (e) => e.type === 'note' && console.error(e.text) });
  const s = report.score;
  console.error(`Deep Fuzz: score ${s.score}, depth ${s.depth} (${JSON.stringify(s.depthParts)}), ${report.findings.length} proven`);
  if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(report, null, 1));
}
