"use client";

import { useMemo, useState } from "react";

export type RegistryRow = {
  rank: number;
  name: string;
  category: string;
  address: string;
  status: "scanned" | "not scanned";
  reason?: string;
  score?: number;
  depth?: number;
  grade?: string;
  proven?: number;
  leads?: number;
  state?: string;
  replayedCalls?: number;
  idl?: boolean;
  upgradeable?: boolean | null;
  bytecodeSha256?: string;
  scannedAt?: string;
  certification: string;
};

const STATE: Record<string, string> = { mainnet: "Mainnet replay", synthetic: "From IDL", empty: "No IDL or history" };
type Sort = "rank" | "score" | "name";

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export function Registry({ rows }: { rows: RegistryRow[] }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [sort, setSort] = useState<Sort>("rank");
  const cats = useMemo(() => ["All", ...Array.from(new Set(rows.map((r) => r.category))).sort()], [rows]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = rows.filter((r) => (cat === "All" || r.category === cat) && (!needle || r.name.toLowerCase().includes(needle) || r.address.toLowerCase().includes(needle)));
    return [...list].sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "score" ? (b.score ?? -1) - (a.score ?? -1) : a.rank - b.rank);
  }, [rows, q, cat, sort]);

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 10 }}>
        <input className="input" style={{ flex: "1 1 260px" }} placeholder="Search by name or address" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search programs" />
        <select className="input" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">{cats.map((c) => <option key={c}>{c}</option>)}</select>
        <select className="input" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
          <option value="rank">Most used first</option>
          <option value="score">Highest score first</option>
          <option value="name">Name</option>
        </select>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>{shown.length} of {rows.length} programs</p>
      <div className="tablewrap">
        <table className="data registry">
          <thead>
            <tr><th>#</th><th>Program</th><th>Category</th><th style={{ textAlign: "right" }}>Score</th><th>Run</th><th style={{ textAlign: "right" }}>Proven</th><th style={{ textAlign: "right" }}>Leads</th><th>Tested on</th><th>Certification</th></tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.address}>
                <td className="mono muted">{r.rank}</td>
                <td>
                  <div>{r.name}</div>
                  <a className="mono" style={{ fontSize: 12 }} href={`https://explorer.solana.com/address/${r.address}`} title={r.address}>{short(r.address)}</a>
                </td>
                <td className="muted">{r.category}</td>
                {r.status === "scanned" ? (
                  <>
                    <td className="mono" style={{ textAlign: "right", fontSize: 16, color: "var(--text)" }}>{r.score}</td>
                    <td className="muted">{r.grade}</td>
                    <td className="mono" style={{ textAlign: "right" }}>{r.proven ? <span style={{ color: "var(--critical)" }}>{r.proven}</span> : 0}</td>
                    <td className="mono muted" style={{ textAlign: "right" }}>{r.leads}</td>
                    <td className="muted">{STATE[r.state || "empty"]}</td>
                  </>
                ) : (
                  <td colSpan={5} className="muted">Not scanned: {r.reason}</td>
                )}
                <td className="muted">{r.certification}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
