// Verafy Certification (VIP-0034): a program's report card on Solana.
// The on-chain program lives in Verafy Harness, packages/solana/certification.
// This module computes what a jury rules on, finds a program's certification
// and reads it. Lookups are read-only RPC calls.
import { createHash } from 'node:crypto';
import * as k from '@solana/kit';

/** verafy_certification on devnet. */
export const CERTIFICATION_PROGRAM = process.env.VERAFY_CERTIFICATION_PROGRAM || '1dcJPW3aGMCWDkNV6do6sEUwSxLdf8NtSuQb1teCdXt';
export const RULING_PROGRAM = 'A6iZhDZASfQGCmzxXWW8JdnEhtz7EZE3gS4N1hkiJNNN';
export const REGISTRY_PROGRAM = 'Bn6jV1CGK4WFibJcCVsEzHeVVhtph2xPsNkemWfgqn9R';
export const DOMAIN = 'verafy-certification/1';
export const CERT_SIZE = 192;
export const RECORD_SIZE = 256;
const ZERO = '11111111111111111111111111111111';

/** What a level means. The jury's answer is the level. */
export const LEVELS = [
  { level: 0, name: 'Not certified', meaning: 'The jury found a proven exploit, or the report does not support any level.' },
  { level: 1, name: 'Sniffed', meaning: 'Survived a Sniff run with no proven findings.' },
  { level: 2, name: 'Fuzzed', meaning: 'Survived a Deep Fuzz run on cloned mainnet state with no proven findings.' },
  { level: 3, name: 'Hardened', meaning: 'Survived a Kitchen Sink run with no proven findings and a Fuzzy Score of 90 or more.' },
];

const sha = (...parts) => createHash('sha256').update(Buffer.concat(parts.map((p) => Buffer.from(p)))).digest();
const key = (a) => Buffer.from(k.getAddressEncoder().encode(a));
const hex = (b) => Buffer.from(b).toString('hex');

/**
 * The bytes Solana runs, without the loader's trailing padding: the ELF ends
 * at its section header table. Everyone hashes this the same way.
 */
export function bytecodeOf(programData) {
  const b = Buffer.from(programData);
  if (b.length >= 64 && b.readUInt32BE(0) === 0x7f454c46) {
    const shoff = Number(b.readBigUInt64LE(40));
    const end = shoff + b.readUInt16LE(58) * b.readUInt16LE(60);
    if (end > 64 && end <= b.length) return b.subarray(0, end);
  }
  let n = b.length;
  while (n > 0 && b[n - 1] === 0) n--;
  return b.subarray(0, n);
}

export const bytecodeHash = (programData) => sha(bytecodeOf(programData));

/** The ruling's contract hash: what the jury ruled on. */
export function certificationContractHash({ program, bytecodeHash: bh, reportHash, score }) {
  return sha(Buffer.from(DOMAIN), key(program), Buffer.from(bh), Buffer.from(reportHash), Buffer.from([score]));
}

