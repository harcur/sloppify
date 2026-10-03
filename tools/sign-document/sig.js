// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Signature and drawing helpers with no DOM access.

export const INKS = { black: [22, 22, 22], blue: [24, 54, 140] };

// Smallest box around pixels with any opacity, or null when the image is empty.
export function trimBox(rgba, w, h, pad = 0) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// Photo of a signature on paper: the paper becomes transparent and the
// strokes take the ink colour, with soft edges kept as partial opacity.
export function inkFromPhoto(rgba, ink) {
  const n = rgba.length / 4;
  const lum = new Float32Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3] / 255;
    const l = (0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]) * a + 255 * (1 - a);
    lum[i] = l;
    hist[Math.min(255, Math.round(l))]++;
  }
  // Paper brightness: the 60th percentile, since most of a signature photo is paper.
  let paper = 255;
  for (let v = 0, seen = 0; v < 256; v++) { seen += hist[v]; if (seen >= n * 0.6) { paper = v; break; } }
  const full = paper * 0.45, none = paper * 0.82;
  for (let i = 0; i < n; i++) {
    const t = (none - lum[i]) / (none - full);
    rgba[i * 4] = ink[0]; rgba[i * 4 + 1] = ink[1]; rgba[i * 4 + 2] = ink[2];
    rgba[i * 4 + 3] = Math.round(255 * Math.min(1, Math.max(0, t)));
  }
  return rgba;
}

// Smooth SVG path through pointer samples: quadratic curves through the midpoints.
export function smoothPath(pts) {
  const f = (v) => Math.round(v * 100) / 100;
  if (!pts.length) return '';
  if (pts.length < 3) return `M${f(pts[0][0])} ${f(pts[0][1])}${pts.slice(1).map((p) => `L${f(p[0])} ${f(p[1])}`).join('') || `l0.01 0`}`;
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += `Q${f(pts[i][0])} ${f(pts[i][1])} ${f(mx)} ${f(my)}`;
  }
  const last = pts[pts.length - 1];
  return `${d}L${f(last[0])} ${f(last[1])}`;
}

// Box around stroke points, widened by half the line width.
export function pointsBox(pts, lw) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x = Math.min(...xs) - lw / 2, y = Math.min(...ys) - lw / 2;
  return { x, y, w: Math.max(...xs) + lw / 2 - x, h: Math.max(...ys) + lw / 2 - y };
}

// Union of item boxes, padded and kept inside the page; null when there are none.
export function itemsBox(items, pw, ph, pad = 2) {
  if (!items.length) return null;
  const x0 = Math.max(0, Math.min(...items.map((i) => i.x)) - pad);
  const y0 = Math.max(0, Math.min(...items.map((i) => i.y)) - pad);
  const x1 = Math.min(pw, Math.max(...items.map((i) => i.x + i.w)) + pad);
  const y1 = Math.min(ph, Math.max(...items.map((i) => i.y + i.h)) + pad);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

// Keeps at least part of an item on the page after a move or resize.
export function keepOnPage(item, pw, ph) {
  const min = Math.min(item.w, item.h, 12) / 2;
  item.x = Math.min(pw - min, Math.max(min - item.w, item.x));
  item.y = Math.min(ph - min, Math.max(min - item.h, item.y));
  return item;
}

// Scales an item about its centre by factor k, within sensible limits.
export function resize(item, k, pw) {
  const w = Math.min(pw * 1.5, Math.max(pw * 0.02, item.w * k));
  const f = w / item.w;
  item.x += (item.w - w) / 2;
  item.y += (item.h - item.h * f) / 2;
  item.w = w;
  item.h *= f;
  return item;
}

export const isSignatureList = (v) => Array.isArray(v) && v.every((s) => s && typeof s.id === 'string' && typeof s.src === 'string' && s.src.startsWith('data:image/png;base64,'));
