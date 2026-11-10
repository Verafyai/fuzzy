// verafy_certification in LiteSVM: it writes a report card only from a sealed
// ruling about this program, build and report, by a jury of active registered
// harnesses from at least two model families.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { LiteSVM } from 'litesvm';
import * as k from '@solana/kit';
import {
  CERTIFICATION_PROGRAM, RULING_PROGRAM, REGISTRY_PROGRAM,
  certificationContractHash, certificationAddress, certifyData, decodeCertification, bytecodeHash,
  recordAddress, recordData, nextRecords, decodeRecord,
} from '../src/certification.js';

const certSo = new Uint8Array(readFileSync(new URL('../bench/programs/verafy_certification.so', import.meta.url)));
const vault = new Uint8Array(readFileSync(new URL('../bench/example_vault_fixed.so', import.meta.url)));
const enc = k.getAddressEncoder();
const seedKey = (label) => k.createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(createHash('sha256').update(label).digest()));

async function world() {
  const svm = new LiteSVM();
  svm.addProgram(CERTIFICATION_PROGRAM, certSo);
  const payer = await seedKey('payer');
  svm.airdrop(payer.address, k.lamports(10_000_000_000n));
  return { svm, payer };
}

function rulingData({ contractHash, jurors, status = 2, answer = 1, releasable = 0n }) {
  const d = Buffer.alloc(1450);
  d.write('VRFYRUL1', 0);
  d[8] = status; d[9] = jurors.length; d[10] = answer; d[11] = jurors.length;
  Buffer.from(contractHash).copy(d, 16);
  jurors.forEach((j, i) => Buffer.from(enc.encode(j)).copy(d, 80 + 104 * i));
  d.writeBigUInt64LE(releasable, 1434);
  return d;
}

function harnessData(juror, family, status = 1) {
  const d = Buffer.alloc(392);
  d.write('VRFYHRN1', 0);
  d[8] = status;
  Buffer.from(enc.encode(juror)).copy(d, 16);
  Buffer.alloc(32, family).copy(d, 80);
  return d;
}

async function setup({ families = [1, 2, 3, 1], status = 2, answer = 1, wrongContract = false, unregistered = false, releasable = 0n, rulingLabel = 'ruling' } = {}) {
  const w = await world();
  const program = (await seedKey('target-program')).address;
  const bh = bytecodeHash(vault);
  const rh = createHash('sha256').update('report').digest();
  const score = 55;
  const jurors = await Promise.all(families.map((_, i) => seedKey(`juror-${i}`).then((s) => s.address)));
  const contractHash = wrongContract ? createHash('sha256').update('something else').digest() : certificationContractHash({ program, bytecodeHash: bh, reportHash: rh, score });
  const ruling = (await seedKey(rulingLabel)).address;
  const put = (address, data, owner) => w.svm.setAccount({ address, data: new Uint8Array(data), executable: false, lamports: k.lamports(10_000_000n), programAddress: owner, space: BigInt(data.length) });
  put(ruling, rulingData({ contractHash, jurors, status, answer, releasable }), RULING_PROGRAM);
  const harnesses = [];
  for (let i = 0; i < jurors.length; i++) {
    const h = (await seedKey(`harness-${i}`)).address;
    put(h, harnessData(jurors[i], families[i], unregistered && i === 2 ? 2 : 1), REGISTRY_PROGRAM);
    harnesses.push(h);
  }
  const cert = await certificationAddress(program, bh);
  return { ...w, program, bh, rh, score, ruling, harnesses, cert };
}

const SYSTEM = '11111111111111111111111111111111';

async function send(s, accounts, data) {
  const msg = k.pipe(
    k.createTransactionMessage({ version: 0 }),
    (m) => k.setTransactionMessageFeePayerSigner(s.payer, m),
    (m) => k.setTransactionMessageLifetimeUsingBlockhash({ blockhash: s.svm.latestBlockhash(), lastValidBlockHeight: 0n }, m),
    (m) => k.appendTransactionMessageInstruction({ programAddress: CERTIFICATION_PROGRAM, accounts, data }, m),
  );
  const res = s.svm.sendTransaction(await k.signTransactionMessageWithSigners(msg));
  s.svm.expireBlockhash();
  if (typeof res.err === 'function') return { ok: false, code: (res.toString().match(/Custom\((\d+)\)/) || [])[1] ?? res.toString().slice(0, 120) };
  return { ok: true };
}

async function certify(s, ruling = s.ruling, { tag, record, previous } = {}) {
  const next = await nextRecords(s.program, s.bh, s.svm.getAccount(s.cert)?.data ?? null);
  const accounts = [
    { address: s.cert, role: k.AccountRole.WRITABLE },
    { address: ruling, role: k.AccountRole.READONLY },
    { address: s.payer.address, role: k.AccountRole.WRITABLE_SIGNER, signer: s.payer },
    { address: SYSTEM, role: k.AccountRole.READONLY },
    { address: record ?? next.record, role: k.AccountRole.WRITABLE },
    { address: previous ?? next.previous, role: (previous ?? next.previous) === CERTIFICATION_PROGRAM ? k.AccountRole.READONLY : k.AccountRole.WRITABLE },
    ...s.harnesses.map((h) => ({ address: h, role: k.AccountRole.READONLY })),
  ];
  const data = certifyData({ program: s.program, bytecodeHash: s.bh, reportHash: s.rh, score: s.score });
  if (tag !== undefined) data[0] = tag;
  return send(s, accounts, data);
}

