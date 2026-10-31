// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// A small PDF reader: objects, cross-reference tables and streams, object
// streams, the common filters and the page tree. No DOM access, so it runs in
// the worker and in Node's tests.

export class Name { constructor(n) { this.n = n; } }
export class Ref { constructor(num, gen) { this.num = num; this.gen = gen; } }
export class Str { constructor(b) { this.b = b; } }
export class Op { constructor(o) { this.o = o; } }
export class Stream { constructor(dict, data) { this.dict = dict; this.data = data; } }

export class PdfError extends Error { constructor(code) { super(code); this.code = code; } }

const WS = new Uint8Array(256);
for (const c of [0, 9, 10, 12, 13, 32]) WS[c] = 1;
const DELIM = new Uint8Array(256);
for (const c of '()<>[]{}/%') DELIM[c.charCodeAt(0)] = 1;

export const latin1 = (b, s = 0, e = b.length) => {
  let out = '';
  for (let i = s; i < e; i += 8192) out += String.fromCharCode.apply(null, b.subarray(i, Math.min(e, i + 8192)));
  return out;
};
export const bytes = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 255);
export const isDict = (v) => v != null && v.constructor === Object;
export const nameOf = (v) => (v instanceof Name ? v.n : null);

export class Lexer {
  constructor(b, pos = 0) { this.b = b; this.pos = pos; }

  skip() {
    const b = this.b;
    for (;;) {
      while (this.pos < b.length && WS[b[this.pos]]) this.pos++;
      if (b[this.pos] !== 37) return;
      while (this.pos < b.length && b[this.pos] !== 10 && b[this.pos] !== 13) this.pos++;
    }
  }

  // Next object or operator; undefined at the end. Ends of arrays and dicts come back as Op(']') and Op('>>').
  token() {
    this.skip();
    const b = this.b;
    if (this.pos >= b.length) return undefined;
    const c = b[this.pos];
    if (c === 47) { // name
      let s = '';
      this.pos++;
      while (this.pos < b.length && !WS[b[this.pos]] && !DELIM[b[this.pos]]) {
        const ch = b[this.pos++];
        if (ch === 35 && this.pos + 1 < b.length) { s += String.fromCharCode(parseInt(latin1(b, this.pos, this.pos + 2), 16)); this.pos += 2; } else s += String.fromCharCode(ch);
      }
      return new Name(s);
    }
    if (c === 40) return this.literal();
    if (c === 60) {
      if (b[this.pos + 1] === 60) { this.pos += 2; return new Op('<<'); }
      const end = b.indexOf(62, this.pos);
      const hex = latin1(b, this.pos + 1, end < 0 ? b.length : end).replace(/[^0-9a-fA-F]/g, '');
      this.pos = end < 0 ? b.length : end + 1;
      return new Str(hexBytes(hex));
    }
    if (c === 62 && b[this.pos + 1] === 62) { this.pos += 2; return new Op('>>'); }
    if (DELIM[c]) { this.pos++; return new Op(String.fromCharCode(c)); }
    const start = this.pos;
    while (this.pos < b.length && !WS[b[this.pos]] && !DELIM[b[this.pos]]) this.pos++;
    const s = latin1(b, start, this.pos);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return parseFloat(s);
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s === 'null') return null;
    return new Op(s);
  }

  literal() {
    const b = this.b;
    const out = [];
    let depth = 1;
    this.pos++;
    while (this.pos < b.length) {
      let c = b[this.pos++];
      if (c === 40) depth++;
      else if (c === 41 && --depth === 0) break;
      else if (c === 92) {
        c = b[this.pos++];
        const esc = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12 }[c];
        if (esc != null) c = esc;
        else if (c === 13 || c === 10) { if (c === 13 && b[this.pos] === 10) this.pos++; continue; }
        else if (c >= 48 && c <= 55) {
          let v = c - 48;
          for (let k = 0; k < 2 && b[this.pos] >= 48 && b[this.pos] <= 55; k++) v = v * 8 + b[this.pos++] - 48;
          c = v & 255;
        }
      }
      out.push(c);
    }
    return new Str(Uint8Array.from(out));
  }

  // A full object: arrays, dicts and "n g R" references are assembled here.
  object(refs = true) {
    const t = this.token();
    if (t instanceof Op) {
      if (t.o === '[') {
        const arr = [];
        for (;;) {
          const save = this.pos;
          const v = this.token();
          if (v === undefined || (v instanceof Op && v.o === ']')) return arr;
          this.pos = save;
          arr.push(this.object(refs));
        }
      }
      if (t.o === '<<') {
        const d = {};
        for (;;) {
          const k = this.token();
          if (k === undefined || (k instanceof Op && k.o === '>>')) return d;
          if (k instanceof Name) d[k.n] = this.object(refs);
        }
      }
      return t;
    }
    if (refs && typeof t === 'number' && Number.isInteger(t)) {
      const save = this.pos;
      const g = this.token();
      if (typeof g === 'number') {
        const r = this.token();
        if (r instanceof Op && r.o === 'R') return new Ref(t, g);
      }
      this.pos = save;
    }
    return t;
  }
}

