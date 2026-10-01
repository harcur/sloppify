// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { initPage, guardStore } from '../../shared/page.js';
import { extendStrings, t } from '../../shared/i18n.js';
import { h } from '../../shared/dom.js';
import { openStore } from '../../shared/storage.js';
import { confirmDialog } from '../../shared/dialog.js';
import { optionsSheet } from '../../shared/sheet.js';
import { strings } from './strings.js';
import { LEVELS, newGame, reveal, chord, toggleFlag, count, flagsLeft, serialize, deserialize } from './logic.js';

extendStrings(strings);

const TOOL_ID = 'mines';
const name = t(`${TOOL_ID}.name`);
const SOURCE_PATH = 'tools/mines/';
const narrow = matchMedia('(max-width: 719px)');
const { main } = initPage({ toolId: TOOL_ID, toolName: name, license: 'MIT', sourcePath: SOURCE_PATH, app: true });

// Saved: level, game in progress, and wins/best times per level.
const store = openStore(TOOL_ID, { version: 1 });
const saving = await guardStore(store, name);

let g = (saving && deserialize(store.get('game'))) || newGame(LEVELS[store.get('level')] ? store.get('level') : 'small');
let stats = saving ? store.get('stats', {}) : {};
if (!stats || typeof stats !== 'object') stats = {};
let flagMode = false;

// Elements -----------------------------------------------------------

const FLAG = '<path class="pole" d="M8 3.5v17M4.5 20.5h8"/><path class="cloth" d="M9 3.5l11 4.5-11 4.5z"/><path class="fold" d="M9 8l11 0-11 4.5z"/>';
const ICONS = {
  flag: FLAG,
  mine: '<path class="spikes" d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4M5.3 5.3l2.6 2.6M16.1 16.1l2.6 2.6M5.3 18.7l2.6-2.6M16.1 7.9l2.6-2.6"/><circle class="body" cx="12" cy="12" r="5.5"/><circle class="shine" cx="10" cy="10" r="1.6"/>',
  wrong: `${FLAG}<path class="x" d="M4 4l16 16M20 4L4 20"/>`,
};
const svg = (kind) => {
  const tpl = document.createElement('template');
  tpl.innerHTML = `<svg class="mines-icon mines-icon-${kind}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[kind]}</svg>`;
  return tpl.content.firstElementChild;
};

const leftValue = h('span', { class: 'mines-stat-value' });
const timeValue = h('span', { class: 'mines-stat-value' });
const flagBtn = h('button', { type: 'button', class: 'btn mines-flag-btn', 'aria-pressed': 'false', onclick: () => setFlagMode(!flagMode) },
  svg('flag'), t('mines.flagMode'));
const newBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => startNew(g.level) }, t('mines.new'));
const moreBtn = h('button', { type: 'button', class: 'btn mines-more', 'aria-haspopup': 'dialog', onclick: () => openSheet() }, t('mines.options'));
const status = h('p', { class: 'mines-status', role: 'status' });
const announcer = h('p', { class: 'sr-only', 'aria-live': 'polite' });
const scroller = h('div', { class: 'mines-scroll' });
const levelBtns = Object.keys(LEVELS).map((lv) => h('button', {
  type: 'button', class: 'seg-btn mines-level', 'data-level': lv,
  onclick: async () => { if (await startNew(lv)) options.close(); },
}, h('span', {}, t(`mines.level.${lv}`)), h('span', { class: 'mines-level-detail' }, t('mines.level.detail', LEVELS[lv]))));
const statsList = h('dl', { class: 'mines-record' });

const side = h('div', { class: 'mines-side' },
      h('div', { class: 'mines-section', role: 'group', 'aria-labelledby': 'mines-level-label' },
        h('h2', { class: 'mines-h2', id: 'mines-level-label' }, t('mines.level')),
        h('div', { class: 'seg mines-seg' }, levelBtns),
      ),
      h('section', { class: 'mines-section', 'aria-labelledby': 'mines-stats-label' },
        h('h2', { class: 'mines-h2', id: 'mines-stats-label' }, t('mines.stats')),
        statsList,
      ),
      h('section', { class: 'mines-section mines-help', 'aria-labelledby': 'mines-help-label' },
        h('h2', { class: 'mines-h2', id: 'mines-help-label' }, t('mines.help.title')),
        ['goal', 'touch', 'mouse', 'keys', 'chord'].map((k) => h('p', {}, t(`mines.help.${k}`))),
      ),
);
const layout = h('div', { class: 'mines-layout' },
  h('div', { class: 'mines-play' },
    h('div', { class: 'mines-top' },
      h('p', { class: 'mines-stat' }, h('span', { class: 'mines-stat-label' }, t('mines.left')), leftValue),
      h('p', { class: 'mines-stat' }, h('span', { class: 'mines-stat-label' }, t('mines.time')), timeValue),
    ),
    status,
    scroller,
    h('div', { class: 'mines-actions' }, flagBtn, newBtn, moreBtn),
  ),
  side,
);

