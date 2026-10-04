// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cryptoRandom, randInt, pickNumbers, sum, readInt } from '../../tools/random-numbers/logic.js';

// Deterministic random numbers for repeatable results.
function seeded(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

test('cryptoRandom stays in [0, 1)', () => {
  for (let i = 0; i < 1000; i++) {
    const x = cryptoRandom();
    assert.ok(x >= 0 && x < 1);
  }
});

test('randInt covers its whole range and nothing else', () => {
  const rng = seeded(1);
  const seen = new Set();
  for (let i = 0; i < 2000; i++) seen.add(randInt(-2, 3, rng));
  assert.deepEqual([...seen].sort((a, b) => a - b), [-2, -1, 0, 1, 2, 3]);
  assert.equal(randInt(5, 5, rng), 5);
});

test('randInt is roughly uniform', () => {
  const counts = new Array(6).fill(0);
  for (let i = 0; i < 60000; i++) counts[randInt(1, 6) - 1]++;
  for (const c of counts) assert.ok(c > 9000 && c < 11000, `count ${c}`);
});

test('no repeats uses every number once when asked for all of them', () => {
  const r = pickNumbers({ min: 1, max: 10, count: 10, unique: true, sort: true }, seeded(3));
  assert.deepEqual(r.values, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('values stay in range, and a backwards range is swapped', () => {
  const r = pickNumbers({ min: 10, max: -5, count: 100 }, seeded(4));
  assert.equal(r.min, -5);
  assert.equal(r.max, 10);
  assert.equal(r.values.length, 100);
  assert.ok(r.values.every((v) => Number.isInteger(v) && v >= -5 && v <= 10));
});

test('sorting is numeric', () => {
  const r = pickNumbers({ min: 1, max: 1000, count: 50, sort: true }, seeded(5));
  assert.deepEqual(r.values, [...r.values].sort((a, b) => a - b));
});

test('bad input gives an error instead of numbers', () => {
  assert.equal(pickNumbers({ min: 1, max: 3, count: 4, unique: true }).error, 'unique');
  assert.equal(pickNumbers({ min: 1, max: 3, count: 0 }).error, 'count');
  assert.equal(pickNumbers({ min: 1, max: 3, count: 101 }).error, 'count');
  assert.equal(pickNumbers({ min: 1, max: 3, count: NaN }).error, 'count');
  assert.equal(pickNumbers({ min: 1.5, max: 3 }).error, 'range');
  assert.equal(pickNumbers({ min: NaN, max: 3 }).error, 'range');
  assert.equal(pickNumbers({ min: 0, max: 2e9 }).error, 'range');
});

test('readInt accepts whole numbers only, including a typographic minus', () => {
  assert.equal(readInt(' 42 '), 42);
  assert.equal(readInt('-7'), -7);
  assert.equal(readInt('−7'), -7);
  for (const bad of ['', '1.5', '1e3', 'ten', '--1']) assert.ok(Number.isNaN(readInt(bad)), bad);
});

test('sum adds the values', () => {
  assert.equal(sum([1, 2, -3]), 0);
});
