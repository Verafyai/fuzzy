// The four attack classes added in engine 0.3.0, on example_pool: every bug proven on the
// vulnerable build, nothing proven on the fixed build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fuzz } from '../src/engine/run.js';
import { runHistory } from '../src/engine/history.js';
import { readIdl } from '../src/engine/idl.js';
import { signerFor } from '../src/engine/world.js';
import { replayFinding } from '../src/engine/replay.js';

const rawIdl = JSON.parse(readFileSync(new URL('../bench/example_pool.json', import.meta.url)));
const so = (v) => new Uint8Array(readFileSync(new URL(`../bench/example_pool_${v}.so`, import.meta.url)));

test('example_pool, vulnerable: unchecked CPI, close-then-reuse and reinitialization are proven; the non-canonical bump is a lead', async () => {
  const report = await fuzz({ program: so('vulnerable'), idl: rawIdl, seed: 'test' });
  report.seed = 'test';
  const classes = report.findings.map((f) => f.class).sort();
  assert.deepEqual(classes, ['close_reuse', 'reinitialization', 'unchecked_cpi']);
  assert.ok(report.leads.some((l) => l.class === 'pda_seed'));
  for (const f of report.findings) {
    const r = await replayFinding({ program: so('vulnerable'), idl: rawIdl, report, findingId: f.id });
    assert.equal(r.reproduced, true, `${f.id} replays`);
    assert.ok(BigInt(r.attackerGainLamports) > 0n, `${f.class} moves funds to the attacker`);
  }
});

test('example_pool, fixed: nothing proven, no false leads for the new classes', async () => {
  const report = await fuzz({ program: so('fixed'), idl: rawIdl, seed: 'test' });
  assert.equal(report.findings.length, 0);
  for (const c of ['unchecked_cpi', 'close_reuse', 'pda_seed']) {
    assert.equal(report.tested.classes.find((x) => x.id === c).status, 'held', `${c} ran and held`);
    assert.ok(!report.leads.some((l) => l.class === c), `no ${c} lead`);
  }
});

async function poolHistory() {
  const SYSTEM = '11111111111111111111111111111111';
  const programId = (await signerFor('hist', 'program')).address;
  const [pool, user, oracle] = await Promise.all(['pool', 'user', 'oracle'].map(async (n) => (await signerFor('hist', n)).address));
  const price = Buffer.alloc(16);
  price.write('FZPRICE1');
  price.writeBigUInt64LE(1_000_000n, 8);
  const amount = Buffer.alloc(8);
  amount.writeBigUInt64LE(1_000_000_000n);
  return {
    programId,
    history: {
      calls: [{ signature: 'x', slot: 1, data: [184, 12, 86, 149, 70, 196, 97, 225, ...amount], prefix: [], feePayer: user,
        accounts: [{ address: pool, signer: false, writable: true }, { address: user, signer: true, writable: true }, { address: oracle, signer: false, writable: false }, { address: SYSTEM, signer: false, writable: false }] }],
      accounts: {
        [pool]: { lamports: 50_000_000_000, owner: programId, executable: false, data: Buffer.alloc(40).toString('base64') },
        [user]: { lamports: 10_000_000_000, owner: SYSTEM, executable: false, data: '' },
        [oracle]: { lamports: 1_000_000, owner: 'H7o7ZuXQgyjEqka3qGtZZ3ZxhQjFfZiHF3cHcLgeb8kT', executable: false, data: price.toString('base64') },
      },
      programs: {}, slot: 1, now: null,
    },
  };
}

test('replay, vulnerable pool: unchecked CPI and price manipulation are proven with the attacker as the user', async () => {
  const { programId, history } = await poolHistory();
  const h = await runHistory({ program: so('vulnerable'), programId, history, idl: readIdl(rawIdl), seed: 'hist', budget: { txs: 200, ms: 30_000 } });
  assert.deepEqual(h.findings.map((f) => f.class).sort(), ['price_manipulation', 'unchecked_cpi']);
  assert.ok(h.findings.every((f) => f.steps[0].accounts.every((a) => !a.signer || a.label !== history.calls[0].feePayer)), 'no attack signs as the real user');
});

test('replay, fixed pool: both hold', async () => {
  const { programId, history } = await poolHistory();
  const h = await runHistory({ program: so('fixed'), programId, history, idl: readIdl(rawIdl), seed: 'hist', budget: { txs: 200, ms: 30_000 } });
  assert.equal(h.findings.length, 0);
  assert.ok(h.tried.has('unchecked_cpi') && h.tried.has('price_manipulation'));
});
