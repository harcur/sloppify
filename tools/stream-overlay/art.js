// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Draws a design into two transparent layers: back (under all content) and
// front (over the content of zones placed under the art). Uses only the 2D
// canvas API, so it runs in a worker on OffscreenCanvas or on the page.

import { field, noise, rng, sdBox, smooth } from './field.js';
import { PALETTES } from './design.js';

const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
const gapOf = (d) => 34 - d.density * 2.6;
const bandOf = (h) => ((Math.floor(h * 2.5 + 40) % 4) + 4) % 4;

/** render(design, scale, (w, h) => canvas) -> { back, front } canvases at design size × scale. */
export function render(design, scale, makeCanvas) {
  const W = Math.max(1, Math.round(design.w * scale));
  const H = Math.max(1, Math.round(design.h * scale));
  const s = W / design.w;
  const pal = PALETTES[design.palette];
  const F = field(design);
  const art = makeCanvas(W, H);
  const fx = makeCanvas(W, H);
  const a = art.getContext('2d');
  const e = fx.getContext('2d');
  for (const c of [a, e]) {
    c.setTransform(s, 0, 0, s, 0, 0);
    c.lineCap = 'round';
    c.lineJoin = 'round';
  }
  a.globalAlpha = 0.92;
  STYLES[design.style]?.(a, design, F, pal.colors, s);
  const r = rng(design.seed + 7);
  for (const z of F.zones) EFFECTS[z.effect]?.(e, z, F, pal.colors, r, s);
  for (const c of [a, e]) c.setTransform(1, 0, 0, 1, 0, 0);
  const ai = a.getImageData(0, 0, W, H);
  const ei = e.getImageData(0, 0, W, H);
  compose(design, s, ai.data, ei.data, W, H);
  a.putImageData(ai, 0, 0);
  e.putImageData(ei, 0, 0);
  return { back: art, front: fx };
}

// Art styles ----------------------------------------------------------

function polyline(c, pts, color, width) {
  if (pts.length < 4) return;
  c.beginPath();
  c.strokeStyle = color;
  c.lineWidth = width;
  c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.stroke();
}

// How dark the field is at a point (height h) under a light at the top
// left: steeper away from the light is darker, with a little noise.
function shadeOf(F, x, y, h) {
  const slope = F.probe(x + 4, y).h - h + F.probe(x, y + 4).h - h;
  return 0.5 - slope * 16 - h * 0.1 + F.noise(x * 0.01, y * 0.01) * 0.2;
}

