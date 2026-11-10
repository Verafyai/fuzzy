// Put every registry program's latest scan on chain: a jury ruling on Solana devnet, then a
// Verafy Certification for that exact build. Shallow or broken runs are recorded too, as
// Not certified, so every scanned build has an on-chain record. An existing certification is
// replaced by the newer ruling (the program accepts only a ruling releasable later), and the
// previous one is kept in data/certifications.json history.
//
// Level policy (the jury question's rules; unsure means the lower level):
//   any proven finding                                  -> 0 Not certified
//   Deep Fuzz on cloned mainnet state, depth >= 40      -> 2 Fuzzed
//   no proven findings, depth >= 40                     -> 1 Sniffed
//   otherwise (too shallow to vouch for)                -> 0 Not certified
// Jurors vote by script in these runs; real model jurors are next.
//
//   HARNESS_DIR=../verafyHarness node scripts/certify-all.mjs --payer payer.json --reports <dir>
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fetchProgram } from '../src/engine/ingest.js';
import {
  CERTIFICATION_PROGRAM, RULING_PROGRAM, REGISTRY_PROGRAM, LEVELS,
  bytecodeHash, reportHash, certificationContractHash, certificationAddress, certifyData, certifyKeys, lookupCertification,
} from '../src/certification.js';

const arg = (name, d) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d; };
const sol = await import(join(process.cwd(), process.env.HARNESS_DIR || '../verafyHarness', 'packages/solana/src/index.js'));
const RPC_URL = arg('rpc', 'https://api.devnet.solana.com');
const rpc = sol.rpc(RPC_URL);
const payer = sol.keypair(Uint8Array.from(JSON.parse(readFileSync(arg('payer'), 'utf8'))));
const reports = arg('reports');
const say = (s) => console.error(s);

export function levelFor(report) {
  if (report.findings.length) return 0;
  const deep = report.tier?.id === 'deep';
  if (deep && report.tested?.state === 'mainnet' && report.score.depth >= 40) return 2;
  if (report.score.depth >= 40) return 1;
  return 0;
}

const jurors = JSON.parse(readFileSync('reports/certify-devnet-jurors.json', 'utf8')).map((j) => ({ ...j, keypair: sol.keypair(Uint8Array.from(j.secret)) }));
const harnesses = jurors.map((j) => sol.harnessAccount(j.keypair.publicKey, REGISTRY_PROGRAM).address);
const out = existsSync('data/certifications.json') ? JSON.parse(readFileSync('data/certifications.json', 'utf8')) : { certifications: [] };
out.kind = 'fuzzy.devnet-certifications/2';
out.note = 'Devnet certifications only. Jurors voted by script in these runs. Every scanned build has a record; shallow runs are recorded as Not certified.';
const registry = JSON.parse(readFileSync('data/registry.json', 'utf8'));

for (const p of registry.programs.filter((x) => x.status === 'scanned')) {
  try {
    const file = join(reports, `${p.address}.json`);
    if (!existsSync(file)) { say(`${p.name}: no report`); continue; }
    const report = JSON.parse(readFileSync(file, 'utf8'));
    const rh = reportHash(report);
    const prev = out.certifications.find((c) => c.program === p.address);
    if (prev && prev.reportHash === rh.toString('hex')) { say(`${p.name}: already recorded for this report`); continue; }
    const got = await fetchProgram(p.address, { network: 'mainnet' });
    const bh = bytecodeHash(got.program);
    const level = levelFor(report);
    const contractHash = certificationContractHash({ program: p.address, bytecodeHash: bh, reportHash: rh, score: report.score.score }).toString('hex');
    const settled = await sol.settleRuling({
      rpc, programId: RULING_PROGRAM, payer, contractHash, barPpm: 750_000, challengeWindow: 0,
      summary: `Verafy Certification (devnet): ${LEVELS[level].name}. ${p.name}. ${report.tier?.name || 'Sniff'}, Fuzzy Score ${report.score.score}, depth ${report.score.depth}, ${report.findings.length} proven findings.`,
      votes: jurors.map((j) => ({ keypair: j.keypair, answer: level, reasoningHash: rh.toString('hex') })),
      say: () => {},
    });
    const certNow = await rpc.account(await certificationAddress(p.address, bh));
    const { cert, record, previous, keys } = await certifyKeys(sol, { program: p.address, bytecodeHash: bh, ruling: settled.ruling, payer, harnesses, certData: certNow?.data ?? null });
    const ix = {
      programId: sol.b58decode(CERTIFICATION_PROGRAM),
      keys,
      data: certifyData({ program: p.address, bytecodeHash: bh, reportHash: rh, score: report.score.score }),
    };
    const sig = await rpc.send(sol.buildTx([ix], payer, [payer], await rpc.blockhash()));
    const seen = await lookupCertification(p.address, { rpcUrl: RPC_URL, cluster: 'mainnet' });
    const entry = {
      program: p.address, name: p.name, level, levelName: LEVELS[level].name, score: report.score.score, depth: report.score.depth, tier: report.tier?.name || 'Sniff',
      bytecodeHash: bh.toString('hex'), reportHash: rh.toString('hex'),
      ruling: settled.ruling, certification: cert, record, supersedes: previous, certifySignature: sig,
      jurors: jurors.length, families: new Set(jurors.map((j) => j.family)).size, jurorsScripted: true,
      certifiedAt: new Date().toISOString(), lookup: seen.reason,
      history: prev ? [...(prev.history || []), { levelName: prev.levelName, score: prev.score, ruling: prev.ruling, reportHash: prev.reportHash, certifiedAt: prev.certifiedAt, replacedAt: new Date().toISOString() }] : [],
    };
    out.certifications = [...out.certifications.filter((c) => c.program !== p.address), entry];
    writeFileSync('data/certifications.json', JSON.stringify(out, null, 1) + '\n');
    say(`${p.name}: ${LEVELS[level].name}${prev ? ` (replaced ${prev.levelName})` : ''}, ${seen.reason}`);
  } catch (e) {
    say(`${p.name}: failed: ${e.message}`);
  }
}
