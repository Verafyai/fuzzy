// History mode, for a deployed program: take its recent successful mainnet
// transactions, clone every account they touch into LiteSVM (read only, over
// RPC), replay them, then attack each replayed instruction. Works with or
// without an IDL, and uses the program's real address so PDAs resolve.
// Signatures are not verified in this world so history can replay; attack
// transactions are signed only by the attacker, so their proof does not
// depend on that.
import { LiteSVM } from 'litesvm';
import { recordInvocation } from './record.js';
import * as k from '@solana/kit';
import { createHash } from 'node:crypto';
import { signerFor, ACTOR_FUNDS, FEE_PER_SIGNATURE, breathe, reclaim } from './world.js';
import { fmtSol } from './sniff.js';
import { DRAINER_SO } from './drainer.js';

const UPGRADEABLE = 'BPFLoaderUpgradeab1e11111111111111111111111';
const SYSTEM = '11111111111111111111111111111111';
/** Programs the runtime always has; an account slot holding one of these is a program the target calls. */
const BUILTIN_PROGRAMS = new Set([SYSTEM, 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo']);
/** Price sources: accounts owned by these programs are oracles. */
export const ORACLE_OWNERS = new Map([
  ['rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ', 'pyth-update'], // Pyth receiver: PriceUpdateV2
  ['pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT', 'pyth-update'], // Pyth push oracle: PriceUpdateV2
  ['FsJ3A3u2vn5cTVofAjvy6y5kwABJAqYWpe4975bi2epH', 'pyth-legacy'], // Pyth v2 price accounts
  ['SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv', 'switchboard'], // Switchboard on-demand
  ['SW1TCH7qEPTdLsDHRgPuMQjbQxKdH2aBStViMFnt64f', 'switchboard'], // Switchboard v2
  ['HEvSKofvBgfaexv23kMabbYqxasxU3mQ4ibBMEmJWHny', 'chainlink'],
  ['H7o7ZuXQgyjEqka3qGtZZ3ZxhQjFfZiHF3cHcLgeb8kT', 'fuzzy-bench'], // Fuzzy's benchmark oracle owner (example_pool)
]);

/** Where the price sits in an oracle account we know the layout of: [{ offset, kind }]. */
function priceFields(layout, data) {
  if (layout === 'pyth-update' && data.length >= 8 + 32 + 2 + 32 + 8) {
    const vlen = data[40] === 0 ? 2 : 1; // VerificationLevel: Partial { num_signatures } or Full
    const msg = 8 + 32 + vlen + 32;
    return [{ offset: msg, kind: 'i64' }, { offset: msg + 8 + 8 + 4 + 8 + 8, kind: 'i64' }]; // price, ema_price
  }
  if (layout === 'pyth-legacy' && data.length >= 216 && data.readUInt32LE(0) === 0xa1b2c3d4) return [{ offset: 208, kind: 'i64' }, { offset: 48, kind: 'i64' }];
  if (layout === 'fuzzy-bench' && data.length >= 16 && data.subarray(0, 8).toString() === 'FZPRICE1') return [{ offset: 8, kind: 'u64' }];
  return [];
}

/** A copy of an oracle account's data with every price scaled by num/den. */
function scaledPrice(layout, data, num, den) {
  const out = Buffer.from(data);
  for (const f of priceFields(layout, out)) {
    const v = f.kind === 'i64' ? out.readBigInt64LE(f.offset) : out.readBigUInt64LE(f.offset);
    const scaled = (v * BigInt(num)) / BigInt(den);
    if (f.kind === 'i64') out.writeBigInt64LE(scaled, f.offset); else out.writeBigUInt64LE(scaled, f.offset);
  }
  return out;
}

async function rpc(url, method, params, tries = 3) {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    if (res.status === 429 && i < tries) { await new Promise((r) => setTimeout(r, 600 * (i + 1))); continue; }
    if (!res.ok) throw new Error(`RPC ${method} failed: HTTP ${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(`RPC ${method}: ${body.error.message}`);
    return body.result;
  }
}

/** Recent top-level calls to the program, and the current state of every account they touch. */
export async function fetchHistory(programId, { rpcUrl, limit = 10, onEvent = () => {} }) {
  const sigs = (await rpc(rpcUrl, 'getSignaturesForAddress', [programId, { limit: 60 }])).filter((s) => !s.err).slice(0, limit * 2);
  const calls = [];
  const seen = new Set();
  onEvent({ type: 'activity', text: `Found ${sigs.length} recent transactions; reading them one by one` });
  let read = 0;
  for (const s of sigs) {
    if (calls.length >= limit) break;
    onEvent({ type: 'activity', text: `Reading recent transaction ${++read} of ${sigs.length}: ${s.signature.slice(0, 12)}…` });
    const tx = await rpc(rpcUrl, 'getTransaction', [s.signature, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]).catch(() => null);
    if (!tx) continue;
    const msg = tx.transaction.message;
    const loaded = tx.meta?.loadedAddresses || { writable: [], readonly: [] };
    const keys = [...msg.accountKeys, ...loaded.writable, ...loaded.readonly];
    const h = msg.header;
    const nStatic = msg.accountKeys.length;
    const isSigner = (i) => i < h.numRequiredSignatures;
    const isWritable = (i) => {
      if (i >= nStatic) return i < nStatic + loaded.writable.length;
      if (i < h.numRequiredSignatures) return i < h.numRequiredSignatures - h.numReadonlySignedAccounts;
      return i < nStatic - h.numReadonlyUnsignedAccounts;
    };
    const decodeIx = (ix) => ({ programId: keys[ix.programIdIndex], data: [...Buffer.from(k.getBase58Encoder().encode(ix.data))], accounts: ix.accounts.map((i) => ({ address: keys[i], signer: isSigner(i), writable: isWritable(i) })) });
    msg.instructions.forEach((ix, n) => {
      if (keys[ix.programIdIndex] !== programId) return;
      const { data, accounts } = decodeIx(ix);
      const id = createHash('sha256').update(Buffer.from(data)).update(JSON.stringify(accounts)).digest('hex');
      if (seen.has(id)) return;
      seen.add(id);
      // Instructions before this one in the same transaction often create the accounts it needs
      // (token accounts, wrapped SOL), so they are replayed with it.
      const prefix = msg.instructions.slice(0, n).map(decodeIx).filter((p) => p.programId !== programId);
      calls.push({ signature: s.signature, slot: tx.slot, blockTime: tx.blockTime, data, accounts, prefix, feePayer: keys[0] });
    });
  }
  onEvent({ type: 'note', text: `Found ${calls.length} recent calls to replay.` });
  onEvent({ type: 'activity', text: 'Cloning the accounts those calls touched' });

  const addresses = [...new Set(calls.flatMap((c) => [c.feePayer, ...c.accounts.map((a) => a.address), ...c.prefix.flatMap((p) => [p.programId, ...p.accounts.map((a) => a.address)])]))].filter((a) => a !== programId);
  const accounts = {};
  for (let i = 0; i < addresses.length; i += 100) {
    const batch = addresses.slice(i, i + 100);
    const res = await rpc(rpcUrl, 'getMultipleAccounts', [batch, { encoding: 'base64' }]);
    res.value.forEach((v, j) => { if (v) accounts[batch[j]] = { lamports: v.lamports, owner: v.owner, executable: v.executable, data: v.data[0] }; });
  }
  // Programs the calls touch (for CPI): load their bytecode too.
  const programs = {};
  for (const [address, a] of Object.entries(accounts)) {
    if (!a.executable || a.owner !== UPGRADEABLE) continue;
    const raw = Buffer.from(a.data, 'base64');
    const pdAddr = k.getAddressDecoder().decode(raw.subarray(4, 36));
    const pd = await rpc(rpcUrl, 'getAccountInfo', [pdAddr, { encoding: 'base64' }]).catch(() => null);
    if (pd?.value) programs[address] = Buffer.from(pd.value.data[0], 'base64').subarray(45).toString('base64');
  }
  onEvent({ type: 'note', text: `Cloned ${Object.keys(accounts).length} mainnet accounts and ${Object.keys(programs).length} other programs.` });
  // Accounts are cloned as they are now, so the clock must be now too (programs reject stale timestamps).
  const nowSlot = await rpc(rpcUrl, 'getSlot', []).catch(() => calls[0]?.slot ?? 0);
  return { calls, accounts, programs, slot: calls[0]?.slot ?? null, now: { slot: nowSlot, unix: Math.floor(Date.now() / 1000) } };
}

const TOKEN_PROGRAMS = new Set(['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']);
const addrDecoder = k.getAddressDecoder();
const addrEncoder = k.getAddressEncoder();

/** An SPL token account's mint, owner and amount, or null. */
export function tokenInfo(ownerProgram, data) {
  if (!TOKEN_PROGRAMS.has(ownerProgram) || !data || data.length < 165) return null;
  const b = Buffer.from(data);
  return { mint: addrDecoder.decode(b.subarray(0, 32)), owner: addrDecoder.decode(b.subarray(32, 64)), amount: b.readBigUInt64LE(64) };
}

function fakeSigner(address) {
  return { address, signTransactions: async (txs) => txs.map(() => ({ [address]: new Uint8Array(64) })) };
}

async function makeHistoryWorld({ program, programId, history, seed }) {
  const svm = new LiteSVM().withSigverify(false).withBlockhashCheck(false);
  for (const [address, a] of Object.entries(history.accounts)) {
    if (a.executable) continue;
    if (a.owner.startsWith('Sysvar')) continue;
    const data = Buffer.from(a.data, 'base64');
    svm.setAccount({ address, data: new Uint8Array(data), executable: false, lamports: k.lamports(BigInt(a.lamports)), programAddress: a.owner, space: BigInt(data.length) });
  }
  for (const [address, bytes] of Object.entries(history.programs)) {
    try { svm.addProgram(address, new Uint8Array(Buffer.from(bytes, 'base64'))); } catch { /* a program LiteSVM cannot load stays out */ }
  }
  svm.addProgram(programId, program);
  if (history.now?.slot) {
    try {
      svm.warpToSlot(BigInt(history.now.slot));
      const c = svm.getClock();
      c.unixTimestamp = BigInt(history.now.unix);
      svm.setClock(c);
    } catch { /* keep the default clock */ }
  }
  const attacker = await signerFor(seed, 'actor:attacker');
  svm.airdrop(attacker.address, k.lamports(ACTOR_FUNDS));
  const loot = (await signerFor(seed, 'new:loot')).address;
  const fakeProgram = (await signerFor(seed, 'fake-program')).address;
  const drainerId = (await signerFor(seed, 'cpi-drainer')).address;
  svm.addProgram(drainerId, DRAINER_SO);
  return { svm, programId, attacker, loot, fakeProgram, drainerId, seed };
}

/** Send one call. accounts: [{ address, signer, writable }]; payer: 'attacker' or an address. */
async function sendCall(world, call, payerAddress) {
  await breathe();
  const attackerAddr = world.attacker.address;
  const signerOf = (address) => (address === attackerAddr ? world.attacker : fakeSigner(address));
  const metas = call.accounts.map((a) => {
    const role = a.signer ? (a.writable ? k.AccountRole.WRITABLE_SIGNER : k.AccountRole.READONLY_SIGNER) : a.writable ? k.AccountRole.WRITABLE : k.AccountRole.READONLY;
    const meta = { address: a.address, role };
    if (a.signer) meta.signer = signerOf(a.address);
    return meta;
  });
  const payer = signerOf(payerAddress);
  const prefixIxs = (call.prefix || []).map((p) => ({
    programAddress: p.programId,
    accounts: p.accounts.map((a) => {
      const meta = { address: a.address, role: a.signer ? (a.writable ? k.AccountRole.WRITABLE_SIGNER : k.AccountRole.READONLY_SIGNER) : a.writable ? k.AccountRole.WRITABLE : k.AccountRole.READONLY };
      if (a.signer) meta.signer = signerOf(a.address);
      return meta;
    }),
    data: Uint8Array.from(p.data),
  }));
  const touched = new Set([payerAddress, ...call.accounts.map((a) => a.address), ...(call.prefix || []).flatMap((p) => p.accounts.map((a) => a.address)), world.loot]);
  const before = snap(world, touched);
  recordInvocation(world.svm, world.programId, metas, Uint8Array.from(call.data));
  const msg = k.pipe(
    k.createTransactionMessage({ version: 0 }),
    (m) => k.setTransactionMessageFeePayerSigner(payer, m),
    (m) => k.setTransactionMessageLifetimeUsingBlockhash({ blockhash: world.svm.latestBlockhash(), lastValidBlockHeight: 0n }, m),
    (m) => k.appendTransactionMessageInstructions([...prefixIxs, { programAddress: world.programId, accounts: metas, data: Uint8Array.from(call.data) }], m),
  );
  const tx = await k.signTransactionMessageWithSigners(msg);
  const res = world.svm.sendTransaction(tx);
  world.svm.expireBlockhash();
  const failed = typeof res.err === 'function';
  const meta = failed ? res.meta() : res;
  const after = snap(world, touched);
  const changes = [...touched].map((address) => {
    const b = before.get(address), a = after.get(address);
    let delta = a.lamports - b.lamports;
    if (address === payerAddress) delta += FEE_PER_SIGNATURE * BigInt(Object.keys(tx.signatures).length);
    return { address, before: b.lamports.toString(), after: a.lamports.toString(), delta, dataChanged: !Buffer.from(b.data).equals(Buffer.from(a.data)), ownerAfter: a.owner, dataAfter: a.data, token: a.token, tokenBefore: b.token };
  });
  return { ok: !failed, error: failed ? res.toString().slice(0, 160) : null, logs: meta.logs(), computeUnits: Number(meta.computeUnitsConsumed()), changes, transaction: k.getBase64EncodedWireTransaction(tx) };
}

function snap(world, addresses) {
  const out = new Map();
  for (const address of addresses) {
    const a = world.svm.getAccount(address);
    out.set(address, a.exists ? { lamports: BigInt(a.lamports), data: Uint8Array.from(a.data), owner: a.programAddress, token: tokenInfo(a.programAddress, a.data) } : { lamports: 0n, data: new Uint8Array(), owner: SYSTEM, token: null });
  }
  return out;
}

/** Attack every replayable call. */
export async function runHistory({ program, programId, history, idl, seed, budget, onEvent = () => {} }) {
  onEvent({ type: 'phase', id: 'replay', text: `Replaying ${history.calls.length} recent mainnet calls on cloned accounts` });
  const t0 = Date.now();
  let txs = 0;
  const findings = [], leads = [];
  const tried = new Set();
  const outOfBudget = () => txs >= budget.txs || Date.now() - t0 > budget.ms;
  const nameOf = (data) => {
    const disc = Buffer.from(data.slice(0, 8)).toString('hex');
    const ix = idl?.instructions.find((i) => Buffer.from(i.discriminator).toString('hex') === disc);
    return ix ? ix.name : `instruction ${disc.slice(0, 8)}`;
  };
  const argName = (call, i) => {
    const ix = idl?.instructions.find((x) => Buffer.from(x.discriminator).toString('hex') === Buffer.from(call.data.slice(0, 8)).toString('hex'));
    return ix?.accounts[i]?.name || `account ${i + 1}`;
  };
  const kinds = new Map(); // instruction name -> { ok, err }
  const mark = (name, ok) => { const s = kinds.get(name) || { ok: false, err: false }; if (ok) s.ok = true; else s.err = true; kinds.set(name, s); };

  async function attempt(call, payer) {
    const world = await makeHistoryWorld({ program, programId, history, seed });
    // Attacker-owned copies of token accounts: same mint, owner set to the attacker, empty.
    for (const [placeholder, original] of Object.entries(call.lootTokens || {})) {
      const a = history.accounts[original];
      const data = Buffer.from(a.data, 'base64');
      Buffer.from(addrEncoder.encode(world.attacker.address)).copy(data, 32);
      data.writeBigUInt64LE(0n, 64);
      world.svm.setAccount({ address: placeholder, data: new Uint8Array(data), executable: false, lamports: k.lamports(BigInt(a.lamports)), programAddress: a.owner, space: BigInt(data.length) });
      world.lootTokens = { ...(world.lootTokens || {}), [placeholder]: original };
    }
    // Attacker-owned copies of a user's token accounts holding the same balances: the attacker as an ordinary user.
    for (const [placeholder, original] of Object.entries(call.cloneTokens || {})) {
      const a = history.accounts[original];
      const data = Buffer.from(a.data, 'base64');
      Buffer.from(addrEncoder.encode(world.attacker.address)).copy(data, 32);
      world.svm.setAccount({ address: placeholder, data: new Uint8Array(data), executable: false, lamports: k.lamports(BigInt(a.lamports)), programAddress: a.owner, space: BigInt(data.length) });
    }
    // Accounts the attacker made: a price account owned by the attacker's program, say.
    for (const [address, sp] of Object.entries(call.spoofs || {})) {
      world.svm.setAccount({ address, data: new Uint8Array(sp.data), executable: false, lamports: k.lamports(BigInt(sp.lamports)), programAddress: sp.owner, space: BigInt(sp.data.length) });
    }
    const r = await sendCall(world, call, payer);
    txs++;
    if (txs % 4 === 0) reclaim();
    if (txs % 10 === 0) onEvent({ type: 'progress', transactions: txs });
    return { world, r };
  }

  const gainOf = (world, r) => r.changes.filter((c) => c.address === world.attacker.address || c.address === world.loot).reduce((s, c) => s + c.delta, 0n);
  // Tokens that reached an account the attacker owns. Those accounts start empty, so any increase came from someone else.
  const tokenGainOf = (world, r) => r.changes.filter((c) => c.token && c.tokenBefore && c.token.owner === world.attacker.address).map((c) => ({ address: c.address, mint: c.token.mint, gained: c.token.amount - c.tokenBefore.amount })).filter((g) => g.gained > 0n);

  for (const call of history.calls) {
    if (outOfBudget()) break;
    const name = nameOf(call.data);
    onEvent({ type: 'activity', text: `Replaying ${name} as it ran on mainnet` });
    const honest = await attempt(call, call.feePayer);
    mark(name, honest.r.ok);
    if (!honest.r.ok && process.env.FUZZY_DEBUG) console.error(name, honest.r.error, honest.r.logs.slice(-4));
    if (!honest.r.ok) continue;
    const world0 = honest.world;
    const owned = (addr) => history.accounts[addr]?.owner === programId;
    const wallet = (addr) => history.accounts[addr]?.owner === SYSTEM && !history.accounts[addr]?.executable;
    const redirect = (accts) => accts.map((a) => (!a.signer && a.writable && wallet(a.address) ? { ...a, address: world0.loot } : a));

    for (let j = 0; j < call.accounts.length && !outOfBudget(); j++) {
      const a = call.accounts[j];
      if (!a.signer) continue;
      // 1. The signer drops out: the attacker pays, payouts go to the attacker.
      tried.add('missing_signer'); tried.add('lamport_draining');
      onEvent({ type: 'activity', text: `Missing signer: ${name} without ${argName(call, j)}'s signature` });
      // Signatures are not verified in replay, so every other signer must become the attacker:
      // an attack may never rely on a signature the attacker does not hold.
      const asAttacker = (x) => (x.signer ? { ...x, address: world0.attacker.address } : x);
      const attackerPrefix = (call.prefix || []).map((p) => ({ ...p, accounts: p.accounts.map(asAttacker) }));
      const unsigned = { ...call, prefix: attackerPrefix, accounts: redirect(call.accounts.map((x, n) => (n === j ? { ...x, signer: false } : asAttacker(x)))) };
      const u = await attempt(unsigned, world0.attacker.address);
      mark(name, u.r.ok);
      const ug = u.r.ok ? gainOf(u.world, u.r) : 0n;
      if (u.r.ok && ug > 0n) {
        findings.push(finding('missing_signer', 'critical', name, argName(call, j), `Anyone can call ${name} without ${argName(call, j)}'s signature and take funds`,
          `Replayed against cloned mainnet state, ${name} succeeded without ${argName(call, j)}'s signature and moved ${fmtSol(ug)} to the attacker.`,
          `Require ${argName(call, j)} to sign.`, unsigned, u));
        continue;
      }
      if (u.r.ok && u.r.changes.some((c) => c.dataChanged && owned(c.address))) {
        leads.push({ class: 'missing_signer', instruction: name, title: `${name} changed program state without ${argName(call, j)}'s signature`, detail: 'No funds reached the attacker, so it is not counted. Check whether this caller should be required.' });
      }
      // 2. The attacker signs in the signer's place.
      tried.add('account_substitution');
      onEvent({ type: 'activity', text: `Substitution: the attacker signs ${name} in ${argName(call, j)}'s place` });
      const swapped = { ...call, prefix: attackerPrefix, accounts: redirect(call.accounts.map((x, n) => (n === j ? { ...x, address: world0.attacker.address } : asAttacker(x)))) };
      const s = await attempt(swapped, world0.attacker.address);
      mark(name, s.r.ok);
      const sg = s.r.ok ? gainOf(s.world, s.r) : 0n;
      if (s.r.ok && sg > 0n) {
        findings.push(finding('account_substitution', 'critical', name, argName(call, j), `${name} lets any signer act as ${argName(call, j)} and take funds`,
          `Replayed against cloned mainnet state, ${name} accepted the attacker's signature in place of ${argName(call, j)} and moved ${fmtSol(sg)} to the attacker.`,
          `Check that ${argName(call, j)} matches the authority stored in the account.`, swapped, s));
      }
      // 3. Tokens: the attacker signs in the signer's place, and the signer's token accounts are
      //    swapped, one at a time, for empty attacker-owned copies. Tokens that land there were taken.
      const victimTokens = call.accounts.map((x, n) => ({ x, n })).filter(({ x }) => {
        if (!x.writable || x.signer) return false;
        const h = history.accounts[x.address];
        const t = h && tokenInfo(h.owner, Buffer.from(h.data, 'base64'));
        return t && t.owner === a.address;
      }).slice(0, 2);
      for (const { n } of victimTokens) {
        if (outOfBudget()) break;
        tried.add('unchecked_mint');
        onEvent({ type: 'activity', text: `Token owner: ${name} with ${argName(call, n)} swapped for an attacker-owned account` });
        const placeholder = (await signerFor(seed, `loot-token:${call.accounts[n].address}`)).address;
        const tokenCall = { ...call, prefix: attackerPrefix, lootTokens: { [placeholder]: call.accounts[n].address }, accounts: call.accounts.map((x, m) => (m === j ? { ...x, address: world0.attacker.address } : m === n ? { ...x, address: placeholder } : asAttacker(x))) };
        const t = await attempt(tokenCall, world0.attacker.address);
        mark(name, t.r.ok);
        const gains = t.r.ok ? tokenGainOf(t.world, t.r) : [];
        if (gains.length) {
          const g = gains[0];
          findings.push(finding('account_substitution', 'critical', name, argName(call, j), `${name} lets any signer act as ${argName(call, j)} and take their tokens`,
            `Replayed against cloned mainnet state, ${name} accepted the attacker's signature in place of ${argName(call, j)} and moved ${g.gained} base units of mint ${g.mint} into an account the attacker owns.`,
            `Check that ${argName(call, j)} matches the authority stored in the account, and that token accounts belong to the expected owner.`, tokenCall, t));
          break;
        }
      }
    }
    if (!outOfBudget()) await userAttacks(call, name, world0);
  }

  async function userAttacks(call, name, world0) {
    const isProgramAccount = (addr) => addr !== programId && (BUILTIN_PROGRAMS.has(addr) || Boolean(history.accounts[addr]?.executable) || addr in (history.programs || {}));
    const cpiSlots = call.accounts.map((x, n) => ({ x, n })).filter(({ x }) => !x.signer && !x.writable && isProgramAccount(x.address));
    const oracles = call.accounts.map((x, n) => ({ x, n })).filter(({ x }) => !x.writable && ORACLE_OWNERS.has(history.accounts[x.address]?.owner));
    if (!cpiSlots.length && !oracles.length) return;
    const userCall = await asUserCall(call, world0);
    const base = await attempt(userCall, world0.attacker.address);
    const baseAssets = base.r.ok ? assetsOf(base.world, base.r, userCall) : new Map();

    // Unchecked CPI target: a do-nothing program in place of each program the call passes.
    for (const { x, n } of cpiSlots) {
      if (outOfBudget()) break;
      tried.add('unchecked_cpi');
      onEvent({ type: 'activity', text: `Unchecked CPI: ${name} with a do-nothing program in place of ${argName(call, n)}` });
      const twist = { ...userCall, accounts: userCall.accounts.map((y, m) => (m === n ? { ...y, address: world0.drainerId } : y)) };
      const t = await attempt(twist, world0.attacker.address);
      mark(name, t.r.ok);
      if (!t.r.ok || !t.r.logs.some((l) => l.includes('FUZZY_CPI_HIJACK'))) continue;
      const ahead = dominance(assetsOf(t.world, t.r, twist), baseAssets);
      if (ahead) {
        findings.push(finding('unchecked_cpi', 'critical', name, argName(call, n), `${name} calls whatever program is passed as ${argName(call, n)}`,
          `Replayed against cloned mainnet state with the attacker as the user, ${name} accepted a do-nothing program in place of ${argName(call, n)} (${x.address}) and went on as if it had run. The attacker ended ahead of making the same call honestly: ${ahead}.`,
          `Check the program account's address before calling it.`, twist, t));
      } else {
        leads.push({ class: 'unchecked_cpi', instruction: name, title: `${name} calls whatever program is passed as ${argName(call, n)}`, detail: 'A do-nothing program in its place was called and the instruction still succeeded on cloned mainnet state. The attacker took nothing that was not already theirs, so it is not counted.' });
      }
    }

    // Price manipulation: price accounts the attacker made, owned by the attacker's program.
    for (const { x, n } of oracles) {
      if (outOfBudget()) break;
      tried.add('price_manipulation');
      const real = history.accounts[x.address];
      const layout = ORACLE_OWNERS.get(real.owner);
      const data = Buffer.from(real.data, 'base64');
      const variants = [{ label: 'an exact copy', data }];
      if (priceFields(layout, data).length) variants.push({ label: 'the price times 10', data: scaledPrice(layout, data, 10, 1) }, { label: 'the price divided by 10', data: scaledPrice(layout, data, 1, 10) });
      for (const [v, variant] of variants.entries()) {
        if (outOfBudget()) break;
        onEvent({ type: 'activity', text: `Price: ${name} with ${variant.label} of ${argName(call, n)}, owned by the attacker's program` });
        const spoof = (await signerFor(seed, `spoof:${x.address}:${v}`)).address;
        const twist = { ...userCall, spoofs: { [spoof]: { data: variant.data, owner: world0.fakeProgram, lamports: real.lamports } }, accounts: userCall.accounts.map((y, m) => (m === n ? { ...y, address: spoof } : y)) };
        const t = await attempt(twist, world0.attacker.address);
        mark(name, t.r.ok);
        if (!t.r.ok) continue;
        const ahead = dominance(assetsOf(t.world, t.r, twist), baseAssets);
        if (ahead) {
          findings.push(finding('price_manipulation', 'critical', name, argName(call, n), `${name} takes its price from an account anyone can create`,
            `Replayed against cloned mainnet state with the attacker as the user, ${name} accepted ${variant.label} of the ${layout} price account ${x.address}, made by the attacker and owned by the attacker's program. The attacker ended ahead of making the same call at the real price: ${ahead}.`,
            `Check the price account's owner (and, for Pyth, the feed id and verification level) before reading it.`, twist, t));
          break;
        }
        if (v === 0) leads.push({ class: 'price_manipulation', instruction: name, title: `${name} accepts a price account from any owner`, detail: `A copy of ${argName(call, n)} owned by the attacker's program was accepted on cloned mainnet state. With the real price no funds moved, so it is not counted.` });
      }
    }
  }

  /** The call with the attacker as the user: every signer becomes the attacker, payouts go to the attacker,
   *  and the signers' token accounts become attacker-owned copies with the same balances. */
  async function asUserCall(call, world0) {
    const signers = new Set([...call.accounts, ...(call.prefix || []).flatMap((p) => p.accounts)].filter((x) => x.signer).map((x) => x.address));
    const cloneTokens = {};
    const map = async (x) => {
      if (x.signer) return { ...x, address: world0.attacker.address };
      const h = history.accounts[x.address];
      if (!h) return x;
      const t = tokenInfo(h.owner, Buffer.from(h.data, 'base64'));
      if (t && signers.has(t.owner)) {
        const placeholder = (await signerFor(seed, `user-token:${x.address}`)).address;
        cloneTokens[placeholder] = x.address;
        return { ...x, address: placeholder };
      }
      if (x.writable && h.owner === SYSTEM && !h.executable) return { ...x, address: world0.loot };
      return x;
    };
    const accounts = [];
    for (const x of call.accounts) accounts.push(await map(x));
    const prefix = [];
    for (const p of call.prefix || []) {
      const pa = [];
      for (const x of p.accounts) pa.push(await map(x));
      prefix.push({ ...p, accounts: pa });
    }
    return { ...call, accounts, prefix, cloneTokens };
  }

  /** What the attacker gained, per asset: SOL, and each mint held in attacker-owned token copies. */
  function assetsOf(world, r, call) {
    const out = new Map([['SOL', gainOf(world, r)]]);
    const mine = new Set(Object.keys(call.cloneTokens || {}));
    for (const c of r.changes) {
      if (!mine.has(c.address) || !(c.token || c.tokenBefore)) continue;
      const mint = (c.token || c.tokenBefore).mint;
      out.set(mint, (out.get(mint) || 0n) + (c.token?.amount ?? 0n) - (c.tokenBefore?.amount ?? 0n));
    }
    return out;
  }

  /** The attacker is ahead when no asset is worse than the honest run, at least one is better, and on at least
   *  one of those the attacker ends up with more than they started with. Ending ahead of the honest run only by
   *  not paying their own money (a CPI proxy that forwards the caller's own transfer) is not a theft. */
  function dominance(a, b) {
    const keys = new Set([...a.keys(), ...b.keys()]);
    const better = [];
    let gained = false;
    for (const key of keys) {
      const x = a.get(key) ?? 0n, y = b.get(key) ?? 0n;
      if (x < y) return null;
      if (x > y) {
        better.push(key === 'SOL' ? `${fmtSol(x - y)} more` : `${x - y} more base units of mint ${key}`);
        if (x > 0n) gained = true;
      }
    }
    return better.length && gained ? better.join(', ') : null;
  }

  const replayed = [...kinds.values()].filter((k2) => k2.ok).length;
  onEvent({ type: 'note', text: `Replayed ${replayed} of ${kinds.size} instruction kinds on cloned mainnet state.` });
  tried.add('compute_exhaustion');
  return {
    findings, leads, tried, txs, durationMs: Date.now() - t0,
    instructions: [...kinds.entries()].map(([n, s]) => ({ name: n, succeeded: s.ok, failed: s.err })),
    outOfBudget: outOfBudget(),
  };

  function finding(cls, severity, instruction, account, title, summary, fix, call, { world, r }) {
    if ([...call.accounts, ...(call.prefix || []).flatMap((p) => p.accounts)].some((a) => a.signer && a.address !== world.attacker.address)) {
      throw new Error('history attack relied on a signature the attacker does not hold');
    }
    const f = {
      class: cls, severity, instruction, account, title, summary, fix,
      steps: [{ ix: instruction, args: [], payer: 'attacker', accounts: call.accounts.map((a) => ({ label: a.address, signer: a.signer, writable: a.writable })) }],
      attackFrom: 0,
      evidence: {
        transaction: r.transaction, computeUnits: r.computeUnits, logs: r.logs, programId,
        balances: r.changes.map((c) => ({ account: c.address === world.attacker.address ? 'actor:attacker' : c.address === world.loot ? 'new:loot' : c.address, address: c.address, before: c.before, after: c.after })),
        tokens: r.changes.filter((c) => c.token || c.tokenBefore).map((c) => ({ address: c.address, mint: (c.token || c.tokenBefore).mint, owner: c.token?.owner ?? null, attackerOwned: c.token?.owner === world.attacker.address, before: String(c.tokenBefore?.amount ?? 0n), after: String(c.token?.amount ?? 0n) })),
        replaysAgainst: `cloned mainnet state at slot ${history.slot}`,
      },
    };
    onEvent({ type: 'finding', finding: f });
    return f;
  }
}
