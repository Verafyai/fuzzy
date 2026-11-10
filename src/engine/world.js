// A local Solana world in LiteSVM. Every key is derived from (seed, label), so
// a run, and every finding in it, replays to the same addresses and outcomes.
// Nothing here ever talks to a network.
import { LiteSVM } from 'litesvm';
import v8 from 'node:v8';
import vm from 'node:vm';
import { recordInvocation } from './record.js';
import * as k from '@solana/kit';
import { createHash } from 'node:crypto';
import { concat, encodeValue } from './borsh.js';
import { DRAINER_SO } from './drainer.js';

export const ACTORS = ['owner', 'attacker', 'stranger'];
export const ACTOR_FUNDS = 10_000_000_000n;
/** Program-owned accounts start funded, as if users had deposited into them. */
export const STATE_FUNDS = 5_000_000_000n;
export const FEE_PER_SIGNATURE = 5000n;

const keyBytes = (seed, label) => new Uint8Array(createHash('sha256').update(`fuzzy:${seed}:${label}`).digest());
const signerCache = new Map();

export async function signerFor(seed, label) {
  const id = `${seed}:${label}`;
  if (!signerCache.has(id)) signerCache.set(id, await k.createKeyPairSignerFromPrivateKeyBytes(keyBytes(seed, label)));
  return signerCache.get(id);
}

export async function makeWorld({ program, seed, idl }) {
  const svm = new LiteSVM();
  const programId = (await signerFor(seed, 'program')).address;
  const fakeProgramId = (await signerFor(seed, 'fake-program')).address;
  svm.addProgram(programId, program);
  // The do-nothing program passed in place of programs the target calls (unchecked CPI target).
  const drainerId = (await signerFor(seed, 'cpi-drainer')).address;
  svm.addProgram(drainerId, DRAINER_SO);
  const actors = {};
  for (const name of ACTORS) {
    actors[name] = await signerFor(seed, `actor:${name}`);
    svm.airdrop(actors[name].address, k.lamports(ACTOR_FUNDS));
  }
  const states = {};
  for (const st of idl?.stateTypes || []) {
    const address = (await signerFor(seed, `state:${st.key}`)).address;
    const rent = svm.minimumBalanceForRentExemption(BigInt(st.size));
    svm.setAccount({ address, data: new Uint8Array(st.size), executable: false, lamports: k.lamports(rent + STATE_FUNDS), programAddress: programId, space: BigInt(st.size) });
    states[st.key] = { address, type: st };
  }
  return { svm, seed, programId, fakeProgramId, drainerId, actors, states, idl };
}

/** Resolve an account label to an address, creating fakes on demand. */
async function resolve(world, label) {
  const [kind, name] = label.split(':');
  if (kind === 'actor') return world.actors[name].address;
  if (kind === 'state') return world.states[name].address;
  if (kind === 'fixed') return label.slice(6);
  if (kind === 'fake') return fakeState(world, name);
  if (kind === 'new') return (await signerFor(world.seed, `new:${name}`)).address;
  throw new Error(`unknown account label ${label}`);
}

/** A look-alike of a program-owned account: same data, the attacker's key in
 * every pubkey field, owned by a program the attacker controls. */
async function fakeState(world, name) {
  const real = world.states[name];
  const address = (await signerFor(world.seed, `fake:${name}`)).address;
  if (!world.svm.getAccount(address).exists) {
    const acct = world.svm.getAccount(real.address);
    const data = Uint8Array.from(acct.data);
    const attacker = k.getAddressEncoder().encode(world.actors.attacker.address);
    for (const pk of real.type.pubkeys) data.set(attacker, pk.offset);
    world.svm.setAccount({ address, data, executable: false, lamports: acct.lamports, programAddress: world.fakeProgramId, space: BigInt(data.length) });
  }
  return address;
}

function role(signer, writable) {
  if (signer && writable) return k.AccountRole.WRITABLE_SIGNER;
  if (signer) return k.AccountRole.READONLY_SIGNER;
  if (writable) return k.AccountRole.WRITABLE;
  return k.AccountRole.READONLY;
}

/**
 * Send one step. A step: { ix, args, accounts: [{ label, signer, writable }], payer }.
 * Returns the outcome with lamport changes for every account it touched.
 */
let sends = 0;
/** Give the event loop a turn every few transactions, so progress streams out while a run is busy. */
export async function breathe() {
  if (++sends % 8 === 0) await new Promise((resolve) => setImmediate(resolve));
  if (sends % 64 === 0) reclaim();
}

