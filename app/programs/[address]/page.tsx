import type { Metadata } from "next";
import { notFound } from "next/navigation";
import registry from "@/data/registry.json";
import { Info } from "@/components/fuzzy/info";
import { Stamp } from "@/components/fuzzy/stamp";
import { certLevel as levelOf, gradeFor } from "@/lib/grade";
import { ASSESSMENT_BY_ID, COLUMN_HELP, DEPTH_PARTS, STATUS_TEXT, scoreColor } from "@/lib/assessments";
import { JobResults } from "@/components/fuzzy/build-machine";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = any;
const rows: Row[] = (registry.programs as Row[]).filter(Boolean);
const find = (address: string) => rows.find((r) => r.address === address);

export const dynamicParams = false;
export function generateStaticParams() {
  return rows.map((r) => ({ address: r.address }));
}

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const r = find((await params).address);
  if (!r) return {};
  return { title: `${r.name} report card | Fuzzy`, description: `Fuzzy report card for ${r.name} (${r.address}): score ${r.score}, ${r.proven} proven findings, ${r.leads} leads.` };
}

const mainnet = (a: string) => `https://explorer.solana.com/address/${a}`;
const devnet = (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`;
const devnetTx = (s: string) => `https://explorer.solana.com/tx/${s}?cluster=devnet`;
const date = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });
const STATUS_COLOR: Record<string, string> = { "broke it": "var(--critical)", held: "var(--teal)", "not tried": "var(--medium)", "does not apply": "var(--text-3)" };

