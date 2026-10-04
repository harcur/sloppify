// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, canTake, canPlace, move, drawStock, undo, bestTarget, canFinish, nextFinishMove,
  encode, validPosition, serialize, deserialize, TABLEAU, FOUNDATIONS,
} from '../../tools/solitaire/logic.js';

function seeded(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

// Card numbers by name: card('Q', 'hearts').
const SUIT = { spades: 0, hearts: 1, diamonds: 2, clubs: 3 };
const RANK = { A: 1, J: 11, Q: 12, K: 13 };
const card = (r, s) => SUIT[s] * 13 + (RANK[r] ?? r) - 1;

// An empty table; tests put cards where they need them. The rest go in the stock.
function table(piles = {}, down = [0, 0, 0, 0, 0, 0, 0]) {
  const g = newGame(1, seeded(1));
  for (const p of ['stock', 'waste', ...FOUNDATIONS, ...TABLEAU]) g[p] = [];
  Object.assign(g, piles);
  g.down = down;
  const used = new Set(Object.values(piles).flat());
  if (!piles.stock) g.stock = Array.from({ length: 52 }, (_, i) => i).filter((c) => !used.has(c));
  g.state = 'playing';
  return g;
}

test('a deal puts 28 cards in seven piles, one face up on each', () => {
  const g = newGame(1, seeded(7));
  assert.deepEqual(TABLEAU.map((p) => g[p].length), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(g.down, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(g.stock.length, 24);
  assert.ok(validPosition(encode(g)));
  assert.notEqual(encode(newGame(1, seeded(8))), encode(g));
});

test('tableau takes alternating colours going down, and only kings on empty piles', () => {
  const g = table({ t0: [card(8, 'spades')], t1: [] });
  assert.ok(canPlace(g, card(7, 'hearts'), 1, 't0'));
  assert.ok(canPlace(g, card(7, 'diamonds'), 3, 't0'));
  assert.ok(!canPlace(g, card(7, 'clubs'), 1, 't0'));
  assert.ok(!canPlace(g, card(6, 'hearts'), 1, 't0'));
  assert.ok(canPlace(g, card('K', 'clubs'), 1, 't1'));
  assert.ok(!canPlace(g, card('Q', 'clubs'), 1, 't1'));
});

test('foundations build up by suit from the ace, one card at a time', () => {
  const g = table({ f0: [card('A', 'hearts')] });
  assert.ok(canPlace(g, card('A', 'spades'), 1, 'f1'));
  assert.ok(!canPlace(g, card(2, 'spades'), 1, 'f1'));
  assert.ok(canPlace(g, card(2, 'hearts'), 1, 'f0'));
  assert.ok(!canPlace(g, card(2, 'diamonds'), 1, 'f0'));
  assert.ok(!canPlace(g, card(2, 'hearts'), 2, 'f0'));
});

test('only face-up cards and the tops of the waste and foundations can be taken', () => {
  const g = table({ t0: [card(9, 'clubs'), card(5, 'hearts'), card(4, 'spades')], waste: [card(2, 'clubs'), card(3, 'clubs')] }, [1, 0, 0, 0, 0, 0, 0]);
  assert.ok(!canTake(g, 't0', 0));
  assert.ok(canTake(g, 't0', 1));
  assert.ok(canTake(g, 'waste', 1));
  assert.ok(!canTake(g, 'waste', 0));
  assert.ok(!canTake(g, 'stock', g.stock.length - 1));
});

test('moving a run turns over the card it uncovers', () => {
  const g = table({ t0: [card(2, 'clubs'), card(9, 'spades'), card(8, 'hearts')], t1: [card(10, 'diamonds')] }, [2, 0, 0, 0, 0, 0, 0]);
  assert.equal(move(g, 't0', 1, 't1'), null); // the 9 is still face down
  g.down[0] = 1;
  const r = move(g, 't0', 1, 't1');
  assert.deepEqual(r, { cards: [card(9, 'spades'), card(8, 'hearts')], flipped: card(2, 'clubs') });
  assert.equal(g.down[0], 0);
  assert.deepEqual(g.t1, [card(10, 'diamonds'), card(9, 'spades'), card(8, 'hearts')]);
  assert.equal(g.moves, 1);
});

test('the stock deals one or three cards and turns over when empty', () => {
  const g = table({ stock: [1, 2, 3, 4], t0: Array.from({ length: 48 }, (_, i) => i + 4) });
  assert.equal(drawStock(g), 'drawn');
  assert.deepEqual(g.waste, [4]);
  g.draw = 3;
  drawStock(g);
  assert.deepEqual(g.waste, [4, 3, 2, 1]);
  assert.equal(drawStock(g), 'recycled');
  assert.deepEqual(g.stock, [1, 2, 3, 4]);
  assert.deepEqual(g.waste, []);
  g.stock = [];
  assert.equal(drawStock(g), null);
});

test('undo restores the position before each move', () => {
  const g = newGame(1, seeded(3));
  const start = encode(g);
  drawStock(g);
  drawStock(g);
  assert.ok(undo(g));
  assert.ok(undo(g));
  assert.equal(encode(g), start);
  assert.equal(g.moves, 4);
  assert.ok(!undo(g));
});

test('a tap sends a card to a foundation first, then to a pile', () => {
  const g = table({
    waste: [card('A', 'diamonds')],
    t0: [card(5, 'clubs')], t1: [], t2: [card(6, 'hearts')], t3: [card(4, 'hearts')],
    t4: [card(2, 'spades'), card('K', 'clubs')], t5: [card('K', 'spades')],
  }, [0, 0, 0, 0, 1, 0, 0]);
  assert.equal(bestTarget(g, 'waste', 0), 'f0');
  assert.equal(bestTarget(g, 't0', 0), 't2'); // 5 of clubs onto the 6 of hearts
  assert.equal(bestTarget(g, 't3', 0), 't0'); // 4 of hearts onto the 5 of clubs
  assert.equal(bestTarget(g, 't4', 1), 't6'); // a king from a pile with cards under it, to the next empty pile
  assert.equal(bestTarget(g, 't5', 0), null); // a king that already starts a pile stays
  assert.equal(bestTarget(g, 't4', 0), null); // face down
});

test('a game finishes once every card is face up and the stock is used', () => {
  const g = table({
    stock: [],
    f0: Array.from({ length: 12 }, (_, i) => i), f1: Array.from({ length: 13 }, (_, i) => 13 + i),
    f2: Array.from({ length: 13 }, (_, i) => 26 + i), f3: Array.from({ length: 11 }, (_, i) => 39 + i),
    t0: [card('K', 'clubs'), card('K', 'spades')], t1: [card('Q', 'clubs')],
  });
  assert.ok(canFinish(g));
  assert.deepEqual(nextFinishMove(g), { from: 't1', index: 0, to: 'f3' });
  let step;
  while ((step = nextFinishMove(g))) move(g, step.from, step.index, step.to);
  assert.equal(g.state, 'won');
  assert.ok(!canFinish(g));
  assert.equal(move(g, 'f0', 12, 't2'), null);
  assert.ok(!undo(g));
});

test('saved games round-trip, and broken ones are refused', () => {
  const g = newGame(3, seeded(11));
  drawStock(g);
  const back = deserialize(JSON.parse(JSON.stringify(serialize(g))));
  assert.equal(encode(back), encode(g));
  assert.equal(back.draw, 3);
  assert.equal(back.history.length, 1);
  assert.equal(deserialize(null), null);
  assert.equal(deserialize({ position: 'nonsense' }), null);
  const dup = encode(g).replace(/[A-t]/, 'A').replace(/[B-t]/, 'A');
  assert.equal(deserialize({ position: dup }), null);
  const tooManyDown = encode(g).split('|');
  tooManyDown[6] = `9${tooManyDown[6].slice(1)}`;
  assert.equal(deserialize({ position: tooManyDown.join('|') }), null);
});