async function backfill(s) {
  return send(s, [
    { address: s.cert, role: k.AccountRole.WRITABLE },
    { address: s.payer.address, role: k.AccountRole.WRITABLE_SIGNER, signer: s.payer },
    { address: SYSTEM, role: k.AccountRole.READONLY },
    { address: await recordAddress(s.program, s.bh, 0), role: k.AccountRole.WRITABLE },
  ], recordData());
}

/** A ruling releasable at `releasable`, for the same program, build and report. */
async function laterRuling(s, label, releasable) {
  const ruling = (await seedKey(label)).address;
  const jurors = await Promise.all(s.harnesses.map((_, i) => seedKey(`juror-${i}`).then((x) => x.address)));
  const contractHash = certificationContractHash({ program: s.program, bytecodeHash: s.bh, reportHash: s.rh, score: s.score });
  const d = rulingData({ contractHash, jurors, releasable });
  s.svm.setAccount({ address: ruling, data: new Uint8Array(d), executable: false, lamports: k.lamports(10_000_000n), programAddress: RULING_PROGRAM, space: BigInt(d.length) });
  return ruling;
}

const record = async (s, seq) => decodeRecord(s.svm.getAccount(await recordAddress(s.program, s.bh, seq)).data);

test('a sealed ruling by registered harnesses writes the certification', async () => {
  const s = await setup();
  assert.deepEqual(await certify(s), { ok: true });
  const c = decodeCertification(s.svm.getAccount(s.cert).data);
  assert.equal(c.level, 1);
  assert.equal(c.levelName, 'Sniffed');
  assert.equal(c.score, 55);
  assert.equal(c.seats, 4);
  assert.equal(c.families, 3);
  assert.equal(c.program, s.program);
  assert.equal(c.ruling, s.ruling);
});

test('a ruling about anything else is refused', async () => {
  assert.equal((await certify(await setup({ wrongContract: true }))).code, '103');
});

test('an unsealed ruling is refused', async () => {
  assert.equal((await certify(await setup({ status: 1 }))).code, '102');
});

test('a retired or unregistered juror is refused', async () => {
  assert.equal((await certify(await setup({ unregistered: true }))).code, '104');
});

test('one model family is not a jury', async () => {
  assert.equal((await certify(await setup({ families: [7, 7, 7] }))).code, '104');
});

test('two seats are not a jury', async () => {
  assert.equal((await certify(await setup({ families: [1, 2] }))).code, '104');
});

test('a replacement needs a later ruling', async () => {
  const s = await setup({ releasable: 100n });
  assert.equal((await certify(s)).ok, true);
  assert.equal((await certify(s)).code, '105');
});

test('each verdict is kept as a record, and a newer one supersedes it', async () => {
  const s = await setup({ releasable: 100n });
  assert.equal((await certify(s)).ok, true);
  const r0 = await recordAddress(s.program, s.bh, 0);
  let first = await record(s, 0);
  assert.equal(first.seq, 0);
  assert.equal(first.ruling, s.ruling);
  assert.equal(first.supersedes, null);
  assert.equal(first.current, true);
  assert.equal(decodeCertification(s.svm.getAccount(s.cert).data).records, 1);

  const later = await laterRuling(s, 'ruling-2', 200n);
  assert.deepEqual(await certify(s, later), { ok: true });
  const r1 = await recordAddress(s.program, s.bh, 1);
  first = await record(s, 0);
  const second = await record(s, 1);
  assert.equal(first.supersededBy, r1);
  assert.equal(first.current, false);
  assert.equal(first.ruling, s.ruling, 'the old record keeps its own verdict');
  assert.equal(second.supersedes, r0);
  assert.equal(second.current, true);
  assert.equal(second.ruling, later);
  const head = decodeCertification(s.svm.getAccount(s.cert).data);
  assert.equal(head.records, 2);
  assert.equal(head.ruling, later);
});

test('a record cannot be skipped or written out of order', async () => {
  const s = await setup({ releasable: 100n });
  assert.equal((await certify(s)).ok, true);
  const later = await laterRuling(s, 'ruling-2', 200n);
  assert.equal((await certify(s, later, { record: await recordAddress(s.program, s.bh, 5) })).code, '109');
  assert.equal((await certify(s, later, { previous: (await seedKey('not-a-record')).address })).code, '109');
});

test('the version 1 certify is retired', async () => {
  assert.equal((await certify(await setup(), undefined, { tag: 0 })).code, '106');
});

test('a version 1 certification is recorded before it can be replaced', async () => {
  const s = await setup({ releasable: 100n });
  assert.equal((await certify(s)).ok, true);
  // Make it look like version 1 wrote it: no records yet.
  const acct = s.svm.getAccount(s.cert);
  const d = Buffer.from(acct.data); d.writeUInt32LE(0, 12);
  s.svm.setAccount({ address: s.cert, data: new Uint8Array(d), executable: false, lamports: acct.lamports, programAddress: CERTIFICATION_PROGRAM, space: BigInt(d.length) });
  s.svm.setAccount({ address: await recordAddress(s.program, s.bh, 0), data: new Uint8Array(0), executable: false, lamports: k.lamports(0n), programAddress: SYSTEM, space: 0n });
  const later = await laterRuling(s, 'ruling-2', 200n);
  assert.equal((await certify(s, later, { record: await recordAddress(s.program, s.bh, 0), previous: CERTIFICATION_PROGRAM })).code, '107');
  assert.deepEqual(await backfill(s), { ok: true });
  assert.equal((await record(s, 0)).ruling, s.ruling);
  assert.equal((await backfill(s)).code, '108');
  assert.deepEqual(await certify(s, later), { ok: true });
  assert.equal((await record(s, 0)).supersededBy, await recordAddress(s.program, s.bh, 1));
});