const STYLES = {
  // Horizontal lines draped over the zones like cloth. Drawn front to back
  // with a floating horizon, so raised zones hide the lines behind them.
  sheet(c, d, F, colors, s) {
    const g = gapOf(d);
    const amp = 64;
    const step = 2 / s;
    const n = Math.ceil(d.w / step) + 1;
    const horizon = new Float32Array(n).fill(1e9);
    const width = Math.max(1 / s, g * 0.16);
    for (let y0 = d.h + amp * 2; y0 > -amp; y0 -= g) {
      let pts = [];
      let band = -1;
      for (let i = 0; i < n; i++) {
        const x = i * step;
        const p = F.probe(x, y0);
        const y = p.wy - p.h * amp;
        const visible = y < horizon[i] - 0.5 / s;
        if (y < horizon[i]) horizon[i] = y;
        const b = bandOf(p.h);
        if (visible && b === band) { pts.push(x, y); continue; }
        if (visible) pts.push(x, y);
        polyline(c, pts, colors[band], width);
        pts = visible ? [x, y] : [];
        band = visible ? b : -1;
      }
      polyline(c, pts, colors[band], width);
    }
  },

  // Evenly spaced streamlines that flow around raised zones, spiral into
  // sunken ones and fall from splash and pile zones.
  flow(c, d, F, colors, s) {
    const r = rng(d.seed + 1);
    const sep = gapOf(d) * 1.5;
    const cell = sep * 0.5;
    const gw = Math.ceil(d.w / cell) + 1;
    const gh = Math.ceil(d.h / cell) + 1;
    const occ = new Int32Array(gw * gh);
    const step = sep * 0.3;
    const seeds = [];
    for (let y = sep / 2; y < d.h; y += sep) for (let x = sep / 2; x < d.w; x += sep) seeds.push(x + (r() - 0.5) * sep, y + (r() - 0.5) * sep);
    for (let i = seeds.length / 2 - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [seeds[2 * i], seeds[2 * j]] = [seeds[2 * j], seeds[2 * i]];
      [seeds[2 * i + 1], seeds[2 * j + 1]] = [seeds[2 * j + 1], seeds[2 * i + 1]];
    }
    const claim = (x, y, id) => {
      if (x < 0 || y < 0 || x >= d.w || y >= d.h) return false;
      const ci = Math.floor(y / cell) * gw + Math.floor(x / cell);
      if (occ[ci] && occ[ci] !== id) return false;
      occ[ci] = id;
      return true;
    };
    const trace = (x, y, dir, id, out) => {
      for (let k = 0; k < 220; k++) {
        const p = F.probe(x, y, true);
        x += p.fx * step * dir;
        y += p.fy * step * dir;
        if (!claim(x, y, id)) return;
        out.push(x, y);
      }
    };
    for (let i = 0, id = 1; i < seeds.length; i += 2, id++) {
      const [x, y] = [seeds[i], seeds[i + 1]];
      if (!claim(x, y, id)) continue;
      const back = [];
      const fwd = [x, y];
      trace(x, y, -1, id, back);
      trace(x, y, 1, id, fwd);
      const pts = [];
      for (let j = back.length - 2; j >= 0; j -= 2) pts.push(back[j], back[j + 1]);
      pts.push(...fwd);
      if (pts.length < 16) continue;
      polyline(c, pts, colors[bandOf(F.probe(x, y).h)], Math.max(1 / s, sep * 0.26 * (0.45 + r())));
    }
  },

  // Topographic lines of the field (marching squares): rings stack up
  // around raised zones and crowd into sunken ones.
  contour(c, d, F, colors, s) {
    const cs = Math.max(2 / s, gapOf(d) * 0.4);
    const gw = Math.ceil(d.w / cs) + 2;
    const gh = Math.ceil(d.h / cs) + 2;
    const v = new Float32Array(gw * gh);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) v[j * gw + i] = F.probe(i * cs, j * cs).h;
    const dl = 0.5 / (2 + d.density * 0.6);
    const segs = [[], [], [], [], []];
    const pt = [];
    for (let j = 0; j < gh - 1; j++) {
      for (let i = 0; i < gw - 1; i++) {
        const q = [v[j * gw + i], v[j * gw + i + 1], v[(j + 1) * gw + i + 1], v[(j + 1) * gw + i]];
        const lo = Math.min(...q);
        const hi = Math.max(...q);
        const x = i * cs;
        const y = j * cs;
        const corner = [[x, y], [x + cs, y], [x + cs, y + cs], [x, y + cs]];
        for (let L = Math.ceil(lo / dl); L * dl <= hi; L++) {
          const lv = L * dl;
          pt.length = 0;
          for (let k = 0; k < 4; k++) {
            const a = q[k] - lv;
            const b = q[(k + 1) % 4] - lv;
            if ((a < 0) === (b < 0)) continue;
            const t = a / (a - b);
            const [x0, y0] = corner[k];
            const [x1, y1] = corner[(k + 1) % 4];
            pt.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
          }
          const list = L % 5 === 0 ? segs[4] : segs[((L % 4) + 4) % 4];
          for (let k = 0; k + 3 < pt.length; k += 4) list.push(pt[k], pt[k + 1], pt[k + 2], pt[k + 3]);
        }
      }
    }
    const width = Math.max(1 / s, gapOf(d) * 0.1);
    segs.forEach((list, k) => {
      c.beginPath();
      c.strokeStyle = colors[k % 4];
      c.lineWidth = k === 4 ? width * 2.4 : width;
      for (let i = 0; i < list.length; i += 4) { c.moveTo(list[i], list[i + 1]); c.lineTo(list[i + 2], list[i + 3]); }
      c.stroke();
    });
  },

  // Halftone dots lit from the top left: their size follows the slope, so
  // zones read as embossed.
  dots(c, d, F, colors) {
    const sp = gapOf(d) * 1.15;
    const paths = [[], [], [], []];
    for (let y = 0, row = 0; y < d.h + sp; y += sp * 0.87, row++) {
      for (let x = row % 2 ? sp / 2 : 0; x < d.w + sp; x += sp) {
        const h = F.probe(x + 4, y).h;
        const hy = F.probe(x, y + 4).h;
        const p = F.probe(x, y);
        const shade = 0.45 + (h - p.h + hy - p.h) * 16 + p.h * 0.12;
        const rad = sp * 0.48 * Math.min(1, Math.max(0.06, shade));
        paths[bandOf(p.h)].push(p.wx, p.wy, rad);
      }
    }
    paths.forEach((list, k) => {
      c.beginPath();
      c.fillStyle = colors[k];
      for (let i = 0; i < list.length; i += 3) { c.moveTo(list[i] + list[i + 2], list[i + 1]); c.arc(list[i], list[i + 1], list[i + 2], 0, Math.PI * 2); }
      c.fill();
    });
  },

  // Pen hatching: up to three layers of parallel strokes, more of them
  // where the field turns away from a light at the top left.
  hatch(c, d, F, colors, s) {
    const sp = Math.max(2.5 / s, gapOf(d) * 0.45);
    const gs = 8;
    const gw = Math.ceil(d.w / gs) + 1;
    const gh = Math.ceil(d.h / gs) + 1;
    const dark = new Float32Array(gw * gh);
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const x = i * gs;
        const y = j * gs;
        dark[j * gw + i] = shadeOf(F, x, y, F.probe(x, y).h);
      }
    }
    const R = Math.hypot(d.w, d.h) / 2;
    c.lineWidth = Math.max(0.8 / s, sp * 0.14);
    [[0.7071, 0.7071, 0.3], [-0.7071, 0.7071, 0.5], [1, 0, 0.7]].forEach(([dx, dy, th], k) => {
      c.beginPath();
      c.strokeStyle = colors[k];
      for (let o = -R; o < R; o += sp * (1 + k * 0.2)) {
        let on = false;
        let lx = 0;
        let ly = 0;
        for (let t = -R; t <= R; t += 4) {
          const x = d.w / 2 - dy * o + dx * t;
          const y = d.h / 2 + dx * o + dy * t;
          const ink = x >= 0 && y >= 0 && x <= d.w && y <= d.h && dark[Math.round(y / gs) * gw + Math.round(x / gs)] > th;
          if (ink && !on) c.moveTo(x, y);
          else if (!ink && on) c.lineTo(lx, ly);
          on = ink;
          lx = x;
          ly = y;
        }
        if (on) c.lineTo(lx, ly);
      }
      c.stroke();
    });
  },

  // A wireframe mesh lifted by the field, like terrain seen from above:
  // the grid bulges over raised zones and dips into sunken ones.
  mesh(c, d, F, colors, s) {
    const g = gapOf(d) * 1.6;
    const sub = 4;
    const q = g / sub;
    const amp = 48;
    const m = g * 2;
    const nx = Math.ceil((d.w + m * 2) / q) + 1;
    const ny = Math.ceil((d.h + m * 2 + amp * 2) / q) + 1;
    const X = new Float32Array(nx * ny);
    const Y = new Float32Array(nx * ny);
    const B = new Uint8Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const p = F.probe(i * q - m, j * q - m);
        const k = j * nx + i;
        X[k] = p.wx;
        Y[k] = p.wy - p.h * amp;
        B[k] = bandOf(p.h);
      }
    }
    const segs = [[], [], [], []];
    const seg = (a, b) => segs[B[a]].push(X[a], Y[a], X[b], Y[b]);
    for (let j = 0; j < ny; j += sub) for (let i = 0; i + 1 < nx; i++) seg(j * nx + i, j * nx + i + 1);
    for (let i = 0; i < nx; i += sub) for (let j = 0; j + 1 < ny; j++) seg(j * nx + i, (j + 1) * nx + i);
    c.lineWidth = Math.max(1 / s, g * 0.05);
    segs.forEach((list, k) => {
      c.beginPath();
      c.strokeStyle = colors[k];
      for (let i = 0; i < list.length; i += 4) { c.moveTo(list[i], list[i + 1]); c.lineTo(list[i + 2], list[i + 3]); }
      c.stroke();
    });
  },

  // Stippling: fine dots scattered at random, packed tighter where the
  // field turns away from a light at the top left.
  stipple(c, d, F, colors, s) {
    const r = rng(d.seed + 3);
    const sp = Math.max(1.5 / s, gapOf(d) * 0.32);
    const rad = Math.max(0.6 / s, sp * 0.22);
    const dots = [[], [], [], []];
    for (let y = 0; y < d.h; y += sp) {
      for (let x = 0; x < d.w; x += sp) {
        const px = x + r() * sp;
        const py = y + r() * sp;
        const p = F.probe(px, py);
        const { h, wx, wy } = p;
        if (r() > shadeOf(F, px, py, h) * 1.2) continue;
        dots[bandOf(h)].push(wx, wy);
      }
    }
    dots.forEach((list, k) => {
      c.beginPath();
      c.fillStyle = colors[k];
      for (let i = 0; i < list.length; i += 2) { c.moveTo(list[i] + rad, list[i + 1]); c.arc(list[i], list[i + 1], rad, 0, Math.PI * 2); }
      c.fill();
    });
  },

  // A mosaic of square tiles that twist with the field's height and shrink
  // on steep slopes, so the grout lines trace the zones.
  mosaic(c, d, F, colors) {
    const t = gapOf(d) * 1.4;
    const tiles = [[], [], [], []];
    for (let y = t / 2 - t * 2; y < d.h + t * 2; y += t) {
      for (let x = t / 2 - t * 2; x < d.w + t * 2; x += t) {
        const p = F.probe(x, y);
        const { h, wx, wy } = p;
        const sl = F.probe(x + 4, y).h - h + F.probe(x, y + 4).h - h;
        const half = t * 0.5 * Math.min(0.9, Math.max(0.25, 0.9 - Math.abs(sl) * 12));
        const a = h * 1.2 + sl * 20 + Math.PI / 4;
        const list = tiles[bandOf(h)];
        for (let k = 0; k < 4; k++) list.push(wx + Math.cos(a + k * Math.PI / 2) * half * Math.SQRT2, wy + Math.sin(a + k * Math.PI / 2) * half * Math.SQRT2);
      }
    }
    tiles.forEach((list, k) => {
      c.beginPath();
      c.fillStyle = colors[k];
      for (let i = 0; i < list.length; i += 8) {
        c.moveTo(list[i], list[i + 1]);
        c.lineTo(list[i + 2], list[i + 3]);
        c.lineTo(list[i + 4], list[i + 5]);
        c.lineTo(list[i + 6], list[i + 7]);
        c.closePath();
      }
      c.fill();
    });
  },

  // Short, thick brush dashes laid along the flow, like impasto: they
  // stream around raised zones and swirl into sunken ones.
  dashes(c, d, F, colors, s) {
    const r = rng(d.seed + 5);
    const sp = gapOf(d) * 0.8;
    const segs = [[], [], [], []];
    for (let y = 0; y < d.h + sp; y += sp) {
      for (let x = 0; x < d.w + sp; x += sp) {
        const px = x + (r() - 0.5) * sp;
        const py = y + (r() - 0.5) * sp;
        const { h, fx, fy } = F.probe(px, py, true);
        const len = sp * (0.6 + r() * 0.9) / 2;
        segs[bandOf(h)].push(px - fx * len, py - fy * len, px + fx * len, py + fy * len);
      }
    }
    c.lineWidth = Math.max(1 / s, sp * 0.3);
    segs.forEach((list, k) => {
      c.beginPath();
      c.strokeStyle = colors[k];
      for (let i = 0; i < list.length; i += 4) { c.moveTo(list[i], list[i + 1]); c.lineTo(list[i + 2], list[i + 3]); }
      c.stroke();
    });
  },
};

