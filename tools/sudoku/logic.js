// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Puzzle generator, solver and game rules for sudoku. No DOM access, so it
// runs under Node for tests and in a Web Worker. Cells are indexed row by
// row: i = row * 9 + col. Digits are 1-9, 0 is empty. Notes are bit masks,
// bit d set for digit d.

export const SIZE = 81;
const ALL = 0b1111111110;

// Fewest givens a puzzle may be thinned to. Easy and medium puzzles must
// also be solvable with singles alone; hard ones should need more.
export const LEVELS = {
  easy: { min: 38, singles: true },
  medium: { min: 30, singles: true },
  hard: { min: 22, singles: false },
};

export const rowOf = (i) => Math.floor(i / 9);
export const colOf = (i) => i % 9;
export const boxOf = (i) => Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3);

// The 27 rows, columns and boxes, and each cell's 20 peers.
export const UNITS = [];
for (let k = 0; k < 9; k++) {
  UNITS.push(Array.from({ length: 9 }, (_, j) => k * 9 + j));
  UNITS.push(Array.from({ length: 9 }, (_, j) => j * 9 + k));
  UNITS.push(Array.from({ length: 9 }, (_, j) => (Math.floor(k / 3) * 3 + Math.floor(j / 3)) * 9 + (k % 3) * 3 + (j % 3)));
}
export const UNITS_OF = Array.from({ length: SIZE }, (_, i) => UNITS.filter((u) => u.includes(i)));
export const PEERS = Array.from({ length: SIZE }, (_, i) => [...new Set(UNITS_OF[i].flat())].filter((j) => j !== i));

const bitCount = (m) => { let n = 0; for (; m; m &= m - 1) n++; return n; };
const digitsOf = (m) => { const out = []; for (let d = 1; d <= 9; d++) if (m & (1 << d)) out.push(d); return out; };

function shuffle(a, rand) {
  for (let k = a.length - 1; k > 0; k--) {
    const j = Math.floor(rand() * (k + 1));
    [a[k], a[j]] = [a[j], a[k]];
  }
  return a;
}

// Candidates for an empty cell, from the digits its peers hold.
export function candidates(grid, i) {
  let used = 0;
  for (const j of PEERS[i]) used |= 1 << grid[j];
  return ALL & ~used;
}

// Counts solutions up to `limit`. Fills `out` with the first one found.
// With `rand`, tries digits in random order (used to make full grids).
export function solve(grid, { limit = 2, rand = null, out = null } = {}) {
  const g = Array.from(grid);
  const rows = new Array(9).fill(0);
  const cols = new Array(9).fill(0);
  const boxes = new Array(9).fill(0);
  for (let i = 0; i < SIZE; i++) {
    const d = g[i];
    if (!d) continue;
    const bit = 1 << d;
    if ((rows[rowOf(i)] | cols[colOf(i)] | boxes[boxOf(i)]) & bit) return 0;
    rows[rowOf(i)] |= bit; cols[colOf(i)] |= bit; boxes[boxOf(i)] |= bit;
  }
  let found = 0;
  const search = () => {
    let best = -1;
    let bestMask = 0;
    let bestN = 10;
    for (let i = 0; i < SIZE; i++) {
      if (g[i]) continue;
      const m = ALL & ~(rows[rowOf(i)] | cols[colOf(i)] | boxes[boxOf(i)]);
      const n = bitCount(m);
      if (!n) return;
      if (n < bestN) { best = i; bestMask = m; bestN = n; if (n === 1) break; }
    }
    if (best < 0) {
      if (!found && out) out.splice(0, SIZE, ...g);
      found++;
      return;
    }
    const r = rowOf(best); const c = colOf(best); const b = boxOf(best);
    const ds = digitsOf(bestMask);
    if (rand) shuffle(ds, rand);
    for (const d of ds) {
      const bit = 1 << d;
      g[best] = d; rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit;
      search();
      g[best] = 0; rows[r] &= ~bit; cols[c] &= ~bit; boxes[b] &= ~bit;
      if (found >= limit) return;
    }
  };
  search();
  return found;
}

