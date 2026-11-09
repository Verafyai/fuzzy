// One Fuzzy run, from program bytes to a scored report.
import { readIdl } from './idl.js';
import { runSniff, ATTACK_CLASSES } from './sniff.js';
import { elfInfo, sha256Hex } from './ingest.js';
import { fuzzyScore, SCORE_VERSION } from '../score.js';

export const REPORT_VERSION = 'fuzzy-report/1';
export const ENGINE_VERSION = 'fuzzy-engine/0.1.0';

export const TIERS = {
  sniff: { name: 'Sniff', credits: 100, budget: { txs: 600, ms: 40_000 } },
};

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

export async function fuzz({ program, idl: rawIdl = null, name, source = {}, tier = 'sniff', seed, onEvent }) {
  const t = TIERS[tier];
  if (!t) throw new Error(`tier ${tier} is not available yet`);
  const elf = elfInfo(program);
  const hash = sha256Hex(program);
  const idl = rawIdl ? readIdl(rawIdl) : null;
  const raw = await runSniff({ program, idl, seed: seed || hash.slice(0, 16), budget: t.budget, onEvent });
  const findings = raw.findings
    .map((f) => ({ ...f, proven: true }))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const score = fuzzyScore({
    depth: raw.depthInput,
    findings: [...findings.map((f) => ({ severity: f.severity, proven: true })), ...raw.leads.map(() => ({ severity: 'low', proven: false }))],
  });
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
    leads: raw.leads,
    tested: {
      durationMs: raw.durationMs,
      transactions: raw.transactions,
      paths: raw.paths.length,
      instructions: raw.instructions,
      classes: ATTACK_CLASSES.map((c) => ({
        id: c.id,
        name: classNames[c.id],
        status: raw.classes.tried.includes(c.id) ? (findings.some((f) => f.class === c.id) ? 'broke it' : 'held') : raw.classes.applicable.includes(c.id) ? 'not tried' : 'does not apply',
      })),
      state: raw.depthInput.state,
      branchCoverage: 'not measured in this engine version',
    },
    notes: [
      'Every finding was reproduced in LiteSVM with the transaction attached. Leads were tried and did not break anything; they never count toward the score.',
      'Branch coverage is not measured yet, so it adds 0 of 40 to Depth. With synthetic accounts, that caps any score from this engine version at 55.',
      'Accounts are synthetic, built from the IDL. Cloned mainnet state arrives with Deep Fuzz.',
    ],
  };
}