export function hexBytes(hex) {
  if (hex.length % 2) hex += '0';
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

const find = (b, s, from = 0) => {
  const first = s.charCodeAt(0);
  outer: for (let i = b.indexOf(first, from); i >= 0; i = b.indexOf(first, i + 1)) {
    for (let k = 1; k < s.length; k++) if (b[i + k] !== s.charCodeAt(k)) continue outer;
    return i;
  }
  return -1;
};

// Filters ---------------------------------------------------------------

async function inflate(data) {
  // Keep what was decoded before any error: many files have damaged or padded streams.
  const chunks = [];
  try {
    const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } catch { /* partial data */ }
  return concat(chunks);
}

export async function deflate(data) {
  return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
}

export function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function unpredict(data, p) {
  const pred = p?.Predictor ?? 1;
  if (pred < 10) return data;
  const colors = p.Colors ?? 1;
  const bpp = Math.max(1, Math.ceil((colors * (p.BitsPerComponent ?? 8)) / 8));
  const row = Math.ceil((colors * (p.BitsPerComponent ?? 8) * (p.Columns ?? 1)) / 8);
  const rows = Math.floor(data.length / (row + 1));
  const out = new Uint8Array(rows * row);
  for (let r = 0; r < rows; r++) {
    const type = data[r * (row + 1)];
    const src = r * (row + 1) + 1;
    const o = r * row;
    for (let i = 0; i < row; i++) {
      const a = i >= bpp ? out[o + i - bpp] : 0;
      const up = r ? out[o + i - row] : 0;
      const ul = r && i >= bpp ? out[o + i - row - bpp] : 0;
      let v = data[src + i];
      if (type === 1) v += a;
      else if (type === 2) v += up;
      else if (type === 3) v += (a + up) >> 1;
      else if (type === 4) {
        const pa = Math.abs(up - ul), pb = Math.abs(a - ul), pc = Math.abs(a + up - 2 * ul);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : ul;
      }
      out[o + i] = v;
    }
  }
  return out;
}

function ascii85(data) {
  const s = latin1(data).replace(/\s/g, '').replace(/^<~/, '');
  const out = [];
  let tuple = [];
  for (const ch of s) {
    if (ch === '~') break;
    if (ch === 'z' && !tuple.length) { out.push(0, 0, 0, 0); continue; }
    tuple.push(ch.charCodeAt(0) - 33);
    if (tuple.length === 5) {
      let v = 0;
      for (const d of tuple) v = v * 85 + d;
      out.push(v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
      tuple = [];
    }
  }
  if (tuple.length) {
    const n = tuple.length;
    while (tuple.length < 5) tuple.push(84);
    let v = 0;
    for (const d of tuple) v = v * 85 + d;
    out.push(...[v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].slice(0, n - 1));
  }
  return Uint8Array.from(out);
}

function lzw(data, early = 1) {
  const out = [];
  let dict = [], bits = 9, buf = 0, nbits = 0, prev = null;
  const reset = () => { dict = []; for (let i = 0; i < 256; i++) dict.push([i]); dict.push(null, null); bits = 9; prev = null; };
  reset();
  for (const byte of data) {
    buf = (buf << 8) | byte;
    nbits += 8;
    while (nbits >= bits) {
      const code = (buf >>> (nbits - bits)) & ((1 << bits) - 1);
      nbits -= bits;
      if (code === 256) { reset(); continue; }
      if (code === 257) return Uint8Array.from(out);
      let entry = dict[code];
      if (!entry && prev) entry = prev.concat(prev[0]);
      if (!entry) return Uint8Array.from(out);
      out.push(...entry);
      if (prev) dict.push(prev.concat(entry[0]));
      prev = entry;
      if (dict.length + early >= 1 << bits && bits < 12) bits++;
    }
  }
  return Uint8Array.from(out);
}

const IMAGE_FILTERS = new Set(['DCTDecode', 'JPXDecode', 'CCITTFaxDecode', 'JBIG2Decode', 'DCT', 'CCF']);

// Document --------------------------------------------------------------

export class PdfDoc {
  constructor(b) {
    this.b = b;
    this.xref = new Map(); // num -> { off } | { stm, idx }
    this.cache = new Map();
    this.objStms = new Map();
    this.trailer = {};
    this.xrefStream = false;
    this.startxref = 0;
  }

  static async open(buffer) {
    const doc = new PdfDoc(new Uint8Array(buffer));
    if (find(doc.b.subarray(0, 1024), '%PDF') < 0) throw new PdfError('invalid');
    try { await doc.readXref(); } catch { doc.xref.clear(); }
    if (!doc.xref.size || !doc.trailer.Root) doc.rebuild();
    if (doc.trailer.Encrypt) throw new PdfError('encrypted');
    await doc.loadObjStms();
    doc.pages = doc.collectPages();
    if (!doc.pages.length) throw new PdfError('invalid');
    return doc;
  }

  async readXref() {
    const b = this.b;
    const tail = latin1(b, Math.max(0, b.length - 2048));
    const m = /startxref\s+(\d+)(?![\s\S]*startxref)/.exec(tail);
    if (!m) throw new Error('no startxref');
    let off = this.startxref = +m[1];
    const seen = new Set();
    let first = true;
    while (off != null && !seen.has(off) && off < b.length) {
      seen.add(off);
      const lx = new Lexer(b, off);
      lx.skip();
      let trailer;
      if (latin1(b, lx.pos, lx.pos + 4) === 'xref') {
        lx.pos += 4;
        for (;;) {
          const start = lx.token();
          if (start instanceof Op) break; // "trailer"
          const count = lx.token();
          for (let i = 0; i < count; i++) {
            const o = lx.token(), g = lx.token(), type = lx.token();
            // Free entries are left unset: in hybrid files the stream below fills them.
            if (!this.xref.has(start + i) && type?.o === 'n') this.xref.set(start + i, { off: o, gen: g });
          }
        }
        trailer = lx.object();
        if (trailer.XRefStm) await this.readXrefStream(trailer.XRefStm);
      } else {
        trailer = (await this.readXrefStream(off));
        if (first) this.xrefStream = true;
      }
      for (const k in trailer) if (!(k in this.trailer)) this.trailer[k] = trailer[k];
      first = false;
      off = trailer.Prev;
    }
  }

  async readXrefStream(off) {
    const s = this.parseAt(off);
    if (!(s instanceof Stream)) throw new Error('bad xref');
    const d = s.dict;
    const data = await this.decode(s);
    const [w0, w1, w2] = d.W;
    const index = d.Index || [0, d.Size];
    let p = 0;
    const field = (w, dflt) => {
      if (!w) return dflt;
      let v = 0;
      for (let i = 0; i < w; i++) v = v * 256 + data[p++];
      return v;
    };
    for (let k = 0; k < index.length; k += 2) {
      for (let i = 0; i < index[k + 1]; i++) {
        const type = field(w0, 1), a = field(w1, 0), c = field(w2, 0);
        const num = index[k] + i;
        if (this.xref.has(num)) continue;
        this.xref.set(num, type === 1 ? { off: a, gen: c } : type === 2 ? { stm: a, idx: c } : null);
      }
    }
    return d;
  }

  // Damaged file: find every "n g obj" and the catalog by scanning.
  rebuild() {
    this.xref.clear();
    this.cache.clear();
    const s = latin1(this.b);
    const re = /(?:^|[^\d])(\d+)\s+(\d+)\s+obj\b/g;
    let m;
    while ((m = re.exec(s))) this.xref.set(+m[1], { off: m.index + m[0].indexOf(m[1]), gen: +m[2] });
    const trailers = [...s.matchAll(/trailer\s*<</g)];
    for (const t of trailers.reverse()) {
      const d = new Lexer(this.b, t.index + 7).object();
      for (const k in d) if (!(k in this.trailer)) this.trailer[k] = d[k];
    }
    for (const [num, e] of this.xref) {
      if (this.trailer.Root) break;
      let v;
      try { v = this.parseAt(e.off); } catch { continue; }
      const d = v instanceof Stream ? v.dict : v;
      if (nameOf(d?.Type) === 'XRef' && d.Root) Object.assign(this.trailer, d);
      if (nameOf(d?.Type) === 'Catalog') this.trailer.Root = new Ref(num, e.gen);
    }
    this.xrefStream = false;
    this.startxref = 0;
  }

  async loadObjStms() {
    const nums = new Set();
    for (const e of this.xref.values()) if (e && e.stm != null) nums.add(e.stm);
    for (const n of nums) {
      try {
        const s = this.get(new Ref(n, 0));
        const data = await this.decode(s);
        const lx = new Lexer(data);
        const offs = [];
        for (let i = 0; i < s.dict.N; i++) offs.push([lx.token(), lx.token()]);
        this.objStms.set(n, offs.map(([num, o]) => {
          const l = new Lexer(data, s.dict.First + o);
          return [num, l.object()];
        }));
      } catch { /* skip a damaged object stream */ }
    }
  }

  parseAt(off) {
    const lx = new Lexer(this.b, off);
    lx.token(); lx.token();
    const kw = lx.token();
    if (!(kw instanceof Op) || kw.o !== 'obj') throw new Error('not an object');
    const v = lx.object();
    lx.skip();
    if (isDict(v) && latin1(this.b, lx.pos, lx.pos + 6) === 'stream') {
      let p = lx.pos + 6;
      if (this.b[p] === 13) p++;
      if (this.b[p] === 10) p++;
      let len = v.Length instanceof Ref ? this.get(v.Length) : v.Length;
      const end = find(this.b, 'endstream', p);
      if (typeof len !== 'number' || p + len > this.b.length || (end >= 0 && p + len > end)) {
        len = (end < 0 ? this.b.length : end) - p;
        while (len > 0 && WS[this.b[p + len - 1]]) len--;
      }
      return new Stream(v, this.b.subarray(p, p + len));
    }
    return v;
  }

  get(v) {
    if (!(v instanceof Ref)) return v;
    if (this.cache.has(v.num)) return this.cache.get(v.num);
    this.cache.set(v.num, null); // guards against reference loops
    const e = this.xref.get(v.num);
    let out = null;
    try {
      if (e?.off != null) out = this.parseAt(e.off);
      else if (e?.stm != null) out = this.objStms.get(e.stm)?.find(([n]) => n === v.num)?.[1] ?? null;
    } catch { out = null; }
    this.cache.set(v.num, out);
    return out;
  }

  // Resolves a dict entry, following references.
  r(d, key) { return d ? this.get(d instanceof Stream ? d.dict[key] : d[key]) : undefined; }

  async decode(s, stopAtImage = false) {
    if (!(s instanceof Stream)) return new Uint8Array(0);
    let data = s.data;
    const fs = [].concat(this.get(s.dict.Filter ?? s.dict.F) ?? []).map((f) => nameOf(this.get(f)));
    const ps = [].concat(this.get(s.dict.DecodeParms ?? s.dict.DP) ?? []).map((p) => this.get(p));
    for (let i = 0; i < fs.length; i++) {
      const f = fs[i];
      if (IMAGE_FILTERS.has(f)) {
        if (stopAtImage) return { data, filter: f.startsWith('DCT') ? 'DCTDecode' : f, parms: ps[i] };
        break;
      }
      if (f === 'FlateDecode' || f === 'Fl') data = unpredict(await inflate(data), ps[i]);
      else if (f === 'LZWDecode' || f === 'LZW') data = unpredict(lzw(data, ps[i]?.EarlyChange ?? 1), ps[i]);
      else if (f === 'ASCIIHexDecode' || f === 'AHx') data = hexBytes(latin1(data).replace(/>[\s\S]*$/, '').replace(/[^0-9a-fA-F]/g, ''));
      else if (f === 'ASCII85Decode' || f === 'A85') data = ascii85(data);
      else if (f === 'RunLengthDecode' || f === 'RL') data = runLength(data);
      else break;
    }
    return stopAtImage ? { data, filter: null } : data;
  }

  collectPages() {
    const pages = [];
    const seen = new Set();
    const walk = (ref, inh, depth) => {
      const node = this.get(ref);
      if (!isDict(node) || depth > 50 || (ref instanceof Ref && seen.has(ref.num))) return;
      if (ref instanceof Ref) seen.add(ref.num);
      const here = { ...inh };
      for (const k of ['Resources', 'MediaBox', 'CropBox', 'Rotate']) if (node[k] != null) here[k] = this.get(node[k]);
      const kids = this.get(node.Kids);
      if (Array.isArray(kids) && nameOf(node.Type) !== 'Page') for (const k of kids) walk(k, here, depth + 1);
      else if (ref instanceof Ref) pages.push(this.pageInfo(ref, node, here));
    };
    walk(this.get(this.trailer.Root)?.Pages, {}, 0);
    return pages;
  }

  pageInfo(ref, dict, inh) {
    const box = (b) => (Array.isArray(b) && b.length === 4 ? b.map((v) => +this.get(v) || 0) : null);
    const norm = (b) => [Math.min(b[0], b[2]), Math.min(b[1], b[3]), Math.max(b[0], b[2]), Math.max(b[1], b[3])];
    const media = norm(box(inh.MediaBox) || [0, 0, 612, 792]);
    const crop = box(inh.CropBox) ? norm(box(inh.CropBox)) : media;
    const view = [Math.max(media[0], crop[0]), Math.max(media[1], crop[1]), Math.min(media[2], crop[2]), Math.min(media[3], crop[3])];
    const ok = view[2] - view[0] > 1 && view[3] - view[1] > 1;
    const rotate = (((Math.round((+inh.Rotate || 0) / 90) * 90) % 360) + 360) % 360;
    const v = ok ? view : media;
    const w = v[2] - v[0], h = v[3] - v[1];
    return { ref, dict, resources: isDict(inh.Resources) ? inh.Resources : {}, view: v, rotate, width: rotate % 180 ? h : w, height: rotate % 180 ? w : h };
  }

  async contents(page) {
    const c = this.get(page.dict.Contents);
    const list = Array.isArray(c) ? c.map((x) => this.get(x)) : [c];
    const parts = [];
    for (const s of list) { parts.push(await this.decode(s), bytes('\n')); }
    return concat(parts);
  }
}

function runLength(data) {
  const out = [];
  for (let i = 0; i < data.length;) {
    const n = data[i++];
    if (n === 128) break;
    if (n < 128) { for (let k = 0; k <= n; k++) out.push(data[i++]); } else { const v = data[i++]; for (let k = 0; k < 257 - n; k++) out.push(v); }
  }
  return Uint8Array.from(out);
}

// Maps PDF user space to page pixels at the given scale, applying the crop box and rotation.
export function viewport(page, s) {
  const [x0, y0, x1, y1] = page.view;
  switch (page.rotate) {
    case 90: return [0, s, s, 0, -y0 * s, -x0 * s];
    case 180: return [-s, 0, 0, s, x1 * s, -y0 * s];
    case 270: return [0, -s, -s, 0, y1 * s, x1 * s];
    default: return [s, 0, 0, -s, -x0 * s, y1 * s];
  }
}

// Row-vector product: transforming by a, then by b.
export const mul = (a, b) => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];
export const inverse = (m) => {
  const d = m[0] * m[3] - m[1] * m[2];
  return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d];
};
