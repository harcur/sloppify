// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, capacity, canTake, canPlace, canMove, move, undo, bestTarget, canFinish, nextFinishMove,
  encode, validPosition, serialize, deserialize, PILES, CELLS, TABLEAU, FOUNDATIONS,
} from '../../tools/solitaire/freecell.js';
import { deserialize as classicDeserialize } from '../../tools/solitaire/logic.js';
import { solve, winnableDeal, hint, toGame } from '../../tools/solitaire/freecell-solver.js';

function seeded(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

const SUIT = { spades: 0, hearts: 1, diamonds: 2, clubs: 3 };
const RANK = { A: 1, J: 11, Q: 12, K: 13 };
const card = (r, s) => SUIT[s] * 13 + (RANK[r] ?? r) - 1;
const run = (s, from, to) => Array.from({ length: to - from + 1 }, (_, k) => card(from + k, s));

// A table with the given piles; every other card goes in the last column,
// which tests leave alone.
function table(piles = {}) {
  const g = newGame(seeded(1));
  for (const p of PILES) g[p] = [];
  Object.assign(g, structuredClone(piles));
  const used = new Set(Object.values(piles).flat());
  if (!piles.t7) g.t7 = Array.from({ length: 52 }, (_, i) => i).filter((c) => !used.has(c));
  g.state = 'playing';
  return g;
}

test('a deal puts all 52 cards face up in eight columns', () => {
  const g = newGame(seeded(3));
  assert.equal(g.mode, 'freecell');
  assert.deepEqual(TABLEAU.map((p) => g[p].length), [7, 7, 7, 7, 6, 6, 6, 6]);
  assert.equal(new Set(TABLEAU.flatMap((p) => g[p])).size, 52);
  assert.ok([...CELLS, ...FOUNDATIONS].every((p) => !g[p].length));
  assert.equal(g.state, 'ready');
});

test('columns build down in alternating colours, and any card fills an empty column', () => {
  const g = table({ t0: [card(7, 'spades')], t1: [card(6, 'hearts')], t2: [card(6, 'clubs')] });
  assert.ok(canMove(g, 't1', 0, 't0'));
  assert.ok(!canMove(g, 't2', 0, 't0'));
  assert.ok(canMove(g, 't2', 0, 't3'));
  assert.ok(!canPlace(g, card(5, 'hearts'), 1, 't0'));
});

test('a free cell holds one card, and only single cards go to cells and foundations', () => {
  const g = table({ t0: [card(9, 'spades'), card(8, 'hearts')], c1: [card('K', 'clubs')], f0: [card('A', 'hearts')] });
  assert.ok(!canPlace(g, card(5, 'hearts'), 1, 'c1'));
  assert.ok(canPlace(g, card(5, 'hearts'), 1, 'c0'));
  assert.ok(!canPlace(g, card(9, 'spades'), 2, 'c0'));
  assert.ok(!canMove(g, 't0', 0, 'f0'));
  assert.ok(canMove(g, 't0', 1, 'c0'));
  assert.ok(canTake(g, 'c1', 0));
  assert.ok(!canTake(g, 'f0', 0), 'cards stay on the foundations');
});

test('how many cards move at once depends on free cells and empty columns', () => {
  // Every column but the last has a card, so no column is empty.
  const full = Object.fromEntries(TABLEAU.slice(0, 7).map((p, k) => [p, [card(k + 1, 'clubs')]]));
  const g = table({ ...full, t0: [card('K', 'spades'), card('Q', 'hearts'), card('J', 'spades'), card(10, 'hearts')], t1: [card('K', 'clubs')], c0: [card(2, 'diamonds')], c1: [card(3, 'diamonds')] });
  assert.equal(capacity(g, 't1'), 3); // two free cells
  assert.ok(canMove(g, 't0', 1, 't1'), 'three cards with two free cells');
  g.c2 = [card(4, 'diamonds')];
  assert.equal(capacity(g, 't1'), 2);
  assert.ok(!canMove(g, 't0', 1, 't1'), 'not three with one free cell');
  g.t6 = []; // an empty column doubles it
  g.t7.push(card(7, 'clubs'));
  assert.equal(capacity(g, 't1'), 4);
  assert.equal(capacity(g, 't6'), 2, 'the column moved to does not count');
  assert.ok(canMove(g, 't0', 1, 't1'));
});

test('a run is only picked up when it builds down in alternating colours', () => {
  const g = table({ t0: [card(9, 'spades'), card(8, 'hearts'), card(7, 'hearts')] });
  assert.ok(canTake(g, 't0', 2));
  assert.ok(!canTake(g, 't0', 1));
});

test('moves count, undo restores, and a full set of foundations wins', () => {
  const g = table({ f0: run('spades', 1, 12), f1: run('hearts', 1, 13), f2: run('diamonds', 1, 13), f3: run('clubs', 1, 13), t0: [card('K', 'spades')], t7: [] });
  const before = encode(g);
  assert.ok(move(g, 't0', 0, 'c0'));
  assert.equal(g.moves, 1);
  assert.ok(undo(g));
  assert.equal(encode(g), before);
  assert.equal(g.moves, 2);
  assert.ok(move(g, 't0', 0, 'f0'));
  assert.equal(g.state, 'won');
  assert.equal(move(g, 'f0', 12, 't0'), null);
});

test('a tap sends a card home, then onto a column, then to an empty column, then to a free cell', () => {
  const g = table({ t0: [card(5, 'clubs'), card('A', 'hearts')], t1: [card(8, 'spades')], t2: [card(9, 'clubs'), card(7, 'hearts')], t3: [card(4, 'clubs'), card(3, 'spades')] });
  assert.equal(bestTarget(g, 't0', 1), 'f0');
  assert.equal(bestTarget(g, 't2', 1), 't1');
  assert.equal(bestTarget(g, 't3', 1), 't4', 'an empty column');
  assert.equal(bestTarget(g, 't1', 0), 'c0', 'a whole column does not move to an empty one');
  g.c0 = [card(2, 'clubs')];
  assert.equal(bestTarget(g, 'c0', 0), 't4');
});

test('once every column is in order the rest finishes itself', () => {
  const g = table({
    f0: run('spades', 1, 11), f1: run('hearts', 1, 11), f2: run('diamonds', 1, 13), f3: run('clubs', 1, 13),
    t0: [card('K', 'spades'), card('Q', 'hearts')], c0: [card('Q', 'spades')], t7: [card('K', 'hearts')],
  });
  assert.ok(canFinish(g));
  for (let k = 0; k < 4; k++) {
    const s = nextFinishMove(g);
    assert.ok(move(g, s.from, s.index, s.to));
  }
  assert.equal(g.state, 'won');
  const mixed = table({ t0: [card(3, 'spades'), card(9, 'hearts')] });
  assert.ok(!canFinish(mixed));
});

test('saved games round-trip, and broken ones are refused', () => {
  const g = newGame(seeded(8));
  move(g, 't0', 6, 'c2');
  const back = deserialize(JSON.parse(JSON.stringify(serialize(g))));
  assert.equal(encode(back), encode(g));
  assert.equal(back.moves, 1);
  assert.equal(back.history.length, 1);
  assert.ok(validPosition(encode(g)));
  const twoInCell = encode(g).replace(/^\|\|/, 'AB||');
  assert.ok(!validPosition(twoInCell));
  assert.equal(deserialize({ ...serialize(g), position: 'x' }), null);
  assert.equal(deserialize({ ...serialize(g), mode: undefined }), null);
  assert.equal(classicDeserialize(serialize(g)), null, 'the classic game does not load a free cell game');
});

// Solver ----------------------------------------------------------------

function replay(g, moves) {
  for (const m of moves) {
    const gm = toGame(g, m);
    assert.ok(move(g, gm.from, gm.index, gm.to), `move not allowed: ${JSON.stringify(m)}`);
  }
  assert.equal(g.state, 'won');
}

test('solutions play through to a win under the game rules', () => {
  let solved = 0;
  for (let k = 1; k <= 20; k++) {
    const g = newGame(seeded(k));
    const before = encode(g);
    const r = solve(g);
    assert.equal(encode(g), before, 'the solver must not change the game');
    if (!r.solved) continue;
    solved++;
    replay(g, r.moves);
  }
  assert.ok(solved >= 18, `solved ${solved} of 20`);
});

test('deals are proven winnable', () => {
  for (let k = 1; k <= 5; k++) {
    const { game, proven } = winnableDeal({ rand: seeded(300 + k) });
    assert.ok(proven);
    assert.equal(game.mode, 'freecell');
    assert.equal(game.state, 'ready');
  }
});

test('following hint after hint wins', () => {
  const { game: g } = winnableDeal({ rand: seeded(40) });
  for (let step = 0; g.state !== 'won'; step++) {
    assert.ok(step < 400, 'too many hints');
    const next = hint(g);
    assert.ok(next, `no hint at step ${step}`);
    assert.ok(canMove(g, next.from, next.index, next.to), JSON.stringify(next));
    move(g, next.from, next.index, next.to);
  }
  assert.equal(hint(g), null);
});

test('no hint from a position with no way to win', () => {
  // Every cell full, no empty column, a king on top of every column and the
  // aces at the bottom: no move anywhere.
  const g = table({ c0: [card(10, 'spades')], c1: [card(10, 'hearts')], c2: [card(10, 'diamonds')], c3: [card(10, 'clubs')] });
  const rest = g.t7;
  g.t7 = [];
  const order = [...rest].sort((a, b) => (a % 13) - (b % 13));
  TABLEAU.forEach((p, k) => { g[p] = order.filter((_, i) => i % 8 === k); });
  assert.equal(solve(g, { limit: 2000 }).solved, false);
});

test('the search stops at its limit', () => {
  const r = solve(newGame(seeded(4)), { limit: 1 });
  assert.equal(r.solved, false);
  assert.ok(r.nodes <= 1);
});
