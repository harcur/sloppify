// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Draws a page's content stream on a 2D canvas context: paths, colours,
// clipping, images and approximate text. A preview for placing a signature,
// not a full renderer: shadings, patterns and some image formats are skipped,
// and `missing` says so. The saved file always keeps the original content.

import { Lexer, Op, Name, Str, Stream, isDict, nameOf, mul, viewport } from './pdf.js';
import { loadFont } from './fonts.js';

const ID = [1, 0, 0, 1, 0, 0];
const CAPS = ['butt', 'round', 'square'];
const JOINS = ['miter', 'round', 'bevel'];
const ABBR = { BPC: 'BitsPerComponent', CS: 'ColorSpace', D: 'Decode', DP: 'DecodeParms', F: 'Filter', H: 'Height', W: 'Width', IM: 'ImageMask', I: 'Interpolate', G: 'DeviceGray', RGB: 'DeviceRGB', CMYK: 'DeviceCMYK' };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export async function renderPage(doc, page, ctx, scale) {
  const g = new Gfx(doc, ctx, viewport(page, scale));
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  await g.run(await doc.contents(page), page.resources, 0);
  return { missing: g.missing };
}

export class Gfx {
  constructor(doc, ctx, base) {
    this.doc = doc;
    this.ctx = ctx;
    this.base = base;
    this.missing = false;
    this.fonts = new Map();
    this.images = new Map();
    this.widths = new Map();
    this.st = { ctm: ID, fill: [0, 0, 0], stroke: [0, 0, 0], fcs: gray, scs: gray, fa: 1, sa: 1, lw: 1, font: null, fs: 1, tc: 0, tw: 0, th: 1, tl: 0, rise: 0, tr: 0, tm: ID, tlm: ID };
    this.stack = [];
    this.clip = null;
    this.cur = [0, 0];
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    this.setT();
  }

  setT(m = this.st.ctm) { this.ctx.setTransform(...mul(m, this.base)); }

  async run(data, res, depth) {
    const lx = new Lexer(data);
    const args = [];
    for (;;) {
      const t = lx.object(false);
      if (t === undefined) break;
      if (!(t instanceof Op) || t.o === '[' || t.o === '<<') { args.push(t); continue; }
      try {
        if (t.o === 'BI') await this.inline(lx, res);
        else await this.op(t.o, args, res, depth);
      } catch { /* skip a broken operator */ }
      args.length = 0;
    }
  }

