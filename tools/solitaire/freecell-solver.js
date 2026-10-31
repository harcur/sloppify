// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Solving free cell, for dealing and for hints. Every card is face up, so a
// deal the solver wins can be won by anyone without guessing.
// solve() is a best-first search: it always looks next at the position that
// looks closest to a win (cards home, few cards blocking the next ones
// needed, free cells and columns open), skips positions already seen, and
// sends cards nobody can need any more straight home. It gives up after a
// set number of positions. Nearly every random deal is winnable, and most
// are solved within a few thousand positions.
// No DOM access: runs in the Worker (worker.js) and under Node for tests.

import { suit, rank, isRed, FOUNDATIONS } from './logic.js';
import { newGame, canPlace, CELLS, TABLEAU } from './freecell.js';

// A position: cells (a card or -1 each), f (cards home per suit), t (columns).
const fromGame = (g) => ({ cells: CELLS.map((p) => g[p][0] ?? -1), f: foundations(g), t: TABLEAU.map((p) => g[p].slice()) });
function foundations(g) {
  const f = [0, 0, 0, 0];
  for (const p of FOUNDATIONS) if (g[p].length) f[suit(g[p][0])] = g[p].length;
  return f;
}
const clone = (s) => ({ cells: s.cells.slice(), f: s.f.slice(), t: s.t.map((p) => p.slice()) });

// Cells and columns are interchangeable, so they're sorted to make one key.
const chars = (p) => String.fromCharCode(...p.map((c) => 65 + c));
const key = (s) => `${s.cells.slice().sort((a, b) => a - b).join(',')}|${s.f.join(',')}|${s.t.map(chars).sort().join('|')}`;

const builds = (lower, upper) => isRed(lower) !== isRed(upper) && rank(lower) === rank(upper) - 1;
const fits = (s, c) => s.f[suit(c)] === rank(c) - 1;
// Safe to send home: nothing still in play could need this card to build on.
function safe(s, c) {
  const r = rank(c);
  if (r <= 2) return true;
  const other = isRed(c) ? [0, 3] : [1, 2];
  return other.every((o) => s.f[o] >= r - 1);
}
const capacity = (s, to) => {
  let cells = 0;
  for (const c of s.cells) if (c < 0) cells++;
  let cols = 0;
  s.t.forEach((p, j) => { if (j !== to && !p.length) cols++; });
  return (cells + 1) * 2 ** cols;
};
// How many cards on top of column i form a run.
function runLength(p) {
  let n = p.length ? 1 : 0;
  while (n < p.length && builds(p[p.length - n], p[p.length - n - 1])) n++;
  return n;
}

// A move: { from: 't3' | 'c1', index, to: 'f' | 't5' | 'c0' }. 'f' is the
// card's own foundation; the hint turns it into a pile.
function apply(s, m) {
  let cards;
  if (m.from[0] === 'c') {
    const i = +m.from[1];
    cards = [s.cells[i]];
    s.cells[i] = -1;
  } else cards = s.t[+m.from[1]].splice(m.index);
  if (m.to === 'f') s.f[suit(cards[0])]++;
  else if (m.to[0] === 'c') s.cells[+m.to[1]] = cards[0];
  else s.t[+m.to[1]].push(...cards);
}

// Moves every safe card home. Returns the moves made.
function settle(s) {
  const made = [];
  let again = true;
  while (again) {
    again = false;
    for (let i = 0; i < 4; i++) {
      const c = s.cells[i];
      if (c >= 0 && fits(s, c) && safe(s, c)) {
        const m = { from: `c${i}`, index: 0, to: 'f' };
        apply(s, m);
        made.push(m);
        again = true;
      }
    }
    for (let i = 0; i < 8; i++) {
      const p = s.t[i];
      const c = p.at(-1);
      if (c !== undefined && fits(s, c) && safe(s, c)) {
        const m = { from: `t${i}`, index: p.length - 1, to: 'f' };
        apply(s, m);
        made.push(m);
        again = true;
      }
    }
  }
  return made;
}

