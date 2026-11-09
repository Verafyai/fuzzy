// Branch and instruction coverage for an SBF program, measured by tracing real executions
// with `agave-ledger-tool program run --mode interpreter --trace`.
//
// Each traced line reads "<step> [<registers>] <pc>: <instruction>". We count:
//   instruction coverage: distinct pcs executed / instructions in .text
//   branch coverage: distinct (conditional jump, outcome) pairs / (2 x conditional jumps in .text)
// A call that makes a cross-program invocation stops at the CPI in this mocked runtime,
// so coverage past a CPI is not counted. That keeps the number conservative.
import { readFileSync, writeFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/** Locate .text in an ELF64 and count instructions and conditional jumps. */
export function textStats(elf) {
  const b = Buffer.from(elf);
  if (b.readUInt32BE(0) !== 0x7f454c46) throw new Error('not an ELF file');
  const shoff = Number(b.readBigUInt64LE(40));
  const shentsize = b.readUInt16LE(58), shnum = b.readUInt16LE(60), shstrndx = b.readUInt16LE(62);
  const sec = (i) => {
    const o = shoff + i * shentsize;
    return { name: b.readUInt32LE(o), offset: Number(b.readBigUInt64LE(o + 24)), size: Number(b.readBigUInt64LE(o + 32)) };
  };
  const strtab = sec(shstrndx);
  const nameOf = (s) => { let e = strtab.offset + s.name; let str = ''; while (b[e]) str += String.fromCharCode(b[e++]); return str; };
  let text = null;
  for (let i = 0; i < shnum; i++) { const s = sec(i); if (nameOf(s) === '.text') { text = s; break; } }
  if (!text) throw new Error('no .text section');
  const conditional = new Map(); // pc -> taken target pc
  let pc = 0, instructions = 0;
  for (let o = text.offset; o + 8 <= text.offset + text.size; ) {
    const opc = b[o];
    const cls = opc & 0x07, op = opc & 0xf0;
    if ((cls === 0x05 || cls === 0x06) && op !== 0x00 && op !== 0x80 && op !== 0x90) {
      const off = b.readInt16LE(o + 2);
      conditional.set(pc, pc + 1 + off);
    }
    const wide = opc === 0x18; // lddw takes two slots
    instructions++;
    pc += wide ? 2 : 1;
    o += wide ? 16 : 8;
  }
  return { instructions, conditionalJumps: conditional.size, conditional };
}

/** Parse a trace file into the pcs executed, in order (one frame or many). */
export function tracePcs(text) {
  const pcs = [];
  for (const line of text.split('\n')) {
    const m = /\]\s+(\d+):\s/.exec(line);
    if (m) pcs.push(Number(m[1]));
    else if (/^Frame /.test(line)) pcs.push(-1); // frame boundary: not an edge
  }
  return pcs;
}

export function coverageFrom(stats, pcLists) {
  const seen = new Set();
  const edges = new Set();
  for (const pcs of pcLists) {
    for (let i = 0; i < pcs.length; i++) {
      const pc = pcs[i];
      if (pc < 0) continue;
      seen.add(pc);
      const target = stats.conditional.get(pc);
      const next = pcs[i + 1];
      if (target !== undefined && next !== undefined && next >= 0) {
        if (next === target) edges.add(`${pc}:t`);
        else if (next === pc + 1) edges.add(`${pc}:f`);
      }
    }
  }
  return {
    instructions: stats.instructions,
    instructionsExecuted: seen.size,
    instructionCoverage: stats.instructions ? seen.size / stats.instructions : 0,
    branches: stats.conditionalJumps * 2,
    branchesTaken: edges.size,
    branchCoverage: stats.conditionalJumps ? edges.size / (stats.conditionalJumps * 2) : 0,
  };
}

/**
 * Trace each recorded invocation and measure coverage.
 * @param {object} o
 * @param {string} o.programPath - the .so file.
 * @param {object[]} o.inputs - program-run inputs: { program_id, accounts, instruction_data }.
 * @param {string} o.ledger - a ledger directory (any genesis ledger).
 * @param {string} [o.tool] - agave-ledger-tool binary.
 */
export function measureCoverage({ programPath, inputs, ledger, tool = 'agave-ledger-tool', limit = 200_000 }) {
  const stats = textStats(readFileSync(programPath));
  const dir = mkdtempSync(join(tmpdir(), 'fuzzy-cov-'));
  const lists = [];
  let traced = 0, failed = 0;
  try {
    inputs.forEach((input, i) => {
      const inFile = join(dir, `in-${i}.json`);
      const traceFile = join(dir, `trace-${i}`);
      writeFileSync(inFile, JSON.stringify(input));
      const r = spawnSync(tool, ['program', 'run', '--ledger', ledger, '--ignore-ulimit-nofile-error', '--mode', 'interpreter', '--limit', String(limit), '--trace', traceFile, '-i', inFile, '--output', 'json', programPath], { encoding: 'utf8', timeout: 60_000 });
      const files = readdirSync(dir).filter((f) => f.startsWith(`trace-${i}`));
      if (r.status !== 0 && !files.length) { failed++; return; }
      for (const f of files) lists.push(tracePcs(readFileSync(join(dir, f), 'utf8')));
      traced++;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return { ...coverageFrom(stats, lists), invocationsTraced: traced, invocationsFailed: failed, method: 'agave-ledger-tool program run --mode interpreter --trace' };
}
