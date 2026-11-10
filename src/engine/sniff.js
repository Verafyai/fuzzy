// The Sniff engine: learn the program's working paths from its IDL, then attack
// each one in LiteSVM. A finding is kept only when an attack transaction
// actually succeeds and moves funds to the attacker or hands them an authority.
import { candidates, isNumeric } from './borsh.js';
import * as kit from '@solana/kit';

const addrDecoder = kit.getAddressDecoder();
import { makeWorld, send, signerFor, derivedAccounts } from './world.js';

export const ATTACK_CLASSES = [
  { id: 'missing_signer', name: 'Missing signer check' },
  { id: 'missing_owner', name: 'Missing owner check' },
  { id: 'account_substitution', name: 'Account substitution' },
  { id: 'pda_seed', name: 'PDA seed collision' },
  { id: 'arithmetic', name: 'Arithmetic overflow' },
  { id: 'close_reuse', name: 'Close, then reuse' },
  { id: 'unchecked_cpi', name: 'Unchecked CPI target' },
  { id: 'unchecked_mint', name: 'Unchecked mint or authority' },
  { id: 'lamport_draining', name: 'Lamport draining' },
  { id: 'reinitialization', name: 'Reinitialization' },
  { id: 'price_manipulation', name: 'Price manipulation' },
  { id: 'compute_exhaustion', name: 'Compute exhaustion' },
];

/** Labels whose balance counts as the attacker's. */
const ATTACKER_LABELS = new Set(['actor:attacker', 'new:loot']);

export function honestAccounts(ix) {
  return ix.accounts.map((a) => {
    let label;
    if (a.role === 'fixed') label = `fixed:${a.address}`;
    else if (a.role === 'actor') label = 'actor:owner';
    else if (a.pda) label = `pda:${a.name}`;
    else if (a.role === 'state') label = `state:${a.stateType.replace(/[_\s-]/g, '').toLowerCase()}`;
    else if (a.role === 'wallet') label = `new:wallet-${a.name}`;
    else label = 'actor:stranger';
    return { name: a.name, role: a.role, label, signer: a.signer, writable: a.writable };
  });
}

/** The attacker as an ordinary user: they play the owner on their own accounts, and payouts go to them. */
function asUser(step) {
  return { ...step, payer: !step.payer || step.payer === 'owner' ? 'attacker' : step.payer, accounts: step.accounts.map((a) => (a.label === 'actor:owner' ? { ...a, label: 'actor:attacker' } : a.role === 'wallet' ? { ...a, label: 'new:loot' } : a)) };
}

const NOT_PROGRAMS = /^(Sysvar|SysvarC1ock|SysvarRent)/;
/** An account slot that holds a program the target calls. */
function isProgramSlot(a) {
  const address = a.address || (a.label?.startsWith('fixed:') ? a.label.slice(6) : '');
  if (a.role === 'fixed') return !NOT_PROGRAMS.test(address) && !/sysvar|rent|clock|instructions/i.test(a.name);
  return /program$/i.test(a.name) && !a.signer && !a.writable;
}

/** Keys the do-nothing program logged as signers. */
function signersIn(logs) {
  const out = [];
  for (const l of logs) {
    const m = l.match(/FUZZY_CPI_SIGNER ([0-9a-f]{64})/);
    if (m) out.push(addrDecoder.decode(Uint8Array.from(Buffer.from(m[1], 'hex'))));
  }
  return out;
}

/** Swap the owner for the attacker everywhere, and send any payout to the attacker. */
function asAttacker(accounts, { sign = true } = {}) {
  return accounts.map((a) => {
    if (a.label === 'actor:owner') return { ...a, label: 'actor:attacker', signer: sign && a.signer };
    if (a.role === 'wallet') return { ...a, label: 'new:loot' };
    return { ...a };
  });
}

let types = new Map();
function argCombos(ix, pick) {
  if (ix.args.length === 0) return [[]];
  const lists = ix.args.map((a) => pick(candidates(a.type, types)));
  const combos = [];
  const width = Math.max(...lists.map((l) => l.length));
  for (let i = 0; i < width; i++) combos.push(lists.map((l) => l[Math.min(i, l.length - 1)]));
  return combos;
}

export function attackerGain(result) {
  let gain = 0n;
  for (const c of result.changes) if (ATTACKER_LABELS.has(c.label)) gain += BigInt(c.delta);
  return gain;
}

