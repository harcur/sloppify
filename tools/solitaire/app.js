// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { initPage, guardStore } from '../../shared/page.js';
import { extendStrings, t } from '../../shared/i18n.js';
import { h } from '../../shared/dom.js';
import { optionsSheet } from '../../shared/sheet.js';
import { openStore } from '../../shared/storage.js';
import { confirmDialog } from '../../shared/dialog.js';
import { strings } from './strings.js';
import * as klondike from './logic.js';
import * as freecell from './freecell.js';

extendStrings(strings);

const TOOL_ID = 'solitaire';
const name = t(`${TOOL_ID}.name`);
const SOURCE_PATH = 'tools/solitaire/';
const narrow = matchMedia('(max-width: 719px)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const { main } = initPage({ toolId: TOOL_ID, toolName: name, license: 'MIT', sourcePath: SOURCE_PATH, app: true });

// Saved: how many cards to turn over, the game in progress (with its undo
// history), and games won and best results for each draw setting.
const store = openStore(TOOL_ID, { version: 1 });
const saving = await guardStore(store, name);

// Two games on one table: the classic one (logic.js), turning over one or
// three cards, and free cell (freecell.js). Both have the same interface;
// `R` is the rules of the game being played. A variant is 1 or 3 (cards
// turned over in the classic game) or 'freecell'.
const { SUITS, FOUNDATIONS, suit, rank, tableauIndex } = klondike;
const GAMES = {
  klondike: {
    rules: klondike,
    piles: ['stock', 'waste', ...FOUNDATIONS, ...klondike.TABLEAU],
    top: ['stock', 'waste', null, ...FOUNDATIONS],
    targets: [...FOUNDATIONS, ...klondike.TABLEAU],
  },
  freecell: { rules: freecell, piles: freecell.PILES, top: [...freecell.CELLS, ...FOUNDATIONS], targets: freecell.TARGETS },
};
const ALL_PILES = ['stock', 'waste', ...freecell.CELLS, ...FOUNDATIONS, ...freecell.TABLEAU];
const isFree = (game) => game.mode === 'freecell';
const variantOf = (game) => (isFree(game) ? 'freecell' : game.draw);
const VARIANTS = [1, 3, 'freecell'];
let G; // GAMES entry for the game being played
let R; // its rules
let TABLEAU;
function use(game) {
  G = GAMES[isFree(game) ? 'freecell' : 'klondike'];
  R = G.rules;
  TABLEAU = R.TABLEAU;
}
const deserialize = (data) => (data?.mode === 'freecell' ? freecell : klondike).deserialize(data);

// Solver -------------------------------------------------------------
// Every deal is one the solver (solver.js) has won, so no game is hopeless,
// and Hint asks it for the next move of a winning line. It runs in a Worker,
// with the next deal found ahead so New game is instant. If the browser can't
// start a Worker, it runs here instead.

let worker = null;
let nextId = 0;
const waiting = new Map();
const here = (job) => (job.variant === 'freecell'
  ? import('./freecell-solver.js').then((solver) => (job.type === 'hint' ? solver.hint(job.game) : solver.winnableDeal().game))
  : import('./solver.js').then((solver) => (job.type === 'hint' ? solver.hint(job.game) : solver.winnableDeal(job.variant).game)));
try {
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.addEventListener('message', (e) => {
    waiting.get(e.data.id)?.resolve(e.data.result);
    waiting.delete(e.data.id);
  });
  worker.addEventListener('error', (e) => {
    e.preventDefault();
    worker = null;
    for (const w of waiting.values()) w.resolve(here(w.job));
    waiting.clear();
  });
} catch { worker = null; }

function ask(job) {
  if (!worker) return here(job);
  return new Promise((resolve) => {
    const id = ++nextId;
    waiting.set(id, { resolve, job });
    worker.postMessage({ id, job });
  });
}
const findDeal = (variant) => ask({ type: 'deal', variant });

const ahead = new Map(); // variant → the next deal, being found or found
function takeDeal(variant) {
  const next = ahead.get(variant) ?? findDeal(variant);
  ahead.delete(variant);
  return next;
}
function dealAhead(variant) {
  if (!ahead.has(variant)) ahead.set(variant, findDeal(variant));
}

// The classic game remembers its draw setting while free cell is played.
let lastDraw = saving && store.get('draw') === 3 ? 3 : 1;
const savedVariant = saving && store.get('mode') === 'freecell' ? 'freecell' : lastDraw;
let g = (saving && deserialize(store.get('game'))) || await takeDeal(savedVariant);
use(g);
let stats = saving ? store.get('stats', {}) : {};
if (!stats || typeof stats !== 'object') stats = {};
let selection = null; // { pile, index } picked up with the keyboard
let busy = false; // finishing on its own

// Cards --------------------------------------------------------------
// Our own drawing: square cards, our own suit shapes, letters on the court
// cards, and a lattice on the back.

const SUIT_SVG = {
  spades: '<path d="M12 2.2C9.4 6 3.2 8.8 3.2 13.6a4.4 4.4 0 0 0 7.6 3L9.4 21.8h5.2l-1.4-5.2a4.4 4.4 0 0 0 7.6-3C20.8 8.8 14.6 6 12 2.2z"/>',
  hearts: '<path d="M12 21.2C7 16.8 2.6 13.4 2.6 8.4a4.8 4.8 0 0 1 9.4-1.6 4.8 4.8 0 0 1 9.4 1.6c0 5-4.4 8.4-9.4 12.8z"/>',
  diamonds: '<path d="M12 1.8 19.6 12 12 22.2 4.4 12z"/>',
  clubs: '<circle cx="12" cy="6.8" r="4.4"/><circle cx="6.6" cy="13.4" r="4.4"/><circle cx="17.4" cy="13.4" r="4.4"/><path d="M10.8 11h2.4l1.6 10.8H9.2z"/>',
};
const RECYCLE_SVG = '<path d="M5 12a7 7 0 0 1 12-4.9M19 12a7 7 0 0 1-12 4.9"/><path d="M17.5 3v4.5H13M6.5 21v-4.5H11"/>';

function svg(markup, cls) {
  const tpl = document.createElement('template');
  tpl.innerHTML = `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${markup}</svg>`;
  return tpl.content.firstElementChild;
}

const rankShort = (r) => (r === 1 || r > 10 ? t(`solitaire.rank.short.${r}`) : String(r));
const rankName = (r) => (r === 1 || r > 10 ? t(`solitaire.rank.${r}`) : String(r));
const cardName = (c) => t('solitaire.card', { rank: rankName(rank(c)), suit: t(`solitaire.suit.${SUITS[suit(c)]}`) });
// A card's button name starts with the letter it shows (A, J, Q, K), so
// speech input users can say what they see.
const cardLabel = (c) => (rank(c) === 1 || rank(c) > 10 ? t('solitaire.cardLabel', { short: rankShort(rank(c)), name: cardName(c) }) : cardName(c));

const cardEls = Array.from({ length: 52 }, (_, c) => {
  const s = SUITS[suit(c)];
  const r = rank(c);
  const mid = r > 10
    ? h('span', { class: 'sol-mid sol-court' }, h('span', { class: 'sol-court-letter', 'data-letter': rankShort(r) }), svg(SUIT_SVG[s], 'sol-suit'))
    : h('span', { class: 'sol-mid' }, svg(SUIT_SVG[s], 'sol-suit'));
  return h('button', { type: 'button', class: `sol-card sol-${s}`, 'data-c': c, 'aria-label': cardLabel(c) },
    h('span', { class: 'sol-inner', 'aria-hidden': 'true' },
      h('span', { class: 'sol-idx' }, h('span', { class: 'sol-rank' }, rankShort(r)), svg(SUIT_SVG[s], 'sol-suit')),
      mid,
    ));
});

const pileEls = {};
const slotEls = {};
const board = h('div', { class: 'sol-board', role: 'group', 'aria-label': t('solitaire.table') });
for (const p of ALL_PILES) {
  slotEls[p] = h('button', { type: 'button', class: `sol-slot sol-slot-${p[0]}`, 'data-pile': p, tabindex: '-1' });
  if (p === 'stock') slotEls[p].append(svg(RECYCLE_SVG, 'sol-recycle'));
  if (p[0] === 'f') slotEls[p].append(svg(SUIT_SVG[SUITS[+p[1]]], 'sol-slot-suit'));
  pileEls[p] = h('div', { class: 'sol-pile', role: 'group' }, slotEls[p]);
  board.append(pileEls[p]);
}

// Page ---------------------------------------------------------------

const movesValue = h('span', { class: 'sol-stat-value' });
const timeValue = h('span', { class: 'sol-stat-value' });
const undoBtn = h('button', { type: 'button', class: 'btn', onclick: () => doUndo() }, t('solitaire.undo'));
const hintBtn = h('button', { type: 'button', class: 'btn', onclick: () => doHint() }, t('solitaire.hint'));
const newBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => startNew(variantOf(g)) }, t('solitaire.new'));
const moreBtn = h('button', { type: 'button', class: 'btn sol-more', 'aria-haspopup': 'dialog', onclick: () => openSheet() }, t('solitaire.options'));
const status = h('p', { class: 'sol-status', role: 'status' });
const announcer = h('p', { class: 'sr-only', 'aria-live': 'polite' });
const scroller = h('div', { class: 'sol-scroll' }, board);
// A choice that starts a new game; the button stays as it was if the game
// in progress is kept.
const choice = (variant, label, detail, data) => h('button', {
  type: 'button', class: 'seg-btn sol-draw', ...data,
  onclick: async () => { if (await startNew(variant)) options.close(); },
}, h('span', {}, label), h('span', { class: 'sol-draw-detail' }, detail));
const modeBtns = [
  choice(null, t('solitaire.mode.klondike'), t('solitaire.mode.detail.klondike'), { 'data-mode': 'klondike' }),
  choice('freecell', t('solitaire.mode.freecell'), t('solitaire.mode.detail.freecell'), { 'data-mode': 'freecell' }),
];
const drawBtns = [1, 3].map((n) => choice(n, t(`solitaire.draw.${n}`), t(`solitaire.draw.detail.${n}`), { 'data-draw': n }));
const drawSection = h('div', { class: 'sol-section', role: 'group', 'aria-labelledby': 'sol-draw-label' },
  h('h2', { class: 'sol-h2', id: 'sol-draw-label' }, t('solitaire.draw')),
  h('div', { class: 'seg sol-seg' }, drawBtns),
);
const statsList = h('dl', { class: 'sol-record' });
const helpText = h('div', {});
const HELP = {
  klondike: ['goal', 'columns', 'stock', 'hint', 'touch', 'keys'],
  freecell: ['fc.goal', 'fc.columns', 'fc.cells', 'hint', 'touch', 'keys'],
};

