"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Info } from "@/components/fuzzy/info";
import { COLUMN_HELP, STATE_LABEL, scoreColor } from "@/lib/assessments";

export type RegistryRow = {
  rank: number;
  name: string;
  category: string;
  address: string;
  description?: string;
  status: "scanned" | "not scanned";
  reason?: string;
  score?: number;
  depth?: number;
  grade?: string;
  proven?: number;
  leads?: number;
  state?: string;
  idl?: boolean;
  scannedAt?: string;
  certification: string;
  devnetCertification?: { level?: number; levelName: string; certification: string };
  verifiedBuild?: boolean;
};


type Sort = "rank" | "score" | "name";
type View = "cards" | "table";

export const shortDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export function Registry({ rows }: { rows: RegistryRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [sort, setSort] = useState<Sort>("rank");
  const [view, setView] = useState<View>("cards");
  const [certOnly, setCertOnly] = useState(false);
  useEffect(() => {
    try { const v = localStorage.getItem("fuzzy-view"); if (v === "table" || v === "cards") setView(v); } catch {}
  }, []);
  const pick = (v: View) => { setView(v); try { localStorage.setItem("fuzzy-view", v); } catch {} };
  const cats = useMemo(() => ["All", ...Array.from(new Set(rows.map((r) => r.category))).sort()], [rows]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = rows.filter((r) => (cat === "All" || r.category === cat) && (!certOnly || (r.devnetCertification?.level ?? 1) > 0 && r.devnetCertification) && (!needle || r.name.toLowerCase().includes(needle) || r.address.toLowerCase().includes(needle)));
    return [...list].sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : sort === "score" ? (b.score ?? -1) - (a.score ?? -1) : a.rank - b.rank));
  }, [rows, q, cat, sort, certOnly]);
  const href = (r: RegistryRow) => `/programs/${r.address}`;

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 10 }}>
        <input className="input" style={{ flex: "1 1 240px" }} placeholder="Search by name or address" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search programs" />
        <select className="input" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">{cats.map((c) => <option key={c}>{c}</option>)}</select>
        <select className="input" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
          <option value="rank">Most used first</option>
          <option value="score">Highest score first</option>
          <option value="name">Name</option>
        </select>
        <div className="seg" role="group" aria-label="View">
          <button type="button" aria-pressed={view === "cards"} onClick={() => pick("cards")}>Cards</button>
          <button type="button" aria-pressed={view === "table"} onClick={() => pick("table")}>Table</button>
        </div>
      </div>
      <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
        <p className="muted" style={{ fontSize: 13 }}>{shown.length} of {rows.length} programs</p>
        <label className="muted" style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={certOnly} onChange={(e) => setCertOnly(e.target.checked)} /> Devnet certified only
        </label>
      </div>

      {view === "cards" ? (
        <div className="cards">
          {shown.map((r) => {
            const shallow = r.grade === "Shallow run";
            return (
              <a key={r.address} className="pcard" href={href(r)}>
                <div className="top">
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{r.name}</div>
                    <div className="mono muted" style={{ fontSize: 12 }}>{short(r.address)} · {r.category}</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div className="big" style={{ color: scoreColor(r.score, shallow) }}>{r.score ?? "-"}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{r.grade}</div>
                  </div>
                </div>
                <div className="stats">
                  <span><b style={{ color: r.proven ? "var(--critical)" : undefined }}>{r.proven ?? "-"}</b>proven</span>
                  <span><b>{r.leads ?? "-"}</b>leads</span>
                  <span><b>{r.depth ?? "-"}</b>depth</span>
                </div>
                <div className="row" style={{ justifyContent: "space-between", gap: 6 }}>
                  <span className="row" style={{ gap: 6 }}>
                    {r.devnetCertification && (r.devnetCertification.level ?? 1) > 0 ? <span className="tag tag-cert">Devnet cert: {r.devnetCertification.levelName}</span> : <span className="tag">{r.devnetCertification ? "On chain: not certified" : "Not certified"}</span>}
                    {r.verifiedBuild ? <span className="tag" style={{ color: "var(--teal)" }}>Verified source</span> : null}
                  </span>
                  <span className="muted" style={{ fontSize: 12 }}>{STATE_LABEL[r.state || "empty"]} · {shortDate(r.scannedAt)}</span>
                </div>
              </a>
            );
          })}
        </div>
      ) : (
        <div className="tablewrap">
          <table className="data registry">
            <thead>
              <tr>
                <th>#</th>
                <th>Program</th>
                <th>Category</th>
                <th>Score<Info text={COLUMN_HELP.score} /></th>
                <th>Run<Info text={COLUMN_HELP.run} /></th>
                <th>Proven<Info text={COLUMN_HELP.proven} /></th>
                <th>Leads<Info text={COLUMN_HELP.leads} /></th>
                <th>Tested on<Info text={COLUMN_HELP.tested} /></th>
                <th>Source<Info text={COLUMN_HELP.source} /></th>
                <th>Scanned<Info text={COLUMN_HELP.scanned} /></th>
                <th>Certification<Info text={COLUMN_HELP.certification} /></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const shallow = r.grade === "Shallow run";
                return (
                  <tr key={r.address} onClick={() => router.push(href(r))}>
                    <td className="mono muted c">{r.rank}</td>
                    <td>
                      <a href={href(r)} style={{ color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>{r.name}</a>
                      <div className="mono muted" style={{ fontSize: 12 }}>{short(r.address)}</div>
                    </td>
                    <td className="muted">{r.category}</td>
                    <td className="c"><span className="score-num" style={{ color: scoreColor(r.score, shallow) }}>{r.score ?? "-"}</span></td>
                    <td className="c muted">{r.grade}</td>
                    <td className="c mono" style={{ color: r.proven ? "var(--critical)" : undefined }}>{r.proven ?? "-"}</td>
                    <td className="c mono muted">{r.leads ?? "-"}</td>
                    <td className="c muted">{STATE_LABEL[r.state || "empty"]}</td>
                    <td className="c">{r.verifiedBuild ? <span className="status" style={{ color: "var(--teal)" }}>verified</span> : <span className="muted">not verified</span>}</td>
                    <td className="c muted">{shortDate(r.scannedAt)}</td>
                    <td className="c">{r.devnetCertification && (r.devnetCertification.level ?? 1) > 0 ? <span className="tag tag-cert">Devnet: {r.devnetCertification.levelName}</span> : <span className="muted">{r.devnetCertification ? "On chain: not certified" : "Not certified"}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted" style={{ fontSize: 13 }}>
        <b style={{ color: "var(--text-2)" }}>Shallow run</b> means nothing was proven but Fuzzy did not get far (Depth under 50), usually because the program publishes no IDL and had no recent calls to replay. It is not a judgment that the program is broken.
      </p>
    </div>
  );
}
