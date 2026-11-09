// Borsh encoding for IDL argument types, and the values the fuzzer tries.
// Values are kept JSON-safe in steps: integers wider than 32 bits are strings.

const INT = {
  u8: [1, false], i8: [1, true], u16: [2, false], i16: [2, true], u32: [4, false], i32: [4, true],
  u64: [8, false], i64: [8, true], u128: [16, false], i128: [16, true],
};

function intBytes(value, bytes, signed) {
  let v = BigInt(value);
  const bits = BigInt(bytes * 8);
  if (signed && v < 0n) v = (1n << bits) + v;
  v &= (1n << bits) - 1n;
  const out = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) { out[i] = Number(v & 0xffn); v >>= 8n; }
  return out;
}

const norm = (x) => String(x).replace(/[_\s-]/g, '').toLowerCase();
const definedName = (t) => t && t.defined && (typeof t.defined === 'string' ? t.defined : t.defined.name);

export function encodeValue(type, value, resolveKey, types = new Map()) {
  if (typeof type === 'string') {
    if (type in INT) return intBytes(value, INT[type][0], INT[type][1]);
    if (type === 'bool') return new Uint8Array([value ? 1 : 0]);
    if (type === 'pubkey' || type === 'publicKey') return resolveKey(value);
    if (type === 'string' || type === 'bytes') {
      const b = type === 'string' ? new TextEncoder().encode(String(value)) : Uint8Array.from(value || []);
      return concat([intBytes(b.length, 4, false), b]);
    }
    throw new Error(`unsupported arg type ${type}`);
  }
  if (type.option) return value == null ? new Uint8Array([0]) : concat([new Uint8Array([1]), encodeValue(type.option, value, resolveKey, types)]);
  if (type.vec) return concat([intBytes((value || []).length, 4, false), ...(value || []).map((v) => encodeValue(type.vec, v, resolveKey, types))]);
  if (type.array) return concat(Array.from({ length: type.array[1] }, (_, i) => encodeValue(type.array[0], (value || [])[i] ?? 0, resolveKey, types)));
  const name = definedName(type);
  if (name) {
    const def = types.get(norm(name));
    const t = def && (def.type || def);
    if (t && t.kind === 'struct') {
      const fields = t.fields || [];
      if (fields.length && typeof fields[0] !== 'object') return concat(fields.map((f, i) => encodeValue(f, (value || [])[i], resolveKey, types)));
      return concat(fields.map((f) => encodeValue(f.type, (value || {})[f.name], resolveKey, types)));
    }
    if (t && t.kind === 'enum') {
      const idx = value?.variant ?? 0;
      const variant = (t.variants || [])[idx] || {};
      const fields = variant.fields || [];
      const parts = fields.map((f, i) => (typeof f === 'object' && f.type !== undefined ? encodeValue(f.type, (value?.fields || {})[f.name], resolveKey, types) : encodeValue(f, (value?.fields || [])[i], resolveKey, types)));
      return concat([new Uint8Array([idx]), ...parts]);
    }
  }
  throw new Error(`unsupported arg type ${JSON.stringify(type)}`);
}

export function concat(parts) {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Ordinary values first, then the extremes the arithmetic attack uses. */
export function candidates(type, types = new Map(), depth = 0) {
  if (typeof type === 'string') {
    if (type in INT) {
      const [bytes, signed] = INT[type];
      const max = (1n << BigInt(bytes * 8 - (signed ? 1 : 0))) - 1n;
      const typical = bytes >= 8 ? ['1000000000', '1000000', '1'] : ['1', '7'];
      const extreme = ['0', max.toString(), signed ? (-max - 1n).toString() : (max - 1n).toString()];
      return { typical, extreme };
    }
    if (type === 'bool') return { typical: [true, false], extreme: [] };
    if (type === 'pubkey' || type === 'publicKey') return { typical: ['actor:owner'], extreme: ['actor:attacker'] };
    if (type === 'string') return { typical: ['fuzzy'], extreme: ['', 'x'.repeat(200)] };
    if (type === 'bytes') return { typical: [[1, 2, 3]], extreme: [[]] };
  }
  if (type.option) return { typical: [null, ...candidates(type.option, types, depth + 1).typical.slice(0, 1)], extreme: [] };
  const name = definedName(type);
  if (name && depth < 6) {
    const def = types.get(norm(name));
    const t = def && (def.type || def);
    const first = (ft, key) => { const c = candidates(ft, types, depth + 1); return key === 'extreme' && c.extreme.length ? c.extreme[0] : c.typical[0]; };
    if (t && t.kind === 'struct') {
      const fields = t.fields || [];
      const build = (key) => (fields.length && typeof fields[0] !== 'object' ? fields.map((f) => first(f, key)) : Object.fromEntries(fields.map((f) => [f.name, first(f.type, key)])));
      return { typical: [build('typical')], extreme: [build('extreme')] };
    }
    if (t && t.kind === 'enum') {
      const variants = (t.variants || []).map((v, i) => {
        const fields = v.fields || [];
        const vals = fields.length && typeof fields[0] === 'object' && fields[0].type !== undefined ? Object.fromEntries(fields.map((f) => [f.name, first(f.type, 'typical')])) : fields.map((f) => first(f, 'typical'));
        return { variant: i, fields: vals };
      });
      return { typical: variants.slice(0, 3), extreme: [] };
    }
  }
  if (type.vec) return { typical: [[]], extreme: [] };
  if (type.array) return { typical: [[]], extreme: [] };
  return { typical: [0], extreme: [] };
}

export function isNumeric(type) {
  return typeof type === 'string' && type in INT;
}
