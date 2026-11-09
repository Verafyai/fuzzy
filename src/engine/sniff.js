// The Sniff engine: learn the program's working paths from its IDL, then attack
// each one in LiteSVM. A finding is kept only when an attack transaction
// actually succeeds and moves funds to the attacker or hands them an authority.
import { candidates, isNumeric } from './borsh.js';
import { makeWorld, send } from './world.js';

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

function honestAccounts(ix) {
  return ix.accounts.map((a) => {
    let label;
    if (a.role === 'fixed') label = `fixed:${a.address}`;
    else if (a.role === 'actor') label = 'actor:owner';
    else if (a.role === 'state') label = `state:${a.stateType.replace(/[_\s-]/g, '').toLowerCase()}`;
    else if (a.role === 'wallet') label = `new:wallet-${a.name}`;
    else label = 'actor:stranger';
    return { name: a.name, role: a.role, label, signer: a.signer, writable: a.writable };
  });
}

/** Swap the owner for the attacker everywhere, and send any payout to the attacker. */
function asAttacker(accounts, { sign = true } = {}) {
  return accounts.map((a) => {
    if (a.label === 'actor:owner') return { ...a, label: 'actor:attacker', signer: sign && a.signer };
    if (a.role === 'wallet') return { ...a, label: 'new:loot' };
    return { ...a };
  });
}

function argCombos(ix, pick) {
  if (ix.args.length === 0) return [[]];
  const lists = ix.args.map((a) => pick(candidates(a.type)));
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
  const t0 = Date.now();
  let txs = 0;
  const paths = new Set();
  const seen = new Map(); // ix -> { ok, err }
  const findings = [];
  const leads = [];
  const tried = new Set();
  const outOfBudget = () => txs >= budget.txs || Date.now() - t0 > budget.ms;

  async function run(prefix, step) {
    const world = await makeWorld({ program, seed, idl });
    for (const p of prefix) { await send(world, p); txs++; }
    const result = await send(world, step);
    txs++;
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
  const steps = [];
  for (let round = 0; round < 3 && !outOfBudget(); round++) {
    let progress = false;
    for (const ix of idl.instructions) {
      if (steps.some((s) => s.ix === ix.name)) continue;
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

  // 2. Attack every working step.
  for (let i = 0; i < steps.length && !outOfBudget(); i++) {
    const prefix = steps.slice(0, i);
    const step = steps[i];
    const ix = idl.instructions.find((x) => x.name === step.ix);

    // Missing signer: every account that should sign, left unsigned, attacker pays.
    const signerIdx = step.accounts.map((a, j) => (a.signer ? j : -1)).filter((j) => j >= 0);
    if (signerIdx.length) {
      tried.add('missing_signer'); tried.add('lamport_draining');
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
      for (const args of argCombos(ix, (c) => (c.extreme.length ? c.extreme : c.typical))) {
        if (outOfBudget()) break;
        const { result } = await run(prefix, { ...step, args });
        if (result.ok && attackerGain(result) > 0n) {
          addLead({ class: 'arithmetic', instruction: step.ix, title: `${step.ix} accepted extreme arguments`, detail: `Arguments ${JSON.stringify(args)} succeeded. Review the math on this path.` });
        }
      }
    }
  }

  // 3. Fill the rest of the budget with mixed calls, for coverage of error paths.
  tried.add('compute_exhaustion');
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
    return result.ok && result.changes.some((c) => c.label.startsWith('state:') && c.dataChanged);
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
  if (names.some((n) => /program$/.test(n) && !/^system_?program$/.test(n))) out.add('unchecked_cpi');
  if (names.some((n) => /mint|token/.test(n))) out.add('unchecked_mint');
  if (names.some((n) => /oracle|price|pool|feed/.test(n))) out.add('price_manipulation');
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