// Each LiteSVM world holds its programs and accounts in native memory, which V8 only frees when it collects
// the JS wrapper. The JS heap stays small, so without a nudge V8 rarely collects and a replay with hundreds of
// cloned accounts runs out of memory. reclaim() forces a collection.
let gc = null;
try {
  v8.setFlagsFromString('--expose-gc');
  gc = vm.runInNewContext('gc');
} catch { gc = globalThis.gc || null; }
export function reclaim() {
  if (gc) gc();
}

const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const addrEnc = k.getAddressEncoder();
const addrDec = k.getAddressDecoder();

/** The program address for seeds and one bump, or null when that bump lands on the curve. */
export function programAddress(seeds, bump, programId) {
  const h = createHash('sha256');
  for (const seed of seeds) h.update(Buffer.from(seed));
  h.update(Buffer.from([bump])).update(Buffer.from(addrEnc.encode(programId))).update('ProgramDerivedAddress');
  const address = addrDec.decode(h.digest());
  return k.isOffCurveAddress(address) ? address : null;
}

/** Every valid bump for these seeds, canonical (highest) first. */
export function validBumps(seeds, programId, limit = 4) {
  const out = [];
  for (let b = 255; b >= 0 && out.length < limit; b--) {
    const address = programAddress(seeds, b, programId);
    if (address) out.push({ bump: b, address });
  }
  return out;
}

const isBumpArg = (a) => /(^|_)bump$/i.test(a.name) && a.type === 'u8';

/** The seed bytes for one IDL PDA account, given the step's other accounts and arguments. */
async function pdaSeeds(world, ix, account, step, addresses) {
  const seeds = [];
  for (const seed of account.pda.seeds || []) {
    if (seed.kind === 'const') seeds.push(Uint8Array.from(seed.value));
    else if (seed.kind === 'account') {
      const i = ix.accounts.findIndex((a) => a.name === String(seed.path).split('.')[0]);
      if (i < 0 || !addresses[i]) return null;
      seeds.push(addrEnc.encode(addresses[i]));
    } else if (seed.kind === 'arg') {
      const j = ix.args.findIndex((a) => a.name === String(seed.path).split('.')[0]);
      if (j < 0) return null;
      const resolveKey = (v) => addrEnc.encode(String(v).startsWith('actor:') ? world.actors[String(v).slice(6)].address : v);
      seeds.push(encodeValue(ix.args[j].type, step.args[j], resolveKey, world.idl.types));
    } else return null;
  }
  return seeds;
}

/** The derived (PDA) accounts in a step, with their valid bumps, canonical first. */
export async function derivedAccounts(world, step) {
  const ix = world?.idl ? world.idl.instructions.find((i) => i.name === step.ix) : null;
  if (!ix) return [];
  const addresses = [];
  for (const [i, a] of step.accounts.entries()) if (!a.label.startsWith('pda:')) addresses[i] = await resolve(world, a.label);
  const out = [];
  for (const [i, a] of step.accounts.entries()) {
    const def = ix.accounts[i];
    if (!a.label.startsWith('pda:') || !def?.pda) continue;
    const seeds = await pdaSeeds(world, ix, def, step, addresses);
    if (!seeds) continue;
    const programId = def.pda.program?.kind === 'const' ? addrDec.decode(Uint8Array.from(def.pda.program.value)) : world.programId;
    out.push({ name: a.name, bumps: validBumps(seeds, programId, 3) });
  }
  return out;
}

/** Build one instruction for the target program, and note the accounts it touches. */
async function buildIx(world, step, touched) {
  const ix = world.idl ? world.idl.instructions.find((i) => i.name === step.ix) : null;
  // Resolve plain accounts first, then derived (PDA) accounts, which may depend on them.
  const addresses = [];
  for (const [i, a] of step.accounts.entries()) if (!a.label.startsWith('pda:')) addresses[i] = await resolve(world, a.label);
  let bump = null;
  for (const [i, a] of step.accounts.entries()) {
    if (!a.label.startsWith('pda:')) continue;
    const def = ix?.accounts[i];
    const seeds = def?.pda ? await pdaSeeds(world, ix, def, step, addresses) : null;
    const programId = def?.pda?.program?.kind === 'const' ? addrDec.decode(Uint8Array.from(def.pda.program.value)) : world.programId;
    let address = step.pdaOverride?.[a.name];
    if (!address && seeds) {
      const [canonical] = validBumps(seeds, programId, 1);
      address = canonical?.address;
      if (bump === null && canonical) bump = canonical.bump;
    }
    if (!address) address = (await signerFor(world.seed, `pda:${a.name}`)).address;
    // A derived account nobody has created yet is funded like a treasury users paid into,
    // unless it is program state, which the program creates itself.
    if (!step.pdaOverride?.[a.name] && !world.svm.getAccount(address).exists && !def?.stateType) world.svm.airdrop(address, k.lamports(STATE_FUNDS));
    addresses[i] = address;
  }
  let data;
  if (ix) {
    const resolveKey = (v) => addrEnc.encode(String(v).startsWith('actor:') ? world.actors[String(v).slice(6)].address : v);
    const args = ix.args.map((a, i) => (isBumpArg(a) && (step.bumpOverride ?? bump) !== null ? (step.bumpOverride ?? bump) : step.args[i]));
    data = concat([Uint8Array.from(ix.discriminator), ...ix.args.map((a, i) => encodeValue(a.type, args[i], resolveKey, world.idl.types))]);
  } else {
    data = Uint8Array.from(step.raw || []);
  }
  const metas = step.accounts.map((a, i) => {
    const meta = { address: addresses[i], role: role(a.signer, a.writable) };
    if (a.signer) meta.signer = world.actors[a.label.split(':')[1]];
    touched.set(addresses[i], a.label);
    return meta;
  });
  recordInvocation(world.svm, world.programId, metas, data);
  return { programAddress: world.programId, accounts: metas, data };
}