const side = h('div', { class: 'sol-side' },
  h('div', { class: 'sol-section', role: 'group', 'aria-labelledby': 'sol-mode-label' },
    h('h2', { class: 'sol-h2', id: 'sol-mode-label' }, t('solitaire.mode')),
    h('div', { class: 'seg sol-seg' }, modeBtns),
  ),
  drawSection,
  h('section', { class: 'sol-section', 'aria-labelledby': 'sol-stats-label' },
    h('h2', { class: 'sol-h2', id: 'sol-stats-label' }, t('solitaire.stats')),
    statsList,
  ),
  h('section', { class: 'sol-section sol-help', 'aria-labelledby': 'sol-help-label' },
    h('h2', { class: 'sol-h2', id: 'sol-help-label' }, t('solitaire.help.title')),
    helpText,
  ),
);
const play = h('div', { class: 'sol-play' },
  h('div', { class: 'sol-top' },
    h('p', { class: 'sol-stat' }, h('span', { class: 'sol-stat-label' }, t('solitaire.moves')), movesValue),
    h('p', { class: 'sol-stat' }, h('span', { class: 'sol-stat-label' }, t('solitaire.time')), timeValue),
  ),
  status,
  scroller,
  h('div', { class: 'sol-actions' }, undoBtn, hintBtn, newBtn, moreBtn),
);
const layout = h('div', { class: 'sol-layout' }, play, side);

