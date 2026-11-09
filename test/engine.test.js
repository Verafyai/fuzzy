import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fuzz } from '../src/engine/run.js';
import { replayFinding } from '../src/engine/replay.js';
import { elfInfo } from '../src/engine/ingest.js';

const idl = JSON.parse(readFileSync(new URL('../bench/example_vault.json', import.meta.url)));
const vulnerable = new Uint8Array(readFileSync(new URL('../bench/example_vault_vulnerable.so', import.meta.url)));
const fixed = new Uint8Array(readFileSync(new URL('../bench/example_vault_fixed.so', import.meta.url)));

test('the vulnerable vault: both bugs are proven, critical, and replay', async () => {
  const report = await fuzz({ program: vulnerable, idl, seed: 'test' });
  report.seed = 'test';
  const classes = report.findings.map((f) => f.class).sort();
  assert.deepEqual(classes, ['missing_signer', 'reinitialization']);
  assert.ok(report.findings.every((f) => f.severity === 'critical' && f.proven));
  assert.equal(report.score.ceiling, 20);
  assert.equal(report.score.grade, 'Broken');
  for (const f of report.findings) {
    const r = await replayFinding({ program: vulnerable, idl, report, findingId: f.id });
    assert.equal(r.reproduced, true);
    assert.ok(BigInt(r.attackerGainLamports) > 0n, `${f.id} moves funds to the attacker`);
  }
});

test('the fixed vault: no findings, and leads are not scored', async () => {
  const report = await fuzz({ program: fixed, idl, seed: 'test' });
  assert.equal(report.findings.length, 0);
  assert.equal(report.score.ceiling, 100);
  assert.equal(report.score.score, report.score.depth);
  assert.ok(report.leads.length >= 1);
});

test('a run is deterministic for a seed', async () => {
  const a = await fuzz({ program: vulnerable, idl, seed: 'same' });
  const b = await fuzz({ program: vulnerable, idl, seed: 'same' });
  assert.deepEqual(a.findings.map((f) => f.evidence.transaction), b.findings.map((f) => f.evidence.transaction));
});

test('without an IDL the run is shallow and says so', async () => {
  const report = await fuzz({ program: vulnerable, idl: null, seed: 'test' });
  assert.equal(report.findings.length, 0);
  assert.equal(report.program.idl, false);
  assert.ok(report.score.depth < 25);
});

test('elfInfo reads a Solana program and refuses other files', () => {
  const info = elfInfo(vulnerable);
  assert.ok(info.sbfInstructions > 0);
  assert.throws(() => elfInfo(new Uint8Array(100)));
});