// On narrow screens the game fills the screen. The side panel, plus the
// footer's text and source link that the page hides there, move into a sheet.
const options = optionsSheet({ title: t('mines.options'), sourcePath: SOURCE_PATH, returnFocus: moreBtn });
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

// Board --------------------------------------------------------------
// On narrow screens a wide board is shown turned on its side, so it scrolls
// down instead of sideways. The game itself doesn't change.

const coarse = matchMedia('(pointer: coarse)');
let board = null;
let cells = [];
let transposed = false;
let active = 0;

const dims = () => (transposed ? [g.cols, g.rows] : [g.rows, g.cols]);
const toIndex = (dr, dc) => (transposed ? dc * g.cols + dr : dr * g.cols + dc);
const toDisplay = (i) => {
  const r = Math.floor(i / g.cols);
  const c = i % g.cols;
  return transposed ? [c, r] : [r, c];
};

function buildBoard() {
  transposed = narrow.matches && g.cols > g.rows;
  const [rows, cols] = dims();
  cells = new Array(g.rows * g.cols);
  board = h('div', { class: 'mines-board', role: 'grid', 'aria-label': t('mines.board', { rows, cols }) });
  for (let dr = 0; dr < rows; dr++) {
    const row = h('div', { class: 'mines-row', role: 'row' });
    for (let dc = 0; dc < cols; dc++) {
      const i = toIndex(dr, dc);
      const alt = (Math.floor(i / g.cols) + (i % g.cols)) % 2 === 1;
      cells[i] = h('button', { type: 'button', class: alt ? 'mines-cell alt' : 'mines-cell', role: 'gridcell', tabindex: '-1', 'data-i': i });
      row.append(cells[i]);
    }
    board.append(row);
  }
  board.addEventListener('click', onClick);
  board.addEventListener('contextmenu', onContextMenu);
  board.addEventListener('keydown', onKey);
  board.addEventListener('pointerdown', onPointerDown);
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) board.addEventListener(type, cancelPress);
  board.addEventListener('pointermove', onPointerMove);
  const hadFocus = scroller.contains(document.activeElement);
  scroller.replaceChildren(board);
  if (active >= cells.length) active = 0;
  cells[active].tabIndex = 0;
  if (hadFocus) cells[active].focus();
  for (let i = 0; i < cells.length; i++) renderCell(i);
  sizeCells();
}

// Cells grow to fit the space: the width on desktop, the width and height
// on narrow screens where the board fills the screen. Below the minimum
// size the board scrolls instead.
function sizeCells() {
  const [rows, cols] = dims();
  const min = coarse.matches ? 32 : 24;
  const fitW = Math.floor((scroller.clientWidth - 10) / cols);
  const fitH = narrow.matches ? Math.floor((scroller.clientHeight - 10) / rows) : Infinity;
  const max = narrow.matches ? 64 : 40;
  board.style.setProperty('--cell', `${Math.max(min, Math.min(max, fitW, fitH))}px`);
}

function cellState(i) {
  const over = g.state === 'won' || g.state === 'lost';
  if (g.open[i] && g.mine[i]) return i === g.exploded ? 'exploded' : 'mine';
  if (g.state === 'lost' && g.flag[i] && !g.mine[i]) return 'wrong';
  if (g.flag[i]) return 'flag';
  if (over && g.mine[i]) return 'mine';
  if (g.open[i]) return 'open';
  return 'hidden';
}

function renderCell(i) {
  const b = cells[i];
  const s = cellState(i);
  if (b.dataset.s === s) return; // unchanged, so its animation doesn't replay
  const n = s === 'open' ? count(g, i) : 0;
  b.dataset.s = s;
  b.dataset.n = n;
  if (s === 'flag' || s === 'wrong') b.replaceChildren(svg(s === 'flag' ? 'flag' : 'wrong'));
  else if (s === 'mine' || s === 'exploded') b.replaceChildren(svg('mine'));
  else b.textContent = n ? String(n) : '';
  const [dr, dc] = toDisplay(i);
  b.setAttribute('aria-label', t('mines.cell.label', { row: dr + 1, col: dc + 1, state: describe(s, n) }));
}

