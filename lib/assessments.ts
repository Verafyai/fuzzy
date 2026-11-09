/** What Fuzzy checks, how, and where each check comes from. Shared by the home page, Method and report cards. */

export type Source = { label: string; href: string };

const HELIUS = { label: "Helius: A Hitchhiker's Guide to Solana Program Security", href: "https://helius.dev/blog/a-hitchhikers-guide-to-solana-program-security" };
const SEALEVEL = { label: "Sealevel Attacks (Coral, the Anchor team)", href: "https://github.com/coral-xyz/sealevel-attacks" };
const COURSE = (path: string, label: string) => ({ label: `Solana Foundation course: ${label}`, href: `https://solana.com/developers/courses/program-security${path}` });
const CRYTIC = { label: "Trail of Bits solana-lints: missing_signer_check", href: "https://github.com/crytic/solana-lints" };

export type Assessment = {
  id: string;
  name: string;
  built: boolean;
  catches: string;
  how: string;
  proof: string;
  sources: Source[];
};

export const ASSESSMENTS: Assessment[] = [
  {
    id: "missing_signer", name: "Missing signer check", built: true,
    catches: "An instruction that moves funds or changes an authority without checking that the right account signed.",
    how: "For every instruction that worked when the owner called it, Fuzzy calls it again with each required signature dropped, paid for by an attacker, with any payout redirected to the attacker.",
    proof: "SOL reaches the attacker, or the attacker's key replaces the owner's in program state.",
    sources: [SEALEVEL, CRYTIC, HELIUS],
  },
  {
    id: "missing_owner", name: "Missing owner check", built: true,
    catches: "A program that trusts an account's data without checking which program owns the account.",
    how: "Fuzzy passes a copy of each state account owned by a different program, with the same bytes, and checks whether the instruction still accepts it.",
    proof: "The forged account is accepted and funds or authority move to the attacker.",
    sources: [COURSE("/owner-checks", "Owner Checks"), SEALEVEL],
  },
  {
    id: "account_substitution", name: "Account substitution", built: true,
    catches: "A program that accepts any signer or any account in a slot where only one specific account belongs, such as the stored authority.",
    how: "Fuzzy signs as the attacker in the owner's place, and swaps in look-alike accounts the attacker controls.",
    proof: "The attacker, signing as themselves, moves the owner's funds or authority.",
    sources: [SEALEVEL, HELIUS],
  },
  {
    id: "reinitialization", name: "Reinitialization", built: true,
    catches: "An initialize instruction that can run again on an account that is already set up, letting a stranger overwrite its owner.",
    how: "After an honest setup, Fuzzy runs initialize again as a stranger on the same account, then tries to withdraw.",
    proof: "The stranger's key is written in as the authority, or the follow-up withdrawal succeeds.",
    sources: [COURSE("/reinitialization-attacks", "Reinitialization Attacks"), SEALEVEL],
  },
  {
    id: "arithmetic", name: "Arithmetic overflow", built: true,
    catches: "Amounts that wrap around or panic at the edges of their type.",
    how: "Fuzzy sends 0, 1, the maximum and maximum minus one for every numeric argument.",
    proof: "A wrapped amount moves funds to the attacker. A panic alone is a lead.",
    sources: [HELIUS],
  },
  {
    id: "lamport_draining", name: "Lamport draining", built: true,
    catches: "Instructions that let SOL leave an account the caller does not control.",
    how: "Every attack above measures every account's SOL before and after; any path that moves SOL to the attacker counts here too.",
    proof: "The attacker's SOL balance goes up.",
    sources: [HELIUS],
  },
  {
    id: "compute_exhaustion", name: "Compute exhaustion", built: true,
    catches: "Instructions that run out of compute on reachable inputs, which can lock funds.",
    how: "Fuzzy records the compute each call used and flags calls that hit the limit.",
    proof: "Shown as a lead. It never counts toward the score in this engine version.",
    sources: [{ label: "Solana docs: fees and compute budget", href: "https://solana.com/docs/core/fees" }],
  },
  {
    id: "unchecked_cpi", name: "Unchecked CPI target", built: false,
    catches: "A program that calls whatever program ID it is handed.",
    how: "Planned: pass an attacker program in each program slot and watch what it is asked to do.",
    proof: "",
    sources: [COURSE("/arbitrary-cpi", "Arbitrary CPI"), SEALEVEL],
  },
  {
    id: "pda_seed", name: "PDA seed collision", built: false,
    catches: "Program-derived addresses that two users can share, or that accept a non-canonical bump.",
    how: "Planned: derive colliding seeds and non-canonical bumps for each PDA in the IDL.",
    proof: "",
    sources: [SEALEVEL, HELIUS],
  },
  {
    id: "close_reuse", name: "Close, then reuse", built: false,
    catches: "An account closed in one instruction and revived or reused in the same transaction.",
    how: "Planned: close an account, then refund and reuse it in the same transaction.",
    proof: "",
    sources: [SEALEVEL, HELIUS],
  },
  {
    id: "unchecked_mint", name: "Unchecked token owner", built: true,
    catches: "Token accounts accepted without checking who owns them, so tokens meant for one user can be sent to another.",
    how: "In mainnet replay, the attacker signs in the user's place and each of the user's token accounts is swapped, one at a time, for an empty copy the attacker owns.",
    proof: "Tokens land in the attacker-owned copy. It starts empty, so every unit came from someone else.",
    sources: [HELIUS, SEALEVEL],
  },
  {
    id: "price_manipulation", name: "Price manipulation", built: false,
    catches: "Prices read from a pool or oracle an attacker can move in the same transaction.",
    how: "Planned: move the pool or oracle a program reads before calling it.",
    proof: "",
    sources: [HELIUS],
  },
];

