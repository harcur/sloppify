// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// The overlay design: canvas size, art settings and zones. No DOM access,
// so it's unit tested and shared by the editor, the worker and the view page.

export const SIZES = { '1920x1080': [1920, 1080], '1280x720': [1280, 720], '2560x1440': [2560, 1440], '1080x1920': [1080, 1920] };
export const KINDS = ['camera', 'chat', 'game', 'alerts', 'info', 'buttons', 'other'];
export const EFFECTS = ['lift', 'sink', 'orbit', 'splash', 'pile', 'none'];
// over: the content sits on top of the art. under: the art's edges cover the content.
export const PLACES = ['over', 'under'];
export const STYLES = ['sheet', 'flow', 'contour', 'dots', 'none'];
export const MAX_ZONES = 12;
export const MIN_SIDE = 40;

// Art colours are the user's content, not page chrome, so they're plain values.
export const PALETTES = {
  ember: { bg: '#1B0F14', frame: '#F2E8CF', colors: ['#FF4D3D', '#FF9A3D', '#FFD23F', '#F2E8CF'] },
  neon: { bg: '#0D0B1F', frame: '#F4F4F4', colors: ['#FF2E88', '#2EE6FF', '#B14BFF', '#F4F4F4'] },
  moss: { bg: '#10201A', frame: '#E9F59D', colors: ['#7BD389', '#E9F59D', '#3AA17E', '#F2F7E1'] },
  ocean: { bg: '#08263A', frame: '#FFFFFF', colors: ['#5EC2E8', '#A8E6F0', '#F7B267', '#FFFFFF'] },
  paper: { bg: '#F3ECE0', frame: '#1D1D1D', colors: ['#1D1D1D', '#E4572E', '#2E86AB', '#B8A88A'] },
  mono: { bg: '#121212', frame: '#F5F5F5', colors: ['#F5F5F5', '#9E9E9E', '#5C5C5C', '#FFFFFF'] },
};

// Numeric settings: [min, max, default].
export const RANGES = {
  r: [0, 200, 0], frame: [0, 120, 0], fuzz: [0, 80, 16], power: [1, 10, 5],
  density: [1, 10, 5], reach: [5, 100, 30],
};

const KIND_DEFAULTS = {
  camera: { effect: 'lift', place: 'under', frame: 16, fuzz: 18, w: 480, h: 270 },
  chat: { effect: 'sink', place: 'over', frame: 0, fuzz: 24, w: 380, h: 560 },
  game: { effect: 'none', place: 'under', frame: 10, fuzz: 10, w: 1120, h: 630 },
  alerts: { effect: 'splash', place: 'over', frame: 0, fuzz: 16, w: 600, h: 160 },
  info: { effect: 'orbit', place: 'over', frame: 0, fuzz: 12, w: 520, h: 100 },
  buttons: { effect: 'pile', place: 'over', frame: 0, fuzz: 8, w: 420, h: 90 },
  other: { effect: 'lift', place: 'over', frame: 0, fuzz: 16, w: 400, h: 240 },
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, lo, hi, def) => (Number.isFinite(+v) && v !== null && v !== '' ? clamp(Math.round(+v), lo, hi) : def);
const pick = (v, list) => (list.includes(v) ? v : list[0]);
const ranged = (v, key) => num(v, RANGES[key][0], RANGES[key][1], RANGES[key][2]);

/** A zone of the given kind, centred on the canvas unless a position is given. */
export function newZone(kind, design, at = {}) {
  const k = KIND_DEFAULTS[kind] ?? KIND_DEFAULTS.other;
  const f = Math.min(design.w / 1920, design.h / 1080);
  const w = Math.round(k.w * f);
  const h = Math.round(k.h * f);
  return fitZone({
    kind, effect: k.effect, place: k.place, frame: k.frame, fuzz: k.fuzz, r: 0, power: 5,
    x: Math.round((design.w - w) / 2), y: Math.round((design.h - h) / 2), w, h, ...at,
  }, design);
}

/** Keep a zone on the canvas and at least MIN_SIDE on each side. */
export function fitZone(z, { w: W, h: H }) {
  const w = num(z.w, MIN_SIDE, W, MIN_SIDE);
  const h = num(z.h, MIN_SIDE, H, MIN_SIDE);
  return {
    ...z,
    w, h,
    x: num(z.x, 0, W - w, 0),
    y: num(z.y, 0, H - h, 0),
  };
}

