import { createHash } from 'node:crypto';
import { setRecorder } from './record.js';
// One Fuzzy run, from program bytes to a scored report.
import { readIdl } from './idl.js';
import { runSniff, ATTACK_CLASSES, applicableClasses } from './sniff.js';
import { fetchHistory, runHistory } from './history.js';
import { RPC } from './ingest.js';
import { elfInfo, sha256Hex } from './ingest.js';
import { fuzzyScore, SCORE_VERSION } from '../score.js';

export const REPORT_VERSION = 'fuzzy-report/1';
export const ENGINE_VERSION = 'fuzzy-engine/0.3.0';

export const TIERS = {
  sniff: { name: 'Sniff', credits: 100, budget: { txs: 600, ms: 40_000 }, historyLimit: 10 },
  // Deep Fuzz runs on the build machine: four times the history, five times the budget, and branch coverage.
  deep: { name: 'Deep Fuzz', credits: 1000, budget: { txs: 3000, ms: 180_000 }, historyLimit: 40 },
};

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

export async function fuzz({ program, idl: rawIdl = null, name, source = {}, tier = 'sniff', seed, onEvent = () => {}, rpcUrl, measureCoverage }) {
  const t = TIERS[tier];
  if (!t) throw new Error(`tier ${tier} is not available yet`);
  const elf = elfInfo(program);
  const hash = sha256Hex(program);
  const idl = rawIdl ? readIdl(rawIdl) : null;
  const runSeed = seed || hash.slice(0, 16);
  const t0 = Date.now();
  onEvent({ type: 'phase', id: 'ingest', text: `Read the program: ${elf.sbfInstructions.toLocaleString("en-US")} machine instructions, sha256 ${hash.slice(0, 12)}…, ${idl ? `IDL with ${idl.instructions.length} instructions` : 'no IDL'}`, budget: { txs: t.budget.txs, ms: t.budget.ms } });
  // With a coverage measurer (Deep Fuzz), record every invocation's inputs to trace afterwards.
  const invocations = [];
  const seenInvocations = new Set();
  if (measureCoverage) {
    setRecorder((input) => {
      if (invocations.length >= 120) return; // about 0.7 s each to trace
      const key = createHash('sha256').update(JSON.stringify([input.instruction_data, input.accounts.map((a) => [a.key, a.is_signer, a.data.length])])).digest('hex');
      if (seenInvocations.has(key)) return;
      seenInvocations.add(key);
      invocations.push(input);
    });
  }

  // A deployed program: replay its recent mainnet calls on cloned state first.
  let hist = null;
  if (source.address) {
    try {
      const url = rpcUrl || RPC[source.network || 'mainnet'];
      onEvent({ type: 'phase', id: 'replay', text: 'Fetching recent mainnet calls and the accounts they touched' });
      const history = await fetchHistory(source.address, { rpcUrl: url, onEvent, limit: t.historyLimit || 10 });
      if (history.calls.length) {
        hist = await runHistory({ program, programId: source.address, history, idl, seed: runSeed, budget: { txs: Math.floor(t.budget.txs / 2), ms: Math.floor(t.budget.ms / 2) }, onEvent });
        hist.slot = history.slot;
      }
    } catch (error) {
      onEvent({ type: 'note', text: `Could not replay mainnet history: ${error.message}` });
    }
  }
  const remainingMs = Math.max(5_000, t.budget.ms - (Date.now() - t0));
  const raw = idl || !hist ? await runSniff({ program, idl, seed: runSeed, budget: { txs: t.budget.txs, ms: remainingMs }, onEvent }) : null;

  onEvent({ type: 'phase', id: 'grade', text: 'Scoring the run' });
  const seenKeys = new Set();
  const findings = [...(hist?.findings || []), ...(raw?.findings || [])]
    .filter((f) => { const key = `${f.class}|${f.instruction}|${f.account || ''}`; if (seenKeys.has(key)) return false; seenKeys.add(key); return true; })
    .map((f, i) => ({ ...f, id: `F${i + 1}`, proven: true }))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const leads = [...(hist?.leads || []), ...(raw?.leads || [])];

  const triedAll = new Set([...(hist ? [...hist.tried] : []), ...(raw ? raw.classes.tried : [])]);
  // A class applies if the IDL says so, or if replay found something to attack with it (an oracle read, say).
  const applicable = [...new Set([...applicableClasses(idl), ...triedAll])];
  const tried = applicable.filter((c) => triedAll.has(c));
  const histIx = hist?.instructions || [];
  const sniffIx = raw?.instructions || [];
  const coverage = (list) => (list.length ? list.filter((i) => i.succeeded && i.failed).length / list.length : 0);
  const useHist = coverage(histIx) >= coverage(sniffIx) && histIx.length > 0;
  const instructions = useHist ? histIx : sniffIx;
  const state = hist && histIx.some((i) => i.succeeded) ? 'mainnet' : idl ? 'synthetic' : 'empty';
  const outOfBudget = (hist?.outOfBudget || false) || (raw ? raw.depthInput.effort < 1 : false);
  let branch = null;
  if (measureCoverage) {
    setRecorder(null);
    try {
      onEvent({ type: 'note', text: `Tracing ${invocations.length} invocations for branch coverage.` });
      branch = await measureCoverage(program, invocations);
    } catch (error) {
      onEvent({ type: 'note', text: `Branch coverage could not be measured: ${error.message}` });
    }
  }
  const depthInput = {
    branchCoverage: branch ? branch.branchCoverage : 0,
    instructionCoverage: coverage(instructions),
    classesTried: tried.length,
    classesApplicable: applicable.length,
    state,
    effort: outOfBudget ? 0.5 : 1,
  };
  const score = fuzzyScore({
    depth: depthInput,
    findings: [...findings.map((f) => ({ severity: f.severity, proven: true })), ...leads.map(() => ({ severity: 'low', proven: false }))],
  });
  const transactions = (hist?.txs || 0) + (raw?.transactions || 0);
  const classNames = Object.fromEntries(ATTACK_CLASSES.map((c) => [c.id, c.name]));
  return {
    version: REPORT_VERSION,
    engine: ENGINE_VERSION,
    scoreVersion: SCORE_VERSION,
    createdAt: new Date().toISOString(),
    tier: { id: tier, name: t.name, credits: t.credits },
    program: {
      name: name || idl?.name || 'program',
      sha256: hash,
      ...elf,
      idl: Boolean(idl),
      instructions: idl ? idl.instructions.length : null,
      ...source,
    },
    score,
    findings,
    leads,
    tested: {
      durationMs: Date.now() - t0,
      transactions,
      paths: raw ? raw.paths.length : null,
      instructions,
      history: hist ? { replayedFromSlot: hist.slot, calls: hist.instructions.length } : null,
      classes: ATTACK_CLASSES.map((c) => ({
        id: c.id,
        name: classNames[c.id],
        status: tried.includes(c.id) ? (findings.some((f) => f.class === c.id) ? 'broke it' : 'held') : applicable.includes(c.id) ? 'not tried' : 'does not apply',
      })),
      state,
      branchCoverage: branch || 'not measured in this tier',
    },
    notes: [
      'Every finding was reproduced in LiteSVM with the transaction attached. Leads were tried and did not break anything; they never count toward the score.',
      branch ? `Branch coverage: ${branch.branchesTaken} of ${branch.branches} branch outcomes (${Math.round(branch.branchCoverage * 100)}%), measured by tracing ${branch.invocationsTraced} invocations in agave-ledger-tool. Execution past a cross-program call is not traced, so this is a floor.` : 'Branch coverage is not measured in a Sniff run, so it adds 0 of 40 to Depth. Deep Fuzz measures it.',
      state === 'mainnet' ? 'Attacks ran against cloned copies of the mainnet accounts that recent calls touched. Nothing was sent to mainnet.' : 'Accounts are synthetic, built from the IDL.',
      state === 'mainnet' ? 'Theft is measured in SOL and, for replayed calls, in SPL tokens: tokens that reach an empty account the attacker owns count as taken.' : 'Theft is measured in SOL. Token balances are part of the proof only in mainnet replay, so token-only exploits in IDL-built runs show up as leads at most.',
    ],
  };
}
