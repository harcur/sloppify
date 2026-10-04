// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// The random parts of pick a person, without any page code. Every result is
// decided here before an animation starts; the animation only shows it.

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 30;
export const MAX_NAME = 24;

// A random 32-bit unsigned integer from the browser's secure generator.
export function cryptoUint32() {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

// A whole number from 0 to n - 1, each equally likely. Values from the top of
// the 32-bit range that would favour the low numbers are thrown away.
export function randomInt(n, rnd = cryptoUint32) {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('n must be a positive integer');
  const limit = 2 ** 32 - (2 ** 32 % n);
  let x;
  do x = rnd(); while (x >= limit);
  return x % n;
}

// Fisher–Yates: every order equally likely. Returns a new array.
export function shuffle(list, rnd = cryptoUint32) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1, rnd);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const range = (n) => Array.from({ length: n }, (_, i) => i);

// k different players out of n.
export function pickMany(n, k, rnd = cryptoUint32) {
  return shuffle(range(n), rnd).slice(0, Math.max(0, Math.min(k, n)));
}

// Splits n players into teams whose sizes differ by at most one. Give either
// the number of teams or the size wanted; with a size, the number of teams is
// rounded up so no team is bigger than asked.
export function splitTeams(n, { teams, size } = {}, rnd = cryptoUint32) {
  let count = teams ?? Math.ceil(n / Math.max(1, size ?? n));
  count = Math.max(1, Math.min(count, n));
  const out = Array.from({ length: count }, () => []);
  shuffle(range(n), rnd).forEach((p, i) => out[i % count].push(p));
  return out;
}

export function clampInt(v, min, max, fallback = min) {
  if (v == null || v === '') return fallback;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

// Tidies a typed name list: trims, shortens, drops blanks, and numbers
// repeats ("Sam", "Sam (2)") so every player can be told apart.
export function cleanNames(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    if (typeof raw !== 'string') continue;
    const base = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
    if (!base) continue;
    let name = base;
    for (let k = 2; seen.has(name.toLowerCase()); k++) name = `${base} (${k})`;
    seen.add(name.toLowerCase());
    out.push(name);
    if (out.length >= MAX_PLAYERS) break;
  }
  return out;
}

// Angles are in degrees, clockwise from the top. mod() keeps them in 0..360.
export const mod = (a, m = 360) => ((a % m) + m) % m;

// Rotation that ends a spin pointing at `target`, after `turns` full turns,
// starting from `from`, clockwise (dir 1) or anticlockwise (dir -1).
export function spinTo(from, target, turns, dir = 1) {
  return dir >= 0
    ? from + turns * 360 + mod(target - from)
    : from - turns * 360 - mod(from - target);
}

// A wheel of n equal segments, segment 0 starting at the top, turned by
// `rotation`. The pointer sits at the top.
export function segmentAt(rotation, n) {
  return Math.floor(mod(-rotation) / (360 / n)) % n;
}

// Rotation for the wheel that stops with segment `index` under the pointer.
// `offset` (-0.5..0.5) moves the stop away from the segment's centre so the
// wheel doesn't always land dead centre.
export function wheelTarget(from, index, n, turns, offset = 0) {
  const seg = 360 / n;
  const at = (index + 0.5 + Math.max(-0.4, Math.min(0.4, offset))) * seg;
  return spinTo(from, mod(-at), turns);
}

// The hour on a clock face an angle points at, for saying where the bottle
// points: 0° is 12 o'clock, 90° is 3 o'clock.
export function clockHour(angle) {
  const h = Math.round(mod(angle) / 30) % 12;
  return h === 0 ? 12 : h;
}

// Fan the straws out from one point low in the cup, like a hand of cards.
// The fewer the straws, the thicker they are and the wider apart they stand;
// the fan stays inside `width`, and the cup is cut to fit it. Returns sizes
// in px within a `width` × `height` area, and each straw's angle (degrees,
// 0 is upright), how far it sits below the rim along its own line (`sink`)
// and how far it slides out to clear the rim when drawn (`pull`).
export function strawFan(n, width, height) {
  const thick = Math.round(Math.min(26, Math.max(10, 28 - n * 0.7)));
  const cupH = height * 0.34;
  const rim = height - cupH;
  const pivot = { x: width / 2, y: height - cupH * 0.3 };
  const deep = pivot.y - rim; // how deep the straws stand, straight down
  const length = pivot.y - deep - 20; // room above to pull the middle one out
  const room = Math.max(0, width / 2 - thick - 8); // half the width a tip may use
  const rad = (d) => (d * Math.PI) / 180;
  // Wide enough to tell the straws apart, but even an outer straw, pulled
  // all the way out, must stay inside.
  const reach = (d) => (length + deep / Math.cos(rad(d)) + 12) * Math.sin(rad(d));
  let half = Math.min(((n - 1) * 12) / 2, 40);
  while (half > 0 && reach(half) > room) half = Math.max(0, half - 0.5);
  const step = n > 1 ? (2 * half) / (n - 1) : 0;
  const hit = Math.min(56, Math.max(thick, length * rad(step)));
  const cupW = Math.min(width, Math.max(96, 2 * (deep * Math.tan(rad(half)) + thick / (2 * Math.cos(rad(half))) + 14)));
  const straws = Array.from({ length: n }, (_, i) => {
    const angle = n > 1 ? -half + i * step : 0;
    const sink = deep / Math.cos(rad(angle));
    return { angle, sink, pull: sink + 12 };
  });
  return { thick, length, hit, pivot, rim, cupW, cupH, straws };
}
