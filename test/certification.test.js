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

async function certify(s, ruling = s.ruling) {
  const accounts = [
    { address: s.cert, role: k.AccountRole.WRITABLE },
    { address: ruling, role: k.AccountRole.READONLY },
    { address: s.payer.address, role: k.AccountRole.WRITABLE_SIGNER, signer: s.payer },
    { address: '11111111111111111111111111111111', role: k.AccountRole.READONLY },
    ...s.harnesses.map((h) => ({ address: h, role: k.AccountRole.READONLY })),
  ];
  const msg = k.pipe(
    k.createTransactionMessage({ version: 0 }),
    (m) => k.setTransactionMessageFeePayerSigner(s.payer, m),
    (m) => k.setTransactionMessageLifetimeUsingBlockhash({ blockhash: s.svm.latestBlockhash(), lastValidBlockHeight: 0n }, m),
    (m) => k.appendTransactionMessageInstruction({ programAddress: CERTIFICATION_PROGRAM, accounts, data: certifyData({ program: s.program, bytecodeHash: s.bh, reportHash: s.rh, score: s.score }) }, m),
  );
  const res = s.svm.sendTransaction(await k.signTransactionMessageWithSigners(msg));
  s.svm.expireBlockhash();
  if (typeof res.err === 'function') return { ok: false, code: (res.toString().match(/Custom\((\d+)\)/) || [])[1] ?? res.toString().slice(0, 120) };
  return { ok: true };
}

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
