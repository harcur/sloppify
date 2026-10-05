// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, mineRange, validMines, newGame, neighbours, count, placeMines, reveal, chord, toggleFlag, flagsLeft, serialize, deserialize } from '../../tools/mines/logic.js';

// Deterministic random numbers for repeatable boards.
function seeded(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

// A small board with mines at the given indices, already in play.
function withMines(level, mines) {
  const g = newGame(level);
  g.mines = mines.length;
  for (const i of mines) g.mine[i] = 1;
  g.state = 'playing';
  return g;
}

test('every level fits its mines with a safe opening', () => {
  for (const { rows, cols, mines } of Object.values(LEVELS)) assert.ok(rows * cols - 9 >= mines);
});

test('mine counts range from 8% to 30% of the cells and include each size\'s own', () => {
  for (const [level, { rows, cols, mines }] of Object.entries(LEVELS)) {
    const { min, max } = mineRange(level);
    assert.ok(min >= 1 && min <= mines && mines <= max && max <= rows * cols - 9);
  }
  assert.deepEqual(mineRange('small'), { min: 6, max: 24 });
});

test('a new game takes a mine count, falling back to the size\'s own', () => {
  assert.equal(newGame('medium').mines, 40);
  assert.equal(newGame('medium', 60).mines, 60);
  const { min, max } = mineRange('medium');
  assert.equal(validMines('medium', min - 1), 40);
  assert.equal(validMines('medium', max + 1), 40);
  assert.equal(validMines('medium', 50.5), 40);
  assert.equal(validMines('medium', '50'), 40);
});

test('the densest boards still start with a safe opening', () => {
  for (const level of Object.keys(LEVELS)) {
    for (let seed = 1; seed <= 50; seed++) {
      const g = newGame(level, mineRange(level).max);
      const first = Math.floor(seeded(seed)() * g.rows * g.cols);
      reveal(g, first, seeded(seed));
      assert.equal(g.mine.reduce((a, b) => a + b, 0), g.mines);
      assert.equal(count(g, first), 0);
    }
  }
});

test('neighbours stay on the board', () => {
  const g = newGame('small');
  assert.deepEqual(neighbours(g, 0).sort((a, b) => a - b), [1, 9, 10]);
  assert.equal(neighbours(g, 40).length, 8);
  assert.equal(neighbours(g, 80).length, 3);
});

test('mines are placed on the first move, never on or around it', () => {
  for (let seed = 1; seed <= 200; seed++) {
    for (const level of Object.keys(LEVELS)) {
      const g = newGame(level);
      const first = Math.floor(seeded(seed)() * g.rows * g.cols);
      placeMines(g, first, seeded(seed));
      assert.equal(g.mine.reduce((a, b) => a + b, 0), g.mines);
      assert.equal(g.mine[first], 0);
      for (const j of neighbours(g, first)) assert.equal(g.mine[j], 0);
    }
  }
});

test('the first reveal opens an area and starts the game', () => {
  const g = newGame('medium');
  const opened = reveal(g, 100, seeded(7));
  assert.equal(g.state, 'playing');
  assert.ok(opened.length >= 1);
  assert.equal(count(g, 100), 0);
});

test('opening an empty cell floods to the numbered edge', () => {
  const g = withMines('small', [0]);
  const opened = reveal(g, 80);
  assert.equal(opened.length, 80);
  assert.equal(g.state, 'won');
  assert.equal(g.flag[0], 1, 'mines are flagged on a win');
});

test('opening a mine loses and marks it exploded', () => {
  const g = withMines('small', [0, 1]);
  reveal(g, 0);
  assert.equal(g.state, 'lost');
  assert.equal(g.exploded, 0);
  assert.deepEqual(reveal(g, 40), [], 'nothing opens after the game ends');
});

test('flagged cells cannot be opened and flags count down', () => {
  const g = withMines('small', [0, 1]);
  assert.equal(toggleFlag(g, 0), true);
  assert.equal(flagsLeft(g), 1);
  assert.deepEqual(reveal(g, 0), []);
  toggleFlag(g, 0);
  assert.equal(flagsLeft(g), 2);
});

test('open cells cannot be flagged', () => {
  const g = withMines('small', [0]);
  reveal(g, 2);
  assert.equal(toggleFlag(g, 2), false);
});

test('chording opens neighbours once the flags match the number', () => {
  const g = withMines('small', [0, 2]);
  reveal(g, 1); // shows 2
  assert.equal(count(g, 1), 2);
  assert.deepEqual(chord(g, 1), [], 'no chord until both are flagged');
  toggleFlag(g, 0);
  toggleFlag(g, 2);
  const opened = chord(g, 1).sort((a, b) => a - b);
  assert.deepEqual(opened, [9, 10, 11]);
  assert.equal(g.state, 'playing');
});

test('chording with a wrong flag loses', () => {
  const g = withMines('small', [0]);
  reveal(g, 1); // shows 1
  toggleFlag(g, 2);
  chord(g, 1);
  assert.equal(g.state, 'lost');
  assert.equal(g.exploded, 0);
});

test('a game survives saving and loading', () => {
  const g = newGame('large');
  reveal(g, 200, seeded(3));
  toggleFlag(g, g.mine.indexOf(1));
  g.elapsed = 12345;
  const back = deserialize(JSON.parse(JSON.stringify(serialize(g))));
  assert.deepEqual(serialize(back), serialize(g));
});

test('a custom mine count survives saving and loading', () => {
  const g = newGame('small', 20);
  reveal(g, 40, seeded(5));
  const back = deserialize(JSON.parse(JSON.stringify(serialize(g))));
  assert.equal(back.mines, 20);
  assert.equal(flagsLeft(back), 20);
});

test('games saved without a mine count load with the size\'s own', () => {
  const { mines, ...old } = serialize(withMines('small', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
  assert.equal(mines, 10);
  assert.equal(deserialize(old).mines, 10);
});

test('invalid saved games are rejected', () => {
  const good = serialize(withMines('small', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
  assert.ok(deserialize(good));
  assert.equal(deserialize(null), null);
  assert.equal(deserialize({ ...good, level: 'huge' }), null);
  assert.equal(deserialize({ ...good, state: 'paused' }), null);
  assert.equal(deserialize({ ...good, open: '01' }), null);
  assert.equal(deserialize({ ...good, mine: '1'.repeat(81) }), null);
  assert.equal(deserialize({ ...good, mines: 11 }), null, 'count disagrees with the mines placed');
  assert.equal(deserialize({ ...good, mines: 80 }), null, 'count out of range');
});