/** Did the transaction move lamports or change data anywhere? */
function hasEffect(result) {
  return result.changes.some((c) => BigInt(c.delta) !== 0n || (c.dataChanged && !c.label.startsWith('fake:')));
}

function victimLoss(result) {
  let loss = 0n;
  for (const c of result.changes) if (!ATTACKER_LABELS.has(c.label) && BigInt(c.delta) < 0n) loss -= BigInt(c.delta);
  return loss;
}

/** Did the attack write the attacker's key over the owner's in a program-owned account? */
function authorityTakeover(world, result) {
  const enc = (address) => Buffer.from(addressBytes(address));
  const owner = enc(world.actors.owner.address), attacker = enc(world.actors.attacker.address);
  for (const c of result.changes) {
    if (!c.label.startsWith('state:') || !c.dataChanged) continue;
    const after = Buffer.from(c.dataAfter);
    if (after.indexOf(attacker) >= 0 && after.indexOf(owner) < 0) return true;
  }
  return false;
}

let addressBytes;
async function loadEncoder() {
  if (!addressBytes) {
    const k = await import('@solana/kit');
    const enc = k.getAddressEncoder();
    addressBytes = (a) => enc.encode(a);
  }
}

/**
 * Run Sniff. Returns the raw material for a report: paths seen, findings,
 * leads and the depth inputs. `budget.txs` caps transactions; `budget.ms` caps time.
 */
