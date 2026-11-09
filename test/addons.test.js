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
