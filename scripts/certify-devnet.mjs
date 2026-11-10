// End to end on Solana devnet: Fuzzy report -> a jury of registered harnesses
// rules on it (verafy_ruling) -> verafy_certification writes the report card ->
// an agent looks it up.
//
//   HARNESS_DIR=../verafyHarness node scripts/certify-devnet.mjs \
//     --payer payer.json --program <deployed program> --so bench/example_vault_fixed.so --idl bench/example_vault.json
//
// The jurors are scripted for this run: each votes the level the report
// supports. Real model jurors sit these seats once harnesses run them.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fuzz } from '../src/engine/run.js';
import {
  CERTIFICATION_PROGRAM, RULING_PROGRAM, REGISTRY_PROGRAM, LEVELS,
  bytecodeHash, reportHash, certificationContractHash, certificationAddress, certifyData, certifyKeys, lookupCertification,
} from '../src/certification.js';

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const HARNESS = process.env.HARNESS_DIR || '../verafyHarness';
const sol = await import(join(process.cwd(), HARNESS, 'packages/solana/src/index.js'));
const RPC_URL = arg('rpc') || 'https://api.devnet.solana.com';
const rpc = sol.rpc(RPC_URL);
const payer = sol.keypair(Uint8Array.from(JSON.parse(readFileSync(arg('payer'), 'utf8'))));
const program = arg('program');
const so = new Uint8Array(readFileSync(arg('so')));
const idl = JSON.parse(readFileSync(arg('idl'), 'utf8'));
const statePath = arg('state') || 'reports/certify-devnet-jurors.json';
const say = (s) => console.error(s);

// 1. The report.
say(`Fuzzing ${program} (the same bytes as ${arg('so')})...`);
const report = await fuzz({ program: so, idl, name: idl.metadata?.name, source: { address: program, network: 'devnet' }, seed: 'certify-devnet' });
report.seed = 'certify-devnet';
const rh = reportHash(report);
const bh = bytecodeHash(so);
const level = report.findings.length ? 0 : 1; // Sniff tier: Sniffed at most.
say(`Fuzzy Score ${report.score.score} (${report.score.grade}), ${report.findings.length} proven. The report supports: ${LEVELS[level].name}.`);

// 2. A jury of registered harnesses, from four model families.
const FAMILIES = ['deepseek', 'qwen', 'llama', 'mistral'];
let jurors;
if (existsSync(statePath)) jurors = JSON.parse(readFileSync(statePath, 'utf8')).map((j) => ({ ...j, keypair: sol.keypair(Uint8Array.from(j.secret)) }));
else {
  jurors = FAMILIES.map((family) => { const kp = sol.keypair(); return { family, secret: [...kp.secret], keypair: kp }; });
  writeFileSync(statePath, JSON.stringify(jurors.map(({ family, secret }) => ({ family, secret })), null, 2));
}
const harnessRent = await rpc.rent(sol.HARNESS_SIZE);
for (const j of jurors) {
  const acct = sol.harnessAccount(j.keypair.publicKey, REGISTRY_PROGRAM).address;
  if (await rpc.account(acct)) { say(`juror ${j.family}: already registered`); continue; }
  const ix = sol.registryIx.register({ programId: REGISTRY_PROGRAM, harnessKey: j.keypair.publicKey, operator: payer.publicKey, lamports: harnessRent, family: j.family, model: `${j.family} (scripted for this run)`, modelCommitment: '00'.repeat(32), endpoint: 'https://devnet.verafy.ai', price: 0, attestationHash: '00'.repeat(32) });
  const sig = await rpc.send(sol.buildTx([ix], payer, [payer, j.keypair], await rpc.blockhash()));
  say(`juror ${j.family}: registered ${sig}`);
}

// 3. The ruling: the jury rules on this program, build and report.
const contractHash = certificationContractHash({ program, bytecodeHash: bh, reportHash: rh, score: report.score.score }).toString('hex');
const settled = await sol.settleRuling({
  rpc, programId: RULING_PROGRAM, payer, contractHash, barPpm: 750_000, challengeWindow: 0,
  summary: `Verafy Certification: ${LEVELS[level].name}. Fuzzy Score ${report.score.score}, ${report.findings.length} proven findings.`,
  votes: jurors.map((j) => ({ keypair: j.keypair, answer: level, reasoningHash: rh.toString('hex') })),
  say,
});
say(`ruling ${settled.ruling}: ${settled.state.status}, answer ${settled.state.answer}`);

// 4. The certification.
const certNow = await rpc.account(await certificationAddress(program, bh));
const harnesses = jurors.map((j) => sol.harnessAccount(j.keypair.publicKey, REGISTRY_PROGRAM).address);
const { cert, record, previous, keys } = await certifyKeys(sol, { program: program, bytecodeHash: bh, ruling: settled.ruling, payer, harnesses, certData: certNow?.data ?? null });
const ix = {
  programId: sol.b58decode(CERTIFICATION_PROGRAM),
  keys,
  data: certifyData({ program, bytecodeHash: bh, reportHash: rh, score: report.score.score }),
};
const certSig = await rpc.send(sol.buildTx([ix], payer, [payer], await rpc.blockhash()));
say(`certified: ${certSig}`);

// 5. What an agent sees.
const seen = await lookupCertification(program, { rpcUrl: RPC_URL });
console.log(JSON.stringify(seen, null, 2));
writeFileSync('reports/certify-devnet.json', JSON.stringify({ date: new Date().toISOString(), program, ruling: settled.ruling, rulingSignatures: settled.signatures, certification: cert, certifySignature: certSig, lookup: seen, report }, null, 2));
