// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Rules for solitaire (the traditional Klondike patience). No DOM access, so
// it runs under Node for tests.
//
// A card is a number 0–51: suit = floor(card / 13) (spades, hearts, diamonds,
// clubs), rank = card % 13 + 1 (1 is the ace, 13 the king).
// Piles are named 'stock', 'waste', 'f0'–'f3' (foundations) and 't0'–'t6'
// (tableau). Each tableau pile keeps its face-down cards at the bottom:
// down[i] says how many.

export const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
export const suit = (c) => Math.floor(c / 13);
export const rank = (c) => (c % 13) + 1;
export const isRed = (c) => suit(c) === 1 || suit(c) === 2;
export const FOUNDATIONS = ['f0', 'f1', 'f2', 'f3'];
export const TABLEAU = ['t0', 't1', 't2', 't3', 't4', 't5', 't6'];
const HISTORY_LIMIT = 300;

// state: 'ready' (nothing moved yet) → 'playing' → 'won'
export function newGame(draw = 1, rand = Math.random) {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const g = {
    draw: draw === 3 ? 3 : 1,
    stock: [], waste: [],
    f0: [], f1: [], f2: [], f3: [],
    t0: [], t1: [], t2: [], t3: [], t4: [], t5: [], t6: [],
    down: [0, 1, 2, 3, 4, 5, 6],
    state: 'ready', moves: 0, elapsed: 0, history: [],
  };
  for (let row = 0; row < 7; row++) {
    for (let col = row; col < 7; col++) g[TABLEAU[col]].push(deck.pop());
  }
  g.stock = deck;
  return g;
}

export const tableauIndex = (pile) => (pile[0] === 't' ? +pile[1] : -1);

// Whether the card at `index` in `pile`, with everything above it, can be picked up.
export function canTake(g, pile, index) {
  const cards = g[pile];
  if (!cards || index < 0 || index >= cards.length) return false;
  if (pile === 'stock') return false;
  const t = tableauIndex(pile);
  if (t >= 0) return index >= g.down[t];
  return index === cards.length - 1;
}

// Whether a run starting with `card`, `count` cards long, can be put on `pile`.
export function canPlace(g, card, count, pile) {
  const cards = g[pile];
  const top = cards?.at(-1);
  if (FOUNDATIONS.includes(pile)) {
    if (count !== 1) return false;
    return top === undefined ? rank(card) === 1 : suit(top) === suit(card) && rank(card) === rank(top) + 1;
  }
  if (TABLEAU.includes(pile)) {
    return top === undefined ? rank(card) === 13 : isRed(top) !== isRed(card) && rank(card) === rank(top) - 1;
  }
  return false;
}

export const canMove = (g, from, index, to) =>
  from !== to && canTake(g, from, index) && canPlace(g, g[from][index], g[from].length - index, to);

// Moves the card at `index` and those above it. Returns null when not allowed,
// otherwise { cards, flipped } where flipped is the card turned face up.
export function move(g, from, index, to) {
  if (g.state === 'won' || !canMove(g, from, index, to)) return null;
  remember(g);
  const cards = g[from].splice(index);
  g[to].push(...cards);
  let flipped = null;
  const t = tableauIndex(from);
  if (t >= 0 && g.down[t] > 0 && g.down[t] >= g[from].length) {
    g.down[t] = g[from].length - 1;
    flipped = g[from].at(-1);
  }
  played(g);
  if (FOUNDATIONS.every((f) => g[f].length === 13)) g.state = 'won';
  return { cards, flipped };
}

// Turns over the next one or three cards from the stock, or, when the stock
// is empty, turns the waste back over to make a new stock.
// Returns 'drawn', 'recycled' or null when both are empty.
export function drawStock(g) {
  if (g.state === 'won' || (!g.stock.length && !g.waste.length)) return null;
  remember(g);
  played(g);
  if (!g.stock.length) {
    g.stock = g.waste.reverse();
    g.waste = [];
    return 'recycled';
  }
  for (let k = 0; k < g.draw && g.stock.length; k++) g.waste.push(g.stock.pop());
  return 'drawn';
}

function remember(g) {
  g.history.push(encode(g));
  if (g.history.length > HISTORY_LIMIT) g.history.shift();
}

function played(g) {
  g.moves += 1;
  if (g.state === 'ready') g.state = 'playing';
}

export function undo(g) {
  if (g.state === 'won' || !g.history.length) return false;
  const moves = g.moves;
  decodeInto(g, g.history.pop());
  g.moves = moves + 1; // an undo counts as a move
  return true;
}

