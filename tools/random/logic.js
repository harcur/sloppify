// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Pure logic for the random tool: no DOM, so it can be tested directly.
// Every function takes an rng (returns a float in [0, 1)) so tests can pass a
// seeded one; the page uses cryptoRandom.

export const DICE = [4, 6, 8, 10, 12, 20, 100];
export const LIMITS = { value: 1e9, count: 100, dice: 30, sides: 1000, mod: 1000, entries: 60, teams: 20 };

// 53 random bits from the browser's cryptographic source.
export function cryptoRandom() {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return (a[0] * 2 ** 21 + (a[1] >>> 11)) / 2 ** 53;
}

export function randInt(min, max, rng = cryptoRandom) {
  return min + Math.floor(rng() * (max - min + 1));
}

export function shuffle(list, rng = cryptoRandom) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(0, i, rng);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Numbers ---------------------------------------------------------------

// Returns { values } or { error } ('range', 'count', 'unique').
export function pickNumbers({ min, max, count = 1, unique = false, sort = false }, rng = cryptoRandom) {
  if (![min, max, count].every(Number.isInteger)) return { error: 'range' };
  if (min > max) [min, max] = [max, min];
  if (Math.abs(min) > LIMITS.value || Math.abs(max) > LIMITS.value) return { error: 'range' };
  if (count < 1 || count > LIMITS.count) return { error: 'count' };
  const size = max - min + 1;
  if (unique && count > size) return { error: 'unique' };
  let values;
  if (!unique) values = Array.from({ length: count }, () => randInt(min, max, rng));
  else {
    const seen = new Set();
    while (seen.size < count) seen.add(randInt(min, max, rng));
    values = [...seen];
  }
  if (sort) values.sort((a, b) => a - b);
  return { values, min, max };
}

// Dice ------------------------------------------------------------------

// "2d6 + d20 - 1", "d%" -> { pool: [{ sides, count }], mod }, or null if it can't be read.
export function parseDice(text) {
  const src = String(text).toLowerCase().replace(/\s+/g, '');
  if (!src) return null;
  const terms = src.match(/[+-]?[^+-]+/g);
  if (!terms || terms.join('') !== src) return null;
  const counts = new Map();
  let mod = 0;
  let dice = 0;
  for (const term of terms) {
    const sign = term[0] === '-' ? -1 : 1;
    const body = term.replace(/^[+-]/, '');
    const m = body.match(/^(\d*)d(\d+|%)$/);
    if (m) {
      if (sign < 0) return null;
      const count = m[1] === '' ? 1 : Number(m[1]);
      const sides = m[2] === '%' ? 100 : Number(m[2]);
      if (count < 1 || sides < 2 || sides > LIMITS.sides) return null;
      dice += count;
      counts.set(sides, (counts.get(sides) ?? 0) + count);
    } else if (/^\d+$/.test(body)) mod += sign * Number(body);
    else return null;
  }
  if (dice < 1 || dice > LIMITS.dice || Math.abs(mod) > LIMITS.mod) return null;
  return { pool: sortPool([...counts].map(([sides, count]) => ({ sides, count }))), mod };
}

export const sortPool = (pool) => pool.filter((d) => d.count > 0).sort((a, b) => a.sides - b.sides);

export function formatDice({ pool, mod }) {
  const dice = sortPool(pool).map((d) => `${d.count > 1 ? d.count : ''}d${d.sides}`).join(' + ');
  if (!mod) return dice;
  return `${dice}${dice ? ' ' : ''}${mod < 0 ? '−' : '+'} ${Math.abs(mod)}`;
}

export const poolSize = (pool) => pool.reduce((n, d) => n + d.count, 0);

// Rolls every die. With advantage ('adv') or disadvantage ('dis') each d20 is
// rolled twice and the lower (or higher) roll is kept but marked dropped.
export function rollDice({ pool, mod = 0 }, advantage = 'none', rng = cryptoRandom) {
  const dice = [];
  for (const { sides, count } of sortPool(pool)) {
    for (let i = 0; i < count; i++) {
      const value = randInt(1, sides, rng);
      if (sides === 20 && advantage !== 'none') {
        const other = randInt(1, sides, rng);
        const keepFirst = advantage === 'adv' ? value >= other : value <= other;
        dice.push({ sides, value, dropped: !keepFirst }, { sides, value: other, dropped: keepFirst });
      } else dice.push({ sides, value, dropped: false });
    }
  }
  const sum = dice.reduce((s, d) => s + (d.dropped ? 0 : d.value), 0);
  return { dice, mod, total: sum + mod };
}

// Wheel -----------------------------------------------------------------

// Picks a winner and the wheel's next rotation (degrees, clockwise, always
// further than `from` by at least `turns` whole turns). The pointer is at
// the top; segment i covers [i, i+1) * 360/n degrees clockwise from the top.
export function spinWheel(n, from = 0, rng = cryptoRandom, turns = 5) {
  const index = randInt(0, n - 1, rng);
  const seg = 360 / n;
  const at = (index + 0.1 + 0.8 * rng()) * seg; // keep clear of the edges
  const base = from - (((from % 360) + 360) % 360);
  return { index, rotation: base + turns * 360 + (360 - at) };
}

// Which segment sits under the pointer at a given rotation.
export function segmentAt(n, rotation) {
  const a = (((-rotation % 360) + 360) % 360);
  return Math.min(n - 1, Math.floor(a / (360 / n)));
}

// Straws, coin, teams -------------------------------------------------

// A permutation of lengths 1..n; the straw with length 1 is the shortest.
export function drawStraws(n, rng = cryptoRandom) {
  return shuffle(Array.from({ length: n }, (_, i) => i + 1), rng);
}

export const flipCoin = (rng = cryptoRandom) => (rng() < 0.5 ? 'heads' : 'tails');

// Splits a list into `count` teams as evenly as possible, in random order.
export function makeTeams(list, count, rng = cryptoRandom) {
  const teams = Array.from({ length: count }, () => []);
  shuffle(list, rng).forEach((item, i) => teams[i % count].push(item));
  return teams;
}

// One entry per non-empty line, trimmed.
export function parseList(text) {
  return String(text).split('\n').map((s) => s.trim()).filter(Boolean).slice(0, LIMITS.entries);
}
