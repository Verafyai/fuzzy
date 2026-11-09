// Fuzzy Score v1. Reference implementation of the scoring system in SPEC.md.
// Zero dependencies, Node 22. The score is the lower of the Depth score and the
// ceiling set by the worst proven finding. Leads (findings not reproduced in
// LiteSVM) never affect the score.

export const SCORE_VERSION = 'fuzzy-score/1';

export const WEIGHTS = Object.freeze({
  branchCoverage: 40,
  instructionCoverage: 20,
  attackClasses: 20,
  realState: 10,
  effort: 10,
});

export const CEILINGS = Object.freeze({
  critical: 20,
  high: 45,
  medium: 70,
  low: 90,
});

export const STATE_CREDIT = Object.freeze({
  mainnet: 1,
  synthetic: 0.5,
  empty: 0,
});

export const GRADES = Object.freeze([
  { min: 90, name: 'Hardened', mood: 'hardened' },
  { min: 75, name: 'Solid', mood: 'waiting' },
  { min: 50, name: 'Shaky', mood: 'waiting' },
  { min: 25, name: 'Exposed', mood: 'found' },
  { min: 0, name: 'Broken', mood: 'broken' },
]);

const clamp01 = (x) => {
  if (typeof x !== 'number' || Number.isNaN(x)) throw new TypeError('expected a number');
  return Math.min(1, Math.max(0, x));
};

/**
 * Depth: how hard Fuzzy tried, 0 to 100.
 * @param {object} d
 * @param {number} d.branchCoverage share of sBPF branches executed, 0..1
 * @param {number} d.instructionCoverage share of instructions driven to success and their error paths, 0..1
 * @param {number} d.classesTried attack classes the model actually ran attacks for
 * @param {number} d.classesApplicable attack classes that apply to this program (of 12)
 * @param {'mainnet'|'synthetic'|'empty'} d.state the account state the attacks ran against
 * @param {number} d.effort run time and transactions executed against the tier's budget, 0..1
 */
export function depth(d) {
  if (!(d.state in STATE_CREDIT)) throw new RangeError(`unknown state: ${d.state}`);
  const applicable = d.classesApplicable;
  if (!Number.isInteger(applicable) || applicable < 0 || applicable > 12) throw new RangeError('classesApplicable must be 0..12');
  if (!Number.isInteger(d.classesTried) || d.classesTried < 0 || d.classesTried > applicable) throw new RangeError('classesTried must be 0..classesApplicable');
  const classShare = applicable === 0 ? 1 : d.classesTried / applicable;
  const parts = {
    branchCoverage: Math.round(WEIGHTS.branchCoverage * clamp01(d.branchCoverage)),
    instructionCoverage: Math.round(WEIGHTS.instructionCoverage * clamp01(d.instructionCoverage)),
    attackClasses: Math.round(WEIGHTS.attackClasses * classShare),
    realState: Math.round(WEIGHTS.realState * STATE_CREDIT[d.state]),
    effort: Math.round(WEIGHTS.effort * clamp01(d.effort)),
  };
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  return { total, parts };
}

/** The ceiling set by the worst proven finding; 100 when nothing is proven. */
export function ceiling(findings = []) {
  let cap = 100;
  let worst = null;
  for (const f of findings) {
    if (!f.proven) continue;
    const c = CEILINGS[f.severity];
    if (c === undefined) throw new RangeError(`unknown severity: ${f.severity}`);
    if (c < cap) { cap = c; worst = f.severity; }
  }
  return { cap, worst };
}

export function grade(score) {
  return GRADES.find((g) => score >= g.min);
}

/**
 * The Fuzzy Score for one run.
 * @param {object} run
 * @param {object} run.depth input to depth()
 * @param {{severity: string, proven: boolean}[]} run.findings proven findings and leads
 */
export function fuzzyScore(run) {
  const d = depth(run.depth);
  const c = ceiling(run.findings);
  const score = Math.min(d.total, c.cap);
  const g = grade(score);
  return {
    version: SCORE_VERSION,
    score,
    grade: g.name,
    mood: g.mood,
    depth: d.total,
    depthParts: d.parts,
    ceiling: c.cap,
    cappedBy: score < d.total ? c.worst : null,
    proven: (run.findings || []).filter((f) => f.proven).length,
    leads: (run.findings || []).filter((f) => !f.proven).length,
  };
}