// Where a tap on a card sends it: a foundation if it can go there, otherwise
// a tableau pile, preferring one with cards. Never a pointless move, such as a
// king that already starts an otherwise empty pile. Returns a pile or null.
export function bestTarget(g, from, index) {
  if (!canTake(g, from, index)) return null;
  const card = g[from][index];
  const count = g[from].length - index;
  if (!FOUNDATIONS.includes(from)) {
    const f = FOUNDATIONS.find((p) => canPlace(g, card, count, p));
    if (f) return f;
  }
  const t = tableauIndex(from);
  const order = TABLEAU.map((_, k) => TABLEAU[(Math.max(t, -1) + 1 + k) % 7]).filter((p) => p !== from);
  const filled = order.find((p) => g[p].length && canPlace(g, card, count, p));
  if (filled) return filled;
  if (t >= 0 && index === 0) return null;
  return order.find((p) => !g[p].length && canPlace(g, card, count, p)) ?? null;
}

// Once every card is face up and the stock and waste are empty, the game can
// be finished by moving cards to the foundations one at a time.
export function canFinish(g) {
  return g.state !== 'won' && !g.stock.length && !g.waste.length && g.down.every((d) => d === 0);
}

// The next card to send to a foundation when finishing: the lowest one that fits.
export function nextFinishMove(g) {
  let best = null;
  for (const p of TABLEAU) {
    const card = g[p].at(-1);
    if (card === undefined) continue;
    const to = FOUNDATIONS.find((f) => canPlace(g, card, 1, f));
    if (to && (!best || rank(card) < rank(g[best.from].at(-1)))) best = { from: p, index: g[p].length - 1, to };
  }
  return best;
}

// Saving -------------------------------------------------------------
// A position is a short string: each pile as letters (A = card 0), piles
// separated by '|', tableau piles prefixed with their face-down count.

const PILES = ['stock', 'waste', ...FOUNDATIONS];
const toChars = (cards) => cards.map((c) => String.fromCharCode(65 + c)).join('');
const fromChars = (s) => [...s].map((ch) => ch.charCodeAt(0) - 65);

export function encode(g) {
  return [...PILES.map((p) => toChars(g[p])), ...TABLEAU.map((p, i) => g.down[i] + toChars(g[p]))].join('|');
}

function decodeInto(g, s) {
  const parts = s.split('|');
  PILES.forEach((p, i) => { g[p] = fromChars(parts[i]); });
  TABLEAU.forEach((p, i) => {
    const part = parts[PILES.length + i];
    g.down[i] = +part[0];
    g[p] = fromChars(part.slice(1));
  });
}

// Checks a saved position: right shape, every card exactly once, face-down
// counts that fit, foundations in order.
export function validPosition(s) {
  if (typeof s !== 'string' || !/^[A-t]*(\|[A-t]*){5}(\|[0-9][A-t]*){7}$/.test(s)) return false;
  const g = { down: [] };
  decodeInto(g, s);
  const all = [...PILES, ...TABLEAU].flatMap((p) => g[p]);
  if (all.length !== 52 || new Set(all).size !== 52) return false;
  if (TABLEAU.some((p, i) => g.down[i] > Math.max(0, g[p].length - 1))) return false;
  return FOUNDATIONS.every((f) => g[f].every((c, k) => rank(c) === k + 1 && suit(c) === suit(g[f][0])));
}

export function serialize(g) {
  return {
    draw: g.draw, position: encode(g), state: g.state,
    moves: g.moves, elapsed: Math.round(g.elapsed), history: g.history.slice(),
  };
}

export function deserialize(data) {
  if (!data || typeof data !== 'object' || !validPosition(data.position)) return null;
  const g = newGame(data.draw === 3 ? 3 : 1);
  decodeInto(g, data.position);
  g.state = ['ready', 'playing', 'won'].includes(data.state) ? data.state : 'playing';
  if (g.state === 'won' && !FOUNDATIONS.every((f) => g[f].length === 13)) g.state = 'playing';
  g.moves = Number.isInteger(data.moves) && data.moves >= 0 ? data.moves : 0;
  g.elapsed = Number.isFinite(data.elapsed) && data.elapsed >= 0 ? data.elapsed : 0;
  g.history = Array.isArray(data.history) ? data.history.filter(validPosition).slice(-HISTORY_LIMIT) : [];
  return g;
}