export default async function ProgramPage({ params }: { params: Promise<{ address: string }> }) {
  const r = find((await params).address);
  if (!r) notFound();
  const shallow = r.grade === "Shallow run";
  const cert = r.devnetCertification;
  const certLevel = levelOf(cert);
  const tried = (r.classes || []).filter((c: any) => c.status === "held" || c.status === "broke it").length;

  return (
    <main className="page stack" style={{ gap: 32, maxWidth: 980 }}>
      <p className="muted" style={{ fontSize: 14 }}><a href="/certifications">Registry</a> / {r.name}</p>

      <section className="row" style={{ gap: 24, alignItems: "flex-start" }}>
        <div className="stack" style={{ gap: 10, flex: "1 1 520px" }}>
          <p className="mono" style={{ color: "var(--teal)", fontSize: 14 }}>Report card · {r.category}</p>
          <h1 style={{ fontSize: "clamp(28px, 4vw, 40px)" }}>{r.name}</h1>
          <p className="quiet" style={{ fontSize: 17 }}>{r.description}</p>
          <p className="mono muted" style={{ fontSize: 13, overflowWrap: "anywhere" }}>{r.address}</p>
          <div className="row" style={{ gap: 10 }}>
            <a className="btn btn-primary" href={`https://explorer.verafy.ai/program/${r.address}`}>Verafy Explorer</a>
            <a className="btn btn-quiet" href={mainnet(r.address)}>Solana Explorer</a>
            <a className="btn btn-quiet" href={`https://solscan.io/account/${r.address}`}>Solscan</a>
            {r.site ? <a className="btn btn-quiet" href={r.site}>Project site</a> : null}
          </div>
        </div>
        <div className="panel stack" style={{ gap: 6, flex: "0 1 260px", alignItems: "center", textAlign: "center" }}>
          <span className="muted" style={{ fontSize: 13 }}>Fuzzy Score<Info text={COLUMN_HELP.score} /></span>
          <span style={{ font: "700 64px/1 var(--mono)", color: scoreColor(r.score, shallow) }}>{r.score}</span>
          <span style={{ fontWeight: 600 }}>{r.grade}{shallow ? <Info text={COLUMN_HELP.run} /> : null}</span>
          <span className="muted" style={{ fontSize: 13 }}>Depth {r.depth} · cap {r.ceiling}</span>
          <span className="muted" style={{ fontSize: 13 }}>Scanned {date(r.scannedAt)}</span>
        </div>
      </section>

      <section className="panel stack" style={{ gap: 14 }}>
        <h2>Certification<Info text={COLUMN_HELP.certification} /></h2>
        {cert ? (
          <>
            <div className="row" style={{ gap: 24, alignItems: "flex-start" }}>
              <Stamp cert={cert} name={r.name} proven={r.proven} />
              <p className="quiet" style={{ fontSize: 15, flex: "1 1 320px" }}>
                Grade <b style={{ color: "var(--text)" }}>{gradeFor(cert, r.proven).grade}</b>. A jury of {cert.jurors} registered Verafy harnesses from {cert.families} model families ruled on this build&apos;s {cert.tier || "Sniff"} report, and verafy_certification wrote it on Solana devnet on {date(cert.certifiedAt)}. Devnet only, and the jurors voted by script.{" "}
                {certLevel === 0 ? (r.proven ? "F means an exploit was proven." : "I means the run was too shallow to grade. It is not a judgment that the program is broken.") : null}
              </p>
            </div>
            <dl className="kv">
              <dt>Certification account</dt><dd><a className="mono" href={devnet(cert.certification)}>{cert.certification}</a></dd>
              <dt>Jury ruling</dt><dd><a className="mono" href={devnet(cert.ruling)}>{cert.ruling}</a></dd>
              <dt>Certify transaction</dt><dd><a className="mono" href={devnetTx(cert.certifySignature)}>{cert.certifySignature.slice(0, 32)}…</a></dd>
              <dt>Bytecode hash</dt><dd className="mono">{cert.bytecodeHash}</dd>
              <dt>Report hash</dt><dd className="mono">{cert.reportHash}</dd>
              {cert.record ? <><dt>Verdict record</dt><dd><a className="mono" href={devnet(cert.record)}>{cert.record}</a> <span className="muted">(verdict {cert.records} for this build)</span></dd></> : null}
              {cert.supersedes ? <><dt>Supersedes</dt><dd><a className="mono" href={devnet(cert.supersedes)}>{cert.supersedes}</a></dd></> : null}
            </dl>
            <p className="quiet" style={{ fontSize: 14 }}>Every verdict is kept on chain as its own record. When a newer verdict replaces one for the same build, the old record points to it, so a receipt for an earlier verdict leads here.</p>
            {cert.history?.length ? (
              <div className="stack" style={{ gap: 6 }}>
                <h3>Earlier certifications</h3>
                <ul className="list quiet" style={{ fontSize: 14 }}>{cert.history.map((h: any) => <li key={h.ruling}>Grade {gradeFor(h).grade}, {date(h.certifiedAt)}: <a className="mono" href={devnet(h.ruling)}>{h.ruling.slice(0, 10)}…</a> (replaced {date(h.replacedAt)}{h.record ? "" : ", before verdict records"})</li>)}</ul>
              </div>
            ) : null}
          </>
        ) : (
          <p className="quiet" style={{ fontSize: 15 }}>Not certified yet. This build has no certification on chain.</p>
        )}
      </section>

      <section className="stack" style={{ gap: 12 }}>
        <h2>What ran</h2>
        <p className="quiet">
          {r.tier || "Sniff"} run: {r.transactions} transactions in {Math.round((r.durationMs || 0) / 1000)} seconds, {tried} attack {tried === 1 ? "class" : "classes"} run {r.state === "mainnet" ? "on cloned mainnet accounts" : r.state === "synthetic" ? "on accounts built from the IDL" : "with no accounts to test on"}{r.state === "mainnet" && r.replayedFromSlot ? ` (accounts cloned at slot ${r.replayedFromSlot})` : ""}. Nothing was sent to mainnet or devnet. <a href="/docs/method">How a run works</a>
        </p>
        <div className="tablewrap">
          <table className="data">
            <thead><tr><th>Assessment</th><th style={{ textAlign: "center" }}>Result</th><th>What it means here</th><th>Based on</th></tr></thead>
            <tbody>
              {(r.classes || []).map((c: any) => {
                const a = ASSESSMENT_BY_ID[c.id];
                const built = a?.built;
                const status = !built && c.status !== "does not apply" ? "not built yet" : c.status;
                return (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td style={{ textAlign: "center" }}><span className="status" style={{ color: STATUS_COLOR[status] || "var(--text-3)" }}>{status}</span></td>
                    <td className="quiet" style={{ fontSize: 13 }}>{status === "not built yet" ? "This class applies, but this engine version does not run it yet." : STATUS_TEXT[status]}</td>
                    <td style={{ fontSize: 13 }}>{a?.sources.slice(0, 1).map((s) => <a key={s.href} href={s.href}>{s.label}</a>)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="stack" style={{ gap: 12 }}>
        <h2>Depth: {r.depth} of 100</h2>
        <div className="tablewrap">
          <table className="data">
            <thead><tr><th>Part</th><th style={{ textAlign: "center" }}>Points</th><th>Measured as</th></tr></thead>
            <tbody>{DEPTH_PARTS.map((p) => <tr key={p.key}><td>{p.name}</td><td className="mono" style={{ textAlign: "center" }}>{r.depthParts?.[p.key] ?? 0} / {p.max}</td><td className="quiet" style={{ fontSize: 13 }}>{p.how}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      {r.property ? (
        <section className="stack" style={{ gap: 12 }}>
          <h2>Property fuzzing</h2>
          <JobResults result={{ property: r.property }} />
        </section>
      ) : null}

      <section className="stack" style={{ gap: 12 }}>
        <h2>The build</h2>
        <dl className="kv">
          <dt>Bytecode SHA-256</dt><dd className="mono">{r.bytecodeSha256}</dd>
          <dt>Size</dt><dd>{r.bytes ? `${(r.bytes / 1024).toFixed(0)} KB` : "unknown"}</dd>
          <dt>Upgradeable</dt><dd>{r.upgradeable === null ? "No (loader v2)" : r.upgradeable ? "Yes" : "No"}</dd>
          {r.upgradeAuthority ? (<><dt>Upgrade authority</dt><dd><a className="mono" href={mainnet(r.upgradeAuthority)}>{r.upgradeAuthority}</a></dd></>) : null}
          <dt>Anchor IDL</dt><dd>{r.idl ? `Yes, ${r.idlInstructions} instructions` : "Not published on chain"}</dd>
          <dt>Engine</dt><dd className="mono">{r.engine} · {r.tier}</dd>
        </dl>
      </section>

      <section className="panel stack" style={{ gap: 8 }}>
        <h3>For agents</h3>
        <pre className="code">{`GET https://fuzzy.verafy.ai/api/registry?program=${r.address}\nGET https://fuzzy.verafy.ai/api/certification?program=${r.address}`}</pre>
        <p className="muted" style={{ fontSize: 13 }}>Or use the Fuzzy MCP server. <a href="/docs">Docs</a></p>
      </section>
    </main>
  );
}