export const ASSESSMENT_BY_ID = Object.fromEntries(ASSESSMENTS.map((a) => [a.id, a]));

/** The engine and data Fuzzy runs on. */
export const BUILT_ON: Source[] = [
  { label: "LiteSVM: runs real Solana transactions in-process", href: "https://github.com/LiteSVM/litesvm" },
  { label: "Anchor IDL: how Fuzzy learns a program's instructions", href: "https://www.anchor-lang.com/docs/basics/idl" },
  { label: "Solana RPC: reads the program, its recent calls and their accounts", href: "https://solana.com/docs/rpc" },
  { label: "@solana/kit: transaction building", href: "https://github.com/anza-xyz/kit" },
];

/** Add-ons: checks beyond the Sniff run, each for extra credits. Some run today; the rest need a build machine. */
export type Addon = { id: string; name: string; credits: number; status: "available" | "planned"; needs: string; what: string; source: Source };
export const ADDON_PLAN: Addon[] = [
  { id: "verified", name: "Verified-source check", credits: 25, status: "available", needs: "A deployed mainnet program", what: "Whether the deployed bytecode was rebuilt from public source, and from which repository and commit.", source: { label: "OtterSec verification service (solana-verify)", href: "https://github.com/Ellipsis-Labs/solana-verifiable-build" } },
  { id: "advisories", name: "Dependency advisories", credits: 100, status: "available", needs: "A verified build", what: "Every crate in the verified commit's Cargo.lock checked against the RustSec advisory database.", source: { label: "RustSec advisory database, through OSV", href: "https://rustsec.org" } },
  { id: "rebuild", name: "Rebuild from source", credits: 500, status: "available", needs: "A verified build", what: "Fuzzy clones the verified commit, builds every program in it with cargo-build-sbf, and checks a build matches the deployed bytecode byte for byte.", source: { label: "solana-verify (Ellipsis Labs)", href: "https://github.com/Ellipsis-Labs/solana-verifiable-build" } },
  { id: "lints", name: "Static lints", credits: 300, status: "available", needs: "A verified build", what: "Trail of Bits' Solana lints (through dylint) and Clippy over the verified source.", source: { label: "Trail of Bits solana-lints", href: "https://github.com/crytic/solana-lints" } },
  { id: "deep", name: "Deep Fuzz", credits: 1000, status: "available", needs: "Nothing", what: "Four times the mainnet history and five times the budget of a Sniff run, plus branch coverage: every invocation is traced instruction by instruction in agave-ledger-tool. Required for the Fuzzed level.", source: { label: "LiteSVM", href: "https://github.com/LiteSVM/litesvm" } },
  { id: "property", name: "Property fuzzing", credits: 1500, status: "available", needs: "An IDL", what: "Random call sequences by several users, with invariants derived from the IDL checked after every transaction: authorities change only when they sign, and SOL leaves state only when its authority signs.", source: { label: "Fuzzy property engine", href: "https://github.com/Verafyai/fuzzy/tree/main/worker" } },
  { id: "review", name: "AI design review", credits: 1000, status: "available", needs: "A verified build", what: "Four models from different labs read the source and IDL for design and economic risk; risks two or more raise independently are reported as agreed. Not a human audit.", source: { label: "Verafy Harness juries", href: "https://harness.verafy.ai" } },
  { id: "sink", name: "Kitchen Sink", credits: 4000, status: "available", needs: "A verified build for the source checks", what: "Everything above in one run, for less than the parts. Required for the Hardened level.", source: { label: "Verafy Certification levels", href: "https://fuzzy.verafy.ai/certifications" } },
];