export async function runSniff({ program, idl, seed = 'fuzzy', budget = { txs: 600, ms: 40_000 }, onEvent = () => {} }) {
  await loadEncoder();
  types = idl?.types || new Map();
  const t0 = Date.now();
  let txs = 0;
  const paths = new Set();
  const seen = new Map(); // ix -> { ok, err }
  const findings = [];
  const leads = [];
  const tried = new Set();
  const unsupported = new Set();
  const outOfBudget = () => txs >= budget.txs || Date.now() - t0 > budget.ms;

  async function run(prefix, step) {
    const world = await makeWorld({ program, seed, idl });
    for (const p of prefix) { await send(world, p); txs++; }
    let result;
    try {
      result = await send(world, step);
    } catch (error) {
      unsupported.add(step.ix);
      result = { ok: false, error: 'unsupported_args', computeUnits: 0, logs: [String(error.message || error)], changes: [], transaction: '' };
      return { world, result };
    }
    txs++;
    if (txs % 25 === 0) onEvent({ type: 'progress', transactions: txs });
    const s = seen.get(step.ix) || { ok: false, err: false };
    if (result.ok) s.ok = true; else s.err = true;
    seen.set(step.ix, s);
    paths.add(`${step.ix}|${result.ok ? 'ok' : result.error}`);
    if (result.error === 'panic') addLead({ class: 'arithmetic', instruction: step.ix, title: `${step.ix} panics on some inputs`, detail: 'The program aborts instead of returning an error. Not exploitable on its own.' });
    if (result.computeUnits > 150_000) addLead({ class: 'compute_exhaustion', instruction: step.ix, title: `${step.ix} used ${result.computeUnits} compute units`, detail: 'Close to the default limit of 200,000. Check whether a caller can push it over.' });
    return { world, result };
  }

  function addLead(lead) {
    const key = `${lead.class}|${lead.instruction}|${lead.title}`;
    if (!leads.some((l) => l.key === key)) leads.push({ key, ...lead });
  }

  function addFinding(f) {
    const key = `${f.class}|${f.instruction}|${f.account || ''}`;
    if (findings.some((x) => x.key === key)) return;
    findings.push({ key, id: `F${findings.length + 1}`, ...f });
    onEvent({ type: 'finding', finding: f });
  }

  const drainerId = (await signerFor(seed, 'cpi-drainer')).address;
  const seedWorld = idl ? await makeWorld({ program, seed, idl }) : null;

  /** Run calls in order in a fresh world; record each result and the attacker's running gain. */
  async function runSeq(seq) {
    const world = await makeWorld({ program, seed, idl });
    const results = [], cumulative = [];
    let total = 0n;
    for (const st of seq) {
      let res;
      try { res = await send(world, st); } catch { res = { ok: false, error: 'unsupported_args', logs: [], changes: [], computeUnits: 0, transaction: '' }; }
      txs++;
      if (txs % 25 === 0) onEvent({ type: 'progress', transactions: txs });
      if (res.ok) total += attackerGain(res);
      results.push(res);
      cumulative.push(total);
    }
    return { world, results, cumulative };
  }

  /** The first call at or after `from` where the attacker is up in absolute terms and ahead of the honest run. */
  function firstAhead(t, base, from) {
    for (let n = from; n < t.results.length; n++) {
      if (!t.results[n].ok) return -1;
      if (t.cumulative[n] > 0n && t.cumulative[n] > (base.cumulative[n] ?? 0n) && attackerGain(t.results[n]) > 0n) return n;
    }
    return -1;
  }

  /** Accounts a learned call leaves with no lamports, run as the attacker on their own accounts. */
  async function accountsEmptiedBy(seq, i) {
    const t = await runSeq(seq.slice(0, i + 1));
    const r0 = t.results[i];
    if (!r0?.ok) return [];
    return r0.changes.filter((c) => (c.label.startsWith('state:') || c.label.startsWith('pda:')) && BigInt(c.after) === 0n && BigInt(c.before) > 0n).map((c) => c.label);
  }

  if (!idl) {
    onEvent({ type: 'note', text: 'No IDL: sending raw instruction data only.' });
    for (let i = 0; i < 40 && !outOfBudget(); i++) {
      const raw = Array.from({ length: 8 + (i % 3) * 8 }, (_, j) => (i * 31 + j * 17) & 0xff);
      const { result } = await run([], { ix: '(raw)', raw, accounts: [], payer: 'stranger' });
      paths.add(`raw|${result.ok ? 'ok' : result.error}`);
    }
    return finish();
  }

  // 1. Learn the working paths, in order, so later instructions see earlier state.
  onEvent({ type: 'phase', id: 'learn', text: `Calling ${idl.instructions.length} instructions as an honest user` });
  const steps = [];
  for (let round = 0; round < 3 && !outOfBudget(); round++) {
    let progress = false;
    for (const ix of idl.instructions) {
      if (steps.some((s) => s.ix === ix.name)) continue;
      onEvent({ type: 'activity', text: `Learning: calling ${ix.name} as the owner` });
      for (const args of argCombos(ix, (c) => c.typical)) {
        if (outOfBudget()) break;
        const step = { ix: ix.name, args, accounts: honestAccounts(ix), payer: 'owner' };
        const { result } = await run(steps, step);
        onEvent({ type: 'tx', ix: ix.name, ok: result.ok, error: result.error });
        if (result.ok) { steps.push(step); progress = true; break; }
      }
    }
    if (!progress) break;
  }
  onEvent({ type: 'note', text: `Learned ${steps.length} of ${idl.instructions.length} instructions.` });
  onEvent({ type: 'phase', id: 'attack', text: `Attacking ${steps.length} working ${steps.length === 1 ? 'path' : 'paths'}` });
  if (unsupported.size) onEvent({ type: 'note', text: `Could not encode arguments for ${[...unsupported].join(', ')}.` });

  // 2. Attack every working step.
  for (let i = 0; i < steps.length && !outOfBudget(); i++) {
    const prefix = steps.slice(0, i);
    const step = steps[i];
    const ix = idl.instructions.find((x) => x.name === step.ix);

    // Missing signer: every account that should sign, left unsigned, attacker pays.
    const signerIdx = step.accounts.map((a, j) => (a.signer ? j : -1)).filter((j) => j >= 0);
    if (signerIdx.length) {
      tried.add('missing_signer'); tried.add('lamport_draining');
      onEvent({ type: 'activity', text: `Missing signer: calling ${step.ix} with each required signature dropped` });
      for (const j of signerIdx) {
        const accounts = step.accounts.map((a, n) => (n === j ? { ...a, signer: false } : a.role === 'wallet' ? { ...a, label: 'new:loot' } : a));
        const attack = { ix: step.ix, args: step.args, accounts, payer: 'attacker' };
        const { world, result } = await run(prefix, attack);
        if (result.ok && !hasEffect(result)) {
          addLead({ class: 'missing_signer', instruction: step.ix, title: `${step.ix} runs without ${step.accounts[j].name}'s signature`, detail: 'It succeeded unsigned but changed nothing, so it is not counted.' });
        } else if (result.ok) {
          const gain = attackerGain(result);
          addFinding({
            class: 'missing_signer', instruction: step.ix, account: step.accounts[j].name,
            severity: gain > 0n ? 'critical' : 'high',
            title: gain > 0n ? `Anyone can call ${step.ix} without ${step.accounts[j].name}'s signature and take funds` : `${step.ix} runs without ${step.accounts[j].name}'s signature`,
            summary: `${step.ix} never checks that ${step.accounts[j].name} signed. The attacker named the ${step.accounts[j].name} without their signature and the transaction succeeded${gain > 0n ? `, moving ${fmtSol(gain)} to the attacker` : ''}.`,
            fix: `Require ${step.accounts[j].name} to be a signer (in Anchor, Signer<'info>).`,
            steps: [...prefix, attack], attackFrom: prefix.length,
            evidence: evidence(result, world),
          });
        }
      }
    }

    // Reinitialization: replay the step as the attacker after the owner already ran it.
    const wrote = await stateWritten(prefix, step);
    if (wrote) {
      tried.add('reinitialization');
      onEvent({ type: 'activity', text: `Reinitialization: running ${step.ix} again as a stranger` });
      const attack = { ix: step.ix, args: step.args, accounts: asAttacker(step.accounts), payer: 'attacker' };
      const { world, result } = await run([...prefix, step], attack);
      if (result.ok && authorityTakeover(world, result)) {
        // Escalate: with the authority taken, try every other working step as the attacker.
        let chained = null;
        for (const other of steps) {
          if (other === step) continue;
          const loot = { ix: other.ix, args: other.args, accounts: asAttacker(other.accounts), payer: 'attacker' };
          const r = await run([...prefix, step, attack], loot);
          if (r.result.ok && attackerGain(r.result) > 0n) { chained = { loot, r }; break; }
        }
        addFinding({
          class: 'reinitialization', instruction: step.ix, account: null,
          severity: chained ? 'critical' : 'high',
          title: chained ? `Anyone can re-run ${step.ix}, take over the account, then ${chained.loot.ix} its funds` : `Anyone can re-run ${step.ix} and replace the authority`,
          summary: `${step.ix} does not check that the account is new. The attacker ran it again on an account the owner had already set up and wrote their own key in as the authority${chained ? `, then called ${chained.loot.ix} and took ${fmtSol(attackerGain(chained.r.result))}` : ''}.`,
          fix: `Refuse to initialize an account that already holds data (check the discriminator, or use Anchor's init constraint).`,
          steps: chained ? [...prefix, step, attack, chained.loot] : [...prefix, step, attack], attackFrom: prefix.length + 1,
          evidence: evidence(chained ? chained.r.result : result, chained ? chained.r.world : world),
        });
      }
    }

    // Account substitution: a look-alike account owned by the attacker's program.
    const stateIdx = step.accounts.map((a, j) => (a.role === 'state' ? j : -1)).filter((j) => j >= 0);
    if (stateIdx.length) {
      tried.add('missing_owner'); tried.add('account_substitution');
      onEvent({ type: 'activity', text: `Owner checks: passing ${step.ix} look-alike accounts owned by another program` });
      for (const j of stateIdx) {
        const accounts = asAttacker(step.accounts).map((a, n) => (n === j ? { ...a, label: a.label.replace('state:', 'fake:') } : a));
        const attack = { ix: step.ix, args: step.args, accounts, payer: 'attacker' };
        const { world, result } = await run(prefix, attack);
        if (result.ok && !hasEffect(result)) {
          addLead({ class: 'missing_owner', instruction: step.ix, title: `${step.ix} accepts a fake ${step.accounts[j].name}`, detail: 'It accepted an account the program does not own, but changed nothing, so it is not counted.' });
        } else if (result.ok) {
          const gain = attackerGain(result);
          addFinding({
            class: 'missing_owner', instruction: step.ix, account: step.accounts[j].name,
            severity: gain > 0n || victimLoss(result) > 0n ? 'critical' : 'high',
            title: `${step.ix} accepts a fake ${step.accounts[j].name} the program doesn't own`,
            summary: `${step.ix} checks the ${step.accounts[j].name}'s contents but not which program owns it. The attacker passed a copy owned by their own program, with their key in every authority field, and it was accepted${gain > 0n ? `, moving ${fmtSol(gain)} to the attacker` : ''}.`,
            fix: `Check that ${step.accounts[j].name}.owner is this program (Anchor's Account<T> does this).`,
            steps: [...prefix, attack], attackFrom: prefix.length,
            evidence: evidence(result, world),
          });
        }
      }
    }

    // Arithmetic: the extreme values for every numeric argument.
    if (ix.args.some((a) => isNumeric(a.type))) {
      tried.add('arithmetic');
      onEvent({ type: 'activity', text: `Arithmetic: ${step.ix} with 0, 1 and maximum values` });
      for (const args of argCombos(ix, (c) => (c.extreme.length ? c.extreme : c.typical))) {
        if (outOfBudget()) break;
        const { result } = await run(prefix, { ...step, args });
        if (result.ok && attackerGain(result) > 0n) {
          addLead({ class: 'arithmetic', instruction: step.ix, title: `${step.ix} accepted extreme arguments`, detail: `Arguments ${JSON.stringify(args)} succeeded. Review the math on this path.` });
        }
      }
    }

    // The attacker as an ordinary user: they run the same learned calls on their own accounts,
    // so an attack is proven only by leaving them ahead of doing the same calls honestly.
    const userSeq = steps.map(asUser);

    // Unchecked CPI target: a do-nothing program in place of each program the call passes.
    const programSlots = step.accounts.map((a, j) => (isProgramSlot(a) ? j : -1)).filter((j) => j >= 0);
    if (programSlots.length) {
      tried.add('unchecked_cpi');
      const base = await runSeq(userSeq);
      for (const j of programSlots) {
        if (outOfBudget()) break;
        onEvent({ type: 'activity', text: `Unchecked CPI: ${step.ix} with a do-nothing program in place of ${step.accounts[j].name}` });
        const twisted = userSeq.map((s2, n) => (n === i ? { ...s2, accounts: s2.accounts.map((a, m) => (m === j ? { ...a, label: `fixed:${drainerId}` } : a)) } : s2));
        const t = await runSeq(twisted);
        const at = t.results[i];
        if (!at?.ok) continue;
        const hijacked = at.logs.some((l) => l.includes('FUZZY_CPI_HIJACK'));
        if (!hijacked) continue;
        const ahead = firstAhead(t, base, i);
        if (ahead >= 0) {
          const extra = t.cumulative[ahead] - base.cumulative[ahead];
          addFinding({
            class: 'unchecked_cpi', instruction: step.ix, account: step.accounts[j].name, severity: 'critical',
            title: `${step.ix} calls whatever program is passed as ${step.accounts[j].name}`,
            summary: `${step.ix} never checks that ${step.accounts[j].name} is the program it expects. With a do-nothing program in its place, the call succeeded as if the real program had run, and the attacker ended ${fmtSol(extra)} ahead of making the same calls honestly.`,
            fix: `Check the program account's address before calling it (in Anchor, Program<'info, T>).`,
            steps: twisted.slice(0, ahead + 1), attackFrom: i,
            evidence: evidence(t.results[ahead], t.world),
          });
        } else {
          const foreign = signersIn(at.logs).filter((key) => key !== t.world.actors.attacker.address);
          addLead({ class: 'unchecked_cpi', instruction: step.ix, title: `${step.ix} calls whatever program is passed as ${step.accounts[j].name}`, detail: foreign.length ? `It handed a signature (${foreign.join(', ')}) to a program the attacker chose. No funds moved in this run, so it is not counted.` : 'A do-nothing program in its place was called and the instruction still succeeded. No funds moved in this run, so it is not counted.' });
        }
      }
    }

    // Close, then reuse: close an account, revive it with lamports in the same transaction, use it again.
    if (/close/i.test(step.ix)) {
      const closed = await accountsEmptiedBy(userSeq, i);
      if (closed.length) tried.add('close_reuse');
      for (const label of closed) {
        if (outOfBudget()) break;
        onEvent({ type: 'activity', text: `Close, then reuse: ${step.ix}, revive ${label.split(':')[1]} in the same transaction, use it again` });
        // Re-creating a closed account (an init) is normal; reuse means using its old data.
        const users = [userSeq[i], ...userSeq.filter((s2, n) => n !== i && !/init|create|open|new/i.test(s2.ix || '') && s2.accounts.some((a) => a.label === label))];
        // Two setups: everything learned before the close, and the same without earlier cash-outs,
        // so the account still holds something worth taking twice.
        const full = userSeq.slice(0, i);
        const unspent = full.filter((s2) => !/withdraw|claim|redeem|unstake|harvest|collect/i.test(s2.ix || ''));
        const setups = unspent.length !== full.length ? [unspent, full] : [full];
        let done = false;
        for (const setup of setups) {
         if (done) break;
         const base = await runSeq([...setup, userSeq[i]]);
         const closeGain = base.results[setup.length]?.ok ? attackerGain(base.results[setup.length]) : 0n;
         for (const reuse of users.slice(0, 3)) {
          const revive = { system: { from: 'actor:attacker', to: label, lamports: 5_000_000 } };
          const bundle = { bundle: [userSeq[i], revive, reuse], payer: 'attacker' };
          const t = await runSeq([...setup, bundle]);
          const r2 = t.results[setup.length];
          if (!r2?.ok) continue;
          const extra = attackerGain(r2) - closeGain;
          if (extra > 0n) {
            done = true;
            addFinding({
              class: 'close_reuse', instruction: step.ix, account: label.split(':')[1], severity: 'critical',
              title: `${step.ix} leaves a closed account usable in the same transaction`,
              summary: `After ${step.ix} closed ${label.split(':')[1]}, the attacker sent it lamports in the same transaction and called ${reuse.ix} on it again. The account's data had survived, and the attacker came out ${fmtSol(extra)} ahead of closing it once.`,
              fix: 'Zero the account data (or write a closed marker) when closing, and check for it on every use.',
              steps: [...setup, bundle], attackFrom: setup.length,
              evidence: evidence(r2, t.world),
            });
            break;
          }
          addLead({ class: 'close_reuse', instruction: step.ix, title: `${label.split(':')[1]} can be used again after ${step.ix} in the same transaction`, detail: `Revived with lamports, ${reuse.ix} still accepted it. No extra funds moved, so it is not counted.` });
         }
        }
      }
    }

    // PDA bumps: the same seeds with a valid but non-canonical bump.
    const derived = await derivedAccounts(seedWorld, step);
    for (const d of derived) {
      if (!ix.args.some((a) => /(^|_)bump$/i.test(a.name)) || d.bumps.length < 2) continue;
      tried.add('pda_seed');
      const base = await runSeq(userSeq.slice(0, i + 1));
      const baseGain = base.results[i]?.ok ? attackerGain(base.results[i]) : 0n;
      for (const alt of d.bumps.slice(1, 3)) {
        if (outOfBudget()) break;
        onEvent({ type: 'activity', text: `PDA seeds: ${step.ix} with ${d.name} at non-canonical bump ${alt.bump}` });
        const variant = { ...userSeq[i], pdaOverride: { [d.name]: alt.address }, bumpOverride: alt.bump };
        const t = await runSeq([...userSeq.slice(0, i), variant]);
        const r2 = t.results[i];
        if (!r2?.ok) continue;
        const extra = attackerGain(r2) - baseGain;
        if (extra > 0n) {
          addFinding({
            class: 'pda_seed', instruction: step.ix, account: d.name, severity: 'high',
            title: `${step.ix} accepts ${d.name} at a non-canonical bump`,
            summary: `${step.ix} accepted ${d.name} derived with bump ${alt.bump} instead of the canonical ${d.bumps[0].bump}, a second address for the same seeds, and the attacker came out ${fmtSol(extra)} ahead.`,
            fix: 'Derive the address with find_program_address (or store the canonical bump) and reject any other bump.',
            steps: [...userSeq.slice(0, i), variant], attackFrom: i,
            evidence: evidence(r2, t.world),
          });
          break;
        }
        addLead({ class: 'pda_seed', instruction: step.ix, title: `${step.ix} accepts ${d.name} at a non-canonical bump`, detail: `Bump ${alt.bump} (canonical is ${d.bumps[0].bump}) gives a second valid address for the same seeds, and the call succeeded with it. No funds moved, so it is not counted.` });
        break;
      }
    }
  }

  // 3. Fill the rest of the budget with mixed calls, for coverage of error paths.
  tried.add('compute_exhaustion');
  onEvent({ type: 'activity', text: 'Mixed calls by the owner, a stranger and the attacker, for coverage' });
  let n = 0;
  while (!outOfBudget() && n < 60) {
    const ix = idl.instructions[n % idl.instructions.length];
    const variants = [
      { payer: 'stranger', accounts: honestAccounts(ix).map((a) => (a.label === 'actor:owner' ? { ...a, label: 'actor:stranger' } : a)) },
      { payer: 'owner', accounts: honestAccounts(ix) },
      { payer: 'attacker', accounts: asAttacker(honestAccounts(ix)) },
    ];
    const v = variants[Math.floor(n / idl.instructions.length) % variants.length];
    const combos = argCombos(ix, (c) => [...c.typical, ...c.extreme]);
    const args = combos[n % combos.length];
    await run(n % 2 ? steps : [], { ix: ix.name, args, accounts: v.accounts, payer: v.payer });
    n++;
  }

  // Heuristic leads from the IDL: shown, never scored.
  for (const ix of idl.instructions) {
    const writesState = ix.accounts.some((a) => a.role === 'state' && a.writable);
    if (writesState && !ix.accounts.some((a) => a.signer)) addLead({ class: 'missing_signer', instruction: ix.name, title: `${ix.name} needs no signature`, detail: 'It writes program state but takes no signer. Fine for a permissionless crank; otherwise add one.' });
  }

  return finish();

  async function stateWritten(prefix, step) {
    const { result } = await run(prefix, step);
    return result.ok && result.changes.some((c) => (c.label.startsWith('state:') || c.label.startsWith('pda:')) && c.dataChanged);
  }

  function finish() {
    const applicable = applicableClasses(idl);
    const triedApplicable = [...tried].filter((c) => applicable.includes(c));
    const ixs = idl ? idl.instructions.length : 0;
    const covered = idl ? idl.instructions.filter((i) => seen.get(i.name)?.ok && seen.get(i.name)?.err).length : 0;
    return {
      durationMs: Date.now() - t0,
      transactions: txs,
      paths: [...paths].sort(),
      instructions: idl ? idl.instructions.map((i) => ({ name: i.name, succeeded: Boolean(seen.get(i.name)?.ok), failed: Boolean(seen.get(i.name)?.err) })) : [],
      findings: findings.map(({ key, ...f }) => f),
      leads: leads.map(({ key, ...l }) => l),
      classes: { applicable, tried: triedApplicable },
      depthInput: {
        branchCoverage: 0,
        instructionCoverage: ixs ? covered / ixs : 0,
        classesTried: triedApplicable.length,
        classesApplicable: applicable.length,
        state: idl ? 'synthetic' : 'empty',
        effort: outOfBudget() ? Math.min(1, txs / budget.txs) : 1,
      },
    };
  }
}

