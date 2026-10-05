// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// The PDF's own form fields: read them for the page to show as inputs, and
// write the filled-in values back, with appearances so every viewer shows them.

import { Name, Ref, Str, Stream, isDict, nameOf, latin1, bytes, viewport } from './pdf.js';
import { WIN } from './fonts.js';

const N = (n) => new Name(n);

// Inheritable field attributes come from the nearest ancestor that has them.
function inherited(doc, d, key) {
  for (let i = 0; d && i < 20; i++, d = doc.get(d.Parent)) if (d[key] != null) return doc.get(d[key]);
  return undefined;
}

// The field a widget belongs to: itself when it has a name, else its parent.
const fieldOf = (doc, ref, w) => (w.T == null && w.Parent instanceof Ref ? w.Parent : ref);

function fullName(doc, d) {
  const parts = [];
  for (let i = 0; d && i < 20; i++, d = doc.get(d.Parent)) if (d.T instanceof Str) parts.unshift(text(d.T));
  return parts.join('.');
}

export function text(s) {
  const b = s?.b || new Uint8Array(0);
  if (b[0] === 0xFE && b[1] === 0xFF) {
    let out = '';
    for (let i = 2; i + 1 < b.length; i += 2) out += String.fromCharCode((b[i] << 8) | b[i + 1]);
    return out;
  }
  return latin1(b);
}

// Latin-1 when it fits, else UTF-16 with a byte order mark.
export function pdfString(s) {
  if (/^[\x00-\x7F\xA0-\xFF]*$/.test(s)) return new Str(bytes(s));
  const out = [0xFE, 0xFF];
  for (const c of s) for (const u of c.length > 1 ? [c.charCodeAt(0), c.charCodeAt(1)] : [c.charCodeAt(0)]) out.push(u >> 8, u & 255);
  return new Str(Uint8Array.from(out));
}

const onStates = (doc, w) => Object.keys(doc.get(doc.get(w.AP)?.N) || {}).filter((k) => k !== 'Off');

// Every fillable widget, page by page, in display points.
export function readFields(doc) {
  const out = [];
  doc.pages.forEach((page, pi) => {
    const vp = viewport(page, 1);
    for (const ref of doc.get(page.dict.Annots) || []) {
      const w = doc.get(ref);
      if (!isDict(w) || nameOf(w.Subtype) !== 'Widget' || !(ref instanceof Ref)) continue;
      const ft = nameOf(inherited(doc, w, 'FT'));
      const ff = +inherited(doc, w, 'Ff') || 0;
      const rect = (doc.get(w.Rect) || []).map((v) => +doc.get(v));
      if (rect.length !== 4 || (+doc.get(w.F) || 0) & 2) continue;
      let type = null;
      if (ft === 'Tx') type = 'text';
      else if (ft === 'Ch') type = 'choice';
      else if (ft === 'Btn' && !(ff & 65536)) type = ff & 32768 ? 'radio' : 'check';
      if (!type) continue;
      const fref = fieldOf(doc, ref, w);
      const f = doc.get(fref);
      const v = inherited(doc, w, 'V');
      const pts = [[rect[0], rect[1]], [rect[2], rect[3]]].map(([x, y]) => [vp[0] * x + vp[2] * y + vp[4], vp[1] * x + vp[3] * y + vp[5]]);
      const x = Math.min(pts[0][0], pts[1][0]), y = Math.min(pts[0][1], pts[1][1]);
      const field = {
        id: ref.num, field: fref.num, page: pi, type, name: text(f?.TU) || fullName(doc, f),
        x, y, w: Math.abs(pts[0][0] - pts[1][0]), h: Math.abs(pts[0][1] - pts[1][1]),
        readOnly: !!(ff & 1), multiline: !!(ff & 4096), maxLen: +inherited(doc, w, 'MaxLen') || 0,
      };
      if (type === 'text') field.value = v instanceof Str ? text(v) : '';
      else if (type === 'choice') {
        field.options = (inherited(doc, w, 'Opt') || []).map((o) => { o = doc.get(o); return text(Array.isArray(o) ? doc.get(o[1]) : o); });
        field.value = v instanceof Str ? text(v) : Array.isArray(v) && v[0] instanceof Str ? text(v[0]) : '';
      } else {
        field.on = onStates(doc, w)[0] || 'Yes';
        field.value = nameOf(v) === field.on;
      }
      out.push(field);
    }
  });
  return out;
}

