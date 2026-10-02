// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  randomInt, shuffle, pickMany, splitTeams, cleanNames, clampInt, range,
  mod, spinTo, segmentAt, wheelTarget, clockHour, MAX_PLAYERS, MAX_NAME,
} from '../../tools/pick-a-person/pick.js';

// Deterministic 32-bit numbers for repeatable tests.
function seeded(seed) {
  return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
}

test('randomInt stays in range and throws away the biased top of the range', () => {
  const values = [2 ** 32 - 1, 7]; // 2^32 - 1 is past the last whole set of 3, so it's thrown away
  let k = 0;
  assert.equal(randomInt(3, () => values[k++]), 7 % 3);
  assert.equal(k, 2);
  for (let n = 1; n < 40; n++) {
    const r = randomInt(n);
    assert.ok(Number.isInteger(r) && r >= 0 && r < n);
  }
  assert.throws(() => randomInt(0));
});

test('every player is about equally likely', () => {
  const n = 7;
  const runs = 70000;
  const counts = new Array(n).fill(0);
  for (let i = 0; i < runs; i++) counts[randomInt(n)]++;
  for (const c of counts) assert.ok(Math.abs(c - runs / n) < runs / n * 0.06, `${counts}`);
});

test('shuffle keeps every item once and leaves the input alone', () => {
  const list = range(20);
  const out = shuffle(list, seeded(3));
  assert.deepEqual([...out].sort((a, b) => a - b), list);
  assert.deepEqual(list, range(20));
  assert.notDeepEqual(out, list);
});

test('pickMany picks different players', () => {
  const picked = pickMany(10, 4, seeded(9));
  assert.equal(picked.length, 4);
  assert.equal(new Set(picked).size, 4);
  assert.equal(pickMany(3, 9).length, 3);
});

test('teams cover everyone once and differ in size by at most one', () => {
  for (let n = 2; n <= MAX_PLAYERS; n++) {
    for (const opts of [{ teams: 2 }, { teams: 3 }, { teams: 5 }, { size: 2 }, { size: 3 }, { size: 4 }]) {
      const teams = splitTeams(n, opts, seeded(n));
      const all = teams.flat().sort((a, b) => a - b);
      assert.deepEqual(all, range(n));
      const sizes = teams.map((t) => t.length);
      assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `${n} ${JSON.stringify(opts)}: ${sizes}`);
      assert.ok(sizes.every((s) => s > 0));
      if (opts.size) assert.ok(Math.max(...sizes) <= opts.size);
    }
  }
  assert.equal(splitTeams(3, { teams: 8 }).length, 3);
  assert.equal(splitTeams(7, { size: 3 }).length, 3);
});

test('names are tidied, numbered when repeated and capped', () => {
  assert.deepEqual(cleanNames(['  Ada ', '', 'Ben', 'ben', 'Ada', 3, null, ' Cleo   Lane ']),
    ['Ada', 'Ben', 'ben (2)', 'Ada (2)', 'Cleo Lane']);
  assert.equal(cleanNames(['x'.repeat(80)])[0].length, MAX_NAME);
  assert.equal(cleanNames(range(50).map(String)).length, MAX_PLAYERS);
  assert.deepEqual(cleanNames('not a list'), []);
});

test('clampInt', () => {
  assert.equal(clampInt('5', 2, 30), 5);
  assert.equal(clampInt(99, 2, 30), 30);
  assert.equal(clampInt('x', 2, 30, 4), 4);
  assert.equal(clampInt(null, 2, 30, 4), 4); // nothing saved yet
});

test('spinTo ends on the target after the turns asked, either way round', () => {
  for (const from of [0, 37, -400, 1234]) {
    for (const target of [0, 90, 359]) {
      const cw = spinTo(from, target, 3, 1);
      assert.equal(mod(cw), target);
      assert.ok(cw - from >= 3 * 360 && cw - from < 4 * 360);
      const ccw = spinTo(from, target, 3, -1);
      assert.ok(Math.abs(mod(ccw) - target) < 1e-9);
      assert.ok(from - ccw >= 3 * 360 && from - ccw < 4 * 360);
    }
  }
});

test('the wheel stops on the segment picked', () => {
  for (let n = 2; n <= MAX_PLAYERS; n++) {
    for (let i = 0; i < n; i++) {
      for (const offset of [-0.5, 0, 0.5]) {
        const r = wheelTarget(123.4, i, n, 5, offset);
        assert.equal(segmentAt(r, n), i, `n ${n}, segment ${i}, offset ${offset}`);
      }
    }
  }
  assert.equal(segmentAt(0, 4), 0);
  assert.equal(segmentAt(-91, 4), 1); // turned back a quarter: segment 1 is under the pointer
});

test('clock hours', () => {
  assert.equal(clockHour(0), 12);
  assert.equal(clockHour(90), 3);
  assert.equal(clockHour(-90), 9);
  assert.equal(clockHour(350), 12);
});
