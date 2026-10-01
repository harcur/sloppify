// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEVELS, UNITS, PEERS, generate, solve, solvesWithSingles, newGame, conflicts, digitCounts, completeUnits,
  place, toggleNote, erase, undo, hint, serialize, deserialize,
} from '../../tools/sudoku/logic.js';

// Deterministic random numbers for repeatable puzzles.
function seeded(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

// A valid full grid, and a game with the given cells left empty.
const SOLUTION = Array.from({ length: 81 }, (_, i) => {
  const r = Math.floor(i / 9);
  return ((r * 3 + Math.floor(r / 3) + (i % 9)) % 9) + 1;
});
function withBlanks(blanks) {
  const puzzle = SOLUTION.slice();
  for (const i of blanks) puzzle[i] = 0;
  return newGame('easy', { puzzle, solution: SOLUTION });
}

test('units and peers have the right shape', () => {
  assert.equal(UNITS.length, 27);
  for (const u of UNITS) assert.equal(new Set(u).size, 9);
  for (const p of PEERS) assert.equal(p.length, 20);
  assert.ok(PEERS[0].includes(10) && PEERS[0].includes(72) && !PEERS[0].includes(30));
});

test('the sample grid is a valid solution', () => {
  for (const u of UNITS) assert.equal(new Set(u.map((i) => SOLUTION[i])).size, 9);
});

test('the solver finds and counts solutions', () => {
  const out = [];
  assert.equal(solve(SOLUTION.map((d, i) => (i < 9 ? 0 : d)), { out }), 1);
  assert.deepEqual(out, SOLUTION);
  assert.equal(solve(new Array(81).fill(0)), 2, 'an empty grid has many solutions');
  const broken = SOLUTION.slice();
  broken[1] = broken[0];
  assert.equal(solve(broken), 0);
});

test('generated puzzles have one solution and match their level', () => {
  for (let seed = 1; seed <= 12; seed++) {
    for (const level of Object.keys(LEVELS)) {
      const { puzzle, solution } = generate(level, seeded(seed));
      const out = [];
      assert.equal(solve(puzzle, { out }), 1);
      assert.deepEqual(out, solution);
      assert.ok(puzzle.every((d, i) => !d || d === solution[i]));
      const givens = puzzle.filter(Boolean).length;
      assert.ok(givens >= LEVELS[level].min, `${level}: ${givens} givens`);
      if (LEVELS[level].singles) assert.ok(solvesWithSingles(puzzle), `${level} needs only singles`);
    }
  }
});

test('hard puzzles mostly need more than singles', () => {
  let harder = 0;
  for (let seed = 1; seed <= 10; seed++) if (!solvesWithSingles(generate('hard', seeded(seed)).puzzle)) harder++;
  assert.ok(harder >= 8, `${harder} of 10`);
});

test('placing a digit clears it from the notes around it', () => {
  const g = withBlanks([0, 1, 9]);
  toggleNote(g, 1, SOLUTION[0]);
  toggleNote(g, 1, SOLUTION[1]);
  toggleNote(g, 9, SOLUTION[0]);
  place(g, 0, SOLUTION[0]);
  assert.equal(g.notes[1], 1 << SOLUTION[1]);
  assert.equal(g.notes[9], 0);
});

test('givens cannot change, and notes only go in empty cells', () => {
  const g = withBlanks([0]);
  assert.equal(place(g, 1, 5), null);
  assert.equal(erase(g, 1), null);
  assert.equal(toggleNote(g, 1, 5), null);
  place(g, 0, 9);
  assert.equal(toggleNote(g, 0, 3), null);
});

test('repeats are found in rows, columns and boxes', () => {
  const g = withBlanks([0, 1]);
  place(g, 0, SOLUTION[1]); // repeats the digit that belongs in cell 1, elsewhere in the row
  const bad = conflicts(g);
  assert.ok(bad.has(0));
  assert.ok(bad.size >= 2);
  erase(g, 0);
  assert.equal(conflicts(g).size, 0);
});

test('filling the last cell correctly wins, a wrong digit does not', () => {
  const g = withBlanks([40]);
  const wrong = SOLUTION[40] % 9 + 1;
  place(g, 40, wrong);
  assert.equal(g.state, 'playing');
  place(g, 40, SOLUTION[40]);
  assert.equal(g.state, 'won');
  assert.equal(place(g, 40, wrong), null, 'nothing changes after a win');
});

test('undo restores the cell and the notes it cleared', () => {
  const g = withBlanks([0, 1]);
  toggleNote(g, 1, SOLUTION[0]);
  const step = place(g, 0, SOLUTION[0]);
  assert.deepEqual(undo(g, step).sort(), [0, 1]);
  assert.equal(g.values[0], 0);
  assert.equal(g.notes[1], 1 << SOLUTION[0]);
});

test('a hint fills the chosen cell, or the easiest one, and locks it', () => {
  const g = withBlanks([0, 1, 2, 40]);
  assert.equal(hint(g, 40), 40);
  assert.equal(g.values[40], SOLUTION[40]);
  assert.equal(g.fixed[40], 1);
  assert.equal(g.hints, 1);
  const step = place(g, 0, SOLUTION[1]);
  const j = hint(g, 30); // a given, so the hint picks another cell
  assert.ok([0, 1, 2].includes(j));
  if (j === 0) assert.deepEqual(undo(g, step), [], 'undo leaves a hinted cell alone');
});

test('digit counts and completed units', () => {
  const g = withBlanks([0]);
  assert.equal(digitCounts(g)[SOLUTION[0]], 8);
  place(g, 0, SOLUTION[0]);
  assert.equal(completeUnits(g, 0).length, 3);
});

test('a game survives saving and loading', () => {
  const g = newGame('medium', generate('medium', seeded(5)));
  const empty = g.values.indexOf(0);
  toggleNote(g, empty, 3);
  hint(g);
  g.elapsed = 4321;
  const back = deserialize(JSON.parse(JSON.stringify(serialize(g))));
  assert.deepEqual(serialize(back), serialize(g));
});

test('invalid saved games are rejected', () => {
  const good = serialize(withBlanks([0, 1, 2]));
  assert.ok(deserialize(good));
  assert.equal(deserialize(null), null);
  assert.equal(deserialize({ ...good, level: 'expert' }), null);
  assert.equal(deserialize({ ...good, state: 'lost' }), null);
  assert.equal(deserialize({ ...good, values: '12' }), null);
  assert.equal(deserialize({ ...good, notes: [1] }), null);
  assert.equal(deserialize({ ...good, solution: '1'.repeat(81) }), null, 'solution must solve the puzzle');
  assert.equal(deserialize({ ...good, puzzle: '0'.repeat(81), values: '0'.repeat(81), fixed: '0'.repeat(81) }), null, 'puzzle must have one solution');
  assert.equal(deserialize({ ...good, state: 'won' }), null, 'a won game must be full');
});