// WinAnsi bytes for an appearance stream, or null when a character doesn't fit.
function winAnsiBytes(s) {
  const out = [];
  for (const c of s) {
    const k = c.charCodeAt(0);
    if (c.length > 1) return null;
    if ((k >= 32 && k < 127) || (k >= 0xA0 && k <= 0xFF)) out.push(k);
    else if (WIN.indexOf(c) >= 0 && c !== '\0') out.push(0x80 + WIN.indexOf(c));
    else return null;
  }
  return out;
}
const lit = (b) => `(${b.map((k) => (k === 40 || k === 41 || k === 92 ? `\\${String.fromCharCode(k)}` : k < 32 || k > 126 ? `\\${k.toString(8).padStart(3, '0')}` : String.fromCharCode(k))).join('')})`;

function textAppearance(doc, w, value, multiline, fontRef) {
  const rect = (doc.get(w.Rect) || []).map((v) => +doc.get(v));
  const bw = Math.abs(rect[2] - rect[0]), bh = Math.abs(rect[3] - rect[1]);
  const da = latin1(inherited(doc, w, 'DA')?.b || new Uint8Array(0));
  const set = +(/([\d.]+)\s+Tf/.exec(da)?.[1] || 0);
  const lines = multiline ? value.split(/\r\n|\r|\n/) : [value.replace(/[\r\n]+/g, ' ')];
  const enc = lines.map(winAnsiBytes);
  if (enc.some((l) => !l)) return null;
  const fs = set > 0 ? set : multiline ? 10 : Math.max(4, Math.min(12, (bh - 4) * 0.75));
  const top = multiline ? bh - 2 - fs : (bh - fs) / 2 + fs * 0.22;
  const body = enc.map((l, i) => `${i ? `0 ${-(fs * 1.15).toFixed(2)} Td ` : ''}${lit(l)} Tj`).join(' ');
  const content = `/Tx BMC q 1 1 ${(bw - 2).toFixed(2)} ${(bh - 2).toFixed(2)} re W n BT /SlpHelv ${fs.toFixed(2)} Tf 0 g 2 ${top.toFixed(2)} Td ${body} ET Q EMC\n`;
  return new Stream({ Type: N('XObject'), Subtype: N('Form'), BBox: [0, 0, bw, bh], Resources: { Font: { SlpHelv: fontRef } } }, bytes(content));
}

// values: { [widget id]: string | boolean }. Adds changed objects to `mods` (num -> [gen, body]).
export function fillFields(doc, values, mods, alloc) {
  const fields = readFields(doc).filter((f) => f.id in values && values[f.id] !== f.value && !f.readOnly);
  if (!fields.length) return;
  const edit = (num) => {
    if (!mods.has(num)) mods.set(num, [doc.xref.get(num)?.gen || 0, { ...doc.get(new Ref(num, 0)) }]);
    return mods.get(num)[1];
  };
  let fontRef = null;
  const font = () => {
    if (!fontRef) {
      fontRef = new Ref(alloc(), 0);
      mods.set(fontRef.num, [0, { Type: N('Font'), Subtype: N('Type1'), BaseFont: N('Helvetica'), Encoding: N('WinAnsiEncoding') }]);
    }
    return fontRef;
  };
  for (const f of fields) {
    const value = values[f.id];
    const field = edit(f.field);
    if (f.type === 'check' || f.type === 'radio') {
      // Each widget shows its own state; a radio group's value is the widget turned on.
      const state = value ? f.on : 'Off';
      edit(f.id).AS = N(state);
      if (value || f.type === 'check') field.V = N(state);
    } else {
      field.V = pdfString(String(value));
      const widget = edit(f.id);
      const ap = textAppearance(doc, doc.get(new Ref(f.id, 0)), String(value), f.multiline, font());
      if (ap) {
        const apRef = new Ref(alloc(), 0);
        mods.set(apRef.num, [0, ap]);
        widget.AP = { N: apRef };
      }
    }
  }
  // Ask viewers to redraw text the appearances couldn't cover, and drop XFA so they use these values.
  const rootRef = doc.trailer.Root;
  const root = doc.get(rootRef);
  const af = root?.AcroForm;
  if (af instanceof Ref) {
    const d = edit(af.num);
    d.NeedAppearances = true;
    delete d.XFA;
  } else if (isDict(af) && rootRef instanceof Ref) {
    const r = edit(rootRef.num);
    r.AcroForm = { ...af, NeedAppearances: true };
    delete r.AcroForm.XFA;
  }
}