  async op(o, a, res, depth) {
    const { ctx, st } = this;
    switch (o) {
      case 'q': this.stack.push({ ...st }); ctx.save(); break;
      case 'Q': if (this.stack.length) { this.st = this.stack.pop(); ctx.restore(); this.cssFont = null; this.setT(); } break;
      case 'cm': st.ctm = mul(a.slice(0, 6), st.ctm); this.setT(); break;
      case 'w': st.lw = a[0]; break;
      case 'J': ctx.lineCap = CAPS[a[0]] || 'butt'; break;
      case 'j': ctx.lineJoin = JOINS[a[0]] || 'miter'; break;
      case 'M': ctx.miterLimit = Math.max(1, a[0]); break;
      case 'd': ctx.setLineDash((a[0] || []).filter((v) => v >= 0)); ctx.lineDashOffset = a[1] || 0; break;
      case 'gs': this.extGState(this.doc.get(this.doc.r(res, 'ExtGState')?.[nameOf(a[0])])); break;
      case 'm': ctx.moveTo(a[0], a[1]); this.cur = [a[0], a[1]]; break;
      case 'l': ctx.lineTo(a[0], a[1]); this.cur = [a[0], a[1]]; break;
      case 'c': ctx.bezierCurveTo(...a.slice(0, 6)); this.cur = [a[4], a[5]]; break;
      case 'v': ctx.bezierCurveTo(this.cur[0], this.cur[1], a[0], a[1], a[2], a[3]); this.cur = [a[2], a[3]]; break;
      case 'y': ctx.bezierCurveTo(a[0], a[1], a[2], a[3], a[2], a[3]); this.cur = [a[2], a[3]]; break;
      case 'h': ctx.closePath(); break;
      case 're': ctx.rect(a[0], a[1], a[2], a[3]); this.cur = [a[0], a[1]]; break;
      case 'W': this.clip = 'nonzero'; break;
      case 'W*': this.clip = 'evenodd'; break;
      case 'f': case 'F': this.paint(true, false, 'nonzero'); break;
      case 'f*': this.paint(true, false, 'evenodd'); break;
      case 'S': this.paint(false, true); break;
      case 's': ctx.closePath(); this.paint(false, true); break;
      case 'B': this.paint(true, true, 'nonzero'); break;
      case 'B*': this.paint(true, true, 'evenodd'); break;
      case 'b': ctx.closePath(); this.paint(true, true, 'nonzero'); break;
      case 'b*': ctx.closePath(); this.paint(true, true, 'evenodd'); break;
      case 'n': this.paint(false, false); break;
      case 'g': st.fcs = gray; st.fill = gray.rgb(a); break;
      case 'G': st.scs = gray; st.stroke = gray.rgb(a); break;
      case 'rg': st.fcs = rgb; st.fill = rgb.rgb(a); break;
      case 'RG': st.scs = rgb; st.stroke = rgb.rgb(a); break;
      case 'k': st.fcs = cmyk; st.fill = cmyk.rgb(a); break;
      case 'K': st.scs = cmyk; st.stroke = cmyk.rgb(a); break;
      case 'cs': st.fcs = await this.space(a[0], res); st.fill = st.fcs?.initial ?? null; break;
      case 'CS': st.scs = await this.space(a[0], res); st.stroke = st.scs?.initial ?? null; break;
      case 'sc': case 'scn': st.fill = this.color(st.fcs, a); break;
      case 'SC': case 'SCN': st.stroke = this.color(st.scs, a); break;
      case 'sh': this.missing = true; break;
      case 'BT': st.tm = st.tlm = ID; break;
      case 'Tc': st.tc = a[0]; break;
      case 'Tw': st.tw = a[0]; break;
      case 'Tz': st.th = a[0] / 100; break;
      case 'TL': st.tl = a[0]; break;
      case 'Ts': st.rise = a[0]; break;
      case 'Tr': st.tr = a[0]; break;
      case 'Tf': st.font = await this.font(a[0], res); st.fs = a[1]; break;
      case 'Td': st.tm = st.tlm = mul([1, 0, 0, 1, a[0], a[1]], st.tlm); break;
      case 'TD': st.tl = -a[1]; st.tm = st.tlm = mul([1, 0, 0, 1, a[0], a[1]], st.tlm); break;
      case 'Tm': st.tm = st.tlm = a.slice(0, 6); break;
      case 'T*': st.tm = st.tlm = mul([1, 0, 0, 1, 0, -st.tl], st.tlm); break;
      case 'Tj': this.text(a[0]); break;
      case "'": await this.op('T*', [], res, depth); this.text(a[0]); break;
      case '"': st.tw = a[0]; st.tc = a[1]; await this.op('T*', [], res, depth); this.text(a[2]); break;
      case 'TJ':
        for (const v of a[0] || []) {
          if (typeof v === 'number') st.tm = mul([1, 0, 0, 1, (-v / 1000) * st.fs * st.th, 0], st.tm);
          else this.text(v);
        }
        break;
      case 'Do': await this.xobject(a[0], res, depth); break;
      default: break; // marked content, compatibility and type 3 operators
    }
  }

  extGState(gs) {
    if (!isDict(gs)) return;
    if (typeof gs.CA === 'number') this.st.sa = gs.CA;
    if (typeof gs.ca === 'number') this.st.fa = gs.ca;
    if (typeof gs.LW === 'number') this.st.lw = gs.LW;
  }