// On narrow screens the game fills the screen. The side panel, plus the
// footer's text and source link that the page hides there, move into a sheet.
const options = optionsSheet({ title: t('solitaire.options'), sourcePath: SOURCE_PATH, returnFocus: moreBtn });
const { sheet } = options;

function openSheet() {
  renderStats();
  options.open();
}

function placeSide() {
  if (narrow.matches) options.body.append(side);
  else {
    options.close();
    layout.append(side);
  }
}

main.append(h('h1', { class: 'tool-title' }, name), layout, sheet, announcer);

// Layout -------------------------------------------------------------
// Every card is placed by position on one board, so a move can glide from
// where the card was to where it goes. Columns squeeze their fan to fit the
// height available; past the minimum the board scrolls instead.

let m = null;
const pos = new Map(); // card or slot element → "x,y" it was last placed at

function metrics() {
  const margin = parseFloat(getComputedStyle(board).marginLeft) || 0;
  const width = scroller.clientWidth - margin * 2;
  const gap = Math.max(4, Math.min(14, Math.round(width * 0.014)));
  const n = TABLEAU.length;
  const cw = Math.max(30, Math.min(104, Math.floor((width - gap * (n - 1)) / n)));
  const ch = Math.round(cw * 1.4);
  const ty = ch + Math.max(10, Math.round(gap * 1.6));
  const top = scroller.getBoundingClientRect().top + scrollY;
  const height = narrow.matches ? scroller.clientHeight - margin * 2 : Math.max(ty + ch * 3, innerHeight - top - 24);
  return { gap, cw, ch, ty, height, left: Math.max(0, Math.floor((width - cw * n - gap * (n - 1)) / 2)) };
}

const colX = (col) => m.left + col * (m.cw + m.gap);

// Where each card in a pile goes: [x, y] by index.
function placements(p) {
  const cards = g[p];
  if (p === 'waste') {
    const fanned = g.draw === 3 ? Math.min(3, cards.length) : 1;
    return cards.map((_, k) => [colX(1) + Math.max(0, k - (cards.length - fanned)) * Math.round(m.cw * 0.26), 0]);
  }
  if (p[0] !== 't') return cards.map(() => [colX(G.top.indexOf(p)), 0]);
  const col = tableauIndex(p);
  const down = g.down[col];
  const up = cards.length - down;
  let dOff = m.ch * 0.11;
  let uOff = m.ch * 0.3;
  const need = down * dOff + Math.max(0, up - 1) * uOff;
  const space = m.height - m.ty - m.ch - 4;
  if (need > space) {
    const f = Math.max(0, space) / need;
    dOff = Math.max(m.ch * 0.05, dOff * f);
    uOff = Math.max(m.ch * 0.24, uOff * f);
  }
  let y = m.ty;
  return cards.map((_, k) => {
    const at = [colX(col), Math.round(y)];
    y += k < down ? dOff : uOff;
    return at;
  });
}

