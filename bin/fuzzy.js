#!/usr/bin/env node
// fuzzy run <program.so | address> [--idl idl.json] [--network mainnet|devnet] [--rpc url] [--out report.json]
// fuzzy replay <report.json> <finding id> --program <program.so> [--idl idl.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fuzz } from '../src/engine/run.js';
import { fetchProgram } from '../src/engine/ingest.js';
import { replayFinding } from '../src/engine/replay.js';

function flags(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i];
    else out._.push(argv[i]);
  }
  return out;
}

const [cmd, ...rest] = process.argv.slice(2);
const f = flags(rest);

if (cmd === 'run') {
  const target = f._[0];
  if (!target) usage();
  let program, idl = f.idl ? JSON.parse(readFileSync(f.idl, 'utf8')) : null, source;
  if (target.endsWith('.so')) {
    program = new Uint8Array(readFileSync(target));
    source = { file: basename(target) };
  } else {
    const network = f.network || 'mainnet';
    console.error(`Fetching ${target} from ${network} (read only)...`);
    const got = await fetchProgram(target, { network, rpcUrl: f.rpc });
    program = got.program;
    idl = idl || got.idl;
    source = { address: target, network, upgradeable: got.upgradeable, upgradeAuthority: got.upgradeAuthority };
  }
  const report = await fuzz({ program, idl, source, name: f.name, seed: f.seed, rpcUrl: f.rpc, onEvent: (e) => {
    if (e.type === 'finding') console.error(`  proven: [${e.finding.severity}] ${e.finding.title}`);
    if (e.type === 'note') console.error(`  ${e.text}`);
  } });
  report.seed = f.seed || report.program.sha256.slice(0, 16);
  const s = report.score;
  console.error(`\n${report.program.name}: Fuzzy Score ${s.score} (${s.grade}). Depth ${s.depth}, ceiling ${s.ceiling}. ${report.findings.length} proven, ${report.leads.length} leads, ${report.tested.transactions} transactions.`);
  const out = f.out || 'report.json';
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.error(`Report written to ${out}`);
} else if (cmd === 'replay') {
  const [reportPath, id] = f._;
  if (!reportPath || !id || !f.program) usage();
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const result = await replayFinding({ program: new Uint8Array(readFileSync(f.program)), idl: f.idl ? JSON.parse(readFileSync(f.idl, 'utf8')) : null, report, findingId: id });
  console.log(JSON.stringify({ ...result, logs: undefined }, null, 2));
  process.exit(result.reproduced ? 0 : 1);
} else {
  usage();
}

function usage() {
  console.error('usage:\n  fuzzy run <program.so | address> [--idl idl.json] [--network mainnet|devnet] [--out report.json]\n  fuzzy replay <report.json> <finding id> --program <program.so> [--idl idl.json]');
  process.exit(2);
}
