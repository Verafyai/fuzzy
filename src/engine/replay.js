// Re-run a finding's transactions from scratch and check the attack still works.
import { readIdl } from './idl.js';
import { makeWorld, send } from './world.js';
import { attackerGain } from './sniff.js';

export async function replayFinding({ program, idl: rawIdl, report, findingId }) {
  const finding = report.findings.find((f) => f.id === findingId);
  if (!finding) throw new Error(`no finding ${findingId} in this report`);
  const idl = rawIdl ? readIdl(rawIdl) : null;
  const seed = report.seed;
  const world = await makeWorld({ program, seed, idl });
  let last;
  for (const step of finding.steps) last = await send(world, step);
  const gain = attackerGain(last);
  return {
    finding: finding.id,
    reproduced: last.ok,
    attackerGainLamports: gain.toString(),
    transaction: last.transaction,
    logs: last.logs,
  };
}
