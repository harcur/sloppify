// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// The shapes behind the art. Every zone is an invisible rounded rectangle
// that bends one shared field: raised blocks, pits, swirls and falling
// paint. The art styles read this field, which is what makes flat zones look
// three dimensional. All lengths are in output pixels. No DOM access.

/** Repeatable random numbers in [0, 1) for a seed (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise in [-1, 1] for a seed: noise(seed)(x, y, octaves). */
export function noise(seed) {
  const r = rng(seed);
  const perm = new Uint8Array(512);
  const val = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; val[i] = r() * 2 - 1; }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const n = (x, y) => {
    const xf = Math.floor(x);
    const yf = Math.floor(y);
    const xi = xf & 255;
    const yi = yf & 255;
    let u = x - xf;
    let v = y - yf;
    u = u * u * (3 - 2 * u);
    v = v * v * (3 - 2 * v);
    const a = val[perm[perm[xi] + yi]];
    const b = val[perm[perm[xi + 1] + yi]];
    const c = val[perm[perm[xi] + yi + 1]];
    const d = val[perm[perm[xi + 1] + yi + 1]];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (x, y, octaves = 1) => {
    let sum = 0;
    let amp = 1;
    let total = 0;
    for (let o = 0; o < octaves; o++) {
      sum += n(x + o * 31.7, y - o * 17.3) * amp;
      total += amp;
      amp *= 0.5;
      x *= 2; y *= 2;
    }
    return sum / total;
  };
}

/** Signed distance to a zone's rounded rectangle: negative inside, positive outside. */
export function sdBox(z, px, py) {
  const hw = z.w / 2;
  const hh = z.h / 2;
  const r = Math.min(z.r, hw, hh);
  const qx = Math.abs(px - z.x - hw) - hw + r;
  const qy = Math.abs(py - z.y - hh) - hh + r;
  const ox = qx > 0 ? qx : 0;
  const oy = qy > 0 ? qy : 0;
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - r;
}

export const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 1 inside a zone, easing towards 0 over roughly `soft` pixels outside it. */
export const falloff = (d, soft) => (d <= 0 ? 1 : 1 / (1 + (d / soft) * (d / soft)));

// How much each effect raises (or sinks) the field around its zone.
const LIFT = { lift: 1, sink: -1, orbit: 0.35, splash: 0.45, pile: 0.45, none: 0 };

/**
 * The shared field for a design. probe(x, y) fills `out` with:
 *   h       height (zones raise or sink it, noise ripples it)
 *   wx, wy  the point after the zones have warped space (swirls, pulls)
 *   fx, fy  a unit flow direction that streams around, into or down from zones
 * Pass flow = false to skip the flow direction, which costs extra samples.
 */
export function field(design) {
  const nz = noise(design.seed);
  const r = rng(design.seed ^ 0x9E3779B9);
  const freq = 0.0012 + design.density * 0.00035;
  const zs = design.zones.filter((z) => z.effect !== 'none').map((z) => ({
    ...z,
    cx: z.x + z.w / 2,
    cy: z.y + z.h / 2,
    soft: 30 + z.power * 14,
    k: z.power / 5,
    spin: r() < 0.5 ? -1 : 1,
  }));
  const out = { h: 0, wx: 0, wy: 0, fx: 1, fy: 0 };
  const ds = new Float64Array(zs.length);

  function probe(x, y, flow = false) {
    let wx = x;
    let wy = y;
    let h = 0;
    for (let i = 0; i < zs.length; i++) {
      const z = zs[i];
      const d = (ds[i] = sdBox(z, x, y));
      h += falloff(d, z.soft) * LIFT[z.effect] * z.k;
      const f = falloff(d, z.soft * 1.6);
      if (z.effect === 'orbit') {
        const a = z.spin * f * z.k * 0.9;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const dx = wx - z.cx;
        const dy = wy - z.cy;
        wx = z.cx + dx * c - dy * s;
        wy = z.cy + dx * s + dy * c;
      } else if (z.effect === 'sink') {
        wx += (z.cx - wx) * f * z.k * 0.18;
        wy += (z.cy - wy) * f * z.k * 0.18;
      } else if (z.effect === 'lift') {
        wx -= (z.cx - wx) * f * z.k * 0.06;
        wy -= (z.cy - wy) * f * z.k * 0.06;
      }
    }
    h += 0.35 * nz(wx * freq, wy * freq, 2);
    out.h = h;
    out.wx = wx;
    out.wy = wy;
    if (flow) {
      const a = nz(wx * freq * 0.8 + 40, wy * freq * 0.8, 2) * Math.PI * 2.2;
      let vx = Math.cos(a);
      let vy = Math.sin(a);
      for (let i = 0; i < zs.length; i++) {
        const z = zs[i];
        const w = falloff(ds[i], z.soft) * 4 * z.k;
        if (w < 0.01) continue;
        let gx = sdBox(z, x + 1, y) - sdBox(z, x - 1, y);
        let gy = sdBox(z, x, y + 1) - sdBox(z, x, y - 1);
        const gl = Math.sqrt(gx * gx + gy * gy) || 1;
        gx /= gl; gy /= gl;
        const tx = -gy * z.spin;
        const ty = gx * z.spin;
        let dx = tx;
        let dy = ty;
        if (z.effect === 'lift') { dx += gx * 0.3; dy += gy * 0.3; }
        else if (z.effect === 'sink') { dx = tx * 0.6 - gx; dy = ty * 0.6 - gy; }
        else if (z.effect === 'splash' || z.effect === 'pile') { dx = tx * 0.3; dy = 1; }
        vx += dx * w;
        vy += dy * w;
      }
      const l = Math.sqrt(vx * vx + vy * vy) || 1;
      out.fx = vx / l;
      out.fy = vy / l;
    }
    return out;
  }

  return { probe, noise: nz, zones: zs };
}
