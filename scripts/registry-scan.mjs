// Scan every program in data/registry-programs.json on mainnet (read only) and write
// data/registry.json. Full reports go to --reports (outside the repo): findings on
// programs Verafy does not own are never published, only their count and severity.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]] : null).filter(Boolean));
const reports = args.reports || '/tmp/fuzzy-reports';
const concurrency = Number(args.concurrency || 4);
const timeoutMs = Number(args.timeout || 240) * 1000;
mkdirSync(reports, { recursive: true });
const { programs, source } = JSON.parse(readFileSync('data/registry-programs.json', 'utf8'));
// A program whose rescan fails keeps its last published row, marked with why the rescan failed.
const previous = existsSync('data/registry.json') ? Object.fromEntries((JSON.parse(readFileSync('data/registry.json', 'utf8')).programs || []).filter((x) => x.status === 'scanned').map((x) => [x.address, x])) : {};

function scan(p) {
  const out = join(reports, `${p.address}.json`);
  if (existsSync(out)) return Promise.resolve({ ok: true, out });
  return new Promise((resolve) => {
    // --tier deep: Deep Fuzz with branch coverage (needs FUZZY_LEDGER and agave-ledger-tool).
    const child = args.tier === 'deep'
      ? spawn(process.execPath, ['worker/jobs/deep.mjs', JSON.stringify({ address: p.address, network: 'mainnet', ...(args.rpc ? { rpcUrl: args.rpc } : {}) }), out], { stdio: ['ignore', 'ignore', 'pipe'] })
      : spawn(process.execPath, ['bin/fuzzy.js', 'run', p.address, '--out', out, ...(args.rpc ? ['--rpc', args.rpc] : [])], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ ok: false, error: 'Timed out' }); }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && existsSync(out)) resolve({ ok: true, out });
      else resolve({ ok: false, error: (err.trim().split('\n').pop() || `exit ${code}`).replace(/^Error: /, '').slice(0, 160) });
    });
  });
}

const results = new Array(programs.length);
let next = 0, done = 0;
async function worker() {
  while (next < programs.length) {
    const i = next++;
    const p = programs[i];
    const r = await scan(p);
    let row = { ...p };
    if (r.ok) {
      const rep = JSON.parse(readFileSync(r.out, 'utf8'));
      const s = rep.score;
      const sev = {};
      for (const f of rep.findings) sev[f.severity] = (sev[f.severity] || 0) + 1;
      const leadClasses = {};
      for (const l of rep.leads) leadClasses[l.class] = (leadClasses[l.class] || 0) + 1;
      row = {
        ...row,
        status: 'scanned',
        score: s.score, depth: s.depth, ceiling: s.ceiling, depthParts: s.depthParts,
        grade: rep.findings.length === 0 && s.depth < 50 ? 'Shallow run' : s.grade,
        branch: typeof rep.tested?.branchCoverage === 'object' ? rep.tested.branchCoverage : null,
        proven: rep.findings.length, provenBySeverity: sev, leads: rep.leads.length, leadClasses,
        transactions: rep.tested?.transactions ?? null,
        durationMs: rep.tested?.durationMs ?? null,
        state: rep.tested?.state ?? null,
        replayedCalls: rep.tested?.history?.calls ?? 0,
        replayedFromSlot: rep.tested?.history?.replayedFromSlot ?? null,
        instructionsTried: (rep.tested?.instructions || []).map((i) => ({ name: i.name, succeeded: i.succeeded, failed: i.failed })),
        classes: rep.tested?.classes || [],
        idl: Boolean(rep.program?.idl),
        idlInstructions: rep.program?.instructions ?? null,
        upgradeable: rep.program?.upgradeable ?? null,
        upgradeAuthority: rep.program?.upgradeAuthority ?? null,
        bytes: rep.program?.bytes ?? null,
        bytecodeSha256: rep.program?.sha256 ?? null,
        engine: rep.engine, tier: rep.tier?.name || 'Sniff', scannedAt: rep.createdAt,
        certification: 'Not certified',
      };
    } else {
      row = previous[p.address]
        ? { ...previous[p.address], ...p, rescanError: r.error }
        : { ...row, status: 'not scanned', reason: r.error, certification: 'Not certified' };
    }
    results[i] = row;
    done++;
    console.error(`${done}/${programs.length} ${p.name}: ${row.status === 'scanned' ? `score ${row.score}, depth ${row.depth}, ${row.proven} proven, ${row.leads} leads` : row.reason}`);
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
const addonData = existsSync('data/registry-addons.json') ? JSON.parse(readFileSync('data/registry-addons.json', 'utf8')).programs : {};
for (const row of results) {
  const ad = addonData[row.address];
  if (!ad) continue;
  row.addons = ad;
  row.verifiedBuild = Boolean(ad.verified?.verified);
  row.advisoryCounts = ad.advisories?.ran ? { vulnerabilities: ad.advisories.vulnerabilities, warnings: ad.advisories.warnings } : null;
}
const propertyData = existsSync('data/registry-property.json') ? JSON.parse(readFileSync('data/registry-property.json', 'utf8')).programs : {};
for (const row of results) if (propertyData[row.address]) row.property = propertyData[row.address];
const certs = existsSync('data/certifications.json') ? JSON.parse(readFileSync('data/certifications.json', 'utf8')).certifications : [];
for (const row of results) {
  const c = certs.find((x) => x.program === row.address);
  if (c) {
    row.certification = c.level > 0 ? `Devnet: ${c.levelName}` : 'Recorded, not certified';
    row.devnetCertification = { level: c.level ?? 1, levelName: c.levelName, score: c.score, program: c.program, tier: c.tier, history: c.history || [], certification: c.certification, ruling: c.ruling, certifySignature: c.certifySignature, certifiedAt: c.certifiedAt, jurors: c.jurors, families: c.families, jurorsScripted: c.jurorsScripted, bytecodeHash: c.bytecodeHash, reportHash: c.reportHash, record: c.record, records: c.records, supersedes: c.supersedes ?? null };
  }
}
writeFileSync('data/registry.json', JSON.stringify({ kind: 'fuzzy.registry/1', engine: 'fuzzy-score/1', source, generatedAt: new Date().toISOString(), programs: results }, null, 1) + '\n');
console.error('wrote data/registry.json');
