// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Writes signed PDFs. The signature, drawing and text on each page are one
// transparent image placed over the page. They're appended as an incremental
// update, so every byte of the original file stays as it was.

import { Name, Ref, Str, Stream, isDict, bytes, concat, deflate, inverse, mul, viewport } from './pdf.js';
import { fillFields } from './forms.js';

const DELIMS = '()<>[]{}/%#';

export function ser(v) {
  if (v == null) return 'null';
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(+v.toFixed(5));
  if (v instanceof Name) {
    return `/${[...v.n].map((c) => {
      const k = c.charCodeAt(0);
      return k < 33 || k > 126 || DELIMS.includes(c) ? `#${k.toString(16).padStart(2, '0')}` : c;
    }).join('')}`;
  }
  if (v instanceof Ref) return `${v.num} ${v.gen} R`;
  if (v instanceof Str) return `<${[...v.b].map((b) => b.toString(16).padStart(2, '0')).join('')}>`;
  if (Array.isArray(v)) return `[${v.map(ser).join(' ')}]`;
  if (isDict(v)) return `<<${Object.entries(v).map(([k, x]) => `${ser(new Name(k))} ${ser(x)}`).join(' ')}>>`;
  return 'null';
}

const N = (n) => new Name(n);
const obj = (num, gen, body) => (body instanceof Stream
  ? concat([bytes(`${num} ${gen} obj\n${ser({ ...body.dict, Length: body.data.length })}\nstream\n`), body.data, bytes('\nendstream\nendobj\n')])
  : bytes(`${num} ${gen} obj\n${ser(body)}\nendobj\n`));

// The page-to-image matrix for a rectangle given in display points (y down, page rotation applied).
export function placement(page, { x, y, w, h }) {
  return mul([w, 0, 0, -h, x, y + h], inverse(viewport(page, 1)));
}

async function imageObjects(ov, smaskNum) {
  const n = ov.width * ov.height;
  const rgb = new Uint8Array(n * 3), alpha = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    rgb[i * 3] = ov.rgba[i * 4]; rgb[i * 3 + 1] = ov.rgba[i * 4 + 1]; rgb[i * 3 + 2] = ov.rgba[i * 4 + 2];
    alpha[i] = ov.rgba[i * 4 + 3];
  }
  const base = { Type: N('XObject'), Subtype: N('Image'), Width: ov.width, Height: ov.height, BitsPerComponent: 8, Filter: N('FlateDecode') };
  return [
    new Stream({ ...base, ColorSpace: N('DeviceGray') }, await deflate(alpha)),
    new Stream({ ...base, ColorSpace: N('DeviceRGB'), SMask: new Ref(smaskNum, 0) }, await deflate(rgb)),
  ];
}

// overlays: [{ page, rect: { x, y, w, h } in display points, width, height, rgba }]
// values: filled-in form fields, { [widget id]: string | boolean }.
export async function signPdf(doc, overlays, values = {}) {
  let next = [...doc.xref.keys()].reduce((m, n) => Math.max(m, n + 1), +doc.get(doc.trailer.Size) || 1);
  const objs = [];
  for (const ov of overlays) {
    const page = doc.pages[ov.page];
    const [smask, img, pre, post] = [next++, next++, next++, next++];
    const [sm, im] = await imageObjects(ov, smask);
    const xo = { ...(doc.get(page.resources.XObject) || {}) };
    let name = 'SlpSig';
    for (let i = 1; ; i++) if (!(`${name}${i}` in xo)) { name += i; break; }
    xo[name] = new Ref(img, 0);
    const m = placement(page, ov.rect);
    const c = page.dict.Contents;
    const list = c instanceof Ref ? (Array.isArray(doc.get(c)) ? doc.get(c) : [c]) : Array.isArray(c) ? c : [];
    objs.push(
      [smask, 0, sm], [img, 0, im],
      [pre, 0, new Stream({}, bytes('q\n'))],
      [post, 0, new Stream({}, bytes(`\nQ\nq ${m.map(ser).join(' ')} cm /${name} Do Q\n`))],
      [page.ref.num, page.ref.gen, { ...page.dict, Contents: [new Ref(pre, 0), ...list, new Ref(post, 0)], Resources: { ...page.resources, XObject: xo } }],
    );
  }
  const mods = new Map();
  fillFields(doc, values, mods, () => next++);
  for (const [num, [gen, body]] of mods) objs.push([num, gen, body]);
  return doc.startxref ? update(doc, objs, next) : rewrite(doc, objs, next);
}

function trailerKeys(doc) {
  const t = {};
  for (const k of ['Root', 'Info', 'ID']) if (doc.trailer[k] != null) t[k] = doc.trailer[k];
  return t;
}

function update(doc, objs, next) {
  const end = doc.b[doc.b.length - 1];
  const parts = [doc.b, ...(end === 10 || end === 13 ? [] : [bytes('\n')])];
  let off = parts.reduce((s, p) => s + p.length, 0);
  const offsets = new Map();
  for (const [num, gen, body] of objs) {
    const b = obj(num, gen, body);
    offsets.set(num, [off, gen]);
    parts.push(b);
    off += b.length;
  }
  if (doc.xrefStream) {
    const self = next++;
    offsets.set(self, [off, 0]);
    const nums = [...offsets.keys()].sort((a, b) => a - b);
    const data = new Uint8Array(nums.length * 7);
    nums.forEach((n, i) => {
      const [o, g] = offsets.get(n);
      data.set([1, o >>> 24, (o >>> 16) & 255, (o >>> 8) & 255, o & 255, g >> 8, g & 255], i * 7);
    });
    const index = runs(nums).flatMap(([s, c]) => [s, c]);
    parts.push(obj(self, 0, new Stream({ Type: N('XRef'), Size: next, W: [1, 4, 2], Index: index, Prev: doc.startxref, ...trailerKeys(doc) }, data)));
  } else {
    let x = 'xref\n';
    const nums = [...offsets.keys()].sort((a, b) => a - b);
    for (const [s, c] of runs(nums)) {
      x += `${s} ${c}\n`;
      for (let n = s; n < s + c; n++) {
        const [o, g] = offsets.get(n);
        x += `${String(o).padStart(10, '0')} ${String(g).padStart(5, '0')} n\r\n`;
      }
    }
    parts.push(bytes(`${x}trailer\n${ser({ Size: next, ...trailerKeys(doc), Prev: doc.startxref })}\n`));
  }
  parts.push(bytes(`startxref\n${off}\n%%EOF\n`));
  return concat(parts);
}

// Consecutive runs of object numbers: [[start, count], ...].
function runs(nums) {
  const out = [];
  for (const n of nums) {
    const last = out[out.length - 1];
    if (last && last[0] + last[1] === n) last[1]++;
    else out.push([n, 1]);
  }
  return out;
}

// For a damaged file without a usable cross-reference table: write every object out again.
function rewrite(doc, objs, next) {
  const replaced = new Map(objs.map(([n, g, b]) => [n, [g, b]]));
  const all = [];
  for (const [num, e] of doc.xref) {
    if (!e || replaced.has(num)) continue;
    const v = doc.get(new Ref(num, 0));
    const type = v instanceof Stream && v.dict.Type?.n;
    if (v == null || type === 'XRef' || type === 'ObjStm') continue;
    all.push([num, e.gen || 0, v]);
  }
  return fresh([...all, ...objs.map(([n, g, b]) => [n, g, b])], next, trailerKeys(doc));
}

function fresh(objs, size, trailer) {
  const parts = [bytes('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n')];
  let off = parts[0].length;
  const offsets = new Map();
  for (const [num, gen, body] of objs.sort((a, b) => a[0] - b[0])) {
    const b = obj(num, gen, body);
    offsets.set(num, [off, gen]);
    parts.push(b);
    off += b.length;
  }
  let x = `xref\n0 ${size}\n0000000000 65535 f\r\n`;
  for (let n = 1; n < size; n++) {
    const [o, g] = offsets.get(n) || [0, 65535];
    x += `${String(o).padStart(10, '0')} ${String(g).padStart(5, '0')} ${offsets.has(n) ? 'n' : 'f'}\r\n`;
  }
  parts.push(bytes(`${x}trailer\n${ser({ Size: size, ...trailer })}\nstartxref\n${off}\n%%EOF\n`));
  return concat(parts);
}

// A one-page PDF holding a JPEG, sized so the page is the width of A4.
export function imagePdf(jpeg, width, height) {
  const pw = 595.28, ph = +((pw * height) / width).toFixed(2);
  return fresh([
    [1, 0, { Type: N('Catalog'), Pages: new Ref(2, 0) }],
    [2, 0, { Type: N('Pages'), Kids: [new Ref(3, 0)], Count: 1 }],
    [3, 0, { Type: N('Page'), Parent: new Ref(2, 0), MediaBox: [0, 0, pw, ph], Resources: { XObject: { Im1: new Ref(4, 0) } }, Contents: new Ref(5, 0) }],
    [4, 0, new Stream({ Type: N('XObject'), Subtype: N('Image'), Width: width, Height: height, ColorSpace: N('DeviceRGB'), BitsPerComponent: 8, Filter: N('DCTDecode') }, jpeg)],
    [5, 0, new Stream({}, bytes(`q ${pw} 0 0 ${ph} 0 0 cm /Im1 Do Q\n`))],
  ], 6, { Root: new Ref(1, 0) });
}