function describe(s, n) {
  if (s === 'open') return n === 0 ? t('mines.cell.empty') : n === 1 ? t('mines.cell.one') : t('mines.cell.many', { n });
  return t({ hidden: 'mines.cell.hidden', flag: 'mines.cell.flag', mine: 'mines.cell.mine', exploded: 'mines.cell.exploded', wrong: 'mines.cell.wrongFlag' }[s]);
}

function renderAll() {
  for (let i = 0; i < cells.length; i++) renderCell(i);
  renderBar();
}

function renderBar() {
  leftValue.textContent = String(flagsLeft(g));
  renderTime();
  for (const b of levelBtns) b.setAttribute('aria-pressed', String(b.dataset.level === g.level));
  board?.classList.toggle('is-over', g.state === 'won' || g.state === 'lost');
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

// Actions ------------------------------------------------------------

function act(i, mode) {
  if (g.state === 'won' || g.state === 'lost') return;
  if (mode === 'flag' || flagMode) return flag(i);
  const changed = g.open[i] ? chord(g, i) : reveal(g, i);
  if (!changed.length) return;
  ripple(changed, i, '--d', 22, 18);
  if (g.state === 'won' || g.state === 'lost') return finish(i);
  for (const j of changed) renderCell(j);
  say(changed.length === 1 ? describe('open', count(g, changed[0])) : t('mines.say.opened', { n: changed.length }));
  syncTimer();
  renderBar();
  save();
}

function flag(i) {
  if (!toggleFlag(g, i)) return;
  renderCell(i);
  renderBar();
  say(t(g.flag[i] ? 'mines.say.flag' : 'mines.say.unflag', { left: flagsLeft(g) }));
  save();
}

function finish(from) {
  syncTimer();
  const rec = record(g.level);
  rec.played += 1;
  let message;
  if (g.state === 'won') {
    rec.won += 1;
    const ms = Math.round(g.elapsed);
    const isBest = rec.best == null || ms < rec.best;
    if (isBest) rec.best = ms;
    message = t(isBest ? 'mines.status.best' : 'mines.status.won', { time: formatTime(ms) });
  } else {
    message = t('mines.status.lost');
  }
  stats[g.level] = rec;
  if (saving) store.set('stats', stats);
  status.textContent = message;
  status.dataset.state = g.state;
  const all = cells.map((_, j) => j);
  if (g.state === 'lost') {
    ripple(all.filter((j) => g.mine[j] && j !== g.exploded), g.exploded, '--d', 40, 14);
    board.classList.add('is-lost');
  } else {
    ripple(all.filter((j) => g.mine[j]), from, '--d', 30, 14);
    ripple(all, from, '--w', 35, 30);
    board.classList.add('is-won');
    confetti();
  }
  renderAll();
  renderStats();
  save();
}

// Sets a delay on each cell from its distance to the cell played, so
// changes spread outwards from it.
function ripple(list, from, prop, step, maxSteps) {
  const fr = Math.floor(from / g.cols);
  const fc = from % g.cols;
  for (const j of list) {
    const d = Math.max(Math.abs(Math.floor(j / g.cols) - fr), Math.abs((j % g.cols) - fc));
    cells[j].style.setProperty(prop, `${Math.min(d, maxSteps) * step}ms`);
  }
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const CONFETTI = ['--m-flag', '--m-hid-a', '--m-1', '--m-2', '--m-3', '--m-4', '--m-6'];

function confetti() {
  if (reducedMotion.matches) return;
  const box = h('div', { class: 'mines-confetti', 'aria-hidden': 'true' });
  const height = scroller.offsetTop + scroller.offsetHeight;
  for (let k = 0; k < 60; k++) {
    const p = h('span');
    const rnd = (a, b) => a + Math.random() * (b - a);
    p.style.left = `${rnd(0, 100)}%`;
    p.style.setProperty('--c', `var(${CONFETTI[k % CONFETTI.length]})`);
    p.style.setProperty('--dx', `${rnd(-80, 80)}px`);
    p.style.setProperty('--dy', `${rnd(0.6, 1) * height}px`);
    p.style.setProperty('--rot', `${rnd(-720, 720)}deg`);
    p.style.setProperty('--t', `${rnd(1200, 2000)}ms`);
    p.style.setProperty('--delay', `${rnd(0, 400)}ms`);
    box.append(p);
  }
  scroller.parentElement.append(box);
  setTimeout(() => box.remove(), 2600);
}

function setFlagMode(on) {
  flagMode = on;
  flagBtn.setAttribute('aria-pressed', String(on));
  board.classList.toggle('is-flagging', on);
}

// Returns true when a new game started.
async function startNew(level) {
  if (g.state === 'playing') {
    const ok = await confirmDialog({ title: t('mines.confirm.title'), body: t('mines.confirm.body'), confirmLabel: t('mines.confirm.ok') });
    if (!ok) return false;
  }
  clearInterval(tick);
  runStart = 0;
  g = newGame(level);
  if (saving) store.set('level', level);
  status.textContent = '';
  delete status.dataset.state;
  buildBoard();
  setFlagMode(flagMode);
  renderBar();
  save();
  return true;
}

function save() {
  if (!saving) return;
  const s = serialize(g);
  s.elapsed = Math.round(elapsed());
  store.set('game', s);
}

function say(text) { announcer.textContent = text; }

function record(level) {
  const r = stats[level];
  const num = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
  return { played: num(r?.played), won: num(r?.won), best: Number.isFinite(r?.best) ? r.best : null };
}

function renderStats() {
  statsList.replaceChildren(...Object.keys(LEVELS).flatMap((lv) => {
    const r = record(lv);
    const parts = [];
    if (r.played) parts.push(t('mines.stats.won', r));
    if (r.best != null) parts.push(t('mines.stats.best', { time: formatTime(r.best) }));
    return [h('dt', {}, t(`mines.level.${lv}`)), h('dd', {}, parts.join(', ') || t('mines.stats.none'))];
  }));
}

// Input --------------------------------------------------------------
// Click opens (or flags in flag mode), right-click and long-press flag.
// Enter and Space reach onClick through the native button behaviour.

const LONG_PRESS_MS = 450;
let press = null;
let longPressAt = 0;
let swallowClick = false;

const cellFrom = (e) => e.target.closest?.('.mines-cell');

function onClick(e) {
  const b = cellFrom(e);
  if (!b) return;
  focusCell(+b.dataset.i);
  if (swallowClick) { swallowClick = false; return; }
  act(+b.dataset.i);
}

function onContextMenu(e) {
  const b = cellFrom(e);
  if (!b) return;
  e.preventDefault();
  if (Date.now() - longPressAt < 1000) return; // already flagged by the long-press timer
  focusCell(+b.dataset.i);
  act(+b.dataset.i, 'flag');
}

function onPointerDown(e) {
  swallowClick = false;
  const b = cellFrom(e);
  if (!b || e.pointerType === 'mouse') return;
  const i = +b.dataset.i;
  press = {
    x: e.clientX, y: e.clientY,
    timer: setTimeout(() => {
      press = null;
      longPressAt = Date.now();
      swallowClick = true;
      focusCell(i);
      act(i, 'flag');
    }, LONG_PRESS_MS),
  };
}

function onPointerMove(e) {
  if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) cancelPress();
}

function cancelPress() {
  if (press) clearTimeout(press.timer);
  press = null;
}

function focusCell(i) {
  cells[active].tabIndex = -1;
  active = i;
  cells[i].tabIndex = 0;
  cells[i].focus();
}

function onKey(e) {
  const b = cellFrom(e);
  if (!b || e.altKey || e.metaKey) return;
  const [rows, cols] = dims();
  let [dr, dc] = toDisplay(+b.dataset.i);
  switch (e.key) {
    case 'ArrowUp': dr = Math.max(0, dr - 1); break;
    case 'ArrowDown': dr = Math.min(rows - 1, dr + 1); break;
    case 'ArrowLeft': dc = Math.max(0, dc - 1); break;
    case 'ArrowRight': dc = Math.min(cols - 1, dc + 1); break;
    case 'Home': if (e.ctrlKey) dr = 0; dc = 0; break;
    case 'End': if (e.ctrlKey) dr = rows - 1; dc = cols - 1; break;
    case 'f': case 'F':
      if (e.ctrlKey) return;
      e.preventDefault();
      act(+b.dataset.i, 'flag');
      return;
    default: return;
  }
  e.preventDefault();
  focusCell(toIndex(dr, dc));
}

// Start --------------------------------------------------------------

new ResizeObserver(() => sizeCells()).observe(scroller);
narrow.addEventListener('change', () => {
  placeSide();
  if ((narrow.matches && g.cols > g.rows) !== transposed) buildBoard();
  else sizeCells();
});
coarse.addEventListener('change', sizeCells);
document.addEventListener('visibilitychange', () => { syncTimer(); if (document.visibilityState === 'hidden') save(); });
addEventListener('pagehide', save);

placeSide();
buildBoard();
if (g.state === 'won' || g.state === 'lost') {
  status.textContent = g.state === 'won' ? t('mines.status.won', { time: formatTime(g.elapsed) }) : t('mines.status.lost');
  status.dataset.state = g.state;
}
renderBar();
renderStats();
syncTimer();