/** Still not automated. */
export const NOT_RUN: { name: string; why: string; source: Source }[] = [
  { name: "A human audit", why: "Design and economic risks need people who understand what the program is for. The AI design review is a first pass, not a substitute.", source: HELIUS },
];

export const STATUS_TEXT: Record<string, string> = {
  "broke it": "Proven: an attack in this class worked.",
  held: "Tried, and every attack in this class failed.",
  "not tried": "Could not run: this class applies, but no call to this program completed in Fuzzy's copy of Solana, so there was no working path to attack from. See Gaps for why.",
  "does not apply": "Nothing in this program's interface this class can target.",
};

export const DEPTH_PARTS: { key: string; name: string; max: number; how: string }[] = [
  { key: "branchCoverage", name: "Branch coverage", max: 40, how: "Share of the program's branches executed. Not measured yet." },
  { key: "instructionCoverage", name: "Instructions driven", max: 20, how: "Share of instructions driven to both success and failure." },
  { key: "attackClasses", name: "Attack classes tried", max: 20, how: "Share of the classes that apply to this program that actually ran." },
  { key: "realState", name: "Real state", max: 10, how: "10 for cloned mainnet accounts, 5 for accounts built from the IDL, 0 for none." },
  { key: "effort", name: "Effort", max: 10, how: "Share of the planned run completed within the time limit." },
];

export const COLUMN_HELP: Record<string, string> = {
  score: "Fuzzy Score, 0 to 100: the lower of Depth (how hard Fuzzy tried) and a cap set by the worst proven finding.",
  run: "Shallow run: nothing was proven, but Depth is under 50, so Fuzzy did not get far enough to say much. It is not a judgment that the program is broken.",
  proven: "Exploits proven by a transaction that moved SOL to the attacker or handed them an authority. Only these count.",
  leads: "Attacks that did something unexpected but did not prove theft. Shown, never scored.",
  tested: "What Fuzzy ran its attacks on: real mainnet accounts cloned from recent calls, accounts built from the program's IDL, or neither.",
  certification: "A Verafy Certification: a jury of registered Verafy harnesses ruled on this build's report and the grade is written on Solana devnet for this exact bytecode. A Hardened, B Fuzzed, C Sniffed (plus or minus by score), I too shallow to grade, F exploit proven. Devnet only; the jurors voted by script.",
  scanned: "When this build was last scanned.",
  source: "Verified means the deployed bytecode was rebuilt from public source at a known commit (OtterSec verification service). Source checks, such as dependency advisories, need a verified build.",
};

export function scoreColor(score: number | undefined, shallow: boolean) {
  if (score === undefined) return "var(--text-3)";
  if (shallow) return "var(--medium)";
  if (score >= 75) return "var(--teal)";
  if (score >= 50) return "var(--medium)";
  if (score >= 25) return "var(--high)";
  return "var(--critical)";
}

export const STATE_LABEL: Record<string, string> = { mainnet: "Mainnet replay", synthetic: "From IDL", empty: "Neither" };
