// A local Solana world in LiteSVM. Every key is derived from (seed, label), so
// a run, and every finding in it, replays to the same addresses and outcomes.
// Nothing here ever talks to a network.
import { LiteSVM } from 'litesvm';
import * as k from '@solana/kit';
import { createHash } from 'node:crypto';
import { concat, encodeValue } from './borsh.js';

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
  return { svm, seed, programId, fakeProgramId, actors, states, idl };
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
export async function send(world, step) {
  const ix = world.idl ? world.idl.instructions.find((i) => i.name === step.ix) : null;
  let data;
  if (ix) {
    const resolveKey = (v) => k.getAddressEncoder().encode(String(v).startsWith('actor:') ? world.actors[String(v).slice(6)].address : v);
    data = concat([Uint8Array.from(ix.discriminator), ...ix.args.map((a, i) => encodeValue(a.type, step.args[i], resolveKey))]);
  } else {
    data = Uint8Array.from(step.raw || []);
  }
  const metas = [];
  const touched = new Map();
  for (const a of step.accounts) {
    const address = await resolve(world, a.label);
    const meta = { address, role: role(a.signer, a.writable) };
    if (a.signer) meta.signer = world.actors[a.label.split(':')[1]];
    metas.push(meta);
    touched.set(address, a.label);
  }
  const payer = world.actors[step.payer || 'owner'];
  touched.set(payer.address, `actor:${step.payer || 'owner'}`);
  const before = snapshot(world, touched);

  const msg = k.pipe(
    k.createTransactionMessage({ version: 0 }),
    (m) => k.setTransactionMessageFeePayerSigner(payer, m),
    (m) => k.setTransactionMessageLifetimeUsingBlockhash({ blockhash: world.svm.latestBlockhash(), lastValidBlockHeight: 0n }, m),
    (m) => k.appendTransactionMessageInstruction({ programAddress: world.programId, accounts: metas, data }, m),
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
