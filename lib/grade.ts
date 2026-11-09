/**
 * Certification grades. Every record verafy_certification writes is a certification, and its grade is
 * derived from two bytes already on chain: the jury's level and the Fuzzy Score.
 *   Letter: Hardened (3) = A, Fuzzed (2) = B, Sniffed (1) = C.
 *   Plus or minus: where the score sits within that level's range.
 *   Level 0: F when an exploit was proven, I (Incomplete) when the run was too shallow to grade.
 */
export type Cert = { level?: number; levelName?: string; score?: number };

const TIERS: Record<number, { letter: string; minus: number; plus: number }> = {
  1: { letter: "C", minus: 47, plus: 54 }, // Sniffed: score 40 to 60
  2: { letter: "B", minus: 70, plus: 85 }, // Fuzzed
  3: { letter: "A", minus: 95, plus: 98 }, // Hardened: score 90 or more
};

export function certLevel(c?: Cert | null) {
  if (!c) return 0;
  return c.level ?? (c.levelName === "Not certified" ? 0 : 1);
}

export function gradeFor(c: Cert | null | undefined, proven = 0): { grade: string; meaning: string; tone: "pass" | "fail" | "incomplete" } {
  const level = certLevel(c);
  if (!level) {
    return proven > 0
      ? { grade: "F", meaning: "Exploit proven", tone: "fail" }
      : { grade: "I", meaning: "Incomplete: too shallow to grade", tone: "incomplete" };
  }
  const t = TIERS[level] || TIERS[1];
  const s = c?.score ?? 0;
  const mod = s >= t.plus ? "+" : s < t.minus ? "-" : "";
  return { grade: `${t.letter}${mod}`, meaning: `${c?.levelName || "Sniffed"}, score ${s}`, tone: "pass" };
}

export const GRADE_SCALE: [string, string][] = [
  ["A", "Hardened: survived the Kitchen Sink run, score 90 or more"],
  ["B", "Fuzzed: survived a Deep Fuzz run on cloned mainnet state"],
  ["C", "Sniffed: survived a Sniff run that reached Depth 40"],
  ["I", "Incomplete: the run was too shallow to grade"],
  ["F", "An exploit was proven"],
];
