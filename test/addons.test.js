import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRepo, parseCargoLock, addonCredits } from '../src/addons/source.js';
import { tokenInfo } from '../src/engine/history.js';
import * as k from '@solana/kit';

test('parseRepo reads owner, repo, ref and path', () => {
  assert.deepEqual(parseRepo('https://github.com/Kamino-Finance/klend/tree/77e8185/programs/klend'), { owner: 'Kamino-Finance', repo: 'klend', ref: '77e8185', path: 'programs/klend' });
  assert.deepEqual(parseRepo('https://github.com/orca-so/whirlpools'), { owner: 'orca-so', repo: 'whirlpools', ref: null, path: '' });
  assert.equal(parseRepo('https://gitlab.com/x/y'), null);
});

test('parseCargoLock keeps crates.io packages only', () => {
  const lock = '[[package]]\nname = "serde"\nversion = "1.0.200"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n\n[[package]]\nname = "my-program"\nversion = "0.1.0"\n';
  assert.deepEqual(parseCargoLock(lock), [{ name: 'serde', version: '1.0.200' }]);
});

test('add-on credits: advisories include the verified-source check', () => {
  assert.equal(addonCredits([]), 0);
  assert.equal(addonCredits(['verified']), 25);
  assert.equal(addonCredits(['advisories']), 125);
});

test('tokenInfo reads an SPL token account', () => {
  const mint = 'So11111111111111111111111111111111111111112';
  const owner = 'Vote111111111111111111111111111111111111111';
  const b = Buffer.alloc(165);
  Buffer.from(k.getAddressEncoder().encode(mint)).copy(b, 0);
  Buffer.from(k.getAddressEncoder().encode(owner)).copy(b, 32);
  b.writeBigUInt64LE(42n, 64);
  assert.deepEqual(tokenInfo('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', b), { mint, owner, amount: 42n });
  assert.equal(tokenInfo('11111111111111111111111111111111', b), null);
});

import { textStats, tracePcs, coverageFrom } from '../worker/lib/coverage.mjs';
import { check, deriveInvariants } from '../worker/jobs/property.mjs';
import { agree } from '../worker/jobs/review.mjs';
import { verifyHash, solanaVersion } from '../worker/jobs/rebuild.mjs';
import { diagnostics } from '../worker/jobs/lints.mjs';
import { readFileSync } from 'node:fs';
import { readIdl } from '../src/engine/idl.js';

test('coverage: counts instructions and branch outcomes in the vault', () => {
  const st = textStats(readFileSync('bench/example_vault_fixed.so'));
  assert.ok(st.instructions > 1000 && st.conditionalJumps > 100);
  const [pc, target] = [...st.conditional.entries()][0];
  const cov = coverageFrom(st, [[pc, target], [pc, pc + 1]]);
  assert.equal(cov.branchesTaken, 2);
  assert.deepEqual(tracePcs('Frame 0\n 0 [x]     5: mov64 r1, r2\n 1 [x]     6: exit'), [-1, 5, 6]);
});

test('property: an authority change without its holder signing breaks the invariant', () => {
  const idl = readIdl(JSON.parse(readFileSync('bench/example_vault.json', 'utf8')));
  const inv = deriveInvariants(idl);
  assert.equal(inv.length, 2);
  const key = (n) => { const b = new Uint8Array(48); b[8] = 0; b.fill(n, 8, 40); return b; };
  const owner = k.getAddressDecoder().decode(new Uint8Array(32).fill(1));
  const before = { vault: { lamports: 10n, data: key(1) } };
  const after = { vault: { lamports: 10n, data: key(2) } };
  assert.equal(check(inv, before, after, []).length, 1);
  assert.equal(check(inv, before, after, [owner]).length, 0);
});

test('review: a risk counts as agreed only when two jurors raise it', () => {
  const g = agree([
    { family: 'a', risks: [{ title: 'x', function: 'withdraw', category: 'access-control', severity: 'high' }] },
    { family: 'b', risks: [{ title: 'y', function: 'withdraw', category: 'access-control', severity: 'medium' }, { title: 'z', function: 'init', category: 'other', severity: 'low' }] },
  ]);
  assert.equal(g.filter((r) => r.jurors >= 2).length, 1);
});

test('rebuild: hashes drop trailing zeros, and the Solana version is read from the lockfile', () => {
  assert.equal(verifyHash(Buffer.from([1, 2, 0, 0])), verifyHash(Buffer.from([1, 2])));
  assert.deepEqual(solanaVersion('[[package]]\nname = "solana-program"\nversion = "1.18.26"\n'), { crate: 'solana-program', version: '1.18.26' });
});

test('lints: diagnostics keep this repository only', () => {
  const msg = (file) => JSON.stringify({ reason: 'compiler-message', message: { level: 'warning', code: { code: 'missing_signer_check' }, message: 'm', spans: [{ is_primary: true, file_name: file, line_start: 3 }] } });
  const d = diagnostics([msg('src/lib.rs'), msg('/root/.cargo/registry/x/lib.rs')].join('\n'), '/repo', 'solana-lints');
  assert.equal(d.length, 1);
});
