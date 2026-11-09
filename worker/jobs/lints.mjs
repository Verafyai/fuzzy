// Static lints: Trail of Bits' Solana lints (through dylint) and Clippy, over the verified source.
// Input: { repo: "owner/name", commit, path? }
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

const CRYTIC = 'https://github.com/crytic/solana-lints';
const SOLANA_LINTS = new Set(['arbitrary_cpi', 'bump_seed_canonicalization', 'insecure_account_close', 'missing_owner_check', 'missing_signer_check', 'sysvar_get', 'type_cosplay']);

function git(args, opts = {}) {
  const r = spawnSync('git', args, { encoding: 'utf8', timeout: 5 * 60_000, ...opts });
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${(r.stderr || '').trim().split('\n').pop()}`);
}

/** Pull compiler diagnostics out of cargo's JSON message stream, from this repository only. */
export function diagnostics(stdout, root, tool) {
  const out = [];
  const seen = new Set();
  for (const line of String(stdout).split('\n')) {
    if (!line.startsWith('{')) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (m.reason !== 'compiler-message' || !m.message) continue;
    const d = m.message;
    if (!['warning', 'error'].includes(d.level) || !d.code?.code) continue;
    const span = (d.spans || []).find((s) => s.is_primary) || d.spans?.[0];
    if (!span || span.file_name.startsWith('/') && !span.file_name.startsWith(root)) continue; // skip dependencies
    const file = span.file_name.startsWith('/') ? relative(root, span.file_name) : span.file_name;
    if (file.includes('.cargo/registry') || file.startsWith('..')) continue;
    const key = `${d.code.code}|${file}|${span.line_start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ tool, lint: d.code.code, level: d.level, message: d.message, file, line: span.line_start });
  }
  return out;
}

export async function lints(input, { timeoutMs = 20 * 60_000, onEvent = () => {} } = {}) {
  const { repo, commit } = input;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '') || !/^[0-9a-f]{7,40}$/i.test(commit || '')) throw new Error('Lints need a GitHub repository and a commit hash.');
  const dir = mkdtempSync(join(tmpdir(), 'fuzzy-lint-'));
  const t0 = Date.now();
  try {
    onEvent({ type: 'note', text: `Cloning ${repo} at ${commit.slice(0, 10)}.` });
    git(['init', '-q', dir]);
    git(['-C', dir, 'remote', 'add', 'origin', `https://github.com/${repo}.git`]);
    git(['-C', dir, 'fetch', '-q', '--depth', '1', 'origin', commit]);
    git(['-C', dir, 'checkout', '-q', 'FETCH_HEAD']);
    const root = join(dir, input.path || '');
    const results = [];
    const ran = [];

    onEvent({ type: 'note', text: 'Running Trail of Bits solana-lints.' });
    // A local clone of solana-lints (FUZZY_SOLANA_LINTS); dylint's own git checkout is unreliable.
    const lintRepo = process.env.FUZZY_SOLANA_LINTS;
    const dyArgs = lintRepo ? ['dylint', '--path', lintRepo, '--pattern', 'lints/*', '--all', '--', '--message-format=json'] : ['dylint', '--git', CRYTIC, '--pattern', 'lints/*', '--all', '--', '--message-format=json'];
    const dy = spawnSync('cargo', dyArgs, { cwd: root, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024 });
    if (dy.error || /no such (sub)?command/i.test(dy.stderr || '')) ran.push({ tool: 'solana-lints', ran: false, reason: 'cargo-dylint is not installed on this machine.' });
    else { results.push(...diagnostics(dy.stdout, root, 'solana-lints').filter((d) => SOLANA_LINTS.has(d.lint))); ran.push({ tool: 'solana-lints', ran: true, exit: dy.status }); }

    onEvent({ type: 'note', text: 'Running Clippy.' });
    const cl = spawnSync('cargo', ['clippy', '--all-targets', '--message-format=json', '--', '-W', 'clippy::all'], { cwd: root, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024 });
    results.push(...diagnostics(cl.stdout, root, 'clippy').filter((d) => d.lint.startsWith('clippy::')));
    ran.push({ tool: 'clippy', ran: !cl.error, exit: cl.status });

    const byLint = {};
    for (const r of results) byLint[r.lint] = (byLint[r.lint] || 0) + 1;
    return {
      ran: true, repo, commit, path: input.path || '', tools: ran,
      findings: results.slice(0, 300), total: results.length, byLint,
      seconds: Math.round((Date.now() - t0) / 1000),
      sources: [{ name: 'Trail of Bits solana-lints', url: CRYTIC }, { name: 'Clippy', url: 'https://github.com/rust-lang/rust-clippy' }],
      note: 'Lint findings are leads for the team, not proven exploits, and never change the score.',
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await lints(JSON.parse(process.argv[2]), { onEvent: (e) => console.error(e.text) });
  console.log(JSON.stringify({ ...r, findings: r.findings.slice(0, 8) }, null, 1));
}