/** sha256 of the report as canonical JSON (sorted keys). */
export function reportHash(report) {
  const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().filter((x) => v[x] !== undefined).map((x) => `${JSON.stringify(x)}:${canon(v[x])}`).join(',')}}` : JSON.stringify(v));
  return sha(Buffer.from(canon(report)));
}

export async function certificationAddress(program, bh, programId = CERTIFICATION_PROGRAM) {
  const [pda] = await k.getProgramDerivedAddress({ programAddress: programId, seeds: [Buffer.from('cert'), key(program), Buffer.from(bh)] });
  return pda;
}

/** Every verdict is also its own record at ["verdict", program, bytecode_hash, seq u32 LE]. */
export async function recordAddress(program, bh, seq, programId = CERTIFICATION_PROGRAM) {
  const n = Buffer.alloc(4); n.writeUInt32LE(seq);
  const [pda] = await k.getProgramDerivedAddress({ programAddress: programId, seeds: [Buffer.from('verdict'), key(program), Buffer.from(bh), n] });
  return pda;
}

/** Tag 1, certify. Accounts: cert, ruling, payer, system, the next record, the previous record (or, for the first, the certification program's own address), then the jurors' harnesses. */
export function certifyData({ program, bytecodeHash: bh, reportHash: rh, score }) {
  return Buffer.concat([Buffer.from([1]), key(program), Buffer.from(bh), Buffer.from(rh), Buffer.from([score])]);
}

/** Tag 2: copy a version 1 certification's verdict into record 0. Accounts: cert, payer, system, record 0. */
export const recordData = () => Buffer.from([2]);

/**
 * The record a certify should write and the one it supersedes, from the current
 * certification account's data (or null when there is none yet). `needsRecord`
 * means a version 1 certification that must be recorded (tag 2) first.
 */
export async function nextRecords(program, bh, certData, programId = CERTIFICATION_PROGRAM) {
  const d = certData ? decodeCertification(certData) : null;
  const n = d ? d.records : 0;
  if (d && n === 0) return { needsRecord: true, record: await recordAddress(program, bh, 0, programId), previous: null };
  return { needsRecord: false, record: await recordAddress(program, bh, n, programId), previous: n > 0 ? await recordAddress(program, bh, n - 1, programId) : programId, first: n === 0 };
}

function decodeFields(b) {
  const addr = (o) => k.getAddressDecoder().decode(b.subarray(o, o + 32));
  const level = b[8];
  return {
    level,
    levelName: LEVELS[level]?.name ?? `Level ${level}`,
    score: b[9],
    seats: b[10],
    families: b[11],
    program: addr(16),
    bytecodeHash: hex(b.subarray(48, 80)),
    reportHash: hex(b.subarray(80, 112)),
    ruling: addr(112),
    certifier: addr(144),
    releasableAfterSlot: b.readBigUInt64LE(176).toString(),
    certifiedSlot: b.readBigUInt64LE(184).toString(),
  };
}

/** The current verdict for one build. `records` counts its verdict records (0 for a version 1 certification not yet recorded). */
export function decodeCertification(data) {
  const b = Buffer.from(data);
  if (b.length < CERT_SIZE || b.subarray(0, 8).toString() !== 'VRFYCRT1') return null;
  return { ...decodeFields(b), records: b.readUInt32LE(12) };
}

/** One verdict, kept for good. `supersededBy` is null while it is the current verdict. */
export function decodeRecord(data) {
  const b = Buffer.from(data);
  if (b.length < RECORD_SIZE || b.subarray(0, 8).toString() !== 'VRFYVRD1') return null;
  const addr = (o) => { const a = k.getAddressDecoder().decode(b.subarray(o, o + 32)); return a === ZERO ? null : a; };
  return { ...decodeFields(b), seq: b.readUInt32LE(12), supersedes: addr(192), supersededBy: addr(224), current: addr(224) === null };
}

/**
 * From any verdict record, an old receipt included, follow superseded_by to the
 * current verdict. Returns every record walked, oldest first; the last is current.
 */
export async function followSupersession(record, { rpcUrl = 'https://api.devnet.solana.com', certificationProgram = CERTIFICATION_PROGRAM, max = 64 } = {}) {
  const chain = [];
  let at = record;
  while (at && chain.length < max) {
    const acct = await rpc(rpcUrl, 'getAccountInfo', [at, { encoding: 'base64' }]);
    if (!acct?.value || acct.value.owner !== certificationProgram) throw new Error(`${at} is not a verdict record`);
    const d = decodeRecord(Buffer.from(acct.value.data[0], 'base64'));
    if (!d) throw new Error(`${at} is not a verdict record`);
    chain.push({ address: at, ...d });
    at = d.supersededBy;
  }
  return chain;
}

async function rpc(url, method, params) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = await res.json();
  if (body.error) throw new Error(`RPC ${method}: ${body.error.message}`);
  return body.result;
}

/**
 * Should an agent trust this program? Hash its current bytecode, read the
 * certification for exactly that build, and check the ruling is past its
 * challenge window.
 */
export async function lookupCertification(program, { rpcUrl = 'https://api.devnet.solana.com', programRpcUrl = 'https://api.mainnet-beta.solana.com', cluster, certificationProgram = CERTIFICATION_PROGRAM } = {}) {
  // Certifications live on devnet. The program may be deployed on devnet, mainnet or both,
  // with different bytecode on each: check each deployed build, devnet first, unless a cluster is named.
  const clusters = cluster ? [cluster] : ['devnet', 'mainnet'];
  const slot = await rpc(rpcUrl, 'getSlot', []);
  let first = null;
  for (const c of clusters) {
    const source = c === 'devnet' ? rpcUrl : programRpcUrl;
    if (!source) continue;
    const acct = await rpc(source, 'getAccountInfo', [program, { encoding: 'base64' }]);
    if (!acct?.value?.executable) continue;
    const raw = Buffer.from(acct.value.data[0], 'base64');
    let programData = raw;
    if (acct.value.owner === 'BPFLoaderUpgradeab1e11111111111111111111111') {
      const pdAddr = k.getAddressDecoder().decode(raw.subarray(4, 36));
      const pd = await rpc(source, 'getAccountInfo', [pdAddr, { encoding: 'base64' }]);
      programData = Buffer.from(pd.value.data[0], 'base64').subarray(45);
    }
    const bh = bytecodeHash(programData);
    const address = await certificationAddress(program, bh, certificationProgram);
    const cert = await rpc(rpcUrl, 'getAccountInfo', [address, { encoding: 'base64' }]);
    if (!cert?.value || cert.value.owner !== certificationProgram) {
      first = first || { program, programCluster: c, bytecodeHash: hex(bh), certificationAddress: address, certified: false, reason: 'no certification for this exact build' };
      continue;
    }
    const d = decodeCertification(Buffer.from(cert.value.data[0], 'base64'));
    const currentRecord = d.records > 0 ? await recordAddress(program, bh, d.records - 1, certificationProgram) : null;
    const settled = BigInt(slot) >= BigInt(d.releasableAfterSlot);
    return {
      program, programCluster: c, bytecodeHash: hex(bh), certificationAddress: address, currentRecord,
      certified: d.level > 0 && settled,
      reason: d.level === 0 ? 'the jury did not certify this build' : settled ? `certified ${d.levelName}` : 'certified, but still inside the challenge window',
      ...d,
    };
  }
  return first || { program, certified: false, reason: 'not a program on devnet or mainnet' };
}

/**
 * The accounts for a tag 1 certify, in the shape verafyHarness's tx builder takes.
 * `sol` is packages/solana/src/index.js; `certData` is the current certification account's data, or null.
 */
export async function certifyKeys(sol, { program, bytecodeHash: bh, ruling, payer, harnesses, certData, programId = CERTIFICATION_PROGRAM }) {
  const next = await nextRecords(program, bh, certData, programId);
  if (next.needsRecord) throw new Error('this certification was written by version 1; record it first (tag 2)');
  const cert = await certificationAddress(program, bh, programId);
  return {
    cert, record: next.record, previous: next.first ? null : next.previous,
    keys: [
      { pubkey: sol.b58decode(cert), isSigner: false, isWritable: true },
      { pubkey: sol.b58decode(ruling), isSigner: false, isWritable: false },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: sol.SYSTEM_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: sol.b58decode(next.record), isSigner: false, isWritable: true },
      { pubkey: sol.b58decode(next.previous), isSigner: false, isWritable: !next.first },
      ...harnesses.map((h) => ({ pubkey: sol.b58decode(h), isSigner: false, isWritable: false })),
    ],
  };
}

/** A tag 2 instruction that records a version 1 certification's verdict as record 0. */
export async function recordIx(sol, { program, bytecodeHash: bh, payer, programId = CERTIFICATION_PROGRAM }) {
  const cert = await certificationAddress(program, bh, programId);
  const record = await recordAddress(program, bh, 0, programId);
  return {
    record,
    ix: {
      programId: sol.b58decode(programId),
      keys: [
        { pubkey: sol.b58decode(cert), isSigner: false, isWritable: true },
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: sol.SYSTEM_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: sol.b58decode(record), isSigner: false, isWritable: true },
      ],
      data: recordData(),
    },
  };
}
