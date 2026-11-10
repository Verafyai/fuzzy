// Read an Anchor IDL (0.30+ format, or the legacy isMut/isSigner format) into
// what the engine needs: each instruction's discriminator, account roles and
// argument types, plus the size of each program-owned account type.
import { createHash } from 'node:crypto';

export const KNOWN_ADDRESSES = {
  systemprogram: '11111111111111111111111111111111',
  tokenprogram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  token2022program: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  associatedtokenprogram: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  rent: 'SysvarRent111111111111111111111111111111111',
  clock: 'SysvarC1ock11111111111111111111111111111111',
  instructions: 'Sysvar1nstructions1111111111111111111111111',
};

const norm = (s) => String(s).replace(/[_\s-]/g, '').toLowerCase();

export function anchorDiscriminator(namespace, name) {
  return [...createHash('sha256').update(`${namespace}:${name}`).digest().subarray(0, 8)];
}

const snake = (s) => String(s).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

function typeSize(type, types, depth = 0) {
  if (depth > 8) return 32;
  if (typeof type === 'string') {
    const fixed = { bool: 1, u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4, f32: 4, u64: 8, i64: 8, f64: 8, u128: 16, i128: 16, pubkey: 32, publicKey: 32 };
    if (type in fixed) return fixed[type];
    if (type === 'string' || type === 'bytes') return 4 + 64;
    return 32;
  }
  if (type.option) return 1 + typeSize(type.option, types, depth + 1);
  if (type.coption) return 4 + typeSize(type.coption, types, depth + 1);
  if (type.vec) return 4 + 4 * typeSize(type.vec, types, depth + 1);
  if (type.array) return type.array[1] * typeSize(type.array[0], types, depth + 1);
  const defined = type.defined && (typeof type.defined === 'string' ? type.defined : type.defined.name);
  if (defined) return structSize(types.get(norm(defined)), types, depth + 1);
  return 32;
}

function structSize(def, types, depth) {
  if (!def) return 64;
  const t = def.type || def;
  if (t.kind === 'struct') return (t.fields || []).reduce((n, f) => n + typeSize(f.type, types, depth), 0);
  if (t.kind === 'enum') return 1 + Math.max(0, ...(t.variants || []).map((v) => (v.fields || []).reduce((n, f) => n + typeSize(f.type ?? f, types, depth), 0)));
  return 64;
}

/** Field layout of a struct (offsets), so the engine can spot pubkey fields. */
function pubkeyOffsets(def, types) {
  const t = def && (def.type || def);
  if (!t || t.kind !== 'struct') return [];
  const out = [];
  let off = 8;
  for (const f of t.fields || []) {
    if (f.type === 'pubkey' || f.type === 'publicKey') out.push({ name: f.name, offset: off });
    off += typeSize(f.type, types);
  }
  return out;
}

export function readIdl(idl) {
  if (!idl || !Array.isArray(idl.instructions)) throw new Error('not an Anchor IDL: no instructions');
  const types = new Map();
  for (const t of idl.types || []) types.set(norm(t.name), t);
  for (const a of idl.accounts || []) if (a.type) types.set(norm(a.name), a);

  const stateTypes = (idl.accounts || []).map((a) => {
    const def = types.get(norm(a.name));
    return {
      name: a.name,
      key: norm(a.name),
      discriminator: a.discriminator || anchorDiscriminator('account', a.name),
      size: 8 + structSize(def, types, 0),
      pubkeys: pubkeyOffsets(def, types),
    };
  });
  const stateByKey = new Map(stateTypes.map((s) => [s.key, s]));

  const instructions = idl.instructions.map((ix) => {
    const discriminator = ix.discriminator || anchorDiscriminator('global', snake(ix.name));
    const accounts = flattenAccounts(ix.accounts || []).map((a) => {
      const writable = Boolean(a.writable ?? a.isMut);
      const signer = Boolean(a.signer ?? a.isSigner);
      const fixed = a.address || KNOWN_ADDRESSES[norm(a.name)];
      const state = stateByKey.get(norm(a.name));
      let role;
      if (fixed) role = 'fixed';
      else if (signer) role = 'actor';
      else if (state) role = 'state';
      else if (writable) role = 'wallet';
      else role = 'other';
      // Anchor 0.30 IDLs describe derived accounts (PDAs) by their seeds.
      const pda = !fixed && a.pda && Array.isArray(a.pda.seeds) ? { seeds: a.pda.seeds, program: a.pda.program || null } : null;
      if (pda && !signer && !state) role = 'pda';
      return { name: a.name, writable, signer, role, address: fixed || null, stateType: state ? state.name : null, pda };
    });
    const args = (ix.args || []).map((a) => ({ name: a.name, type: a.type }));
    return { name: ix.name, discriminator, accounts, args };
  });

  return {
    name: idl.metadata?.name || idl.name || 'program',
    instructions,
    stateTypes,
    types,
  };
}

function flattenAccounts(list) {
  const out = [];
  for (const a of list) {
    if (Array.isArray(a.accounts)) out.push(...flattenAccounts(a.accounts));
    else out.push(a);
  }
  return out;
}
