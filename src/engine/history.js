// History mode, for a deployed program: take its recent successful mainnet
// transactions, clone every account they touch into LiteSVM (read only, over
// RPC), replay them, then attack each replayed instruction. Works with or
// without an IDL, and uses the program's real address so PDAs resolve.
// Signatures are not verified in this world so history can replay; attack
// transactions are signed only by the attacker, so their proof does not
// depend on that.
import { LiteSVM } from 'litesvm';
import * as k from '@solana/kit';
import { createHash } from 'node:crypto';
import { signerFor, ACTOR_FUNDS, FEE_PER_SIGNATURE } from './world.js';
import { fmtSol } from './sniff.js';

const UPGRADEABLE = 'BPFLoaderUpgradeab1e11111111111111111111111';
const SYSTEM = '11111111111111111111111111111111';

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
  for (const s of sigs) {
    if (calls.length >= limit) break;
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
    for (const ix of msg.instructions) {
      if (keys[ix.programIdIndex] !== programId) continue;
      const data = Buffer.from(k.getBase58Encoder().encode(ix.data));
      const accounts = ix.accounts.map((i) => ({ address: keys[i], signer: isSigner(i), writable: isWritable(i) }));
      const id = createHash('sha256').update(data).update(JSON.stringify(accounts)).digest('hex');
      if (seen.has(id)) continue;
      seen.add(id);
      calls.push({ signature: s.signature, slot: tx.slot, data: [...data], accounts, feePayer: keys[0] });
    }
  }
  onEvent({ type: 'note', text: `Found ${calls.length} recent calls to replay.` });

  const addresses = [...new Set(calls.flatMap((c) => [c.feePayer, ...c.accounts.map((a) => a.address)]))].filter((a) => a !== programId);
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
  return { calls, accounts, programs, slot: calls[0]?.slot ?? null };
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
  const attacker = await signerFor(seed, 'actor:attacker');
  svm.airdrop(attacker.address, k.lamports(ACTOR_FUNDS));
  const loot = (await signerFor(seed, 'new:loot')).address;
  const fakeProgram = (await signerFor(seed, 'fake-program')).address;
  return { svm, programId, attacker, loot, fakeProgram, seed };
}

/** Send one call. accounts: [{ address, signer, writable }]; payer: 'attacker' or an address. */
async function sendCall(world, call, payerAddress) {
  const attackerAddr = world.attacker.address;
  const signerOf = (address) => (address === attackerAddr ? world.attacker : fakeSigner(address));
  const metas = call.accounts.map((a) => {
    const role = a.signer ? (a.writable ? k.AccountRole.WRITABLE_SIGNER : k.AccountRole.READONLY_SIGNER) : a.writable ? k.AccountRole.WRITABLE : k.AccountRole.READONLY;
    const meta = { address: a.address, role };
    if (a.signer) meta.signer = signerOf(a.address);
    return meta;
  });
  const payer = signerOf(payerAddress);
  const touched = new Set([payerAddress, ...call.accounts.map((a) => a.address), world.loot]);
  const before = snap(world, touched);
  const msg = k.pipe(
    k.createTransactionMessage({ version: 0 }),
    (m) => k.setTransactionMessageFeePayerSigner(payer, m),
    (m) => k.setTransactionMessageLifetimeUsingBlockhash({ blockhash: world.svm.latestBlockhash(), lastValidBlockHeight: 0n }, m),
    (m) => k.appendTransactionMessageInstruction({ programAddress: world.programId, accounts: metas, data: Uint8Array.from(call.data) }, m),
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
    const r = await sendCall(world, call, payer);
    txs++;
    if (txs % 10 === 0) onEvent({ type: 'progress', transactions: txs });
    return { world, r };
  }

  const gainOf = (world, r) => r.changes.filter((c) => c.address === world.attacker.address || c.address === world.loot).reduce((s, c) => s + c.delta, 0n);
  // Tokens that reached an account the attacker owns. Those accounts start empty, so any increase came from someone else.
  const tokenGainOf = (world, r) => r.changes.filter((c) => c.token && c.tokenBefore && c.token.owner === world.attacker.address).map((c) => ({ address: c.address, mint: c.token.mint, gained: c.token.amount - c.tokenBefore.amount })).filter((g) => g.gained > 0n);

  for (const call of history.calls) {
    if (outOfBudget()) break;
    const name = nameOf(call.data);
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
      // Signatures are not verified in replay, so every other signer must become the attacker:
      // an attack may never rely on a signature the attacker does not hold.
      const asAttacker = (x) => (x.signer ? { ...x, address: world0.attacker.address } : x);
      const unsigned = { ...call, accounts: redirect(call.accounts.map((x, n) => (n === j ? { ...x, signer: false } : asAttacker(x)))) };
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
      const swapped = { ...call, accounts: redirect(call.accounts.map((x, n) => (n === j ? { ...x, address: world0.attacker.address } : asAttacker(x)))) };
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
        const placeholder = (await signerFor(seed, `loot-token:${call.accounts[n].address}`)).address;
        const tokenCall = { ...call, lootTokens: { [placeholder]: call.accounts[n].address }, accounts: call.accounts.map((x, m) => (m === j ? { ...x, address: world0.attacker.address } : m === n ? { ...x, address: placeholder } : asAttacker(x))) };
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
    if (call.accounts.some((a) => a.signer && a.address !== world.attacker.address)) {
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
