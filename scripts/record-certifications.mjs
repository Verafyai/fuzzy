// Version 2 of verafy_certification keeps every verdict as its own record, linked by
// supersedes and superseded_by. Certifications written by version 1 have no records yet:
// this copies each one's current verdict into record 0 (instruction tag 2), then notes
// the record in data/certifications.json. Safe to rerun; recorded ones are skipped.
//
//   HARNESS_DIR=../verafyharness node scripts/record-certifications.mjs --payer payer.json
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { certificationAddress, decodeCertification, recordAddress, recordIx } from '../src/certification.js';

const arg = (name, d) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d; };
const sol = await import(join(process.cwd(), process.env.HARNESS_DIR || '../verafyHarness', 'packages/solana/src/index.js'));
const rpc = sol.rpc(arg('rpc', 'https://api.devnet.solana.com'));
const payer = sol.keypair(Uint8Array.from(JSON.parse(readFileSync(arg('payer'), 'utf8'))));
const out = JSON.parse(readFileSync('data/certifications.json', 'utf8'));
const say = (s) => console.error(s);

for (const c of out.certifications) {
  try {
    const bh = Buffer.from(c.bytecodeHash, 'hex');
    const acct = await rpc.account(await certificationAddress(c.program, bh));
    const d = acct && decodeCertification(acct.data);
    if (!d) { say(`${c.name}: no certification on chain`); continue; }
    if (d.ruling !== c.ruling) { say(`${c.name}: chain ruling ${d.ruling} differs from data; skipped`); continue; }
    if (d.records === 0) {
      const { ix } = await recordIx(sol, { program: c.program, bytecodeHash: bh, payer });
      c.recordSignature = await rpc.send(sol.buildTx([ix], payer, [payer], await rpc.blockhash()));
      d.records = 1;
    }
    c.records = d.records;
    c.record = await recordAddress(c.program, bh, d.records - 1);
    writeFileSync('data/certifications.json', JSON.stringify(out, null, 1) + '\n');
    say(`${c.name}: record ${d.records - 1} at ${c.record}`);
  } catch (e) {
    say(`${c.name}: failed: ${e.message}`);
  }
}
