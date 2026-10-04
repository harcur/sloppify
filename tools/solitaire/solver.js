// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Finds a way to win a deal, so the game only deals games that can be won.
// A depth-first search over positions, with a few rules that cut it down:
// cards that can't be needed any more go straight to the foundations, runs
// only move to turn up a card, empty a column or free a card for a
// foundation, and positions already seen are skipped. It's not complete (it
// gives up after a set number of positions), so a deal it can't solve isn't
// proven impossible; it's just not dealt.
// No DOM access: runs in the Worker (worker.js) and under Node for tests.

import { suit, rank, isRed, newGame, FOUNDATIONS, TABLEAU } from './logic.js';

// From a game (see logic.js) to the solver's own compact position.
function fromGame(g) {
  const f = [0, 0, 0, 0];
  for (const p of FOUNDATIONS) if (g[p].length) f[suit(g[p][0])] = g[p].length;
  return { draw: g.draw, stock: g.stock.slice(), waste: g.waste.slice(), f, t: TABLEAU.map((p) => g[p].slice()), down: g.down.slice() };
}

const clone = (s) => ({ draw: s.draw, stock: s.stock.slice(), waste: s.waste.slice(), f: s.f.slice(), t: s.t.map((p) => p.slice()), down: s.down.slice() });

// Piles are interchangeable, so they're sorted to make one key per position.
function key(s) {
  const piles = s.t.map((p, i) => s.down[i] + String.fromCharCode(...p.map((c) => 65 + c))).sort();
  return `${String.fromCharCode(...s.stock.map((c) => 65 + c))}|${String.fromCharCode(...s.waste.map((c) => 65 + c))}|${s.f.join(',')}|${piles.join('|')}`;
}

const fits = (s, c) => s.f[suit(c)] === rank(c) - 1;
// Safe to send home: nothing still in play could need this card to build on.
function safe(s, c) {
  const r = rank(c);
  if (r <= 2) return true;
  const other = isRed(c) ? [0, 3] : [1, 2];
  return other.every((o) => s.f[o] >= r - 1);
}

function flip(s, i) {
  if (s.down[i] > 0 && s.down[i] >= s.t[i].length) s.down[i] = s.t[i].length - 1;
}

// Moves every safe card to its foundation. Returns the moves made.
function settle(s) {
  const made = [];
  let again = true;
  while (again) {
    again = false;
    for (let i = 0; i < 7; i++) {
      const c = s.t[i].at(-1);
      if (c !== undefined && fits(s, c) && safe(s, c)) {
        s.t[i].pop();
        s.f[suit(c)]++;
        flip(s, i);
        made.push({ kind: 'home', from: i });
        again = true;
      }
    }
    const w = s.waste.at(-1);
    if (w !== undefined && fits(s, w) && safe(s, w)) {
      s.waste.pop();
      s.f[suit(w)]++;
      made.push({ kind: 'home', from: 'waste' });
      again = true;
    }
  }
  return made;
}

const canStack = (s, c, j) => {
  const top = s.t[j].at(-1);
  return top === undefined ? rank(c) === 13 : isRed(top) !== isRed(c) && rank(c) === rank(top) - 1;
};

// The moves worth trying from a position, most promising first.
function moves(s) {
  const reveal = [];
  const rest = [];
  const firstEmpty = s.t.findIndex((p) => !p.length);
  for (let i = 0; i < 7; i++) {
    const pile = s.t[i];
    for (let k = s.down[i]; k < pile.length; k++) {
      const c = pile[k];
      const whole = k === s.down[i];
      // Part of a run only moves to free the card under it for a foundation.
      if (!whole && !fits(s, pile[k - 1])) continue;
      for (let j = 0; j < 7; j++) {
        if (j === i || !canStack(s, c, j)) continue;
        if (!s.t[j].length && (j !== firstEmpty || k === 0)) continue;
        (whole && k > 0 ? reveal : rest).push({ kind: 'run', from: i, index: k, to: j });
      }
    }
    const top = pile.at(-1);
    if (top !== undefined && fits(s, top)) rest.push({ kind: 'home', from: i });
  }
  const w = s.waste.at(-1);
  const fromWaste = [];
  if (w !== undefined) {
    if (fits(s, w)) fromWaste.push({ kind: 'home', from: 'waste' });
    for (let j = 0; j < 7; j++) {
      if (canStack(s, w, j) && (s.t[j].length || j === firstEmpty)) fromWaste.push({ kind: 'waste', to: j });
    }
  }
  const out = [...reveal, ...fromWaste, ...rest];
  if (s.stock.length || s.waste.length) out.push({ kind: 'draw' });
  return out;
}

function apply(s, m) {
  if (m.kind === 'draw') {
    if (!s.stock.length) {
      s.stock = s.waste.reverse();
      s.waste = [];
    } else {
      for (let k = 0; k < s.draw && s.stock.length; k++) s.waste.push(s.stock.pop());
    }
  } else if (m.kind === 'home') {
    const c = m.from === 'waste' ? s.waste.pop() : s.t[m.from].pop();
    s.f[suit(c)]++;
    if (m.from !== 'waste') flip(s, m.from);
  } else if (m.kind === 'waste') {
    s.t[m.to].push(s.waste.pop());
  } else {
    s.t[m.to].push(...s.t[m.from].splice(m.index));
    flip(s, m.from);
  }
}

const won = (s) => s.f[0] + s.f[1] + s.f[2] + s.f[3] === 52;

// Searches for a win from the game's current position, looking at no more
// than `limit` positions. Returns { solved, moves, nodes }; moves is the list
// of moves that wins when solved.
export function solve(g, { limit = 100000 } = {}) {
  const start = fromGame(g);
  const path = settle(start);
  const seen = new Set();
  let nodes = 0;
  const dfs = (s) => {
    if (won(s)) return true;
    const k = key(s);
    if (seen.has(k)) return false;
    seen.add(k);
    if (++nodes > limit) return false;
    for (const m of moves(s)) {
      const next = clone(s);
      apply(next, m);
      const auto = settle(next);
      path.push(m, ...auto);
      if (dfs(next)) return true;
      path.length -= 1 + auto.length;
      if (nodes > limit) return false;
    }
    return false;
  };
  const solved = dfs(start);
  return { solved, moves: solved ? path : [], nodes };
}

// Deals until the solver finds a win, trying at most `tries` deals (each solved about half the time). If none
// is found (very unlikely), the last deal is used anyway.
export function winnableDeal(draw, { rand = Math.random, tries = 60, limit = 8000 } = {}) {
  let g;
  for (let k = 0; k < tries; k++) {
    g = newGame(draw, rand);
    if (solve(g, { limit }).solved) return { game: g, proven: true };
  }
  return { game: g, proven: false };
}
