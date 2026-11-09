// Devnet certifications for registry programs (mainnet programs, certified on devnet).
// For each program: fetch its mainnet bytecode, take the registry scan report, have the
// registered jury rule on it (verafy_ruling), and write the certification (verafy_certification).
// The jurors are scripted for this run; real model jurors are next.
//
//   HARNESS_DIR=../verafyHarness node scripts/certify-registry.mjs --payer payer.json \
//     --reports <dir of scan reports> --min-depth 40
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fetchProgram } from '../src/engine/ingest.js';
import {
  CERTIFICATION_PROGRAM, RULING_PROGRAM, REGISTRY_PROGRAM, LEVELS,
  bytecodeHash, reportHash, certificationContractHash, certificationAddress, certifyData, lookupCertification,
} from '../src/certification.js';

const arg = (name, d) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d; };
const HARNESS = process.env.HARNESS_DIR || '../verafyHarness';
const sol = await import(join(process.cwd(), HARNESS, 'packages/solana/src/index.js'));
const RPC_URL = arg('rpc', 'https://api.devnet.solana.com');
const rpc = sol.rpc(RPC_URL);
const payer = sol.keypair(Uint8Array.from(JSON.parse(readFileSync(arg('payer'), 'utf8'))));
const reports = arg('reports');
const minDepth = Number(arg('min-depth', 40));
const say = (s) => console.error(s);

const jurors = JSON.parse(readFileSync('reports/certify-devnet-jurors.json', 'utf8')).map((j) => ({ ...j, keypair: sol.keypair(Uint8Array.from(j.secret)) }));
const harnesses = jurors.map((j) => sol.harnessAccount(j.keypair.publicKey, REGISTRY_PROGRAM).address);
const out = existsSync('data/certifications.json') ? JSON.parse(readFileSync('data/certifications.json', 'utf8')) : { kind: 'fuzzy.devnet-certifications/1', note: 'Devnet certifications only. Jurors voted by script in these runs.', certifications: [] };
const registry = JSON.parse(readFileSync('data/registry.json', 'utf8'));
const picks = registry.programs.filter((p) => p.status === 'scanned' && p.proven === 0 && p.depth >= minDepth);
say(`${picks.length} programs with depth ${minDepth} or more and no proven findings`);

for (const p of picks) {
  if (out.certifications.some((c) => c.program === p.address)) { say(`${p.name}: already certified`); continue; }
  try {
    const report = JSON.parse(readFileSync(join(reports, `${p.address}.json`), 'utf8'));
    const got = await fetchProgram(p.address, { network: 'mainnet' });
    const bh = bytecodeHash(got.program);
    const rh = reportHash(report);
    const level = report.findings.length ? 0 : 1; // A Sniff run supports Sniffed at most.
    const contractHash = certificationContractHash({ program: p.address, bytecodeHash: bh, reportHash: rh, score: report.score.score }).toString('hex');
    const settled = await sol.settleRuling({
      rpc, programId: RULING_PROGRAM, payer, contractHash, barPpm: 750_000, challengeWindow: 0,
      summary: `Verafy Certification (devnet): ${LEVELS[level].name}. ${p.name}. Fuzzy Score ${report.score.score}, ${report.findings.length} proven findings.`,
      votes: jurors.map((j) => ({ keypair: j.keypair, answer: level, reasoningHash: rh.toString('hex') })),
      say: () => {},
    });
    const cert = await certificationAddress(p.address, bh);
    const ix = {
      programId: sol.b58decode(CERTIFICATION_PROGRAM),
      keys: [
        { pubkey: sol.b58decode(cert), isSigner: false, isWritable: true },
        { pubkey: sol.b58decode(settled.ruling), isSigner: false, isWritable: false },
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: sol.SYSTEM_PROGRAM, isSigner: false, isWritable: false },
        ...harnesses.map((h) => ({ pubkey: sol.b58decode(h), isSigner: false, isWritable: false })),
      ],
      data: certifyData({ program: p.address, bytecodeHash: bh, reportHash: rh, score: report.score.score }),
    };
    const sig = await rpc.send(sol.buildTx([ix], payer, [payer], await rpc.blockhash()));
    const seen = await lookupCertification(p.address, { rpcUrl: RPC_URL });
    out.certifications.push({
      program: p.address, name: p.name, level, levelName: LEVELS[level].name, score: report.score.score,
      bytecodeHash: bh.toString('hex'), reportHash: rh.toString('hex'),
      ruling: settled.ruling, certification: cert, certifySignature: sig,
      jurors: jurors.length, families: new Set(jurors.map((j) => j.family)).size, jurorsScripted: true,
      certifiedAt: new Date().toISOString(), lookup: seen.reason,
    });
    writeFileSync('data/certifications.json', JSON.stringify(out, null, 1) + '\n');
    say(`${p.name}: ${seen.reason} (${cert})`);
  } catch (e) {
    say(`${p.name}: failed: ${e.message}`);
  }
}