/** Any value in, a valid design out. Used for saved data, links and edits alike. */
export function normalize(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const size = SIZES[d.size] ? d.size : '1920x1080';
  const [w, h] = SIZES[size];
  const design = {
    size, w, h,
    seed: Number.isInteger(d.seed) ? d.seed >>> 0 : 1,
    style: pick(d.style, STYLES),
    palette: PALETTES[d.palette] ? d.palette : 'ember',
    density: ranged(d.density, 'density'),
    reach: ranged(d.reach, 'reach'),
    fill: d.fill === true,
    zones: [],
  };
  const zones = Array.isArray(d.zones) ? d.zones.slice(0, MAX_ZONES) : [];
  let id = 0;
  for (const z of zones) {
    if (!z || typeof z !== 'object') continue;
    design.zones.push(fitZone({
      id: ++id,
      kind: pick(z.kind, KINDS),
      effect: pick(z.effect, EFFECTS),
      place: pick(z.place, PLACES),
      x: z.x, y: z.y, w: z.w, h: z.h,
      r: ranged(z.r, 'r'),
      frame: ranged(z.frame, 'frame'),
      fuzz: ranged(z.fuzz, 'fuzz'),
      power: ranged(z.power, 'power'),
    }, design));
  }
  return design;
}

/** Change the canvas size, scaling every zone with it. */
export function resize(design, size) {
  if (!SIZES[size] || size === design.size) return design;
  const [w, h] = SIZES[size];
  const fx = w / design.w;
  const fy = h / design.h;
  const f = Math.min(fx, fy);
  return normalize({
    ...design, size,
    zones: design.zones.map((z) => ({
      ...z, x: z.x * fx, y: z.y * fy, w: z.w * fx, h: z.h * fy, r: z.r * f, frame: z.frame * f, fuzz: z.fuzz * f,
    })),
  });
}

// Starting layouts, in 1920 × 1080 units and scaled to the chosen size.
const PRESETS = {
  gameplay: {
    style: 'flow', palette: 'neon', density: 5, reach: 22, fill: false,
    zones: [
      { kind: 'camera', x: 40, y: 700, w: 480, h: 340, r: 24, effect: 'lift', place: 'under', frame: 14, fuzz: 18, power: 6 },
      { kind: 'chat', x: 1500, y: 300, w: 380, h: 560, effect: 'sink', place: 'over', fuzz: 24, power: 4 },
      { kind: 'info', x: 40, y: 40, w: 520, h: 90, effect: 'orbit', place: 'over', fuzz: 12, power: 5 },
    ],
  },
  chatting: {
    style: 'sheet', palette: 'ember', density: 5, reach: 100, fill: true,
    zones: [
      { kind: 'camera', x: 80, y: 90, w: 1100, h: 620, effect: 'lift', place: 'under', frame: 20, fuzz: 22, power: 7 },
      { kind: 'chat', x: 1290, y: 90, w: 550, h: 900, effect: 'sink', place: 'over', fuzz: 28, power: 4 },
      { kind: 'buttons', x: 80, y: 870, w: 1100, h: 120, effect: 'pile', place: 'over', fuzz: 10, power: 6 },
    ],
  },
  intermission: {
    style: 'contour', palette: 'ocean', density: 6, reach: 100, fill: true,
    zones: [
      { kind: 'info', x: 560, y: 400, w: 800, h: 280, r: 40, effect: 'splash', place: 'over', fuzz: 14, power: 7 },
      { kind: 'alerts', x: 660, y: 120, w: 600, h: 140, effect: 'orbit', place: 'over', fuzz: 16, power: 5 },
    ],
  },
};
export const PRESET_NAMES = Object.keys(PRESETS);

export function preset(name, size = '1920x1080', seed = 1) {
  const p = PRESETS[name] ?? PRESETS.gameplay;
  return resize(normalize({ ...p, seed, size: '1920x1080' }), size);
}

/** Whether any zone puts art over its content, so the front layer has something in it. */
export const usesFront = (design) => design.zones.some((z) => z.place === 'under');

// Links carry the whole design, compactly: arrays instead of objects, then base64url.
export function encode(d) {
  const zones = d.zones.map((z) => [KINDS.indexOf(z.kind), z.x, z.y, z.w, z.h, z.r,
    EFFECTS.indexOf(z.effect), PLACES.indexOf(z.place), z.frame, z.fuzz, z.power]);
  const json = JSON.stringify([1, d.size, d.seed, STYLES.indexOf(d.style), d.palette, d.density, d.reach, d.fill ? 1 : 0, zones]);
  let bin = '';
  for (const b of new TextEncoder().encode(json)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decode(s) {
  try {
    const bin = atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));
    const a = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    if (!Array.isArray(a) || a[0] !== 1 || !Array.isArray(a[8])) return null;
    const [, size, seed, style, palette, density, reach, fill, zones] = a;
    return normalize({
      size, seed, style: STYLES[style], palette, density, reach, fill: fill === 1,
      zones: zones.filter(Array.isArray).map(([kind, x, y, w, h, r, effect, place, frame, fuzz, power]) => ({
        kind: KINDS[kind], x, y, w, h, r, effect: EFFECTS[effect], place: PLACES[place], frame, fuzz, power,
      })),
    });
  } catch {
    return null;
  }
}
