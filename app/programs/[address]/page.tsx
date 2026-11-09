import type { Metadata } from "next";
import { notFound } from "next/navigation";
import registry from "@/data/registry.json";
import { Info } from "@/components/fuzzy/info";
import { ADDON_PLAN, ASSESSMENT_BY_ID, COLUMN_HELP, DEPTH_PARTS, STATE_LABEL, STATUS_TEXT, scoreColor } from "@/lib/assessments";
import { SourceChecks } from "@/components/fuzzy/source-checks";

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

function gaps(r: Row): string[] {
  const g: string[] = [];
  if (!r.idl) g.push("The program publishes no Anchor IDL on chain, so Fuzzy could not read its instruction names, accounts or arguments.");
  if (r.state !== "mainnet") g.push(r.replayedCalls ? `Fuzzy found ${r.replayedCalls} recent mainnet ${r.replayedCalls === 1 ? "call" : "calls"}, but none replayed successfully on cloned accounts, so no attack ran on real state.` : "Fuzzy found no recent mainnet calls it could replay through a public RPC.");
  const failed = (r.instructionsTried || []).filter((i: any) => !i.succeeded);
  if (failed.length) g.push(`${failed.length} of ${(r.instructionsTried || []).length} instructions never completed an honest call, so there was no working path to attack from: ${failed.slice(0, 8).map((i: any) => i.name).join(", ")}${failed.length > 8 ? ", and more" : ""}.`);
  const notTried = (r.classes || []).filter((c: any) => c.status === "not tried" && ASSESSMENT_BY_ID[c.id]?.built);
  if (notTried.length) g.push(`Built attack classes that apply but did not run: ${notTried.map((c: any) => c.name).join(", ")}.`);
  const planned = (r.classes || []).filter((c: any) => !ASSESSMENT_BY_ID[c.id]?.built && c.status !== "does not apply");
  if (planned.length) g.push(`Attack classes that apply but are not built yet: ${planned.map((c: any) => c.name).join(", ")}.`);
  g.push("Branch coverage is not measured in this engine version (0 of 40 Depth points).");
  if (r.upgradeable) g.push("The program is upgradeable, so this report and any certification cover only the build hashed below.");
  return g;
}

export default async function ProgramPage({ params }: { params: Promise<{ address: string }> }) {
  const r = find((await params).address);
  if (!r) notFound();
  const shallow = r.grade === "Shallow run";
  const cert = r.devnetCertification;
  const tried = (r.classes || []).filter((c: any) => c.status === "held" || c.status === "broke it").length;
  const leadEntries = Object.entries(r.leadClasses || {}) as [string, number][];

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
            <a className="btn btn-quiet" href={mainnet(r.address)}>Program on Solana Explorer</a>
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

      <section className="panel stack" style={{ gap: 10, borderColor: cert ? "var(--teal-fill)" : undefined }}>
        <h2>Certification<Info text={COLUMN_HELP.certification} /></h2>
        {cert ? (
          <>
            <p className="quiet"><span className="tag tag-cert">Devnet certification only: {cert.levelName}</span></p>
            <p className="quiet" style={{ fontSize: 15 }}>
              A jury of {cert.jurors} registered Verafy harnesses from {cert.families} model families ruled on this report on Solana devnet, and verafy_certification wrote the level for this exact build on {date(cert.certifiedAt)}. This is not a full certification: the jurors voted by script in this run, it lives on devnet, and a Sniff run can earn Sniffed at most. The jury ruled on the scan from {date(cert.certifiedAt)}; the report below may be a newer scan of the same build.
            </p>
            <dl className="kv">
              <dt>Certification account</dt><dd><a className="mono" href={devnet(cert.certification)}>{cert.certification}</a></dd>
              <dt>Jury ruling</dt><dd><a className="mono" href={devnet(cert.ruling)}>{cert.ruling}</a></dd>
              <dt>Certify transaction</dt><dd><a className="mono" href={devnetTx(cert.certifySignature)}>{cert.certifySignature.slice(0, 32)}…</a></dd>
              <dt>Bytecode hash</dt><dd className="mono">{cert.bytecodeHash}</dd>
              <dt>Report hash</dt><dd className="mono">{cert.reportHash}</dd>
            </dl>
          </>
        ) : (
          <p className="quiet" style={{ fontSize: 15 }}>Not certified. A scan is a grade; a certification needs a jury ruling. Devnet certifications so far went to the programs whose runs reached Depth 40 or more.</p>
        )}
      </section>

      <section className="stack" style={{ gap: 12 }}>
        <h2>What ran</h2>
        <p className="quiet">
          A Sniff run: {r.transactions} transactions in {Math.round((r.durationMs || 0) / 1000)} seconds, {tried} attack {tried === 1 ? "class" : "classes"} run, tested on {STATE_LABEL[r.state || "empty"].toLowerCase()}{r.state === "mainnet" && r.replayedFromSlot ? ` (accounts cloned at slot ${r.replayedFromSlot})` : ""}. Nothing was sent to mainnet or devnet. <a href="/method">How a run works</a>
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

      {(r.instructionsTried || []).length ? (
        <section className="stack" style={{ gap: 12 }}>
          <h2>Instructions</h2>
          <p className="quiet">Fuzzy first calls each instruction the way an honest user would. Only instructions that complete an honest call can be attacked.</p>
          <div className="row" style={{ gap: 8 }}>
            {r.instructionsTried.map((i: any) => <span key={i.name} className="tag" style={{ color: i.succeeded ? "var(--teal)" : "var(--text-3)" }}>{i.name}: {i.succeeded ? "ran" : "did not complete"}</span>)}
          </div>
        </section>
      ) : null}

      <section className="stack" style={{ gap: 12 }}>
        <h2>Findings and leads</h2>
        <p className="quiet">
          {r.proven ? `${r.proven} proven. Details go only to the program's team first.` : "No proven findings."} {r.leads ? `${r.leads} ${r.leads === 1 ? "lead" : "leads"}: attacks that did something unexpected but did not prove theft. Leads never count toward the score.` : "No leads."}
        </p>
        {leadEntries.length ? <div className="row" style={{ gap: 8 }}>{leadEntries.map(([c, n]) => <span key={c} className="tag">{ASSESSMENT_BY_ID[c]?.name || c}: {n}</span>)}</div> : null}
      </section>

      <SourceChecks addons={r.addons} />

      <section className="stack" style={{ gap: 12 }}>
        <h2>Gaps in this run</h2>
        <ul className="list quiet">{gaps(r).map((g) => <li key={g}>{g}</li>)}</ul>
        <p className="quiet" style={{ fontSize: 14 }}>Planned add-ons not run on this program yet: {ADDON_PLAN.filter((a) => a.status === "planned").map((a, i) => <span key={a.id}>{i ? ", " : ""}<a href="/method#addons">{a.name.toLowerCase()}</a></span>)}.</p>
      </section>

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
