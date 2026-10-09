// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, move, drawStock, canPlace, canMove, encode, FOUNDATIONS, TABLEAU } from '../../tools/solitaire/logic.js';
import { solve, winnableDeal, hint } from '../../tools/solitaire/solver.js';

function seeded(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

// Plays the solver's moves with the game's own rules. Every move must be
// allowed, and the game must end won.
function replay(g, moves) {
  for (const m of moves) {
    let ok;
    if (m.kind === 'draw') ok = drawStock(g);
    else if (m.kind === 'waste') ok = move(g, 'waste', g.waste.length - 1, TABLEAU[m.to]);
    else if (m.kind === 'run') ok = move(g, TABLEAU[m.from], m.index, TABLEAU[m.to]);
    else {
      const from = m.from === 'waste' ? 'waste' : TABLEAU[m.from];
      const card = g[from].at(-1);
      ok = move(g, from, g[from].length - 1, FOUNDATIONS.find((f) => canPlace(g, card, 1, f)));
    }
    assert.ok(ok, `move not allowed: ${JSON.stringify(m)}`);
  }
  assert.equal(g.state, 'won');
}

for (const draw of [1, 3]) {
  test(`solutions found for draw ${draw} play through to a win under the game's rules`, () => {
    let solved = 0;
    for (let k = 1; k <= 12; k++) {
      const g = newGame(draw, seeded(k));
      const before = encode(g);
      const r = solve(g, { limit: 8000 });
      assert.equal(encode(g), before, 'the solver must not change the game');
      if (!r.solved) continue;
      solved++;
      replay(g, r.moves);
    }
    assert.ok(solved >= 4, `solved ${solved} of 12`);
  });

  test(`winnable deals are proven by a solution (draw ${draw})`, () => {
    for (let k = 1; k <= 5; k++) {
      const { game, proven } = winnableDeal(draw, { rand: seeded(100 + k) });
      assert.ok(proven);
      assert.equal(game.draw, draw);
      assert.equal(game.state, 'ready');
      const copy = structuredClone(game);
      replay(copy, solve(game, { limit: 8000 }).moves);
    }
  });
}

test('the search stops at its limit', () => {
  const r = solve(newGame(1, seeded(4)), { limit: 1 });
  assert.equal(r.solved, false);
  assert.deepEqual(r.moves, []);
  assert.ok(r.nodes <= 2);
});

for (const draw of [1, 3]) {
  test(`following hint after hint wins a winnable deal (draw ${draw})`, () => {
    const { game: g } = winnableDeal(draw, { rand: seeded(20) });
    for (let step = 0; g.state !== 'won'; step++) {
      assert.ok(step < 1000, 'too many hints');
      const before = encode(g);
      const next = hint(g);
      assert.ok(next, `no hint at step ${step}`);
      assert.equal(encode(g), before, 'asking for a hint must not change the game');
      if (next.kind === 'draw') assert.ok(drawStock(g));
      else {
        assert.ok(canMove(g, next.from, next.index, next.to), JSON.stringify(next));
        move(g, next.from, next.index, next.to);
      }
    }
    assert.equal(hint(g), null); // nothing to hint once won
  });
}

test('no hint from a position with no way to win', () => {
  // All 52 cards in one column with the 2 of spades on top: it can't go to a
  // foundation (no ace yet) or to an empty column (only kings can), and the
  // stock is empty.
  const g = newGame(1, seeded(1));
  for (const p of ['stock', 'waste', ...FOUNDATIONS, ...TABLEAU]) g[p] = [];
  g.t0 = [...Array.from({ length: 52 }, (_, c) => c).filter((c) => c !== 1), 1];
  g.down = [51, 0, 0, 0, 0, 0, 0];
  g.state = 'playing';
  assert.equal(hint(g), null);
});
