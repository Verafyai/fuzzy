import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuzzyScore, depth, ceiling, grade } from '../src/score.js';

test('spec example: a shallow Sniff on a clean program scores 49, Exposed', () => {
  const r = fuzzyScore({
    depth: { branchCoverage: 0.30, instructionCoverage: 1, classesTried: 4, classesApplicable: 12, state: 'empty', effort: 1 },
    findings: [],
  });
  assert.equal(r.depth, 49);
  assert.equal(r.score, 49);
  assert.equal(r.grade, 'Exposed');
  assert.equal(r.cappedBy, null);
});

test('spec example: the report page, depth 80 capped at 45 by one High', () => {
  const r = fuzzyScore({
    depth: { branchCoverage: 0.61, instructionCoverage: 0.9, classesTried: 10, classesApplicable: 11, state: 'mainnet', effort: 1 },
    findings: [{ severity: 'high', proven: true }, { severity: 'low', proven: true }, { severity: 'critical', proven: false }],
  });
  assert.equal(r.depth, 80);
  assert.equal(r.ceiling, 45);
  assert.equal(r.score, 45);
  assert.equal(r.cappedBy, 'high');
  assert.equal(r.proven, 2);
  assert.equal(r.leads, 1);
});

test('leads never set a ceiling', () => {
  assert.deepEqual(ceiling([{ severity: 'critical', proven: false }]), { cap: 100, worst: null });
});

test('a proven critical caps any depth at 20, Broken', () => {
  const r = fuzzyScore({
    depth: { branchCoverage: 1, instructionCoverage: 1, classesTried: 12, classesApplicable: 12, state: 'mainnet', effort: 1 },
    findings: [{ severity: 'critical', proven: true }],
  });
  assert.equal(r.depth, 100);
  assert.equal(r.score, 20);
  assert.equal(r.grade, 'Broken');
});

test('a deep clean run can reach Hardened', () => {
  const r = fuzzyScore({
    depth: { branchCoverage: 0.9, instructionCoverage: 1, classesTried: 11, classesApplicable: 11, state: 'mainnet', effort: 1 },
    findings: [],
  });
  assert.equal(r.score, 96);
  assert.equal(r.grade, 'Hardened');
});

test('synthetic state earns half the real-state weight', () => {
  assert.equal(depth({ branchCoverage: 0, instructionCoverage: 0, classesTried: 0, classesApplicable: 0, state: 'synthetic', effort: 0 }).parts.realState, 5);
});

test('grade boundaries', () => {
  assert.equal(grade(90).name, 'Hardened');
  assert.equal(grade(89).name, 'Solid');
  assert.equal(grade(75).name, 'Solid');
  assert.equal(grade(74).name, 'Shaky');
  assert.equal(grade(50).name, 'Shaky');
  assert.equal(grade(49).name, 'Exposed');
  assert.equal(grade(25).name, 'Exposed');
  assert.equal(grade(24).name, 'Broken');
});

test('bad input is refused', () => {
  assert.throws(() => depth({ branchCoverage: 0.5, instructionCoverage: 0.5, classesTried: 5, classesApplicable: 4, state: 'mainnet', effort: 1 }));
  assert.throws(() => depth({ branchCoverage: 0.5, instructionCoverage: 0.5, classesTried: 1, classesApplicable: 4, state: 'devnet', effort: 1 }));
  assert.throws(() => ceiling([{ severity: 'scary', proven: true }]));
});