// Zone effects --------------------------------------------------------
// Drawn on their own layer, which the reach setting and windows don't fade.

function zonePath(c, z, grow = 0) {
  const x = z.x - grow;
  const y = z.y - grow;
  const w = z.w + grow * 2;
  const h = z.h + grow * 2;
  const r = Math.max(0, Math.min(z.r + grow, w / 2, h / 2));
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// A point on the zone's edge and its outward normal, for t in [0, 1).
function edgePoint(z, t) {
  const p = (z.w + z.h) * 2 * t;
  if (p < z.w) return [z.x + p, z.y, 0, -1];
  if (p < z.w + z.h) return [z.x + z.w, z.y + p - z.w, 1, 0];
  if (p < z.w * 2 + z.h) return [z.x + z.w - (p - z.w - z.h), z.y + z.h, 0, 1];
  return [z.x, z.y + z.h - (p - z.w * 2 - z.h), -1, 0];
}

// A point on the zone's outline grown by `grow` (rounded at the corners),
// and its outward normal, for t in [0, 1).
function ringPoint(z, t, grow = 0) {
  const x = z.x - grow;
  const y = z.y - grow;
  const w = z.w + grow * 2;
  const h = z.h + grow * 2;
  const R = Math.max(0, Math.min(z.r + grow, w / 2, h / 2));
  const arc = (cx, cy, a) => [cx + Math.cos(a) * R, cy + Math.sin(a) * R, Math.cos(a), Math.sin(a)];
  const a = w - 2 * R;
  const b = h - 2 * R;
  const q = (Math.PI * R) / 2;
  const pieces = [
    [a, (u) => [x + R + u, y, 0, -1]],
    [q, (u) => arc(x + w - R, y + R, -Math.PI / 2 + u / R)],
    [b, (u) => [x + w, y + R + u, 1, 0]],
    [q, (u) => arc(x + w - R, y + h - R, u / R)],
    [a, (u) => [x + w - R - u, y + h, 0, 1]],
    [q, (u) => arc(x + R, y + h - R, Math.PI / 2 + u / R)],
    [b, (u) => [x, y + h - R - u, -1, 0]],
    [q, (u) => arc(x + R, y + R, Math.PI + u / R)],
  ];
  let p = (((t % 1) + 1) % 1) * (2 * a + 2 * b + 4 * q);
  for (const [len, f] of pieces) {
    if (p <= len) return f(p);
    p -= len;
  }
  return pieces[0][1](0);
}

const EFFECTS = {
  // A soft drop shadow outside the zone, as if it floats above the art.
  lift(c, z, F, colors, r, s) {
    c.save();
    c.beginPath();
    c.rect(z.x - z.w, z.y - z.h, z.w * 3, z.h * 3);
    zonePath(c, z);
    c.clip('evenodd');
    c.shadowColor = 'rgba(0, 0, 0, 0.5)';
    c.shadowBlur = z.soft * 0.45 * s;
    c.shadowOffsetX = c.shadowOffsetY = z.power * 2.4 * s;
    c.beginPath();
    zonePath(c, z);
    c.fill();
    c.restore();
  },

  // An inner shadow along the top and left, as if the zone is set into the art.
  sink(c, z, F, colors, r, s) {
    c.save();
    c.beginPath();
    zonePath(c, z);
    c.clip();
    c.shadowColor = 'rgba(0, 0, 0, 0.6)';
    c.shadowBlur = z.soft * 0.35 * s;
    c.shadowOffsetX = c.shadowOffsetY = z.power * 1.6 * s;
    c.beginPath();
    c.rect(z.x - z.w, z.y - z.h, z.w * 3, z.h * 3);
    zonePath(c, z);
    c.fill('evenodd');
    c.restore();
  },

  // Tilted rings around the zone, thin where they pass behind it.
  orbit(c, z, F, colors, r, s) {
    const rings = 1 + Math.round(z.power / 4);
    for (let k = 0; k < rings; k++) {
      const rx = z.w / 2 + 18 + k * 22 + z.power * 3;
      const ry = z.h / 2 * 0.55 + 10 + k * 12;
      const tilt = (r() - 0.5) * 0.35;
      const col = colors[(k + 1) % 4];
      for (const [from, to, width] of [[Math.PI, Math.PI * 2, 1.2], [0, Math.PI, 3.2]]) {
        c.beginPath();
        c.strokeStyle = col;
        c.lineWidth = Math.max(1 / s, width);
        c.ellipse(z.cx, z.cy, rx, ry, tilt, from, to);
        c.stroke();
      }
      const a = r() * Math.PI;
      c.beginPath();
      c.fillStyle = colors[k % 4];
      c.arc(z.cx + Math.cos(a) * rx * Math.cos(tilt) - Math.sin(a) * ry * Math.sin(tilt),
        z.cy + Math.cos(a) * rx * Math.sin(tilt) + Math.sin(a) * ry * Math.cos(tilt), 5 + z.power * 0.8, 0, Math.PI * 2);
      c.fill();
    }
  },

  // Paint splats around the edges, flung droplets, and drips running down.
  splash(c, z, F, colors, r) {
    const count = 6 + z.power * 3;
    for (let i = 0; i < count; i++) {
      const [px, py, nx, ny] = edgePoint(z, r());
      const size = (8 + r() * 26) * (0.6 + z.power * 0.08);
      const bx = px + nx * size * (r() * 0.7 - 0.2);
      const by = py + ny * size * (r() * 0.7 - 0.2);
      c.fillStyle = colors[Math.floor(r() * 4)];
      c.beginPath();
      for (let k = 0; k <= 18; k++) {
        const a = (k / 18) * Math.PI * 2;
        const rad = size * (0.75 + 0.5 * F.noise(Math.cos(a) * 1.4 + i * 7, Math.sin(a) * 1.4));
        c.lineTo(bx + Math.cos(a) * rad, by + Math.sin(a) * rad);
      }
      c.fill();
      for (let k = 0, n = 2 + Math.floor(r() * 5); k < n; k++) {
        const out = size * (1.2 + r() * 2);
        const side = (r() - 0.5) * size * 2;
        c.beginPath();
        c.arc(bx + nx * out - ny * side, by + ny * out + nx * side, size * (0.06 + r() * 0.16), 0, Math.PI * 2);
        c.fill();
      }
      if (ny >= 0 && r() < 0.65) {
        const w = size * (0.18 + r() * 0.22);
        const len = size * (1.5 + r() * 5);
        const dx = bx + (r() - 0.5) * size * 0.8;
        c.fillRect(dx - w / 2, by, w, len);
        c.beginPath();
        c.arc(dx, by + len, w * 0.8, 0, Math.PI * 2);
        c.fill();
      }
    }
  },

  // Pieces fall onto the top edge and pile up, sliding off the sides.
  pile(c, z, F, colors, r) {
    const ps = 9 + z.power * 0.6;
    const spill = 3;
    const cols = Math.floor(z.w / ps) + spill * 2;
    const heights = new Int16Array(cols);
    const settled = [];
    const falling = [];
    const drops = Math.round(cols * (0.6 + z.power * 0.35));
    const onTop = (k) => k >= spill && k < cols - spill;
    for (let i = 0; i < drops; i++) {
      let k = spill + Math.floor(r() * (cols - spill * 2));
      for (let guard = 0; guard < cols; guard++) {
        if (!onTop(k)) break;
        const left = k > 0 && heights[k] - heights[k - 1] >= 2;
        const right = k < cols - 1 && heights[k] - heights[k + 1] >= 2;
        if (!left && !right) break;
        k += left && (!right || r() < 0.5) ? -1 : 1;
      }
      const x = z.x + (k - spill + 0.5) * ps + (r() - 0.5) * ps * 0.3;
      if (onTop(k)) settled.push(x, z.y - (heights[k]++ + 0.5) * ps * 0.82);
      else falling.push(x, z.y + r() * z.h * 1.4);
    }
    for (let i = 0; i < z.power * 2; i++) falling.push(z.x + r() * z.w, z.y - ps * (4 + r() * 10));
    const piece = (x, y, size) => {
      c.save();
      c.translate(x, y);
      c.rotate(r() * Math.PI);
      c.fillStyle = colors[Math.floor(r() * 4)];
      c.fillRect(-size / 2, -size / 2, size, size);
      c.fillStyle = 'rgba(255, 255, 255, 0.35)';
      c.fillRect(-size / 2, -size / 2, size / 2, size / 2);
      c.restore();
    };
    for (let i = 0; i < falling.length; i += 2) {
      c.strokeStyle = colors[3];
      c.globalAlpha = 0.35;
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(falling[i], falling[i + 1] - ps * 3);
      c.lineTo(falling[i], falling[i + 1] - ps);
      c.stroke();
      c.globalAlpha = 1;
      piece(falling[i], falling[i + 1], ps * 0.8);
    }
    for (let i = 0; i < settled.length; i += 2) piece(settled[i], settled[i + 1], ps * (0.85 + r() * 0.3));
  },

  // See-through tape with torn ends across the corners, as if the zone is
  // taped to the wall.
  tape(c, z, F, colors, r) {
    const len = 120 + z.power * 16;
    const wid = 36 + z.power * 3;
    const corners = [[z.x, z.y, -1, -1], [z.x + z.w, z.y + z.h, 1, 1], [z.x + z.w, z.y, 1, -1], [z.x, z.y + z.h, -1, 1]];
    corners.slice(0, z.power < 4 ? 2 : z.power < 8 ? 3 : 4).forEach(([cx, cy, sx, sy], k) => {
      c.save();
      c.translate(cx - sx * wid * 0.15, cy - sy * wid * 0.15);
      c.rotate((sx * sy > 0 ? -1 : 1) * Math.PI / 4 + (r() - 0.5) * 0.35);
      c.beginPath();
      c.moveTo(-len / 2, -wid / 2);
      c.lineTo(len / 2, -wid / 2);
      for (let i = 1; i <= 5; i++) c.lineTo(len / 2 + (r() - 0.5) * 7, -wid / 2 + (wid * i) / 5);
      c.lineTo(-len / 2, wid / 2);
      for (let i = 4; i >= 0; i--) c.lineTo(-len / 2 + (r() - 0.5) * 7, -wid / 2 + (wid * i) / 5);
      c.globalAlpha = 0.78;
      c.fillStyle = colors[[1, 2, 0][k % 3]];
      c.fill();
      c.clip();
      c.globalAlpha = 0.22;
      c.fillStyle = '#FFFFFF';
      for (let x = -len / 2; x < len / 2; x += 10) c.fillRect(x, -wid / 2, 3.5, wid);
      c.fillRect(-len / 2, -wid / 2, len, wid * 0.18);
      c.restore();
    });
  },

  // Dry-brush strokes sweeping around the edges: wet and solid where they
  // start, breaking into bristle streaks where they run dry.
  brush(c, z, F, colors, r, s) {
    const width = 14 + z.power * 3.5;
    const bristles = 9;
    const around = 2 * (z.w + z.h);
    c.lineWidth = Math.max(1 / s, (width / bristles) * 1.4);
    for (let k = 0, n = 2 + Math.round(z.power / 2); k < n; k++) {
      const t0 = r();
      const span = 0.12 + r() * 0.25;
      const grow = width * (r() * 1.1 - 0.3);
      const steps = Math.max(12, Math.round((span * around) / 6));
      const dry = 0.9 + r() * 0.6;
      c.strokeStyle = colors[Math.floor(r() * 4)];
      for (let b = 0; b < bristles; b++) {
        const lat = (b / (bristles - 1) - 0.5) * width;
        c.globalAlpha = 0.55 + r() * 0.4;
        c.beginPath();
        let on = false;
        for (let i = 0; i <= steps; i++) {
          const u = i / steps;
          const [x, y] = ringPoint(z, t0 + span * u, grow + lat * (1 - 0.6 * u * u));
          const ink = F.noise(u * 10 + b * 3.1, k * 7 + b * 1.3) > u * dry - 1;
          if (ink && on) c.lineTo(x, y);
          else if (ink) c.moveTo(x, y);
          on = ink;
        }
        c.stroke();
      }
    }
    c.globalAlpha = 1;
  },

  // Pencil construction lines that overshoot the corners, with hatched
  // shading on the shadow side.
  sketch(c, z, F, colors, r, s) {
    c.strokeStyle = colors[0];
    c.lineWidth = Math.max(1 / s, 1.4);
    const line = (x0, y0, x1, y1) => {
      const l = Math.hypot(x1 - x0, y1 - y0) || 1;
      const nx = -(y1 - y0) / l;
      const ny = (x1 - x0) / l;
      const seed = r() * 50;
      c.globalAlpha = 0.45 + r() * 0.45;
      c.beginPath();
      for (let u = 0; u <= 1.0001; u += 0.04) {
        const o = F.noise(u * 4 + seed, seed) * 3;
        c.lineTo(x0 + (x1 - x0) * u + nx * o, y0 + (y1 - y0) * u + ny * o);
      }
      c.stroke();
    };
    const over = () => 10 + r() * (20 + z.power * 6);
    const off = () => (r() - 0.5) * 5;
    for (let pass = 0, n = z.power > 6 ? 3 : 2; pass < n; pass++) {
      let o = off();
      line(z.x - over(), z.y + o, z.x + z.w + over(), z.y + o);
      o = off();
      line(z.x - over(), z.y + z.h + o, z.x + z.w + over(), z.y + z.h + o);
      o = off();
      line(z.x + o, z.y - over(), z.x + o, z.y + z.h + over());
      o = off();
      line(z.x + z.w + o, z.y - over(), z.x + z.w + o, z.y + z.h + over());
    }
    const band = 16 + z.power * 5;
    c.globalAlpha = 0.6;
    c.beginPath();
    for (let x = z.x + 12; x < z.x + z.w + band; x += 7) {
      const k = 0.6 + r() * 0.4;
      c.moveTo(x, z.y + z.h + 3);
      c.lineTo(x - band * 0.8 * k, z.y + z.h + 3 + band * k);
    }
    for (let y = z.y + 12; y < z.y + z.h; y += 7) {
      const k = 0.6 + r() * 0.4;
      c.moveTo(z.x + z.w + 3, y);
      c.lineTo(z.x + z.w + 3 + band * k, y + band * 0.8 * k);
    }
    c.stroke();
    c.globalAlpha = 1;
  },

  // Watercolour washes bleeding out from the edges, built from thin
  // translucent layers, with the pigment pooled darker at the rim.
  watercolor(c, z, F, colors, r) {
    for (let k = 0, n = 4 + z.power; k < n; k++) {
      const [cx, cy] = ringPoint(z, r(), (r() - 0.25) * 40);
      const rad = 40 + r() * (50 + z.power * 10);
      const seed = r() * 100;
      const color = colors[Math.floor(r() * 4)];
      const shape = (scale, j) => {
        c.beginPath();
        for (let i = 0; i <= 28; i++) {
          const a = (i / 28) * Math.PI * 2;
          const rr = rad * scale * (0.7 + 0.45 * F.noise(Math.cos(a) * 1.5 + seed + j * 0.3, Math.sin(a) * 1.5 + seed));
          c.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.85);
        }
        c.closePath();
      };
      c.fillStyle = c.strokeStyle = color;
      c.globalAlpha = 0.08;
      for (let j = 0; j < 6; j++) { shape(1 - j * 0.08, j); c.fill(); }
      c.globalAlpha = 0.35;
      c.lineWidth = 1.5;
      shape(1, 0);
      c.stroke();
    }
    c.globalAlpha = 1;
  },

  // Vines growing out from the edges, drooping under their own weight,
  // branching and putting out leaves.
  vines(c, z, F, colors, r, s) {
    const grow = (x, y, a, len, depth) => {
      const leaves = [];
      const branches = [];
      c.beginPath();
      c.moveTo(x, y);
      for (let i = 0; i < len / 9; i++) {
        a += F.noise(x * 0.01, y * 0.01 + depth * 9) * 0.3 + Math.sin(Math.PI / 2 - a) * 0.05;
        x += Math.cos(a) * 9;
        y += Math.sin(a) * 9;
        c.lineTo(x, y);
        if (i % 4 === 2) leaves.push([x, y, a + (i % 8 < 4 ? 1 : -1) * 0.9]);
        if (depth < 2 && r() < 0.05) branches.push([x, y, a + (r() < 0.5 ? -0.8 : 0.8), len * 0.5, depth + 1]);
      }
      c.strokeStyle = colors[2];
      c.lineWidth = Math.max(1 / s, 5 - depth * 1.5);
      c.stroke();
      leaves.forEach(([lx, ly, la], i) => {
        c.save();
        c.translate(lx, ly);
        c.rotate(la);
        c.fillStyle = colors[i % 2];
        c.beginPath();
        c.ellipse(11, 0, 13 - depth * 3, 5.5 - depth, 0, 0, Math.PI * 2);
        c.fill();
        c.restore();
      });
      for (const b of branches) grow(...b);
    };
    for (let k = 0, n = 2 + Math.round(z.power * 0.8); k < n; k++) {
      const [x, y, nx, ny] = ringPoint(z, r());
      grow(x, y, Math.atan2(ny, nx) + (r() - 0.5) * 1.2, 120 + r() * (90 + z.power * 30), 0);
    }
  },

  // Displaced colour slices torn off the sides, and outlines knocked out of
  // register.
  glitch(c, z, F, colors, r) {
    c.globalAlpha = 0.85;
    for (let k = 0, n = 8 + z.power * 3; k < n; k++) {
      const y = z.y - 20 + r() * (z.h + 40);
      const len = 50 + r() * (100 + z.power * 30);
      const x = r() < 0.5 ? z.x - len : z.x + z.w - len * 0.3;
      c.fillStyle = colors[k % 4];
      c.fillRect(x, y, len * 1.3, 4 + r() * (10 + z.power * 2));
    }
    c.lineWidth = 3;
    for (const [dx, k] of [[-(4 + z.power * 1.2), 0], [4 + z.power * 1.2, 1]]) {
      c.strokeStyle = colors[k];
      c.beginPath();
      zonePath(c, { ...z, x: z.x + dx });
      c.stroke();
    }
    c.globalAlpha = 1;
  },
};

