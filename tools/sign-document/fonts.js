// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Enough of a PDF font to place text roughly where it belongs: which
// characters the codes stand for, how wide each one is, and a similar system
// font to draw it with. Glyph shapes from embedded fonts aren't used.

import { Stream, latin1, nameOf, isDict } from './pdf.js';

const ASCII = 'space exclam quotedbl numbersign dollar percent ampersand quotesingle parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at'.split(' ');
const MORE = {
  bracketleft: '[', backslash: '\\', bracketright: ']', asciicircum: '^', underscore: '_', grave: '`', braceleft: '{', bar: '|', braceright: '}', asciitilde: '~',
  quoteleft: '‘', quoteright: '’', quotedblleft: '“', quotedblright: '”', quotesinglbase: '‚', quotedblbase: '„',
  endash: '–', emdash: '—', bullet: '•', ellipsis: '…', fi: 'fi', fl: 'fl', ff: 'ff', ffi: 'ffi', ffl: 'ffl', minus: '−',
  periodcentered: '·', degree: '°', copyright: '©', registered: '®', trademark: '™', Euro: '€', section: '§',
  paragraph: '¶', dagger: '†', daggerdbl: '‡', germandbls: 'ß', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ',
  oslash: 'ø', Oslash: 'Ø', guillemotleft: '«', guillemotright: '»', sterling: '£', yen: '¥', cent: '¢',
  multiply: '×', divide: '÷', plusminus: '±', nbspace: ' ', exclamdown: '¡', questiondown: '¿', dotlessi: 'ı',
};
const MARKS = { grave: '̀', acute: '́', circumflex: '̂', tilde: '̃', dieresis: '̈', ring: '̊', cedilla: '̧', caron: '̌' };
export const WIN = '€\0‚ƒ„…†‡ˆ‰Š‹Œ\0Ž\0\0‘’“”•–—˜™š›œ\0žŸ';

export function glyphChar(name) {
  if (name.length === 1) return name;
  const i = ASCII.indexOf(name);
  if (i >= 0) return String.fromCharCode(32 + i);
  if (MORE[name]) return MORE[name];
  let m = /^uni([0-9A-F]{4})/i.exec(name) || /^u([0-9A-F]{4,6})$/i.exec(name);
  if (m) return String.fromCodePoint(parseInt(m[1], 16));
  m = /^([A-Za-z])(grave|acute|circumflex|tilde|dieresis|ring|cedilla|caron)$/.exec(name);
  if (m) return (m[1] + MARKS[m[2]]).normalize('NFC');
  return '';
}

export function winAnsi(code) {
  if (code >= 0x80 && code < 0xA0) return WIN[code - 0x80].replace('\0', '');
  return code < 32 ? '' : String.fromCharCode(code);
}

const utf16 = (hex) => {
  if (hex.length <= 2) return String.fromCharCode(parseInt(hex || '0', 16));
  let s = '';
  for (let i = 0; i + 4 <= hex.length; i += 4) s += String.fromCharCode(parseInt(hex.substr(i, 4), 16));
  return s;
};

// ToUnicode CMap: bfchar and bfrange entries, and how many bytes a code takes.
export function parseCMap(text) {
  const map = new Map();
  let n = 2;
  const cs = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(text);
  const first = cs && /<([0-9a-f]+)>/i.exec(cs[1]);
  if (first) n = Math.max(1, first[1].length / 2);
  for (const blk of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of blk[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]*)>/gi)) map.set(parseInt(m[1], 16), utf16(m[2]));
  }
  for (const blk of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of blk[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(<[0-9a-f]*>|\[[^\]]*\])/gi)) {
      const lo = parseInt(m[1], 16), hi = Math.min(parseInt(m[2], 16), lo + 65535);
      if (m[3][0] === '[') {
        [...m[3].matchAll(/<([0-9a-f]*)>/gi)].forEach((d, i) => { if (lo + i <= hi) map.set(lo + i, utf16(d[1])); });
      } else {
        const dst = m[3].slice(1, -1);
        const head = dst.slice(0, -4), last = parseInt(dst.slice(-4) || '0', 16);
        for (let c = lo; c <= hi; c++) map.set(c, dst.length <= 2 ? String.fromCharCode(parseInt(dst, 16) + c - lo) : (head ? utf16(head) : '') + String.fromCharCode(last + c - lo));
      }
    }
  }
  return { map, n };
}

