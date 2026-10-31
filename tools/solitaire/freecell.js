// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Rules for free cell, the patience where every card is dealt face up. No DOM
// access, so it runs under Node for tests. Same interface as logic.js, so the
// page plays either game.
//
// Cards are numbered as in logic.js. Piles are named 'c0'–'c3' (free cells,
// one card each), 'f0'–'f3' (foundations) and 't0'–'t7' (columns). A game is
// marked with mode: 'freecell'; down is all zeros, as nothing is face down.

import { suit, rank, isRed, FOUNDATIONS } from './logic.js';

export { FOUNDATIONS };
export const CELLS = ['c0', 'c1', 'c2', 'c3'];
export const TABLEAU = ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'];
export const PILES = [...CELLS, ...FOUNDATIONS, ...TABLEAU];
// Where a card can be put: the piles the page marks as targets.
export const TARGETS = [...FOUNDATIONS, ...TABLEAU, ...CELLS];
const HISTORY_LIMIT = 300;

export const tableauIndex = (pile) => (pile[0] === 't' ? +pile[1] : -1);

// state: 'ready' (nothing moved yet) → 'playing' → 'won'
export function newGame(rand = Math.random) {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const g = empty();
  deck.forEach((c, k) => g[TABLEAU[k % 8]].push(c));
  return g;
}

function empty() {
  const g = { mode: 'freecell', down: [0, 0, 0, 0, 0, 0, 0, 0], state: 'ready', moves: 0, elapsed: 0, history: [] };
  for (const p of PILES) g[p] = [];
  return g;
}

// Whether two cards stack in a column: one lower, other colour.
const builds = (lower, upper) => isRed(lower) !== isRed(upper) && rank(lower) === rank(upper) - 1;

// How many cards can move at once onto `to`: one per free cell plus one,
// doubled for each empty column other than the one moved to. This is the
// same as moving them one by one through the cells and empty columns.
export function capacity(g, to) {
  const cells = CELLS.filter((p) => !g[p].length).length;
  const cols = TABLEAU.filter((p) => p !== to && !g[p].length).length;
  return (cells + 1) * 2 ** cols;
}

// Whether the card at `index` in `pile`, with everything above it, can be
// picked up: a single card from a cell, or a run in a column.
export function canTake(g, pile, index) {
  const cards = g[pile];
  if (!cards || index < 0 || index >= cards.length) return false;
  if (tableauIndex(pile) < 0) return pile[0] === 'c' && index === cards.length - 1;
  for (let k = index + 1; k < cards.length; k++) if (!builds(cards[k], cards[k - 1])) return false;
  return true;
}

// Whether a run starting with `card`, `count` cards long, can be put on `pile`.
export function canPlace(g, card, count, pile) {
  const cards = g[pile];
  if (!cards) return false;
  const top = cards.at(-1);
  if (pile[0] === 'f') {
    if (count !== 1) return false;
    return top === undefined ? rank(card) === 1 : suit(top) === suit(card) && rank(card) === rank(top) + 1;
  }
  if (pile[0] === 'c') return count === 1 && top === undefined;
  if (count > capacity(g, pile)) return false;
  return top === undefined || builds(card, top);
}

export const canMove = (g, from, index, to) =>
  from !== to && canTake(g, from, index) && canPlace(g, g[from][index], g[from].length - index, to);

// Moves the card at `index` and those above it. Returns null when not
// allowed, otherwise { cards, flipped: null } (nothing is ever face down).
export function move(g, from, index, to) {
  if (g.state === 'won' || !canMove(g, from, index, to)) return null;
  remember(g);
  const cards = g[from].splice(index);
  g[to].push(...cards);
  g.moves += 1;
  if (g.state === 'ready') g.state = 'playing';
  if (FOUNDATIONS.every((f) => g[f].length === 13)) g.state = 'won';
  return { cards, flipped: null };
}

function remember(g) {
  g.history.push(encode(g));
  if (g.history.length > HISTORY_LIMIT) g.history.shift();
}