// True when naked and hidden singles alone fill the grid.
export function solvesWithSingles(grid) {
  const g = Array.from(grid);
  for (let progress = true; progress;) {
    progress = false;
    for (let i = 0; i < SIZE; i++) {
      if (g[i]) continue;
      const m = candidates(g, i);
      if (!m) return false;
      if (bitCount(m) === 1) { g[i] = digitsOf(m)[0]; progress = true; }
    }
    for (const unit of UNITS) {
      for (let d = 1; d <= 9; d++) {
        if (unit.some((i) => g[i] === d)) continue;
        const spots = unit.filter((i) => !g[i] && candidates(g, i) & (1 << d));
        if (spots.length === 1) { g[spots[0]] = d; progress = true; }
      }
    }
  }
  return g.every(Boolean);
}

// One attempt: a random full grid, thinned in symmetric pairs while the
// puzzle keeps exactly one solution (and stays within the level's rules).
function attempt(level, rand) {
  const { min, singles } = LEVELS[level];
  const solution = new Array(SIZE).fill(0);
  solve(solution, { limit: 1, rand, out: solution });
  const puzzle = solution.slice();
  let givens = SIZE;
  const order = shuffle(Array.from({ length: 41 }, (_, k) => k), rand);
  for (const i of order) {
    const pair = i === 40 ? [40] : [i, 80 - i];
    if (givens - pair.length < min) continue;
    for (const j of pair) puzzle[j] = 0;
    if (solve(puzzle) === 1 && (!singles || solvesWithSingles(puzzle))) givens -= pair.length;
    else for (const j of pair) puzzle[j] = solution[j];
  }
  return { puzzle, solution };
}

// Returns { puzzle, solution } as arrays of 81 digits.
export function generate(level, rand = Math.random) {
  let p = attempt(level, rand);
  // A hard puzzle should need more than singles; a few tries nearly always find one.
  for (let k = 0; k < 8 && level === 'hard' && solvesWithSingles(p.puzzle); k++) p = attempt(level, rand);
  return p;
}

// Game ---------------------------------------------------------------
// state: 'playing' | 'won'. `fixed` marks givens plus cells filled by a hint.

export function newGame(level, { puzzle, solution }) {
  return {
    level,
    puzzle: Uint8Array.from(puzzle),
    solution: Uint8Array.from(solution),
    values: Uint8Array.from(puzzle),
    notes: new Uint16Array(SIZE),
    fixed: Uint8Array.from(puzzle, (d) => (d ? 1 : 0)),
    state: 'playing',
    elapsed: 0,
    hints: 0,
  };
}

// Cells whose digit also appears in one of their peers.
export function conflicts(g) {
  const out = new Set();
  for (let i = 0; i < SIZE; i++) {
    if (g.values[i] && PEERS[i].some((j) => g.values[j] === g.values[i])) out.add(i);
  }
  return out;
}

// How many of each digit are on the board. Index 0 is unused.
export function digitCounts(g) {
  const n = new Array(10).fill(0);
  for (const d of g.values) n[d]++;
  return n;
}

// A unit is complete when it holds nine different digits.
export function completeUnits(g, i) {
  return UNITS_OF[i].filter((u) => new Set(u.map((j) => g.values[j]).filter(Boolean)).size === 9);
}

const editable = (g, i) => g.state === 'playing' && !g.fixed[i];

// Each change returns an undo step: a list of [cell, value, notes] as they
// were before, or null when nothing changed.
function snapshot(g, cells) {
  return cells.map((j) => [j, g.values[j], g.notes[j]]);
}

// Places a digit, clears the cell's notes and that digit from its peers' notes.
export function place(g, i, d) {
  if (!editable(g, i) || g.values[i] === d) return null;
  const touched = PEERS[i].filter((j) => g.notes[j] & (1 << d));
  const step = snapshot(g, [i, ...touched]);
  g.values[i] = d;
  g.notes[i] = 0;
  for (const j of touched) g.notes[j] &= ~(1 << d);
  checkWin(g);
  return step;
}