function slotPlace(p) {
  if (p[0] !== 't') return [colX(G.top.indexOf(p)), 0];
  return [colX(tableauIndex(p)), m.ty];
}

function place(el, [x, y], z, animate, delay = 0) {
  const to = `translate(${x}px, ${y}px)`;
  const from = pos.get(el);
  el.style.transform = to;
  el.style.zIndex = String(z);
  pos.set(el, to);
  if (!animate || !from || from === to || reducedMotion.matches) return;
  el.style.zIndex = String(1000 + z);
  el.animate([{ transform: from }, { transform: to }], { duration: 240, delay, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)', fill: 'backwards' })
    .finished.then(() => { el.style.zIndex = String(z); }, () => {});
}

function faceUp(p, k) {
  if (p === 'stock') return false;
  const col = tableauIndex(p);
  return col < 0 || k >= g.down[col];
}

// Draws the whole table. With animate, cards glide from where they were and
// cards turned face up flip over.
function render(animate = false) {
  m = metrics();
  const hadFocus = board.contains(document.activeElement);
  let bottom = m.ty + m.ch;
  board.style.setProperty('--cw', `${m.cw}px`);
  board.style.setProperty('--ch', `${m.ch}px`);
  board.classList.toggle('is-freecell', isFree(g));
  for (const p of ALL_PILES) {
    pileEls[p].hidden = !G.piles.includes(p);
    if (pileEls[p].hidden) continue;
    const cards = g[p];
    const places = placements(p);
    const slot = slotEls[p];
    place(slot, slotPlace(p), p === 'stock' ? 100 : 0, false);
    slot.tabIndex = -1;
    slot.dataset.empty = String(!cards.length);
    if (pileEls[p].firstChild !== slot) pileEls[p].prepend(slot);
    let moved = 0;
    cards.forEach((c, k) => {
      const el = cardEls[c];
      const up = faceUp(p, k);
      const wasUp = el.classList.contains('is-up');
      el.classList.toggle('is-up', up);
      el.dataset.pile = p;
      el.dataset.k = k;
      const reachable = up && R.canTake(g, p, k);
      el.classList.toggle('is-live', reachable);
      if (reachable) el.removeAttribute('aria-hidden'); else el.setAttribute('aria-hidden', 'true');
      el.tabIndex = -1;
      if (pileEls[p].children[k + 1] !== el) pileEls[p].insertBefore(el, pileEls[p].children[k + 1] ?? null);
      const before = pos.get(el);
      place(el, places[k], k + 1, animate, moved * 25);
      if (animate && before !== pos.get(el)) moved++;
      if (animate && up && !wasUp && !reducedMotion.matches) {
        el.firstChild.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 200, delay: 60, easing: 'ease-out', fill: 'backwards' });
      }
      bottom = Math.max(bottom, places[k][1] + m.ch);
    });
    while (pileEls[p].children.length > cards.length + 1) pileEls[p].lastChild.remove();
    pileEls[p].setAttribute('aria-label', pileLabel(p));
    slotLabel(p);
  }
  board.style.width = `${colX(TABLEAU.length - 1) + m.cw}px`;
  board.style.height = `${bottom + 4}px`;
  markSelection();
  setActive(active.pile, active.index, hadFocus);
}

function pileLabel(p) {
  const n = g[p].length;
  const cards = t(`solitaire.cards.${n < 2 ? n : 'n'}`, { n });
  if (p === 'stock') return t('solitaire.pile.stock', { cards });
  if (p === 'waste') return t('solitaire.pile.waste', { cards });
  if (p[0] === 'f') return t('solitaire.pile.foundation', { k: +p[1] + 1, cards });
  if (p[0] === 'c') return t('solitaire.pile.cell', { k: +p[1] + 1, cards });
  if (isFree(g)) return t('solitaire.pile.columnUp', { k: tableauIndex(p) + 1, cards });
  const down = g.down[tableauIndex(p)];
  return t('solitaire.pile.column', { k: tableauIndex(p) + 1, down, up: n - down });
}

function slotLabel(p) {
  const slot = slotEls[p];
  let label;
  if (p === 'stock') {
    label = g.stock.length ? t('solitaire.slot.draw', { n: g.stock.length }) : g.waste.length ? t('solitaire.slot.recycle') : t('solitaire.slot.none');
    slot.dataset.state = g.stock.length ? 'full' : g.waste.length ? 'recycle' : 'none';
  } else label = t('solitaire.slot.empty');
  slot.setAttribute('aria-label', label);
  // A slot under cards is covered, so only the stock's (which sits on top)
  // and empty ones are announced.
  if (p === 'stock' || !g[p].length) slot.removeAttribute('aria-hidden');
  else slot.setAttribute('aria-hidden', 'true');
}

