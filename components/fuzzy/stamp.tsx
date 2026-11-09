import { gradeFor, type Cert } from "@/lib/grade";

const W = 30;
const fit = (s: string) => (s.length > W ? `${s.slice(0, W - 3)}...` : s.padEnd(W));
const line = (s: string) => `| ${fit(s)} |`;

/** A rubber stamp in ASCII for one on-chain certification. */
export function Stamp({ cert, name, proven = 0, size = "full", pending = false }: { cert: Cert & { bytecodeHash?: string; certifiedAt?: string }; name: string; proven?: number; size?: "full" | "mini" | "tag"; pending?: boolean }) {
  const g = gradeFor(cert, proven);
  const color = g.tone === "pass" ? "var(--teal)" : g.tone === "fail" ? "var(--critical)" : "var(--medium)";
  const rule = `+${"-".repeat(W + 2)}+`;
  const text = size === "tag"
    ? `[ ${g.grade} ]`
    : size === "mini"
    ? [`+${"-".repeat(14)}+`, `| VERAFY  ${g.grade.padEnd(3)}  |`, `| devnet cert  |`, `+${"-".repeat(14)}+`].join("\n")
    : [
        rule,
        line(`${pending ? "PROJECTED GRADE       " : "VERAFY CERTIFICATION  "} ${g.grade.padStart(2)}`),
        line(g.meaning),
        line(""),
        line(name),
        line(`build ${cert.bytecodeHash ? cert.bytecodeHash.slice(0, 16) : "unknown"}`),
        line(pending ? "awaiting a Verafy jury" : `Solana devnet  ${cert.certifiedAt ? cert.certifiedAt.slice(0, 10) : ""}`),
        rule,
      ].join("\n");
  return (
    <pre className={`stamp stamp-${size}`} style={{ color, opacity: pending ? 0.75 : undefined }} aria-label={`${pending ? "Projected" : "Verafy certification"} grade ${g.grade}: ${g.meaning}`}>{text}</pre>
  );
}