export function toggleNote(g, i, d) {
  if (!editable(g, i) || g.values[i]) return null;
  const step = snapshot(g, [i]);
  g.notes[i] ^= 1 << d;
  return step;
}

export function erase(g, i) {
  if (!editable(g, i) || (!g.values[i] && !g.notes[i])) return null;
  const step = snapshot(g, [i]);
  g.values[i] = 0;
  g.notes[i] = 0;
  return step;
}

// Cells a hint has locked since the step was taken stay as they are.
export function undo(g, step) {
  if (g.state !== 'playing' || !step) return [];
  const back = step.filter(([j]) => !g.fixed[j]);
  for (const [j, v, n] of back) { g.values[j] = v; g.notes[j] = n; }
  return back.map(([j]) => j);
}

// Fills one cell with its answer and locks it: the chosen cell when it's
// empty or wrong, otherwise the empty or wrong cell with the fewest
// candidates. Returns the cell, or -1 when there's nothing to fill.
export function hint(g, i = -1) {
  if (g.state !== 'playing') return -1;
  const wrong = (j) => !g.fixed[j] && g.values[j] !== g.solution[j];
  let target = i >= 0 && wrong(i) ? i : -1;
  if (target < 0) {
    let best = 10;
    for (let j = 0; j < SIZE; j++) {
      if (!wrong(j)) continue;
      const n = g.values[j] ? 10 : bitCount(candidates(g.values, j));
      if (target < 0 || n < best) { target = j; best = n; }
    }
  }
  if (target < 0) return -1;
  place(g, target, g.solution[target]);
  g.fixed[target] = 1;
  g.hints++;
  return target;
}

// Solved when every cell is filled and no digit repeats in a row, column or box.
function checkWin(g) {
  if (g.values.every(Boolean) && conflicts(g).size === 0) g.state = 'won';
}

// Saved form: plain JSON, cell arrays as strings of digits, notes as numbers.
const digits = (a) => Array.from(a).join('');
const undigits = (s, re) => (typeof s === 'string' && s.length === SIZE && re.test(s) ? Uint8Array.from(s, Number) : null);

export function serialize(g) {
  return {
    level: g.level, state: g.state,
    puzzle: digits(g.puzzle), solution: digits(g.solution), values: digits(g.values), fixed: digits(g.fixed),
    notes: Array.from(g.notes), elapsed: Math.round(g.elapsed), hints: g.hints,
  };
}

// Returns a game, or null when the saved data isn't a valid game.
export function deserialize(d) {
  if (!d || !LEVELS[d.level] || !['playing', 'won'].includes(d.state)) return null;
  const puzzle = undigits(d.puzzle, /^[0-9]+$/);
  const solution = undigits(d.solution, /^[1-9]+$/);
  const values = undigits(d.values, /^[0-9]+$/);
  const fixed = undigits(d.fixed, /^[01]+$/);
  if (!puzzle || !solution || !values || !fixed) return null;
  if (!Array.isArray(d.notes) || d.notes.length !== SIZE || !d.notes.every((n) => Number.isInteger(n) && (n & ~ALL) === 0)) return null;
  const out = [];
  if (solve(puzzle, { out }) !== 1 || out.some((v, i) => v !== solution[i])) return null;
  for (let i = 0; i < SIZE; i++) {
    if (puzzle[i] && (values[i] !== puzzle[i] || !fixed[i])) return null;
    if (fixed[i] && values[i] !== solution[i]) return null;
  }
  const g = newGame(d.level, { puzzle, solution });
  g.values = values;
  g.fixed = fixed;
  g.notes = Uint16Array.from(d.notes);
  g.state = d.state;
  g.elapsed = Number.isFinite(d.elapsed) && d.elapsed >= 0 ? d.elapsed : 0;
  g.hints = Number.isInteger(d.hints) && d.hints >= 0 ? d.hints : 0;
  if (g.state === 'won' && (!values.every(Boolean) || conflicts(g).size)) return null;
  return g;
}
