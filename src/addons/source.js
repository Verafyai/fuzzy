// Source add-ons: checks that need the program's source code, found through a verified build.
//
// verifiedSource: asks OtterSec's verification service whether the deployed bytecode was
//   rebuilt from a public repository at a known commit (solana-verify). Read only.
// dependencyAdvisories: reads Cargo.lock from that exact commit and checks every crates.io
//   dependency against OSV, which carries the RustSec advisory database.
//
// Neither changes the Fuzzy Score (fuzzy-score/1). They are reported beside it.

const OSEC = 'https://verify.osec.io/status/';
const OSV_BATCH = 'https://api.osv.dev/v1/querybatch';
const OSV_VULN = 'https://api.osv.dev/v1/vulns/';

export const ADDONS = Object.freeze({
  verified: { id: 'verified', name: 'Verified-source check', credits: 25 },
  advisories: { id: 'advisories', name: 'Dependency advisories', credits: 100, needs: 'verified' },
});

async function getJson(url, opts = {}, timeoutMs = 15_000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctl.signal });
    if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** Parse a GitHub repo URL that may carry /tree/<ref>/<path>. */
export function parseRepo(url) {
  const m = /^https?:\/\/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?(?:\/tree\/([^/]+)(?:\/(.+))?)?\/?$/.exec(String(url || '').trim());
  if (!m) return null;
  return { owner: m[1], repo: m[2], ref: m[3] || null, path: m[4] || '' };
}

/**
 * Is the deployed build verified against public source?
 * @returns {Promise<object>} { verified, repoUrl, repo, commit, onChainHash, executableHash, lastVerifiedAt, message, source }
 */
export async function verifiedSource(programId) {
  const s = await getJson(OSEC + programId);
  const repo = parseRepo(s.repo_url);
  const commit = s.commit && s.commit !== 'None' ? s.commit : repo?.ref || null;
  return {
    verified: Boolean(s.is_verified),
    message: s.message || null,
    repoUrl: s.repo_url || null,
    repo: repo ? `${repo.owner}/${repo.repo}` : null,
    path: repo?.path || '',
    commit,
    onChainHash: s.on_chain_hash || null,
    executableHash: s.executable_hash || null,
    lastVerifiedAt: s.last_verified_at || null,
    frozen: Boolean(s.is_frozen),
    source: { name: 'OtterSec verification service', url: `${OSEC}${programId}` },
  };
}

/** Packages from a Cargo.lock that come from crates.io. */
export function parseCargoLock(text) {
  const out = [];
  for (const block of String(text).split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const name = /^name\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    const version = /^version\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    const source = /^source\s*=\s*"([^"]+)"/m.exec(block)?.[1] || '';
    if (name && version && source.includes('crates.io')) out.push({ name, version });
  }
  return out;
}

async function fetchLock(repo, commit, path) {
  const tries = [path ? `${path.replace(/\/$/, '')}/Cargo.lock` : null, 'Cargo.lock'].filter(Boolean);
  for (const p of tries) {
    const res = await fetch(`https://raw.githubusercontent.com/${repo}/${commit}/${p}`);
    if (res.ok) return { text: await res.text(), file: p };
  }
  return null;
}

/**
 * Check a verified build's dependencies against OSV (RustSec).
 * @param {object} verified - the result of verifiedSource.
 */
export async function dependencyAdvisories(verified) {
  if (!verified?.repo || !verified?.commit) {
    return { ran: false, reason: verified?.repo ? 'The verification record names a repository but no commit, so Fuzzy cannot pin the exact dependencies.' : 'No verified source to read dependencies from.' };
  }
  const lock = await fetchLock(verified.repo, verified.commit, verified.path);
  if (!lock) return { ran: false, reason: `No Cargo.lock at ${verified.repo}@${verified.commit.slice(0, 10)}.` };
  const pkgs = parseCargoLock(lock.text);
  const hits = [];
  for (let i = 0; i < pkgs.length; i += 500) {
    const chunk = pkgs.slice(i, i + 500);
    const r = await getJson(OSV_BATCH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ queries: chunk.map((p) => ({ package: { ecosystem: 'crates.io', name: p.name }, version: p.version })) }) }, 25_000);
    r.results.forEach((res, n) => { for (const v of res.vulns || []) hits.push({ ...chunk[n], id: v.id }); });
  }
  // One entry per advisory per package; prefer RUSTSEC ids, fetch summaries for up to 40.
  const byKey = new Map();
  for (const h of hits) byKey.set(`${h.name}@${h.version}:${h.id}`, h);
  const ids = [...new Set(hits.map((h) => h.id))].slice(0, 40);
  const details = new Map();
  await Promise.all(ids.map(async (id) => {
    try { details.set(id, await getJson(OSV_VULN + id)); } catch { /* summary is optional */ }
  }));
  const seen = new Set();
  const advisories = [];
  for (const h of byKey.values()) {
    const d = details.get(h.id);
    const aliases = d?.aliases || [];
    const group = [h.id, ...aliases].sort().join('|');
    const key = `${h.name}@${h.version}:${group}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rustsec = [h.id, ...aliases].find((x) => x.startsWith('RUSTSEC-')) || h.id;
    const fixed = (d?.affected || []).flatMap((a) => (a.ranges || []).flatMap((r) => (r.events || []).map((e) => e.fixed).filter(Boolean)));
    const informational = d?.database_specific?.informational || (d?.affected || []).map((a) => a.database_specific?.informational).find(Boolean) || null;
    advisories.push({
      package: h.name, version: h.version, id: rustsec, aliases,
      summary: d?.summary || null, kind: informational || 'vulnerability',
      fixedIn: [...new Set(fixed)].slice(0, 3),
      url: rustsec.startsWith('RUSTSEC-') ? `https://rustsec.org/advisories/${rustsec}.html` : `https://osv.dev/vulnerability/${rustsec}`,
    });
  }
  advisories.sort((a, b) => (a.kind === 'vulnerability' ? 0 : 1) - (b.kind === 'vulnerability' ? 0 : 1) || a.package.localeCompare(b.package));
  return {
    ran: true,
    lockfile: `https://github.com/${verified.repo}/blob/${verified.commit}/${lock.file}`,
    packages: pkgs.length,
    vulnerabilities: advisories.filter((a) => a.kind === 'vulnerability').length,
    warnings: advisories.filter((a) => a.kind !== 'vulnerability').length,
    advisories,
    source: { name: 'OSV (includes the RustSec advisory database)', url: 'https://osv.dev' },
  };
}

/** Run the requested add-ons for a deployed program. */
export async function runSourceAddons(programId, addons = []) {
  const want = new Set(addons);
  if (want.has('advisories')) want.add('verified');
  const out = {};
  if (want.has('verified')) {
    try { out.verified = await verifiedSource(programId); } catch (e) { out.verified = { error: e.message }; }
  }
  if (want.has('advisories')) {
    try {
      out.advisories = out.verified?.repo ? await dependencyAdvisories(out.verified) : { ran: false, reason: out.verified?.error || 'No verified source to read dependencies from.' };
    } catch (e) { out.advisories = { ran: false, reason: e.message }; }
  }
  return out;
}

export function addonCredits(addons = []) {
  const want = new Set(addons);
  if (want.has('advisories')) want.add('verified');
  return [...want].reduce((s, id) => s + (ADDONS[id]?.credits || 0), 0);
}
