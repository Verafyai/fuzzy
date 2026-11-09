// Rebuild from source: clone the repository at the commit, build every SBF program in it,
// and compare each build's hash with the deployed bytecode. On the build machine this runs in
// the solana-verify image for the program's Solana version, so builds are reproducible.
// Input: { programId, network?, repo: "owner/name", commit, path?, buildArgs?: string[] }
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fetchProgram } from '../../src/engine/ingest.js';

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(0, 2).join(' ')} failed: ${(r.stderr || r.stdout || '').trim().split('\n').slice(-6).join(' | ')}`);
  return r;
};

/** solana-verify's hash: SHA-256 of the program bytes with trailing zero padding removed. */
export function verifyHash(bytes) {
  let n = bytes.length;
  while (n > 0 && bytes[n - 1] === 0) n--;
  return createHash('sha256').update(bytes.subarray(0, n)).digest('hex');
}

/** The Solana version a lockfile pins (solana-program, or the Agave crates). */
export function solanaVersion(lock) {
  for (const name of ['solana-program', 'solana-sdk', 'solana-account-info', 'anchor-lang']) {
    const m = new RegExp(`name = "${name}"\\nversion = "([^"]+)"`).exec(lock);
    if (m) return { crate: name, version: m[1] };
  }
  return null;
}

export async function rebuild(input, { buildCommand = process.env.FUZZY_BUILD_SBF || 'cargo-build-sbf', timeoutMs = 25 * 60_000, onEvent = () => {} } = {}) {
  const { programId, repo, commit } = input;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '') || !/^[0-9a-f]{7,40}$/i.test(commit || '')) throw new Error('A rebuild needs a GitHub repository and a commit hash.');
  const deployed = await fetchProgram(programId, { network: input.network || 'mainnet', rpcUrl: input.rpcUrl });
  const onChainHash = verifyHash(Buffer.from(deployed.program));
  const dir = mkdtempSync(join(tmpdir(), 'fuzzy-src-'));
  const t0 = Date.now();
  try {
    onEvent({ type: 'note', text: `Cloning ${repo} at ${commit.slice(0, 10)}.` });
    run('git', ['init', '-q', dir]);
    run('git', ['-C', dir, 'remote', 'add', 'origin', `https://github.com/${repo}.git`]);
    run('git', ['-C', dir, 'fetch', '-q', '--depth', '1', 'origin', commit], { timeout: 5 * 60_000 });
    run('git', ['-C', dir, 'checkout', '-q', 'FETCH_HEAD']);
    const root = join(dir, input.path || '');
    const lockPath = [join(root, 'Cargo.lock'), join(dir, 'Cargo.lock')].find(existsSync);
    const toolchain = lockPath ? solanaVersion(readFileSync(lockPath, 'utf8')) : null;
    onEvent({ type: 'note', text: `Building with ${buildCommand}${toolchain ? ` (source pins ${toolchain.crate} ${toolchain.version})` : ''}.` });
    const r = spawnSync(buildCommand, [...(input.buildArgs || [])], { cwd: root, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 128 * 1024 * 1024 });
    const deployDir = [join(root, 'target', 'deploy'), join(dir, 'target', 'deploy')].find(existsSync);
    const built = deployDir ? readdirSync(deployDir).filter((f) => f.endsWith('.so')).map((f) => ({ file: f, sha256: verifyHash(readFileSync(join(deployDir, f))) })) : [];
    if (r.status !== 0 && !built.length) {
      return { ran: true, built: [], match: false, onChainHash, toolchain, seconds: Math.round((Date.now() - t0) / 1000), error: 'The build failed.', log: (r.stderr || '').trim().split('\n').slice(-15).join('\n') };
    }
    const matched = built.find((b) => b.sha256 === onChainHash) || null;
    return {
      ran: true, repo, commit, path: input.path || '', buildArgs: input.buildArgs || [], toolchain,
      onChainHash, built, match: Boolean(matched), matchedFile: matched?.file || null,
      seconds: Math.round((Date.now() - t0) / 1000),
      note: matched ? 'The deployed bytecode is byte-for-byte a build of this source.' : 'No build of this source matches the deployed bytecode. Builds only reproduce in the same toolchain image with the same build arguments, so a mismatch is a lead, not proof of tampering.',
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await rebuild(JSON.parse(process.argv[2]), { onEvent: (e) => console.error(e.text) });
  console.log(JSON.stringify({ ...r, log: r.log?.slice(-500) }, null, 1));
}