  paint(fill, stroke, rule) {
    const { ctx, st } = this;
    if (fill && st.fill) {
      ctx.globalAlpha = st.fa;
      ctx.fillStyle = css(st.fill);
      ctx.fill(rule);
    } else if (fill && !st.fill) this.missing = true;
    if (stroke && st.stroke) {
      const m = mul(st.ctm, this.base);
      const px = 1 / Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]) || 1);
      ctx.lineWidth = Math.max(st.lw, 0.7 * px);
      ctx.globalAlpha = st.sa;
      ctx.strokeStyle = css(st.stroke);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (this.clip) ctx.clip(this.clip);
    this.clip = null;
    ctx.beginPath();
  }

  color(space, a) {
    if (!space || a.some((v) => v instanceof Name)) { this.missing = true; return null; }
    return space.rgb(a);
  }

  async space(v, res, depth = 0) {
    const doc = this.doc;
    v = doc.get(v);
    const n = nameOf(v);
    if (n === 'DeviceGray' || n === 'CalGray' || n === 'G') return gray;
    if (n === 'DeviceRGB' || n === 'CalRGB' || n === 'RGB') return rgb;
    if (n === 'DeviceCMYK' || n === 'CMYK') return cmyk;
    if (n === 'Pattern') return null;
    if (n && depth < 4) {
      const named = doc.r(res, 'ColorSpace')?.[n];
      return named ? this.space(named, res, depth + 1) : gray;
    }
    if (!Array.isArray(v)) return gray;
    const kind = nameOf(doc.get(v[0]));
    if (kind === 'ICCBased') {
      const s = doc.get(v[1]);
      const k = +doc.get(s?.dict?.N) || 3;
      return k === 1 ? gray : k === 4 ? cmyk : rgb;
    }
    if (kind === 'CalRGB' || kind === 'Lab') return rgb;
    if (kind === 'CalGray') return gray;
    if (kind === 'Indexed' || kind === 'I') {
      const baseCs = await this.space(v[1], res, depth + 1) || rgb;
      const look = doc.get(v[3]);
      const tbl = look instanceof Str ? look.b : look instanceof Stream ? await doc.decode(look) : new Uint8Array(0);
      const hival = +doc.get(v[2]) || 0;
      const pal = [];
      for (let i = 0; i <= hival; i++) pal.push(baseCs.rgb([...tbl.subarray(i * baseCs.n, (i + 1) * baseCs.n)].map((x) => x / 255)));
      return { n: 1, indexed: true, pal, initial: pal[0] || [0, 0, 0], rgb: (c) => pal[Math.round(c[0])] || [0, 0, 0] };
    }
    if (kind === 'Separation' || kind === 'DeviceN') {
      const k = kind === 'Separation' ? 1 : (doc.get(v[1]) || []).length || 1;
      return { n: k, initial: [0, 0, 0], rgb: (c) => { const t = c.slice(0, k).reduce((s, x) => s + x, 0) / k; const l = 255 * (1 - t); return [l, l, l]; } };
    }
    if (kind === 'Pattern') return null;
    return gray;
  }

  async font(name, res) {
    const ref = this.doc.r(res, 'Font')?.[nameOf(name)];
    const key = ref?.num ?? nameOf(name);
    if (!this.fonts.has(key)) {
      const d = this.doc.get(ref);
      this.fonts.set(key, isDict(d) ? await loadFont(this.doc, d) : null);
    }
    return this.fonts.get(key);
  }

  measure(f, ch) {
    const key = f.css + ch;
    let w = this.widths.get(key);
    if (w == null) {
      if (this.cssFont !== f.css) this.ctx.font = this.cssFont = f.css;
      w = this.ctx.measureText(ch).width / 100;
      this.widths.set(key, w);
    }
    return w;
  }

  text(s) {
    const { ctx, st } = this;
    const f = st.font;
    if (!f || !(s instanceof Str)) return;
    if (f.type3) this.missing = true;
    const b = s.b;
    const visible = st.tr !== 3 && st.tr !== 7 && !f.type3 && st.fill;
    if (visible) { ctx.fillStyle = css(st.fill); ctx.globalAlpha = st.fa; }
    for (let i = 0; i + f.bytes <= b.length; i += f.bytes) {
      const code = f.bytes === 2 ? (b[i] << 8) | b[i + 1] : b[i];
      const ch = f.uni(code);
      let w = f.width(code);
      const measured = ch ? this.measure(f, ch) : 0;
      if (visible && ch && ch.trim()) {
        if (this.cssFont !== f.css) ctx.font = this.cssFont = f.css;
        const sx = w != null && measured > 0 ? clamp(w / 1000 / measured, 0.5, 2) : 1;
        const trm = mul([st.fs * st.th, 0, 0, st.fs, 0, st.rise], mul(st.tm, st.ctm));
        ctx.setTransform(...mul([0.01 * sx, 0, 0, -0.01, 0, 0], mul(trm, this.base)));
        ctx.fillText(ch, 0, 0);
      }
      if (w == null) w = measured * 1000;
      const tx = ((w / 1000) * st.fs + st.tc + (code === 32 && f.bytes === 1 ? st.tw : 0)) * st.th;
      st.tm = mul([1, 0, 0, 1, tx, 0], st.tm);
    }
    ctx.globalAlpha = 1;
    this.setT();
  }

  async xobject(name, res, depth) {
    const doc = this.doc;
    const ref = doc.r(res, 'XObject')?.[nameOf(name)];
    const x = doc.get(ref);
    if (!(x instanceof Stream)) return;
    const type = nameOf(doc.get(x.dict.Subtype));
    if (type === 'Form' && depth < 12) {
      const { ctx } = this;
      this.stack.push({ ...this.st });
      ctx.save();
      const m = doc.get(x.dict.Matrix);
      if (Array.isArray(m) && m.length === 6) this.st.ctm = mul(m.map((v) => +doc.get(v)), this.st.ctm);
      this.setT();
      const bb = doc.get(x.dict.BBox);
      if (Array.isArray(bb) && bb.length === 4) {
        const [x0, y0, x1, y1] = bb.map((v) => +doc.get(v));
        ctx.beginPath();
        ctx.rect(x0, y0, x1 - x0, y1 - y0);
        ctx.clip();
        ctx.beginPath();
      }
      await this.run(await doc.decode(x), doc.r(x, 'Resources') || res, depth + 1);
      this.st = this.stack.pop();
      ctx.restore();
      this.cssFont = null;
      this.setT();
    } else if (type === 'Image') {
      const key = ref?.num;
      let bmp = key != null && !doc.get(x.dict.ImageMask) ? this.images.get(key) : undefined;
      if (bmp === undefined) {
        bmp = await this.image(x.dict, await doc.decode(x, true), res);
        if (key != null && !doc.get(x.dict.ImageMask)) this.images.set(key, bmp);
      }
      this.drawImage(bmp);
    }
  }

  drawImage(bmp) {
    if (!bmp) { this.missing = true; return; }
    const { ctx } = this;
    this.setT(mul([1, 0, 0, -1, 0, 1], this.st.ctm));
    ctx.globalAlpha = this.st.fa;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(bmp, 0, 0, 1, 1);
    ctx.globalAlpha = 1;
    this.setT();
  }

  async inline(lx, res) {
    const dict = {};
    for (;;) {
      const k = lx.object(false);
      if (k === undefined || (k instanceof Op && k.o === 'ID')) break;
      const v = lx.object(false);
      const key = ABBR[nameOf(k)] || nameOf(k);
      dict[key] = v instanceof Name && ABBR[v.n] ? new Name(ABBR[v.n]) : v;
    }
    const b = lx.b;
    const start = lx.pos + 1;
    let end = start;
    for (end = start; end < b.length - 1; end++) {
      if (b[end] === 69 && b[end + 1] === 73 && (end + 2 >= b.length || b[end + 2] <= 32) && b[end - 1] <= 32) break;
    }
    lx.pos = end + 2;
    const stream = new Stream(dict, b.subarray(start, end));
    this.drawImage(await this.image(dict, await this.doc.decode(stream, true), res));
  }

  async image(dict, { data, filter }, res) {
    const doc = this.doc;
    if (filter === 'DCTDecode') {
      try { return await createImageBitmap(new Blob([data], { type: 'image/jpeg' })); } catch { return null; }
    }
    if (filter) return null;
    const W = +doc.get(dict.Width), H = +doc.get(dict.Height);
    if (!(W > 0 && H > 0) || W * H > 3e7) return null;
    const mask = !!doc.get(dict.ImageMask);
    const bpc = mask ? 1 : +doc.get(dict.BitsPerComponent) || 8;
    const cs = mask ? gray : await this.space(dict.ColorSpace, res) || gray;
    const n = cs.n;
    const stride = Math.ceil((W * n * bpc) / 8);
    const max = (1 << (bpc === 16 ? 8 : bpc)) - 1;
    const dec = doc.get(dict.Decode);
    const inv = Array.isArray(dec) && +doc.get(dec[0]) > +doc.get(dec[1]);
    const out = new Uint8ClampedArray(W * H * 4);
    const comps = new Array(n);
    const fill = this.st.fill || [0, 0, 0];
    for (let y = 0; y < H; y++) {
      const row = y * stride;
      for (let x = 0; x < W; x++) {
        for (let c = 0; c < n; c++) {
          const bit = (x * n + c) * bpc;
          let v;
          if (bpc === 8) v = data[row + x * n + c];
          else if (bpc === 16) v = data[row + (x * n + c) * 2];
          else v = (data[row + (bit >> 3)] >> (8 - bpc - (bit & 7))) & max;
          v = v ?? 0;
          if (inv) v = max - v;
          comps[c] = cs.indexed ? v : v / max;
        }
        const o = (y * W + x) * 4;
        if (mask) {
          if (comps[0] === 0) { out[o] = fill[0]; out[o + 1] = fill[1]; out[o + 2] = fill[2]; out[o + 3] = 255; }
          continue;
        }
        const p = cs.rgb(comps);
        out[o] = p[0]; out[o + 1] = p[1]; out[o + 2] = p[2]; out[o + 3] = 255;
      }
    }
    const sm = doc.get(dict.SMask);
    if (sm instanceof Stream && +doc.get(sm.dict.Width) === W && +doc.get(sm.dict.Height) === H && (+doc.get(sm.dict.BitsPerComponent) || 8) === 8) {
      const a = await doc.decode(sm);
      for (let i = 0; i < W * H; i++) out[i * 4 + 3] = a[i] ?? 255;
    }
    try { return await createImageBitmap(new ImageData(out, W, H)); } catch { return null; }
  }
}

const gray = { n: 1, initial: [0, 0, 0], rgb: (c) => { const v = 255 * (c[0] ?? 0); return [v, v, v]; } };
const rgb = { n: 3, initial: [0, 0, 0], rgb: (c) => [255 * (c[0] ?? 0), 255 * (c[1] ?? 0), 255 * (c[2] ?? 0)] };
const cmyk = {
  n: 4,
  initial: [0, 0, 0],
  rgb: (c) => { const k = c[3] ?? 0; return [255 * (1 - Math.min(1, (c[0] ?? 0) + k)), 255 * (1 - Math.min(1, (c[1] ?? 0) + k)), 255 * (1 - Math.min(1, (c[2] ?? 0) + k))]; },
};
const css = (c) => `rgb(${c.map((v) => Math.round(v)).join(',')})`;