const FAMILY = {
  sans: 'Helvetica, Arial, "Liberation Sans", sans-serif',
  serif: '"Times New Roman", Times, "Liberation Serif", serif',
  mono: '"Courier New", Courier, "Liberation Mono", monospace',
};

export async function loadFont(doc, dict) {
  const sub = nameOf(doc.get(dict.Subtype));
  const base = (nameOf(doc.get(dict.BaseFont)) || '').replace(/^[A-Z]{6}\+/, '');
  const type0 = sub === 'Type0';
  const desc = type0 ? doc.get([].concat(doc.get(dict.DescendantFonts))[0]) || {} : dict;
  const fd = doc.get(desc.FontDescriptor) || doc.get(dict.FontDescriptor) || {};
  const flags = +doc.get(fd.Flags) || 0;

  let cmap = null;
  const tu = doc.get(dict.ToUnicode);
  if (tu instanceof Stream) {
    try { cmap = parseCMap(latin1(await doc.decode(tu))); } catch { cmap = null; }
  }

  const widths = new Map();
  let dw = null;
  if (type0) {
    dw = +doc.get(desc.DW) || 1000;
    const w = doc.get(desc.W) || [];
    for (let i = 0; i < w.length;) {
      const c = doc.get(w[i]), next = doc.get(w[i + 1]);
      if (Array.isArray(next)) { next.forEach((v, k) => widths.set(c + k, +doc.get(v))); i += 2; } else {
        const last = Math.min(next, c + 65535), v = +doc.get(w[i + 2]);
        for (let k = c; k <= last; k++) widths.set(k, v);
        i += 3;
      }
    }
  } else {
    const fc = +doc.get(dict.FirstChar) || 0;
    const fm = sub === 'Type3' ? (doc.get(dict.FontMatrix) || [0.001])[0] * 1000 : 1;
    (doc.get(dict.Widths) || []).forEach((v, k) => { const n = +doc.get(v) * fm; if (n > 0) widths.set(fc + k, n); });
    const mw = +doc.get(fd.MissingWidth);
    if (mw > 0) dw = mw;
  }

  const diffs = new Map();
  const enc = doc.get(dict.Encoding);
  if (isDict(enc)) {
    let code = 0;
    for (const v of doc.get(enc.Differences) || []) {
      if (typeof v === 'number') code = v;
      else diffs.set(code++, glyphChar(nameOf(v) || ''));
    }
  }

  const symbol = /Symbol|Dingbats|Wingdings/i.test(base);
  const family = /Courier|Mono|Consol/i.test(base) || flags & 1 ? 'mono'
    : /Times|Serif|Roman|Georgia|Garamond|Cambria|Minion|Book|Palatino/i.test(base) && !/Sans/i.test(base) ? 'serif'
      : !base && flags & 2 ? 'serif' : 'sans';
  const bold = /Bold|Black|Heavy|Semibold|Demi/i.test(base) || +doc.get(fd.FontWeight) >= 600 || flags & 0x40000;
  const italic = /Italic|Oblique/i.test(base) || flags & 64;

  return {
    bytes: type0 ? (cmap?.n === 1 ? 1 : 2) : 1,
    type3: sub === 'Type3',
    css: `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}100px ${FAMILY[family]}`,
    uni(code) {
      const u = cmap?.map.get(code);
      if (u != null) return u;
      if (type0) return '';
      if (diffs.has(code)) return diffs.get(code);
      return symbol ? '' : winAnsi(code);
    },
    width: (code) => widths.get(code) ?? dw,
  };
}