// Focus --------------------------------------------------------------
// One card or slot on the table is in the tab order at a time; arrow keys
// move it. Index: a card's place in its pile, -1 for the pile's slot.

let active = { pile: 't0', index: Infinity };

function stop(p, index) {
  const n = g[p].length;
  if (p === 'stock' || !n) return { pile: p, index: -1 };
  const col = tableauIndex(p);
  if (col < 0) return { pile: p, index: n - 1 };
  const first = g.down[col];
  return { pile: p, index: Math.max(first, Math.min(n - 1, index)) };
}
const stopEl = ({ pile, index }) => (index < 0 ? slotEls[pile] : cardEls[g[pile][index]]);

function setActive(pile, index, focus) {
  const prev = stopEl(stop(active.pile, active.index));
  active = stop(pile, index);
  const el = stopEl(active);
  if (prev && prev !== el) prev.tabIndex = -1;
  el.tabIndex = 0;
  if (focus) el.focus({ preventScroll: false });
}

function moveFocus(key) {
  const { pile, index } = active;
  const col = tableauIndex(pile);
  if (col >= 0) {
    const first = g.down[col];
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const next = Math.max(0, Math.min(TABLEAU.length - 1, col + (key === 'ArrowLeft' ? -1 : 1)));
      return setActive(TABLEAU[next], Infinity, true);
    }
    if (key === 'ArrowDown') return setActive(pile, index + 1, true);
    if (index > first) return setActive(pile, index - 1, true);
    return setActive(G.top[col] ?? 'waste', Infinity, true);
  }
  const TOP_ROW = G.top;
  const at = TOP_ROW.indexOf(pile);
  if (key === 'ArrowDown') return setActive(TABLEAU[at], -Infinity, true);
  if (key === 'ArrowUp') return;
  const step = key === 'ArrowLeft' ? -1 : 1;
  let next = at + step;
  if (TOP_ROW[next] === null) next += step;
  if (next >= 0 && next < TOP_ROW.length) setActive(TOP_ROW[next], Infinity, true);
}

function markSelection() {
  for (const el of board.querySelectorAll('.is-selected, .is-target, .is-hint')) el.classList.remove('is-selected', 'is-target', 'is-hint');
  if (shown?.kind === 'draw') slotEls.stock.classList.add('is-hint');
  else if (shown) {
    for (const c of g[shown.from].slice(shown.index)) cardEls[c].classList.add('is-hint');
    (g[shown.to].length ? cardEls[g[shown.to].at(-1)] : slotEls[shown.to]).classList.add('is-hint');
  }
  if (!selection) return;
  const { pile, index } = selection;
  for (const c of g[pile].slice(index)) cardEls[c].classList.add('is-selected');
  markTargets(pile, index);
}

function markTargets(pile, index) {
  for (const p of G.targets) {
    if (!R.canMove(g, pile, index, p)) continue;
    (g[p].length ? cardEls[g[p].at(-1)] : slotEls[p]).classList.add('is-target');
  }
}

// Actions ------------------------------------------------------------

function say(text) { announcer.textContent = text; }

function activate(pile, index, byKey) {
  if (busy || g.state === 'won') return;
  if (pile === 'stock') {
    selection = null;
    return doDraw();
  }
  if (selection) {
    const same = selection.pile === pile && (tableauIndex(pile) < 0 || index === selection.index);
    const from = selection;
    selection = null;
    if (same) autoMove(from.pile, from.index);
    else if (!doMove(from.pile, from.index, pile)) {
      say(t('solitaire.say.cantPlace', { card: cardName(g[from.pile][from.index]), pile: pileName(pile) }));
      render();
    }
    return;
  }
  if (index < 0 || !g[pile].length) return;
  if (tableauIndex(pile) < 0) index = g[pile].length - 1;
  if (!R.canTake(g, pile, index)) return;
  if (!byKey) return autoMove(pile, index);
  selection = { pile, index };
  const n = g[pile].length - index - 1;
  say(t(n ? 'solitaire.say.pickedRun' : 'solitaire.say.picked', { card: cardName(g[pile][index]), n }));
  markSelection();
}

function pileName(p) {
  if (p === 'waste') return t('solitaire.pileName.waste');
  if (p[0] === 'f') return t('solitaire.pileName.foundation', { k: +p[1] + 1 });
  if (p[0] === 'c') return t('solitaire.pileName.cell', { k: +p[1] + 1 });
  return t('solitaire.pileName.column', { k: tableauIndex(p) + 1 });
}

function autoMove(pile, index) {
  const to = R.bestTarget(g, pile, index);
  if (to && doMove(pile, index, to)) return;
  const card = g[pile][index];
  say(t('solitaire.say.noMove', { card: cardName(card) }));
  markSelection();
  if (!reducedMotion.matches) {
    cardEls[card].firstChild.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: 220 });
  }
}

