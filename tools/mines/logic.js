// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Game rules for mines. No DOM access, so it runs under Node for tests.
// Cells are indexed row by row: i = row * cols + col.

export const LEVELS = {
  small: { rows: 9, cols: 9, mines: 10 },
  medium: { rows: 16, cols: 16, mines: 40 },
  large: { rows: 16, cols: 30, mines: 99 },
};

// state: 'ready' (no mines placed yet) → 'playing' → 'won' | 'lost'
export function newGame(level) {
  const { rows, cols, mines } = LEVELS[level];
  const n = rows * cols;
  return {
    level, rows, cols, mines,
    state: 'ready',
    mine: new Uint8Array(n),
    open: new Uint8Array(n),
    flag: new Uint8Array(n),
    exploded: -1,
    elapsed: 0,
  };
}

export function neighbours(g, i) {
  const r = Math.floor(i / g.cols);
  const c = i % g.cols;
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr;
      const cc = c + dc;
      if (rr >= 0 && rr < g.rows && cc >= 0 && cc < g.cols) out.push(rr * g.cols + cc);
    }
  }
  return out;
}

export function count(g, i) {
  let n = 0;
  for (const j of neighbours(g, i)) n += g.mine[j];
  return n;
}

export function flagsLeft(g) {
  let f = 0;
  for (const v of g.flag) f += v;
  return g.mines - f;
}

// The first opened cell and, when there's room, its neighbours are always safe,
// so every game starts with an opening.
export function placeMines(g, safe, rand = Math.random) {
  const n = g.rows * g.cols;
  const keepClear = new Set([safe]);
  if (n - 9 >= g.mines) for (const j of neighbours(g, safe)) keepClear.add(j);
  const pool = [];
  for (let i = 0; i < n; i++) if (!keepClear.has(i)) pool.push(i);
  for (let k = 0; k < g.mines; k++) {
    const pick = k + Math.floor(rand() * (pool.length - k));
    [pool[k], pool[pick]] = [pool[pick], pool[k]];
    g.mine[pool[k]] = 1;
  }
  g.state = 'playing';
}

// Opens a cell. Returns the indices that changed.
export function reveal(g, i, rand) {
  if (g.state === 'ready') placeMines(g, i, rand);
  if (g.state !== 'playing' || g.open[i] || g.flag[i]) return [];
  if (g.mine[i]) {
    g.open[i] = 1;
    g.exploded = i;
    g.state = 'lost';
    return [i];
  }
  const changed = [];
  const stack = [i];
  while (stack.length) {
    const j = stack.pop();
    if (g.open[j] || g.flag[j] || g.mine[j]) continue;
    g.open[j] = 1;
    changed.push(j);
    if (count(g, j) === 0) for (const k of neighbours(g, j)) if (!g.open[k]) stack.push(k);
  }
  checkWin(g);
  return changed;
}

// On an opened number whose flags all are placed, opens the remaining neighbours.
export function chord(g, i) {
  if (g.state !== 'playing' || !g.open[i]) return [];
  const around = neighbours(g, i);
  const n = count(g, i);
  if (!n || around.filter((j) => g.flag[j]).length !== n) return [];
  const changed = [];
  for (const j of around) {
    if (g.open[j] || g.flag[j]) continue;
    changed.push(...reveal(g, j));
    if (g.state === 'lost') break;
  }
  return changed;
}

// Returns true when the flag changed.
export function toggleFlag(g, i) {
  if ((g.state !== 'playing' && g.state !== 'ready') || g.open[i]) return false;
  g.flag[i] = g.flag[i] ? 0 : 1;
  return true;
}

function checkWin(g) {
  const safe = g.rows * g.cols - g.mines;
  let opened = 0;
  for (const v of g.open) opened += v;
  if (opened === safe) {
    g.state = 'won';
    for (let i = 0; i < g.mine.length; i++) g.flag[i] = g.mine[i];
  }
}

// Saved form: plain JSON with cell arrays as strings of 0 and 1.
const bits = (a) => Array.from(a).join('');
const unbits = (s, n) => (typeof s === 'string' && s.length === n && /^[01]*$/.test(s)
  ? Uint8Array.from(s, (ch) => +ch) : null);

export function serialize(g) {
  return {
    level: g.level, state: g.state, mine: bits(g.mine), open: bits(g.open), flag: bits(g.flag),
    exploded: g.exploded, elapsed: Math.round(g.elapsed),
  };
}

// Returns a game, or null when the saved data isn't a valid game.
export function deserialize(d) {
  if (!d || !LEVELS[d.level] || !['ready', 'playing', 'won', 'lost'].includes(d.state)) return null;
  const g = newGame(d.level);
  const n = g.rows * g.cols;
  const mine = unbits(d.mine, n);
  const open = unbits(d.open, n);
  const flag = unbits(d.flag, n);
  if (!mine || !open || !flag) return null;
  if (d.state !== 'ready' && mine.reduce((a, b) => a + b, 0) !== g.mines) return null;
  Object.assign(g, { state: d.state, mine, open, flag });
  g.exploded = Number.isInteger(d.exploded) && d.exploded >= -1 && d.exploded < n ? d.exploded : -1;
  g.elapsed = Number.isFinite(d.elapsed) && d.elapsed >= 0 ? d.elapsed : 0;
  return g;
}