/** Which of the 12 attack classes apply to this program, from its IDL. */
export function applicableClasses(idl) {
  if (!idl) return ATTACK_CLASSES.map((c) => c.id);
  const accts = idl.instructions.flatMap((i) => i.accounts);
  const names = accts.map((a) => a.name.toLowerCase());
  const out = new Set(['lamport_draining', 'compute_exhaustion']);
  if (accts.some((a) => a.signer)) out.add('missing_signer');
  if (accts.some((a) => a.role === 'state')) { out.add('missing_owner'); out.add('account_substitution'); }
  if (idl.instructions.some((i) => i.args.some((a) => isNumeric(a.type)))) out.add('arithmetic');
  if (idl.instructions.some((i) => i.accounts.some((a) => a.signer) && i.accounts.some((a) => a.role === 'state' && a.writable))) out.add('reinitialization');
  if (idl.instructions.some((i) => /close/i.test(i.name))) out.add('close_reuse');
  if (accts.some((a) => isProgramSlot(a))) out.add('unchecked_cpi');
  if (names.some((n) => /mint|token/.test(n))) out.add('unchecked_mint');
  if (names.some((n) => /oracle|price|feed/.test(n))) out.add('price_manipulation');
  if (accts.some((a) => a.pda)) out.add('pda_seed');
  return ATTACK_CLASSES.map((c) => c.id).filter((c) => out.has(c));
}

function evidence(result, world) {
  return {
    transaction: result.transaction,
    computeUnits: result.computeUnits,
    logs: result.logs,
    balances: result.changes.map((c) => ({ account: c.label, address: c.address, before: c.before, after: c.after })),
    programId: world.programId,
  };
}

export function fmtSol(lamports) {
  const sol = Number(lamports) / 1e9;
  return `${sol.toLocaleString('en-US', { maximumFractionDigits: 4 })} SOL`;
}

/** Argument combinations for an instruction: typical values, or the extremes. For sequence fuzzing. */
export function combosFor(idl, ix, kind = 'typical') {
  types = idl?.types || new Map();
  return argCombos(ix, (c) => (kind === 'extreme' && c.extreme.length ? c.extreme : c.typical));
}