function doMove(from, index, to) {
  const card = g[from][index];
  const r = R.move(g, from, index, to);
  if (!r) return false;
  const n = r.cards.length - 1;
  let text = t(n ? 'solitaire.say.movedRun' : 'solitaire.say.moved', { card: cardName(card), n, pile: pileName(to) });
  if (r.flipped != null) text += `. ${t('solitaire.say.flipped', { card: cardName(r.flipped) })}`;
  say(text);
  // Focus follows the card to its new pile.
  active = { pile: to, index: g[to].length - r.cards.length };
  changed();
  return true;
}

function doDraw() {
  const r = klondike.drawStock(g);
  if (!r) return;
  say(r === 'drawn' ? t('solitaire.say.drawn', { card: cardName(g.waste.at(-1)) }) : t('solitaire.say.recycled'));
  changed();
}

// Hint: the next move of a winning line from here, shown on the table and
// said in the status line. Cleared by the next move.
let shown = null;
let hinting = false;
async function doHint() {
  if (busy || hinting || g.state === 'won') return;
  hinting = true;
  renderBar();
  const game = g;
  const asked = g.moves;
  const slow = setTimeout(() => note(t('solitaire.say.thinking')), 300);
  const next = await ask({ type: 'hint', variant: variantOf(g), game: position() });
  clearTimeout(slow);
  hinting = false;
  renderBar();
  if (g !== game || g.moves !== asked) return; // the table changed meanwhile
  if (!next) return note(t('solitaire.say.noHint'));
  shown = next;
  markSelection();
  if (next.kind === 'draw') {
    // Name the card the line is going for; if it's already been passed, say
    // to go round again.
    if (next.card == null) return note(t(g.stock.length ? 'solitaire.say.hintDraw' : 'solitaire.say.hintRecycle'));
    return note(t(g.waste.includes(next.card) ? 'solitaire.say.hintPassed' : 'solitaire.say.hintDig', { card: cardName(next.card) }));
  }
  const n = g[next.from].length - next.index - 1;
  note(t(n ? 'solitaire.say.hintRun' : 'solitaire.say.hintMove', { card: cardName(g[next.from][next.index]), n, pile: pileName(next.to) }));
}

// The position alone, for the solver.
const position = () => ({ mode: g.mode, draw: g.draw, state: g.state, ...Object.fromEntries(G.piles.map((p) => [p, g[p].slice()])), down: g.down.slice() });

function note(text) {
  status.textContent = text;
  delete status.dataset.state;
}

function doUndo() {
  if (busy || !R.undo(g)) return;
  selection = null;
  say(t('solitaire.say.undone'));
  changed();
}

let wasReady = g.state === 'ready';
function changed() {
  shown = null;
  if (g.state !== 'won') note('');
  if (wasReady && g.state !== 'ready') {
    wasReady = false;
    const rec = record(variantOf(g));
    rec.played += 1;
    stats[variantOf(g)] = rec;
    if (saving) store.set('stats', stats);
  }
  render(true);
  syncTimer();
  renderBar();
  save();
  if (g.state === 'won') finish();
  else if (R.canFinish(g)) autoFinish();
}

// Once every card is face up the rest is mechanical, so it plays itself.
function autoFinish() {
  busy = true;
  say(t('solitaire.say.finishing'));
  const step = () => {
    const s = R.nextFinishMove(g);
    if (!s) { busy = false; return; }
    R.move(g, s.from, s.index, s.to);
    render(true);
    renderBar();
    if (g.state === 'won') {
      busy = false;
      syncTimer();
      save();
      finish();
    } else setTimeout(step, reducedMotion.matches ? 0 : 90);
  };
  setTimeout(step, reducedMotion.matches ? 0 : 200);
}

function finish() {
  syncTimer();
  const rec = record(variantOf(g));
  rec.won += 1;
  rec.played = Math.max(rec.played, rec.won);
  const ms = Math.round(g.elapsed);
  const isBest = rec.bestTime == null || ms < rec.bestTime;
  if (isBest) rec.bestTime = ms;
  if (rec.bestMoves == null || g.moves < rec.bestMoves) rec.bestMoves = g.moves;
  stats[variantOf(g)] = rec;
  if (saving) store.set('stats', stats);
  status.textContent = t(isBest ? 'solitaire.status.best' : 'solitaire.status.won', { time: formatTime(ms), moves: g.moves });
  status.dataset.state = 'won';
  board.classList.add('is-won');
  renderBar();
  renderStats();
  celebrate();
}

// Suit-shaped confetti over the table.
const CONFETTI = ['--s-red', '--s-gold', '--s-back', '--s-mint', '--s-ink'];
function celebrate() {
  if (reducedMotion.matches) return;
  const box = h('div', { class: 'sol-confetti', 'aria-hidden': 'true' });
  const height = scroller.offsetTop + scroller.offsetHeight;
  const rnd = (a, b) => a + Math.random() * (b - a);
  for (let k = 0; k < 48; k++) {
    const p = svg(SUIT_SVG[SUITS[k % 4]], 'sol-bit');
    p.style.left = `${rnd(0, 100)}%`;
    p.style.setProperty('--c', `var(${CONFETTI[k % CONFETTI.length]})`);
    p.style.setProperty('--dx', `${rnd(-90, 90)}px`);
    p.style.setProperty('--dy', `${rnd(0.6, 1) * height}px`);
    p.style.setProperty('--rot', `${rnd(-540, 540)}deg`);
    p.style.setProperty('--t', `${rnd(1300, 2100)}ms`);
    p.style.setProperty('--delay', `${rnd(0, 450)}ms`);
    box.append(p);
  }
  play.append(box);
  setTimeout(() => box.remove(), 2800);
}