export function undo(g) {
  if (g.state === 'won' || !g.history.length) return false;
  const moves = g.moves;
  decodeInto(g, g.history.pop());
  g.moves = moves + 1; // an undo counts as a move
  return true;
}

// Where a tap on a card sends it: a foundation, then a column with cards,
// then an empty column, then a free cell. Never a pointless move, such as a
// whole column to an empty one. Returns a pile or null.
export function bestTarget(g, from, index) {
  if (!canTake(g, from, index)) return null;
  const card = g[from][index];
  const count = g[from].length - index;
  const f = FOUNDATIONS.find((p) => canPlace(g, card, count, p));
  if (f) return f;
  const t = tableauIndex(from);
  const order = TABLEAU.map((_, k) => TABLEAU[(Math.max(t, -1) + 1 + k) % 8]).filter((p) => p !== from);
  const filled = order.find((p) => g[p].length && canPlace(g, card, count, p));
  if (filled) return filled;
  if (from[0] === 'c') return order.find((p) => !g[p].length) ?? null;
  if (index > 0) {
    const open = order.find((p) => !g[p].length && canPlace(g, card, count, p));
    if (open) return open;
  }
  return count === 1 ? CELLS.find((p) => !g[p].length) ?? null : null;
}

// Once every column is in order (each one a run), the rest is mechanical:
// the lowest card left is always on top of a column or in a cell.
export function canFinish(g) {
  return g.state !== 'won' && TABLEAU.every((p) => canTake(g, p, 0) || !g[p].length);
}

// The next card to send to a foundation when finishing: the lowest one that fits.
export function nextFinishMove(g) {
  let best = null;
  for (const p of [...CELLS, ...TABLEAU]) {
    const card = g[p].at(-1);
    if (card === undefined) continue;
    const to = FOUNDATIONS.find((f) => canPlace(g, card, 1, f));
    if (to && (!best || rank(card) < rank(g[best.from].at(-1)))) best = { from: p, index: g[p].length - 1, to };
  }
  return best;
}

// Saving -------------------------------------------------------------
// A position is a short string: each pile as letters (A = card 0), piles
// separated by '|', in the order of PILES.

const toChars = (cards) => cards.map((c) => String.fromCharCode(65 + c)).join('');
const fromChars = (s) => [...s].map((ch) => ch.charCodeAt(0) - 65);

export const encode = (g) => PILES.map((p) => toChars(g[p])).join('|');

function decodeInto(g, s) {
  s.split('|').forEach((part, i) => { g[PILES[i]] = fromChars(part); });
}

// Checks a saved position: right shape, every card exactly once, at most one
// card in each cell, foundations in order.
export function validPosition(s) {
  if (typeof s !== 'string' || !/^[A-t]*(\|[A-t]*){15}$/.test(s)) return false;
  const g = {};
  decodeInto(g, s);
  const all = PILES.flatMap((p) => g[p]);
  if (all.length !== 52 || new Set(all).size !== 52) return false;
  if (CELLS.some((p) => g[p].length > 1)) return false;
  return FOUNDATIONS.every((f) => g[f].every((c, k) => rank(c) === k + 1 && suit(c) === suit(g[f][0])));
}

export function serialize(g) {
  return {
    mode: 'freecell', position: encode(g), state: g.state,
    moves: g.moves, elapsed: Math.round(g.elapsed), history: g.history.slice(),
  };
}

export function deserialize(data) {
  if (!data || typeof data !== 'object' || data.mode !== 'freecell' || !validPosition(data.position)) return null;
  const g = empty();
  decodeInto(g, data.position);
  g.state = ['ready', 'playing', 'won'].includes(data.state) ? data.state : 'playing';
  if (g.state === 'won' && !FOUNDATIONS.every((f) => g[f].length === 13)) g.state = 'playing';
  g.moves = Number.isInteger(data.moves) && data.moves >= 0 ? data.moves : 0;
  g.elapsed = Number.isFinite(data.elapsed) && data.elapsed >= 0 ? data.elapsed : 0;
  g.history = Array.isArray(data.history) ? data.history.filter(validPosition).slice(-HISTORY_LIMIT) : [];
  return g;
}