function moves(s) {
  const out = [];
  const emptyCol = s.t.findIndex((p) => !p.length);
  const freeCell = s.cells.indexOf(-1);
  for (let i = 0; i < 4; i++) {
    const c = s.cells[i];
    if (c < 0) continue;
    const from = `c${i}`;
    if (fits(s, c)) out.push({ from, index: 0, to: 'f' });
    for (let j = 0; j < 8; j++) {
      const top = s.t[j].at(-1);
      if (top === undefined ? j === emptyCol : builds(c, top)) out.push({ from, index: 0, to: `t${j}` });
    }
  }
  for (let i = 0; i < 8; i++) {
    const p = s.t[i];
    if (!p.length) continue;
    const from = `t${i}`;
    const top = p.length - 1;
    if (fits(s, p[top])) out.push({ from, index: top, to: 'f' });
    const run = runLength(p);
    for (let j = 0; j < 8; j++) {
      if (j === i) continue;
      const dest = s.t[j].at(-1);
      if (dest === undefined) continue;
      // The one card in the run that can go on this column, if any.
      const k = p.length - 1 - (rank(dest) - 1 - rank(p[top]));
      if (k >= p.length - run && k <= top && builds(p[k], dest) && p.length - k <= capacity(s, j)) out.push({ from, index: k, to: `t${j}` });
    }
    if (emptyCol >= 0) {
      const most = Math.min(run, capacity(s, emptyCol));
      if (most < p.length) out.push({ from, index: p.length - most, to: `t${emptyCol}` });
      if (most > 1) out.push({ from, index: top, to: `t${emptyCol}` });
    }
    if (freeCell >= 0) out.push({ from, index: top, to: `c${freeCell}` });
  }
  return out;
}

// Lower looks closer to a win: cards still out, cards sitting on a lower
// card (each has to move before that one can go home), how deep the next
// card needed for each suit is, and full cells; empty columns help.
function distance(s) {
  let out = 52;
  for (const n of s.f) out -= n;
  let blocking = 0;
  let depth = 0;
  for (const p of s.t) {
    let low = 99;
    for (let k = 0; k < p.length; k++) {
      const r = rank(p[k]);
      if (r > low) blocking++;
      else low = r;
      if (fits(s, p[k])) depth += p.length - 1 - k;
    }
  }
  let full = 0;
  for (const c of s.cells) if (c >= 0) full++;
  let empty = 0;
  for (const p of s.t) if (!p.length) empty++;
  return 6 * out + 3 * blocking + depth + 2 * full - 3 * empty;
}

// A small binary heap of nodes, lowest score first.
function heap() {
  const a = [];
  return {
    get size() { return a.length; },
    push(n) {
      a.push(n);
      let i = a.length - 1;
      while (i > 0) {
        const up = (i - 1) >> 1;
        if (a[up].score <= n.score) break;
        a[i] = a[up];
        i = up;
      }
      a[i] = n;
    },
    pop() {
      const top = a[0];
      const last = a.pop();
      if (a.length) {
        let i = 0;
        for (;;) {
          let c = 2 * i + 1;
          if (c >= a.length) break;
          if (c + 1 < a.length && a[c + 1].score < a[c].score) c++;
          if (a[c].score >= last.score) break;
          a[i] = a[c];
          i = c;
        }
        a[i] = last;
      }
      return top;
    },
  };
}

const won = (s) => s.f[0] + s.f[1] + s.f[2] + s.f[3] === 52;

// Searches for a win from the game's position, looking at no more than
// `limit` positions. Returns { solved, moves, nodes }; moves is the list of
// moves that wins when solved.
export function solve(g, { limit = 20000 } = {}) {
  const start = fromGame(g);
  const first = settle(start);
  const seen = new Set([key(start)]);
  const open = heap();
  open.push({ s: start, made: first, parent: null, score: 0, depth: 0 });
  let nodes = 0;
  while (open.size && nodes < limit) {
    const node = open.pop();
    if (won(node.s)) {
      const path = [];
      for (let n = node; n; n = n.parent) path.unshift(...n.made);
      return { solved: true, moves: path, nodes };
    }
    nodes++;
    for (const m of moves(node.s)) {
      const s = clone(node.s);
      apply(s, m);
      const made = [m, ...settle(s)];
      const k = key(s);
      if (seen.has(k)) continue;
      seen.add(k);
      // Mostly greedy, with a little weight on short lines.
      open.push({ s, made, parent: node, score: distance(s) + (node.depth + 1) * 0.5, depth: node.depth + 1 });
    }
  }
  return { solved: false, moves: [], nodes };
}

// Deals until the solver wins, so every deal can be won. Nearly every deal
// can; up to 20 are tried, and then the last deal is used anyway.
export function winnableDeal({ rand = Math.random, tries = 20, limit } = {}) {
  let g;
  for (let k = 0; k < tries; k++) {
    g = newGame(rand);
    if (solve(g, { limit }).solved) return { game: g, proven: true };
  }
  return { game: g, proven: false };
}

// A solver move in the game's own terms (pile names as in freecell.js).
export function toGame(g, m) {
  if (m.to !== 'f') return { kind: 'move', ...m };
  const card = g[m.from][m.index];
  return { kind: 'move', from: m.from, index: m.index, to: FOUNDATIONS.find((f) => canPlace(g, card, 1, f)) };
}

// The next move of a winning line from the game's position, as
// { kind: 'move', from, index, to }. Null when no win is found, or the game
// is already won.
export function hint(g, { limit = 40000 } = {}) {
  if (g.state === 'won') return null;
  const r = solve(g, { limit });
  if (!r.solved || !r.moves.length) return null;
  return toGame(g, r.moves[0]);
}
