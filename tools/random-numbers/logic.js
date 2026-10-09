// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Pure logic for random numbers: no DOM, so it can be tested directly.
// Functions take an rng (a float in [0, 1)) so tests can pass a seeded one;
// the page uses cryptoRandom.

export const LIMITS = { value: 1e9, count: 100 };

// 53 random bits from the browser's cryptographic source.
export function cryptoRandom() {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return (a[0] * 2 ** 21 + (a[1] >>> 11)) / 2 ** 53;
}

export function randInt(min, max, rng = cryptoRandom) {
  return min + Math.floor(rng() * (max - min + 1));
}

// Returns { values, min, max } or { error } ('range', 'count' or 'unique').
// A range given backwards is swapped.
export function pickNumbers({ min, max, count = 1, unique = false, sort = false }, rng = cryptoRandom) {
  if (!Number.isInteger(min) || !Number.isInteger(max)) return { error: 'range' };
  if (min > max) [min, max] = [max, min];
  if (Math.abs(min) > LIMITS.value || Math.abs(max) > LIMITS.value) return { error: 'range' };
  if (!Number.isInteger(count) || count < 1 || count > LIMITS.count) return { error: 'count' };
  if (unique && count > max - min + 1) return { error: 'unique' };
  let values;
  if (unique) {
    const seen = new Set();
    while (seen.size < count) seen.add(randInt(min, max, rng));
    values = [...seen];
  } else values = Array.from({ length: count }, () => randInt(min, max, rng));
  if (sort) values.sort((a, b) => a - b);
  return { values, min, max };
}

export const sum = (values) => values.reduce((s, v) => s + v, 0);

// Reads a whole number typed into a field; anything else is NaN.
export function readInt(text) {
  const s = String(text).trim().replace(/^−/, '-');
  return /^-?\d+$/.test(s) ? Number(s) : NaN;
}