// For tests: every style and effect draws with only the 2D canvas API.
export { STYLES, EFFECTS };

// Compositing ----------------------------------------------------------

/**
 * Per pixel, in place: art (the style layer) becomes the back layer and fx
 * (the effects layer) becomes the front layer. Both are RGBA arrays of W × H
 * at scale s. Order: background fill, art faded by reach, windows cleared
 * inside zones with rough edges, frames, effects. Pixels inside zones placed
 * under the art also go to the front layer.
 */
export function compose(design, s, art, fx, W, H) {
  const pal = PALETTES[design.palette];
  const bg = rgb(pal.bg);
  const fr = rgb(pal.frame);
  const grain = noise(design.seed ^ 0x5BD1E995);
  const zs = design.zones;
  const px = 1 / s;
  const all = design.reach >= 100;
  const rp = Math.max(design.w, design.h) * design.reach / 100 * 0.6;
  const fill = design.fill ? 1 : 0;
  for (let y = 0, i = 0; y < H; y++) {
    const Y = (y + 0.5) * px;
    for (let x = 0; x < W; x++, i += 4) {
      const X = (x + 0.5) * px;
      const g = grain(X / 40, Y / 40, 3);
      let keep = 1;
      let frame = 0;
      let under = false;
      let dist = 1e9;
      for (let k = 0; k < zs.length; k++) {
        const z = zs[k];
        const d = sdBox(z, X, Y);
        if (d < dist) dist = d;
        if (d < 0 && z.place === 'under') under = true;
        const soft = Math.max(px, z.fuzz * 0.3);
        const e = d + g * z.fuzz + (z.place === 'under' ? 0.6 : -0.6) * z.fuzz;
        if (e < soft) keep *= smooth(-soft, soft, e);
        if (z.frame) {
          const t = Math.abs(d + g * z.fuzz) - z.frame / 2;
          if (t < px) frame = Math.max(frame, 1 - smooth(-px, px, t));
        }
      }
      const reach = all ? 1 : 1 - smooth(rp * 0.3, rp, Math.max(dist, 0) + g * rp * 0.25);
      let a = fill * reach;
      let r = bg[0] * a;
      let gr = bg[1] * a;
      let b = bg[2] * a;
      const aa = (art[i + 3] / 255) * reach;
      if (aa > 0) {
        r = (art[i] / 255) * aa + r * (1 - aa);
        gr = (art[i + 1] / 255) * aa + gr * (1 - aa);
        b = (art[i + 2] / 255) * aa + b * (1 - aa);
        a = aa + a * (1 - aa);
      }
      r *= keep; gr *= keep; b *= keep; a *= keep;
      if (frame > 0) {
        r = fr[0] * frame + r * (1 - frame);
        gr = fr[1] * frame + gr * (1 - frame);
        b = fr[2] * frame + b * (1 - frame);
        a = frame + a * (1 - frame);
      }
      const ea = fx[i + 3] / 255;
      if (ea > 0) {
        r = (fx[i] / 255) * ea + r * (1 - ea);
        gr = (fx[i + 1] / 255) * ea + gr * (1 - ea);
        b = (fx[i + 2] / 255) * ea + b * (1 - ea);
        a = ea + a * (1 - ea);
      }
      if (a > 0.002) {
        art[i] = (r / a) * 255;
        art[i + 1] = (gr / a) * 255;
        art[i + 2] = (b / a) * 255;
        art[i + 3] = a * 255;
      } else {
        art[i] = art[i + 1] = art[i + 2] = art[i + 3] = 0;
      }
      for (let c = 0; c < 4; c++) fx[i + c] = under ? art[i + c] : 0;
    }
  }
}
