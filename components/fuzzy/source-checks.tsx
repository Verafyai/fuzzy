/* eslint-disable @typescript-eslint/no-explicit-any */
/** Verified source and dependency advisories, shown beside the Fuzzy Score. They never change the score. */
export function SourceChecks({ addons }: { addons: any }) {
  if (!addons) return null;
  const v = addons.verified;
  const a = addons.advisories;
  const vulns = (a?.advisories || []).filter((x: any) => x.kind === "vulnerability");
  const warns = (a?.advisories || []).filter((x: any) => x.kind !== "vulnerability");
  return (
    <section className="stack" style={{ gap: 12 }}>
      <h2>Source and dependencies</h2>
      {v ? (
        v.error ? <p className="quiet">The verified-source check could not run: {v.error}</p> : (
          <div className="panel stack" style={{ gap: 8 }}>
            <div className="row" style={{ gap: 10 }}>
              <span className="tag" style={{ color: v.verified ? "var(--teal)" : "var(--medium)" }}>{v.verified ? "Verified build" : "Not verified"}</span>
              <span className="quiet" style={{ fontSize: 14 }}>
                {v.verified
                  ? <>The deployed bytecode was rebuilt from <a href={`https://github.com/${v.repo}/tree/${v.commit}`}>{v.repo}</a> at commit <code>{String(v.commit).slice(0, 10)}</code>.</>
                  : v.repo ? <>A repository is on record (<a href={v.repoUrl}>{v.repo}</a>) but the deployed bytecode does not match a verified build of it.</> : "No verified build is on record for this program, so its source cannot be checked."}
              </span>
            </div>
            <p className="muted" style={{ fontSize: 13 }}>Source: <a href={v.source?.url}>{v.source?.name}</a>{v.lastVerifiedAt ? `, last verified ${new Date(v.lastVerifiedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}.</p>
          </div>
        )
      ) : null}
      {a ? (
        a.ran ? (
          <div className="stack" style={{ gap: 8 }}>
            <p className="quiet">
              {a.packages} crates in the <a href={a.lockfile}>verified commit&apos;s Cargo.lock</a>: {a.vulnerabilities} with a vulnerability advisory, {a.warnings} with a warning (unmaintained or unsound). The lockfile covers the whole repository, so some of these sit in off-chain tools or tests rather than the deployed program. Advisories are leads for the team, not proven exploits, and never change the score.
            </p>
            {vulns.length + warns.length ? (
              <div className="tablewrap">
                <table className="data">
                  <thead><tr><th>Crate</th><th>Advisory</th><th style={{ textAlign: "center" }}>Kind</th><th>Fixed in</th></tr></thead>
                  <tbody>{[...vulns, ...warns].map((x: any) => (
                    <tr key={`${x.package}@${x.version}:${x.id}`}>
                      <td className="mono" style={{ fontSize: 13 }}>{x.package} {x.version}</td>
                      <td style={{ fontSize: 13 }}><a href={x.url}>{x.id}</a><div className="quiet">{x.summary}</div></td>
                      <td style={{ textAlign: "center" }}><span className="status" style={{ color: x.kind === "vulnerability" ? "var(--high)" : "var(--medium)" }}>{x.kind}</span></td>
                      <td className="mono muted" style={{ fontSize: 13 }}>{x.fixedIn?.join(", ") || "no fix"}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : null}
            <p className="muted" style={{ fontSize: 13 }}>Source: <a href="https://osv.dev">OSV</a>, which includes the <a href="https://rustsec.org">RustSec advisory database</a>.</p>
          </div>
        ) : <p className="quiet">Dependency advisories did not run: {a.reason}</p>
      ) : null}
    </section>
  );
}
