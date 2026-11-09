// Property fuzzing: random sequences of calls by different users, with invariants checked after
// every transaction. Invariants come from the IDL (every pubkey field in program state is an
// authority that may change only when it signs, and SOL leaves a state account only when its
// authority signs), plus any the program's team supplies in the same form.
// A violation is reported with the exact sequence that produced it, and replays from the seed.
//
// Input: { programPath, idlPath } or { program: bytes, idl }, plus optional { seed, sequences, maxLength, invariants }
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as k from '@solana/kit';
import { makeWorld, send } from '../../src/engine/world.js';
import { honestAccounts, combosFor } from '../../src/engine/sniff.js';
import { readIdl } from '../../src/engine/idl.js';
import { fetchProgram } from '../../src/engine/ingest.js';

const ACTORS = ['owner', 'stranger', 'attacker'];
const dec = k.getAddressDecoder();

/** Deterministic random numbers from a seed. */
function rng(seed) {
  let n = 0;
  return () => {
    const h = createHash('sha256').update(`${seed}:${n++}`).digest();
    return h.readUInt32LE(0) / 2 ** 32;
  };
}

/** Invariants derived from the IDL. */
export function deriveInvariants(idl) {
  const inv = [];
  for (const st of idl.stateTypes || []) {
    for (const pk of st.pubkeys || []) {
      inv.push({ id: `${st.key}.${pk.name}-stable`, kind: 'field-stable-unless-signed', state: st.key, field: pk.name, offset: pk.offset,
        description: `${st.name}.${pk.name} changes only in a transaction its current holder signs.` });
    }
    const auth = (st.pubkeys || [])[0];
    if (auth) inv.push({ id: `${st.key}.sol-out-needs-${auth.name}`, kind: 'sol-out-unless-signed', state: st.key, field: auth.name, offset: auth.offset,
      description: `SOL leaves a ${st.name} only in a transaction its ${auth.name} signs.` });
  }
  return inv;
}

function readKey(data, offset) {
  if (!data || data.length < offset + 32) return null;
  const b = data.subarray ? data.subarray(offset, offset + 32) : Uint8Array.from(data).subarray(offset, offset + 32);
  if (b.every((x) => x === 0)) return null;
  return dec.decode(b);
}

function stateSnapshot(world) {
  const out = {};
  for (const [key, s] of Object.entries(world.states)) {
    const a = world.svm.getAccount(s.address);
    out[key] = a.exists ? { lamports: BigInt(a.lamports), data: Uint8Array.from(a.data) } : null;
  }
  return out;
}

/** Check invariants across one transaction. signers: addresses that signed it. */
export function check(invariants, before, after, signers) {
  const broken = [];
  for (const inv of invariants) {
    const b = before[inv.state], a = after[inv.state];
    if (!b || !a) continue;
    const holder = readKey(b.data, inv.offset);
    if (!holder) continue; // not set up yet: initialization is allowed
    if (inv.kind === 'field-stable-unless-signed') {
      const now = readKey(a.data, inv.offset);
      if (now !== holder && !signers.includes(holder)) broken.push({ invariant: inv.id, description: inv.description, from: holder, to: now });
    } else if (inv.kind === 'sol-out-unless-signed') {
      if (a.lamports < b.lamports && !signers.includes(holder)) broken.push({ invariant: inv.id, description: inv.description, lamportsOut: String(b.lamports - a.lamports) });
    }
  }
  return broken;
}

export async function propertyFuzz(input, { onEvent = () => {}, budgetMs = 150_000 } = {}) {
  let program = input.program || (input.programPath ? new Uint8Array(readFileSync(input.programPath)) : null);
  let rawIdl = input.idl || (input.idlPath ? JSON.parse(readFileSync(input.idlPath, 'utf8')) : null);
  if (!program && input.address) {
    const got = await fetchProgram(input.address, { network: input.network || 'mainnet', rpcUrl: input.rpcUrl });
    program = got.program;
    rawIdl = rawIdl || got.idl;
  }
  if (!rawIdl) return { ran: false, reason: 'Property fuzzing needs the program\'s IDL to build calls and read state.' };
  const idl = readIdl(rawIdl);
  const invariants = [...deriveInvariants(idl), ...(input.invariants || [])];
  if (!invariants.length) return { ran: false, reason: 'No invariants: the program state has no authority fields, and none were supplied.' };
  const seed = input.seed || createHash('sha256').update(program).digest('hex').slice(0, 16);
  const rand = rng(seed);
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  const sequences = input.sequences || 400;
  const maxLength = input.maxLength || 6;
  const t0 = Date.now();
  const violations = [];
  const seenViolation = new Set();
  let txs = 0, ran = 0;

  for (let n = 0; n < sequences && Date.now() - t0 < budgetMs; n++) {
    const world = await makeWorld({ program, seed: `${seed}:${n}`, idl });
    const length = 1 + Math.floor(rand() * maxLength);
    const sequence = [];
    for (let i = 0; i < length; i++) {
      const ix = pick(idl.instructions);
      const actor = i === 0 ? 'owner' : pick(ACTORS);
      const combos = combosFor(idl, ix, rand() < 0.25 ? 'extreme' : 'typical');
      const args = pick(combos);
      const accounts = honestAccounts(ix).map((a) => (a.label === 'actor:owner' ? { ...a, label: `actor:${actor}` } : a));
      const step = { ix: ix.name, args, accounts, payer: actor };
      const before = stateSnapshot(world);
      let result;
      try { result = await send(world, step); } catch { break; }
      txs++;
      sequence.push({ ix: ix.name, actor, args: args.map(String), ok: result.ok });
      if (!result.ok) continue;
      const signers = accounts.filter((a) => a.signer).map((a) => world.actors[a.label.split(':')[1]]?.address).concat(world.actors[actor].address);
      const broken = check(invariants, before, stateSnapshot(world), signers);
      for (const v of broken) {
        const key = `${v.invariant}|${ix.name}|${actor}`;
        if (seenViolation.has(key)) continue;
        seenViolation.add(key);
        const label = (addr) => Object.entries(world.actors).find(([, s]) => s.address === addr)?.[0] || addr;
        violations.push({ ...v, from: v.from && label(v.from), to: v.to && label(v.to), instruction: ix.name, actor, sequence: [...sequence], seed: `${seed}:${n}` });
        onEvent({ type: 'note', text: `Invariant broken: ${v.invariant} by ${actor} in ${ix.name}.` });
      }
    }
    ran++;
  }
  return {
    ran: true, seed, sequencesRun: ran, transactions: txs, seconds: Math.round((Date.now() - t0) / 1000),
    invariants: invariants.map(({ id, kind, description }) => ({ id, kind, description, held: !violations.some((v) => v.invariant === id) })),
    violations,
    note: 'Invariants were derived from the IDL. A violation is a counterexample: the exact sequence of calls, which replays from its seed. Property results are reported beside the score and never change it.',
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await propertyFuzz(JSON.parse(process.argv[2]), { onEvent: (e) => console.error(e.text) });
  console.log(JSON.stringify({ ...r, violations: r.violations?.map((v) => ({ ...v, sequence: v.sequence.map((s) => `${s.actor}:${s.ix}${s.ok ? '' : '(failed)'}`).join(' > ') })) }, null, 1));
}
