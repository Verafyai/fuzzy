// Run one Fuzzy add-on job and print its result as JSON on stdout. Used by the build machine.
// Input (argv[2] or stdin): { jobs: ["rebuild","lints","deep","property","review"] | ["sink"],
//   programId, network?, repo?, commit?, path?, buildArgs?, rpcUrl? }
import { rebuild } from './jobs/rebuild.mjs';
import { lints } from './jobs/lints.mjs';
import { deepFuzz } from './jobs/deep.mjs';
import { propertyFuzz } from './jobs/property.mjs';
import { review } from './jobs/review.mjs';
import { runSourceAddons } from '../src/addons/source.js';

export const NEEDS_SOURCE = new Set(['rebuild', 'lints', 'review']);
export const SINK = ['rebuild', 'lints', 'deep', 'property', 'review'];

async function safely(fn) {
  try { return await fn(); } catch (e) { return { ran: false, reason: e.message }; }
}

export async function runJobs(input, { onEvent = () => {} } = {}) {
  const jobs = new Set(input.jobs?.includes('sink') ? SINK : input.jobs || []);
  const out = { programId: input.programId, network: input.network || 'mainnet', startedAt: new Date().toISOString() };
  // Source jobs need a verified build unless the caller named the source.
  let src = input.repo && input.commit ? { repo: input.repo, commit: input.commit, path: input.path || '' } : null;
  if ([...jobs].some((j) => NEEDS_SOURCE.has(j)) && !src) {
    out.source = await safely(() => runSourceAddons(input.programId, ['advisories']));
    const v = out.source.verified;
    if (v?.verified && v.repo && v.commit) src = { repo: v.repo, commit: v.commit, path: v.path || '' };
  }
  const noSource = { ran: false, reason: 'No verified build of public source is on record, so this check has no source to run on.' };
  const base = { programId: input.programId, address: input.programId, network: input.network || 'mainnet', rpcUrl: input.rpcUrl, idl: input.idl || null };
  if (jobs.has('rebuild')) out.rebuild = src ? await safely(() => rebuild({ ...base, ...src, buildArgs: input.buildArgs }, { onEvent })) : noSource;
  if (jobs.has('lints')) out.lints = src ? await safely(() => lints(src, { onEvent })) : noSource;
  if (jobs.has('review')) out.review = src ? await safely(() => review(src, { onEvent })) : noSource;
  if (jobs.has('property')) out.property = await safely(() => propertyFuzz(base, { onEvent }));
  if (jobs.has('deep')) out.deep = await safely(() => deepFuzz(base, { onEvent }));
  out.finishedAt = new Date().toISOString();
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const raw = process.argv[2] || (await new Promise((r) => { let d = ''; process.stdin.on('data', (c) => (d += c)); process.stdin.on('end', () => r(d)); }));
  const result = await runJobs(JSON.parse(raw), { onEvent: (e) => e.type === 'note' && console.error(e.text) });
  process.stdout.write(JSON.stringify(result));
}
