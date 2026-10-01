// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  randInt, shuffle, pickNumbers, parseDice, formatDice, rollDice, spinWheel, segmentAt,
  drawStraws, flipCoin, makeTeams, parseList, cryptoRandom,
} from '../../tools/random/logic.js';

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

test('shuffle keeps every item and leaves the input alone', () => {
  const list = ['a', 'b', 'c', 'd', 'e'];
  const out = shuffle(list, seeded(2));
  assert.deepEqual([...out].sort(), list);
  assert.deepEqual(list, ['a', 'b', 'c', 'd', 'e']);
});

test('pickNumbers respects range, count, repeats and sorting', () => {
  const r = pickNumbers({ min: 1, max: 10, count: 10, unique: true, sort: true }, seeded(3));
  assert.deepEqual(r.values, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const swapped = pickNumbers({ min: 10, max: 1, count: 50 }, seeded(4));
  assert.equal(swapped.min, 1);
  assert.ok(swapped.values.every((v) => v >= 1 && v <= 10));
  assert.equal(pickNumbers({ min: 1, max: 3, count: 4, unique: true }).error, 'unique');
  assert.equal(pickNumbers({ min: 1, max: 3, count: 0 }).error, 'count');
  assert.equal(pickNumbers({ min: 1.5, max: 3, count: 1 }).error, 'range');
  assert.equal(pickNumbers({ min: NaN, max: 3, count: 1 }).error, 'range');
  assert.equal(pickNumbers({ min: 0, max: 2e9, count: 1 }).error, 'range');
});

test('parseDice reads common notation', () => {
  assert.deepEqual(parseDice('2d6 + 3'), { pool: [{ sides: 6, count: 2 }], mod: 3 });
  assert.deepEqual(parseDice('d20+d4-1'), { pool: [{ sides: 4, count: 1 }, { sides: 20, count: 1 }], mod: -1 });
  assert.deepEqual(parseDice('D%'), { pool: [{ sides: 100, count: 1 }], mod: 0 });
  assert.deepEqual(parseDice('d6+d6'), { pool: [{ sides: 6, count: 2 }], mod: 0 });
  for (const bad of ['', '3', 'd', 'd1', '2d6+', '-d6', '31d6', 'd1001', '2x6', 'd6+2000']) assert.equal(parseDice(bad), null, bad);
});

test('formatDice writes what parseDice reads', () => {
  const d = { pool: [{ sides: 20, count: 1 }, { sides: 6, count: 2 }], mod: -2 };
  assert.equal(formatDice(d), '2d6 + d20 − 2');
  assert.deepEqual(parseDice(formatDice(d).replace('−', '-')), { pool: [{ sides: 6, count: 2 }, { sides: 20, count: 1 }], mod: -2 });
  assert.equal(formatDice({ pool: [], mod: 0 }), '');
});

test('rollDice totals kept dice plus the modifier', () => {
  const rng = seeded(5);
  for (let i = 0; i < 200; i++) {
    const r = rollDice({ pool: [{ sides: 6, count: 3 }, { sides: 4, count: 1 }], mod: 2 }, 'none', rng);
    assert.equal(r.dice.length, 4);
    assert.ok(r.dice.every((d) => d.value >= 1 && d.value <= d.sides && !d.dropped));
    assert.equal(r.total, r.dice.reduce((s, d) => s + d.value, 0) + 2);
  }
});

test('advantage keeps the higher d20, disadvantage the lower', () => {
  const rng = seeded(6);
  for (let i = 0; i < 200; i++) {
    for (const adv of ['adv', 'dis']) {
      const r = rollDice({ pool: [{ sides: 20, count: 1 }, { sides: 6, count: 1 }], mod: 0 }, adv, rng);
      const d20 = r.dice.filter((d) => d.sides === 20);
      assert.equal(d20.length, 2);
      const kept = d20.find((d) => !d.dropped);
      const dropped = d20.find((d) => d.dropped);
      assert.ok(kept && dropped);
      assert.ok(adv === 'adv' ? kept.value >= dropped.value : kept.value <= dropped.value);
      assert.equal(r.total, kept.value + r.dice.find((d) => d.sides === 6).value);
    }
  }
});

test('the wheel stops on the segment it picked, after whole turns', () => {
  const rng = seeded(7);
  let from = 0;
  for (let i = 0; i < 500; i++) {
    const n = 2 + (i % 20);
    const { index, rotation } = spinWheel(n, from, rng, 5);
    assert.ok(index >= 0 && index < n);
    assert.ok(rotation - from >= 4 * 360, 'spins at least four full turns');
    assert.equal(segmentAt(n, rotation), index);
    from = rotation % 360;
  }
});

test('straws: one of each length, exactly one shortest', () => {
  const s = drawStraws(6, seeded(8));
  assert.deepEqual([...s].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
});

test('coin flips land on both sides', () => {
  const rng = seeded(9);
  const sides = new Set(Array.from({ length: 50 }, () => flipCoin(rng)));
  assert.deepEqual([...sides].sort(), ['heads', 'tails']);
});

test('teams are even and use everyone once', () => {
  const people = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const teams = makeTeams(people, 3, seeded(10));
  assert.deepEqual(teams.map((t) => t.length).sort(), [2, 2, 3]);
  assert.deepEqual(teams.flat().sort(), people);
});

test('parseList trims and drops empty lines', () => {
  assert.deepEqual(parseList('  a \n\n b\n   \nc'), ['a', 'b', 'c']);
  assert.equal(parseList(Array.from({ length: 100 }, (_, i) => i).join('\n')).length, 60);
});
