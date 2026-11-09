// Get a program's bytes and IDL from a file or, read-only, from an RPC node.
// Ingest never sends a transaction.
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import * as k from '@solana/kit';

export const RPC = {
  mainnet: 'https://api.mainnet-beta.solana.com',
  devnet: 'https://api.devnet.solana.com',
};

const UPGRADEABLE = 'BPFLoaderUpgradeab1e11111111111111111111111';
const LOADER_2 = 'BPFLoader2111111111111111111111111111111111';

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Basic facts from the ELF header: machine and the size of .text. */
export function elfInfo(bytes) {
  const b = Buffer.from(bytes);
  if (b.length < 64 || b.readUInt32BE(0) !== 0x7f454c46) throw new Error('not an ELF file: expected a compiled Solana program (.so)');
  const machine = b.readUInt16LE(18);
  if (machine !== 247 && machine !== 263) throw new Error(`not a Solana program: ELF machine ${machine}`);
  const shoff = Number(b.readBigUInt64LE(40));
  const shentsize = b.readUInt16LE(58), shnum = b.readUInt16LE(60), shstrndx = b.readUInt16LE(62);
  let textSize = 0;
  if (shoff && shnum && shoff + shnum * shentsize <= b.length) {
    const strOff = Number(b.readBigUInt64LE(shoff + shstrndx * shentsize + 24));
    for (let i = 0; i < shnum; i++) {
      const h = shoff + i * shentsize;
      const nameOff = b.readUInt32LE(h);
      let name = '';
      for (let j = strOff + nameOff; j < b.length && b[j]; j++) name += String.fromCharCode(b[j]);
      if (name === '.text') textSize = Number(b.readBigUInt64LE(h + 32));
    }
  }
  return { bytes: b.length, machine: machine === 263 ? 'sbf' : 'bpf', textBytes: textSize, sbfInstructions: Math.floor(textSize / 8) };
}

async function rpc(url, method, params) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  if (!res.ok) throw new Error(`RPC ${method} failed: HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`RPC ${method}: ${body.error.message}`);
  return body.result;
}

async function accountInfo(url, address) {
  const r = await rpc(url, 'getAccountInfo', [address, { encoding: 'base64' }]);
  if (!r?.value) return null;
  return { owner: r.value.owner, executable: r.value.executable, data: Buffer.from(r.value.data[0], 'base64') };
}

/** Fetch a deployed program's bytecode and its on-chain Anchor IDL, if it has one. */
export async function fetchProgram(address, { network = 'mainnet', rpcUrl } = {}) {
  const url = rpcUrl || RPC[network];
  if (!url) throw new Error(`unknown network ${network}`);
  try { k.assertIsAddress(address); } catch { throw new Error('That is not a valid Solana address.'); }
  const acct = await accountInfo(url, address);
  if (!acct) throw new Error(`There is no account at ${address} on ${network}.`);
  if (!acct.executable) throw new Error(`${address} is not a program.`);
  let program, upgradeable = false, upgradeAuthority = null;
  if (acct.owner === UPGRADEABLE) {
    const programData = k.getAddressDecoder().decode(acct.data.subarray(4, 36));
    const pd = await accountInfo(url, programData);
    if (!pd) throw new Error('program data account is missing');
    upgradeable = pd.data[12] === 1;
    upgradeAuthority = upgradeable ? k.getAddressDecoder().decode(pd.data.subarray(13, 45)) : null;
    program = pd.data.subarray(45);
    // Trailing zero padding after the ELF is allowed; LiteSVM loads it as-is.
  } else if (acct.owner === LOADER_2) {
    program = acct.data;
  } else {
    throw new Error(`unsupported loader ${acct.owner}`);
  }
  const idl = await fetchAnchorIdl(url, address).catch(() => null);
  return { program: new Uint8Array(program), idl, upgradeable, upgradeAuthority, network };
}

/** Anchor stores a zlib-compressed IDL at createWithSeed(pda([], program), "anchor:idl", program). */
export async function fetchAnchorIdl(url, programId) {
  const [base] = await k.getProgramDerivedAddress({ programAddress: programId, seeds: [] });
  const idlAddress = await k.createAddressWithSeed({ baseAddress: base, programAddress: programId, seed: 'anchor:idl' });
  const acct = await accountInfo(url, idlAddress);
  if (!acct) return null;
  const len = acct.data.readUInt32LE(40);
  return JSON.parse(inflateSync(acct.data.subarray(44, 44 + len)).toString('utf8'));
}