// Starts a new game of a variant (null: the classic game with its last draw
// setting). Returns true when a new game started.
let dealing = false;
async function startNew(variant) {
  if (dealing) return false;
  variant ??= lastDraw;
  if (g.state === 'playing') {
    const ok = await confirmDialog({ title: t('solitaire.confirm.title'), body: t('solitaire.confirm.body'), confirmLabel: t('solitaire.confirm.ok') });
    if (!ok) return false;
  }
  dealing = true;
  busy = true; // the table waits for the new deal
  newBtn.setAttribute('aria-disabled', 'true');
  // Usually ready at once; say so only if finding one takes a moment.
  const slow = setTimeout(() => { status.textContent = t('solitaire.status.dealing'); delete status.dataset.state; }, 200);
  const next = await takeDeal(variant);
  clearTimeout(slow);
  dealing = false;
  newBtn.removeAttribute('aria-disabled');
  clearInterval(tick);
  runStart = 0;
  busy = false;
  selection = null;
  g = next;
  use(g);
  shown = null;
  wasReady = true;
  if (variant !== 'freecell') lastDraw = variant;
  if (saving) {
    store.set('mode', isFree(g) ? 'freecell' : 'klondike');
    store.set('draw', lastDraw);
  }
  status.textContent = '';
  delete status.dataset.state;
  board.classList.remove('is-won');
  for (const el of cardEls) el.classList.remove('is-up');
  active = { pile: 't0', index: Infinity };
  // Deal: every card glides out from the stock.
  m = metrics();
  for (const el of cardEls) pos.set(el, `translate(${colX(0)}px, 0px)`);
  render(true);
  renderBar();
  save();
  renderHelp();
  dealAhead(variant);
  return true;
}

function save() {
  if (!saving) return;
  const s = R.serialize(g);
  s.elapsed = Math.round(elapsed());
  store.set('game', s);
}

function record(variant) {
  const r = stats[variant];
  const num = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
  const opt = (v) => (Number.isFinite(v) && v >= 0 ? v : null);
  return { played: num(r?.played), won: num(r?.won), bestTime: opt(r?.bestTime), bestMoves: opt(r?.bestMoves) };
}

function renderStats() {
  statsList.replaceChildren(...VARIANTS.flatMap((n) => {
    const r = record(n);
    const parts = [];
    if (r.played) parts.push(t('solitaire.stats.won', r));
    if (r.bestTime != null) parts.push(t('solitaire.stats.best', { time: formatTime(r.bestTime), moves: r.bestMoves }));
    return [h('dt', {}, t(`solitaire.record.${n}`)), h('dd', {}, parts.join(', ') || t('solitaire.stats.none'))];
  }));
}

function renderHelp() {
  helpText.replaceChildren(...HELP[isFree(g) ? 'freecell' : 'klondike'].map((k) => h('p', {}, t(`solitaire.help.${k}`))));
}

function renderBar() {
  movesValue.textContent = String(g.moves);
  renderTime();
  undoBtn.setAttribute('aria-disabled', String(busy || g.state === 'won' || !g.history.length));
  hintBtn.setAttribute('aria-disabled', String(busy || hinting || g.state === 'won'));
  for (const b of modeBtns) b.setAttribute('aria-pressed', String((b.dataset.mode === 'freecell') === isFree(g)));
  for (const b of drawBtns) b.setAttribute('aria-pressed', String(!isFree(g) && +b.dataset.draw === g.draw));
  drawSection.hidden = isFree(g);
}

// Timer --------------------------------------------------------------
// Runs only while a game is in progress and the page is visible.

let runStart = 0;
let tick = 0;
const elapsed = () => g.elapsed + (runStart ? performance.now() - runStart : 0);

function syncTimer() {
  const run = g.state === 'playing' && document.visibilityState === 'visible';
  if (run && !runStart) {
    runStart = performance.now();
    tick = setInterval(renderTime, 1000);
  } else if (!run && runStart) {
    g.elapsed = elapsed();
    runStart = 0;
    clearInterval(tick);
  }
  renderTime();
}

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function renderTime() { timeValue.textContent = formatTime(elapsed()); }

// Input --------------------------------------------------------------
// A tap or click sends a card to the best place; dragging puts it where it's
// dropped. Keyboard: Enter picks up and puts down (see activate).

const target = (e) => e.target.closest?.('.sol-card, .sol-slot');
const where = (el) => (el.classList.contains('sol-slot') ? { pile: el.dataset.pile, index: -1 } : { pile: el.dataset.pile, index: +el.dataset.k });