/** A System program transfer: { system: { from: 'actor:attacker', to: label, lamports } }. */
async function systemIx(world, part, touched) {
  const from = world.actors[part.system.from.split(':')[1]];
  const to = await resolve(world, part.system.to);
  touched.set(from.address, part.system.from);
  touched.set(to, part.system.to);
  const data = new Uint8Array(12);
  data[0] = 2;
  new DataView(data.buffer).setBigUint64(4, BigInt(part.system.lamports), true);
  return { programAddress: SYSTEM_PROGRAM, accounts: [{ address: from.address, role: k.AccountRole.WRITABLE_SIGNER, signer: from }, { address: to, role: k.AccountRole.WRITABLE }], data };
}

/**
 * Send one step, or several in one transaction (step.bundle). A step:
 * { ix, args, accounts: [{ label, signer, writable }], payer }, or { system: { from, to, lamports } }.
 * Returns the outcome with lamport changes for every account it touched.
 */
export async function send(world, step) {
  await breathe();
  const touched = new Map();
  const instructions = [];
  for (const part of step.bundle || [step]) instructions.push(part.system ? await systemIx(world, part, touched) : await buildIx(world, part, touched));
  const payer = world.actors[step.payer || 'owner'];
  touched.set(payer.address, `actor:${step.payer || 'owner'}`);
  const before = snapshot(world, touched);

  const msg = k.pipe(
    k.createTransactionMessage({ version: 0 }),
    (m) => k.setTransactionMessageFeePayerSigner(payer, m),
    (m) => k.setTransactionMessageLifetimeUsingBlockhash({ blockhash: world.svm.latestBlockhash(), lastValidBlockHeight: 0n }, m),
    (m) => k.appendTransactionMessageInstructions(instructions, m),
  );
  const tx = await k.signTransactionMessageWithSigners(msg);
  const res = world.svm.sendTransaction(tx);
  world.svm.expireBlockhash();
  const failed = typeof res.err === 'function';
  const meta = failed ? res.meta() : res;
  const after = snapshot(world, touched);
  const signatures = BigInt(Object.keys(tx.signatures).length);
  const changes = [];
  for (const [address, label] of touched) {
    const b = before.get(address), a = after.get(address);
    let delta = a.lamports - b.lamports;
    if (address === payer.address) delta += FEE_PER_SIGNATURE * signatures; // fees are not theft or loss
    changes.push({ label, address, before: b.lamports.toString(), after: a.lamports.toString(), delta: delta.toString(), dataChanged: !sameBytes(b.data, a.data), dataAfter: a.data });
  }
  const logs = meta.logs();
  return {
    ok: !failed,
    error: failed ? errorCode(res, logs) : null,
    computeUnits: Number(meta.computeUnitsConsumed()),
    logs,
    changes,
    transaction: k.getBase64EncodedWireTransaction(tx),
  };
}

function snapshot(world, touched) {
  const out = new Map();
  for (const address of touched.keys()) {
    const acct = world.svm.getAccount(address);
    out.set(address, acct.exists ? { lamports: BigInt(acct.lamports), data: Uint8Array.from(acct.data) } : { lamports: 0n, data: new Uint8Array() });
  }
  return out;
}

const sameBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

function errorCode(res, logs) {
  const text = res.toString();
  const custom = text.match(/Custom\((\d+)\)/);
  if (custom) return `custom:${custom[1]}`;
  if (logs.some((l) => /exceeded CUs meter|computational budget exceeded/i.test(l))) return 'compute_exhausted';
  if (logs.some((l) => /panicked/i.test(l))) return 'panic';
  const m = text.match(/InstructionError\(\s*\d+,\s*(\w+)/) || text.match(/(\w+Error|\w+)\b/);
  return m ? m[1] : 'failed';
}