let drag = null;
let swallowClick = false;

board.addEventListener('click', (e) => {
  const el = target(e);
  if (!el || !el.dataset.pile) return;
  if (swallowClick) { swallowClick = false; return; }
  const { pile, index } = where(el);
  if (el.tabIndex === 0 || el.classList.contains('is-live') || pile === 'stock' || index < 0) setActive(pile, index, false);
  activate(pile, index, false);
});

// Whatever gets focus (by Tab, a tap or a screen reader) becomes the active stop.
board.addEventListener('focusin', (e) => {
  const el = target(e);
  if (!el?.dataset.pile || el.tabIndex === 0) return;
  for (const other of board.querySelectorAll('[tabindex="0"]')) other.tabIndex = -1;
  el.tabIndex = 0;
  active = where(el);
});

board.addEventListener('keydown', (e) => {
  const el = target(e);
  if (!el || e.altKey || e.metaKey) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    if (!e.repeat) activate(active.pile, active.index, true);
  } else if (e.key.startsWith('Arrow')) {
    e.preventDefault();
    moveFocus(e.key);
  } else if (e.key === 'Escape' && selection) {
    e.preventDefault();
    selection = null;
    markSelection();
    say(t('solitaire.say.cancel'));
  } else if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey) {
    e.preventDefault();
    doHint();
  } else if ((e.key === 'u' || e.key === 'U') && !e.ctrlKey) {
    e.preventDefault();
    doUndo();
  }
});

// Space activates a button on key up; the table already acted on key down.
board.addEventListener('keyup', (e) => { if (e.key === ' ' && target(e)) e.preventDefault(); });

addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !e.target.closest?.('input, textarea, dialog')) {
    e.preventDefault();
    doUndo();
  }
});

board.addEventListener('pointerdown', (e) => {
  swallowClick = false;
  if (busy || g.state === 'won' || !e.isPrimary || e.button !== 0) return;
  const el = target(e);
  if (!el?.classList.contains('is-live')) return;
  const { pile, index } = where(el);
  drag = { pile, index, x: e.clientX, y: e.clientY, id: e.pointerId, started: false, els: g[pile].slice(index).map((c) => cardEls[c]) };
});

board.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (!drag.started) {
    if (Math.hypot(dx, dy) < 6) return;
    drag.started = true;
    selection = null;
    board.setPointerCapture(e.pointerId);
    board.classList.add('is-dragging');
    drag.from = drag.els.map((el) => pos.get(el).match(/-?[\d.]+/g).map(Number));
    for (const el of drag.els) el.classList.add('is-lifted');
    markSelection();
    markTargets(drag.pile, drag.index);
  }
  drag.els.forEach((el, k) => {
    const [x, y] = drag.from[k];
    el.style.transform = `translate(${x + dx}px, ${y + dy}px)`;
    el.style.zIndex = String(2000 + k);
  });
});

function endDrag(e, drop) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  drag = null;
  if (!d.started) return;
  swallowClick = true;
  setTimeout(() => { swallowClick = false; }, 0);
  board.classList.remove('is-dragging');
  for (const el of d.els) {
    el.classList.remove('is-lifted');
    pos.set(el, el.style.transform); // glide from where it was let go
  }
  const to = drop && dropPile(e.clientX, e.clientY);
  if (!to || !doMove(d.pile, d.index, to)) {
    if (to && to !== d.pile) say(t('solitaire.say.cantPlace', { card: cardName(g[d.pile][d.index]), pile: pileName(to) }));
    render(true);
  }
}
board.addEventListener('pointerup', (e) => endDrag(e, true));
board.addEventListener('pointercancel', (e) => endDrag(e, false));

// The pile under a point on the board.
function dropPile(clientX, clientY) {
  const r = board.getBoundingClientRect();
  const x = clientX - r.left - m.left;
  const y = clientY - r.top;
  const col = Math.floor((x + m.gap / 2) / (m.cw + m.gap));
  if (col < 0 || col >= TABLEAU.length) return null;
  if (y < m.ty - m.gap / 2) return G.top[col] === 'stock' || G.top[col] === 'waste' ? null : G.top[col] ?? null;
  return TABLEAU[col];
}

// Start --------------------------------------------------------------

new ResizeObserver(() => { if (!drag) render(); }).observe(scroller);
narrow.addEventListener('change', () => { placeSide(); render(); });
document.addEventListener('visibilitychange', () => { syncTimer(); if (document.visibilityState === 'hidden') save(); });
addEventListener('pagehide', save);

placeSide();
render();
if (g.state === 'won') {
  status.textContent = t('solitaire.status.won', { time: formatTime(g.elapsed), moves: g.moves });
  status.dataset.state = 'won';
  board.classList.add('is-won');
}
renderBar();
renderStats();
renderHelp();
syncTimer();
if (R.canFinish(g)) autoFinish();
dealAhead(variantOf(g));
