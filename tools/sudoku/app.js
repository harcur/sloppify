// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { initPage, guardStore } from '../../shared/page.js';
import { extendStrings, t } from '../../shared/i18n.js';
import { h } from '../../shared/dom.js';
import { icon } from '../../shared/icons.js';
import { sourceUrl } from '../../shared/config.js';
import { openStore } from '../../shared/storage.js';
import { confirmDialog } from '../../shared/dialog.js';
import { strings } from './strings.js';
import {
  LEVELS, SIZE, UNITS, PEERS, rowOf, colOf, generate, newGame, conflicts, digitCounts, completeUnits,
  place, toggleNote, erase, undo, hint, serialize, deserialize,
} from './logic.js';

extendStrings(strings);

const TOOL_ID = 'sudoku';
const name = t(`${TOOL_ID}.name`);
const SOURCE_PATH = 'tools/sudoku/';
const narrow = matchMedia('(max-width: 719px)');
const coarse = matchMedia('(pointer: coarse)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const { main } = initPage({ toolId: TOOL_ID, toolName: name, license: 'MIT', sourcePath: SOURCE_PATH, app: true });

// Saved: difficulty, game in progress, and solved count and best time per difficulty.
const store = openStore(TOOL_ID, { version: 1 });
const saving = await guardStore(store, name);

let level = saving && LEVELS[store.get('level')] ? store.get('level') : 'easy';
let g = (saving && deserialize(store.get('game'))) || null;
let stats = saving ? store.get('stats', {}) : {};
if (!stats || typeof stats !== 'object') stats = {};
let notesMode = false;
let history = []; // undo steps, this visit only
let active = 40;
let pending = false; // a puzzle is being made

// Puzzles ------------------------------------------------------------
// Made in a Worker. If the browser can't start one, made here instead.

let worker = null;
let nextId = 0;
const waiting = new Map();
try {
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.addEventListener('message', (e) => {
    waiting.get(e.data.id)?.resolve(e.data);
    waiting.delete(e.data.id);
  });
  worker.addEventListener('error', (e) => {
    e.preventDefault();
    worker = null;
    for (const w of waiting.values()) w.resolve(generate(w.level));
    waiting.clear();
  });
} catch { worker = null; }

function makePuzzle(lv) {
  if (!worker) return Promise.resolve(generate(lv));
  return new Promise((resolve) => {
    const id = ++nextId;
    waiting.set(id, { resolve, level: lv });
    worker.postMessage({ id, level: lv });
  });
}

// Elements -----------------------------------------------------------

const levelValue = h('span', { class: 'sdk-stat-value' });
const timeValue = h('span', { class: 'sdk-stat-value' });
const status = h('p', { class: 'sdk-status', role: 'status' });
const announcer = h('p', { class: 'sr-only', 'aria-live': 'polite' });
const boardWrap = h('div', { class: 'sdk-boardwrap' });

const button = (cls, label, onclick, extra = {}) => h('button', { type: 'button', class: `btn ${cls}`, onclick, ...extra }, label);
const undoBtn = button('sdk-tool', t('sudoku.undo'), () => doUndo());
const eraseBtn = button('sdk-tool', t('sudoku.erase'), () => input(0));
const notesBtn = button('sdk-tool sdk-notes-btn', t('sudoku.notes'), () => setNotes(!notesMode), { 'aria-pressed': 'false' });
const hintBtn = button('sdk-tool', t('sudoku.hint'), () => doHint());
const newBtn = button('btn-primary sdk-new', t('sudoku.new'), () => startNew(level));
const moreBtn = button('sdk-more', t('sudoku.options'), () => openSheet(), { 'aria-haspopup': 'dialog' });

const padBtns = Array.from({ length: 9 }, (_, k) => h('button', {
  type: 'button', class: 'sdk-pad-btn', 'data-d': k + 1, onclick: () => input(k + 1),
}, h('span', { class: 'sdk-pad-digit', 'aria-hidden': 'true' }, String(k + 1)), h('span', { class: 'sdk-pips', 'aria-hidden': 'true' }, Array.from({ length: 9 }, () => h('i')))));
const pad = h('div', { class: 'sdk-pad', role: 'group', 'aria-label': t('sudoku.digits') }, padBtns);

const controls = h('div', { class: 'sdk-controls' },
  h('div', { class: 'sdk-tools' }, undoBtn, eraseBtn, notesBtn, hintBtn),
  pad,
  h('div', { class: 'sdk-actions' }, newBtn, moreBtn),
);

const levelBtns = Object.keys(LEVELS).map((lv) => h('button', {
  type: 'button', class: 'seg-btn sdk-level', 'data-level': lv,
  onclick: async () => { if (await startNew(lv) && sheet.open) sheet.close(); },
}, t(`sudoku.level.${lv}`)));
const statsList = h('dl', { class: 'sdk-record' });

const side = h('div', { class: 'sdk-side' },
  h('div', { class: 'sdk-section', role: 'group', 'aria-labelledby': 'sdk-level-label' },
    h('h2', { class: 'sdk-h2', id: 'sdk-level-label' }, t('sudoku.level')),
    h('div', { class: 'seg sdk-seg' }, levelBtns),
  ),
  h('section', { class: 'sdk-section', 'aria-labelledby': 'sdk-stats-label' },
    h('h2', { class: 'sdk-h2', id: 'sdk-stats-label' }, t('sudoku.stats')),
    statsList,
  ),
  h('section', { class: 'sdk-section sdk-help', 'aria-labelledby': 'sdk-help-label' },
    h('h2', { class: 'sdk-h2', id: 'sdk-help-label' }, t('sudoku.help.title')),
    ['goal', 'touch', 'keys', 'levels'].map((k) => h('p', {}, t(`sudoku.help.${k}`))),
  ),
);

const play = h('div', { class: 'sdk-play' },
  h('div', { class: 'sdk-top' },
    h('p', { class: 'sdk-stat' }, h('span', { class: 'sdk-stat-label' }, t('sudoku.level')), levelValue),
    h('p', { class: 'sdk-stat' }, h('span', { class: 'sdk-stat-label' }, t('sudoku.time')), timeValue),
  ),
  status,
  boardWrap,
);
const panel = h('div', { class: 'sdk-panel' });
const layout = h('div', { class: 'sdk-layout' }, play, panel);

// On narrow screens the game fills the screen with the controls below the
// board. The side panel, plus the footer's text and source link that the
// page hides there, move into a sheet. On wider screens the controls and
// side panel sit beside the board.
const sheetBody = h('div', { class: 'sdk-sheet-body' });
const sheet = h('dialog', { class: 'dialog sdk-sheet', 'aria-labelledby': 'sdk-sheet-title' },
  h('div', { class: 'sdk-sheet-head' },
    h('h2', { class: 'dialog-title', id: 'sdk-sheet-title' }, t('sudoku.options')),
    h('button', { type: 'button', class: 'btn', onclick: () => sheet.close() }, t('sudoku.close')),
  ),
  sheetBody,
  h('div', { class: 'sdk-sheet-foot' },
    h('p', {}, t('footer.text')),
    h('p', {}, h('a', { href: sourceUrl(SOURCE_PATH), rel: 'noreferrer' }, icon('source'), t('footer.source'))),
  ),
);
sheet.addEventListener('close', () => { if (moreBtn.isConnected) moreBtn.focus(); });

function openSheet() {
  renderStats();
  sheet.showModal();
}

function placeParts() {
  if (narrow.matches) {
    play.append(controls);
    sheetBody.append(side);
  } else {
    if (sheet.open) sheet.close();
    panel.append(controls, side);
  }
}

main.append(h('h1', { class: 'tool-title' }, name), layout, sheet, announcer);

// Board --------------------------------------------------------------

const cells = new Array(SIZE);
const board = h('div', { class: 'sdk-board', role: 'grid', 'aria-label': t('sudoku.board') });
for (let r = 0; r < 9; r++) {
  const row = h('div', { class: 'sdk-row', role: 'row' });
  for (let c = 0; c < 9; c++) {
    const i = r * 9 + c;
    const box = Math.floor(r / 3) * 3 + Math.floor(c / 3);
    cells[i] = h('button', {
      type: 'button', role: 'gridcell', tabindex: i === active ? '0' : '-1', 'data-i': i,
      class: `sdk-cell${box % 2 ? ' alt' : ''}${c % 3 === 2 && c < 8 ? ' edge-r' : ''}${r % 3 === 2 && r < 8 ? ' edge-b' : ''}`,
    });
    row.append(cells[i]);
  }
  board.append(row);
}
board.addEventListener('click', onClick);
board.addEventListener('keydown', onKey);
boardWrap.append(board);

// Cells grow to fit the space: the column's width on wider screens, the
// width and height left between the counters and the controls on narrow ones.
function sizeBoard() {
  const lines = 2 * 2 + 2 * 2 + 6 + 4; // frame, box lines, cell lines, padding
  const fitW = boardWrap.clientWidth - lines;
  const fitH = narrow.matches ? boardWrap.clientHeight - lines : innerHeight - 220;
  const min = coarse.matches ? 32 : 28;
  const cell = Math.max(min, Math.min(narrow.matches ? 64 : 60, Math.floor(Math.min(fitW, fitH) / 9)));
  board.style.setProperty('--cell', `${cell}px`);
}

const noteList = (n) => [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => n & (1 << d));

function renderCell(i, bad, peers) {
  const b = cells[i];
  const v = g ? g.values[i] : 0;
  const n = g ? g.notes[i] : 0;
  const key = `${v}.${n}`;
  if (b.dataset.key !== key) {
    b.dataset.key = key;
    if (v) b.replaceChildren(h('span', { class: 'sdk-digit', 'aria-hidden': 'true' }, String(v)));
    else if (n) {
      b.replaceChildren(h('span', { class: 'sdk-notes', 'aria-hidden': 'true' },
        [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => h('span', {}, n & (1 << d) ? String(d) : ''))));
    } else b.replaceChildren();
  }
  const fixed = g ? g.fixed[i] : 0;
  b.classList.toggle('is-given', !!(g && g.puzzle[i]));
  b.classList.toggle('is-hint', !!(fixed && !g.puzzle[i]));
  b.classList.toggle('is-bad', bad.has(i));
  b.classList.toggle('is-sel', i === active);
  b.classList.toggle('is-peer', peers.has(i));
  b.classList.toggle('is-same', !!v && i !== active && v === g.values[active]);
  b.setAttribute('aria-selected', String(i === active));

  let state;
  if (!v) state = n ? t('sudoku.cell.notes', { notes: noteList(n).join(' ') }) : t('sudoku.cell.empty');
  else if (g.puzzle[i]) state = t('sudoku.cell.given', { d: v });
  else if (fixed) state = t('sudoku.cell.hinted', { d: v });
  else state = t('sudoku.cell.value', { d: v });
  if (bad.has(i)) state = t('sudoku.cell.conflict', { state });
  b.setAttribute('aria-label', t('sudoku.cell.label', { row: rowOf(i) + 1, col: colOf(i) + 1, state }));
}

function renderAll() {
  const bad = g ? conflicts(g) : new Set();
  const peers = new Set(PEERS[active]);
  for (let i = 0; i < SIZE; i++) renderCell(i, bad, peers);
  renderBar();
}

function renderBar() {
  levelValue.textContent = t(`sudoku.level.${g ? g.level : level}`);
  renderTime();
  for (const b of levelBtns) b.setAttribute('aria-pressed', String(b.dataset.level === (g ? g.level : level)));
  const counts = g ? digitCounts(g) : new Array(10).fill(0);
  for (const b of padBtns) {
    const d = +b.dataset.d;
    const left = Math.max(0, 9 - counts[d]);
    // One pip per digit placed, so the pad shows progress at a glance.
    b.lastChild.childNodes.forEach((pip, k) => pip.classList.toggle('on', k < counts[d]));
    b.classList.toggle('is-done', !left);
    b.setAttribute('aria-label', t(left ? 'sudoku.digit.left' : 'sudoku.digit.done', { d, left }));
  }
  const over = !g || g.state !== 'playing';
  board.classList.toggle('is-over', over);
  board.setAttribute('aria-busy', String(pending));
  for (const b of [undoBtn, eraseBtn, notesBtn, hintBtn, ...padBtns]) b.setAttribute('aria-disabled', String(over || pending));
}

// Timer --------------------------------------------------------------
// Runs only while a game is in progress and the page is visible.

let runStart = 0;
let tick = 0;
const elapsed = () => (g ? g.elapsed : 0) + (runStart ? performance.now() - runStart : 0);

function syncTimer() {
  const run = !!g && !pending && g.state === 'playing' && document.visibilityState === 'visible';
  if (run && !runStart) {
    runStart = performance.now();
    tick = setInterval(renderTime, 1000);
  } else if (!run && runStart) {
    if (g) g.elapsed = elapsed();
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

const playable = () => !!g && !pending && g.state === 'playing';

// d is 1-9, or 0 to erase. Picking the digit a cell already holds clears it.
function input(d, asNote = notesMode) {
  if (!playable()) return;
  const i = active;
  if (g.fixed[i]) {
    say(t('sudoku.say.fixed'));
    bump(cells[i], 'is-locked');
    return;
  }
  let step;
  let message;
  if (!d || (!asNote && g.values[i] === d)) {
    step = erase(g, i);
    message = t('sudoku.say.erased');
  } else if (asNote) {
    step = toggleNote(g, i, d);
    message = t(g.notes[i] & (1 << d) ? 'sudoku.say.note' : 'sudoku.say.unnote', { d });
  } else {
    step = place(g, i, d);
    message = placed(i);
  }
  if (!step) return;
  history.push(step);
  after(i, message);
}

// Message for a digit just placed, and the rewards that go with it.
function placed(i) {
  const d = g.values[i];
  if (conflicts(g).has(i)) {
    bump(cells[i], 'is-shake');
    return t('sudoku.say.conflict', { d });
  }
  const done = completeUnits(g, i);
  for (const u of done) celebrate(u, i);
  const kinds = ['row', 'col', 'box'];
  return [t('sudoku.say.placed', { d }), ...done.map((u) => {
    const k = UNITS.indexOf(u);
    return t(`sudoku.say.${kinds[k % 3]}`, { n: Math.floor(k / 3) + 1 });
  })].join('. ');
}

function after(i, message) {
  renderAll();
  if (g.state === 'won') finish(i);
  else say(message);
  save();
}

function doUndo() {
  if (!playable()) return;
  const step = history.pop();
  if (!step) { say(t('sudoku.say.nothingToUndo')); return; }
  const back = undo(g, step);
  if (back.length) select(back[0]);
  renderAll();
  say(t('sudoku.say.undone'));
  save();
}

function doHint() {
  if (!playable()) return;
  const i = hint(g, active);
  if (i < 0) return;
  select(i);
  bump(cells[i], 'is-hinted');
  after(i, [t('sudoku.say.hint', { d: g.values[i], row: rowOf(i) + 1, col: colOf(i) + 1 }), placed(i)].join('. '));
}

function setNotes(on) {
  notesMode = on;
  notesBtn.setAttribute('aria-pressed', String(on));
  pad.classList.toggle('is-notes', on);
}

function finish(from) {
  syncTimer();
  const rec = record(g.level);
  rec.won += 1;
  const ms = Math.round(g.elapsed);
  let message;
  if (g.hints) {
    message = t(g.hints === 1 ? 'sudoku.status.hintedOne' : 'sudoku.status.hinted', { time: formatTime(ms), hints: g.hints });
  } else {
    const isBest = rec.best == null || ms < rec.best;
    if (isBest) rec.best = ms;
    message = t(isBest ? 'sudoku.status.best' : 'sudoku.status.won', { time: formatTime(ms) });
  }
  stats[g.level] = rec;
  if (saving) store.set('stats', stats);
  status.textContent = message;
  status.dataset.state = 'won';
  ripple(cells.map((_, j) => j), from, '--w', 30);
  restart(board, 'is-won');
  confetti();
  renderAll();
  renderStats();
}

// Returns true when a new game started.
async function startNew(lv, ask = true) {
  if (pending) return false;
  if (ask && g && g.state === 'playing' && g.values.some((v, i) => v !== g.puzzle[i] || g.notes[i])) {
    const ok = await confirmDialog({ title: t('sudoku.confirm.title'), body: t('sudoku.confirm.body'), confirmLabel: t('sudoku.confirm.ok') });
    if (!ok) return false;
  }
  clearInterval(tick);
  runStart = 0;
  level = lv;
  if (saving) store.set('level', lv);
  pending = true;
  g = null;
  history = [];
  board.classList.remove('is-won');
  delete status.dataset.state;
  status.textContent = '';
  const slow = setTimeout(() => { status.textContent = t('sudoku.making'); }, 200);
  renderAll();
  const p = await makePuzzle(lv);
  clearTimeout(slow);
  pending = false;
  g = newGame(lv, p);
  status.textContent = '';
  ripple(cells.map((_, j) => j), active, '--d', 25);
  renderAll();
  syncTimer();
  save();
  return true;
}

function save() {
  if (!saving || !g) return;
  const s = serialize(g);
  s.elapsed = Math.round(elapsed());
  store.set('game', s);
}

function say(text) { announcer.textContent = text; }

function record(lv) {
  const r = stats[lv];
  return { won: Number.isInteger(r?.won) && r.won >= 0 ? r.won : 0, best: Number.isFinite(r?.best) ? r.best : null };
}

function renderStats() {
  statsList.replaceChildren(...Object.keys(LEVELS).flatMap((lv) => {
    const r = record(lv);
    const parts = [];
    if (r.won) parts.push(t('sudoku.stats.won', r));
    if (r.best != null) parts.push(t('sudoku.stats.best', { time: formatTime(r.best) }));
    return [h('dt', {}, t(`sudoku.level.${lv}`)), h('dd', {}, parts.join(', ') || t('sudoku.stats.none'))];
  }));
}

// Animation ----------------------------------------------------------

// Sets a delay on each cell from its distance to the cell played, so
// changes spread outwards from it.
function ripple(list, from, prop, step) {
  for (const j of list) {
    const d = Math.max(Math.abs(rowOf(j) - rowOf(from)), Math.abs(colOf(j) - colOf(from)));
    cells[j].style.setProperty(prop, `${d * step}ms`);
  }
}

// Adds a class that plays an animation, restarting it if it's already on.
function restart(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

function bump(el, cls, ms = 700) {
  restart(el, cls);
  setTimeout(() => el.classList.remove(cls), ms);
}

function celebrate(unit, from) {
  ripple(unit, from, '--u', 45);
  for (const j of unit) bump(cells[j], 'is-done', 1000);
}

const CONFETTI = ['--s-ring', '--s-sel', '--s-entry', '--s-box', '--s-same', '--s-hint'];

function confetti() {
  if (reducedMotion.matches) return;
  const box = h('div', { class: 'sdk-confetti', 'aria-hidden': 'true' });
  const height = boardWrap.offsetTop + boardWrap.offsetHeight;
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
  play.append(box);
  setTimeout(() => box.remove(), 2600);
}

// Input --------------------------------------------------------------
// Click or arrow keys pick a cell; digits come from the pad or the keyboard.

const cellFrom = (e) => e.target.closest?.('.sdk-cell');

function onClick(e) {
  const b = cellFrom(e);
  if (b) focusCell(+b.dataset.i);
}

// Moves the selection. Focus follows only when it's already on the board,
// so the pad and buttons keep it.
function select(i) {
  cells[active].tabIndex = -1;
  active = i;
  cells[i].tabIndex = 0;
  if (board.contains(document.activeElement)) cells[i].focus();
  renderAll();
}

function focusCell(i) {
  select(i);
  cells[i].focus();
}

function onKey(e) {
  const b = cellFrom(e);
  if (!b || e.altKey) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); doUndo(); return; }
  if (mod) {
    if (e.key !== 'Home' && e.key !== 'End') return;
  }
  let r = rowOf(active);
  let c = colOf(active);
  let d = /^[0-9]$/.test(e.key) ? +e.key : -1;
  let asNote = notesMode;
  if (e.shiftKey) {
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (m) { d = +m[1]; asNote = true; }
  }
  if (d >= 0) { e.preventDefault(); input(d, d ? asNote : false); return; }
  switch (e.key) {
    case 'ArrowUp': r = Math.max(0, r - 1); break;
    case 'ArrowDown': r = Math.min(8, r + 1); break;
    case 'ArrowLeft': c = Math.max(0, c - 1); break;
    case 'ArrowRight': c = Math.min(8, c + 1); break;
    case 'Home': if (e.ctrlKey) r = 0; c = 0; break;
    case 'End': if (e.ctrlKey) r = 8; c = 8; break;
    case 'Backspace': case 'Delete': e.preventDefault(); input(0); return;
    case 'n': case 'N':
      e.preventDefault();
      setNotes(!notesMode);
      say(t(notesMode ? 'sudoku.say.notesOn' : 'sudoku.say.notesOff'));
      return;
    default: return;
  }
  e.preventDefault();
  focusCell(r * 9 + c);
}

// Start --------------------------------------------------------------

new ResizeObserver(() => sizeBoard()).observe(boardWrap);
narrow.addEventListener('change', () => { placeParts(); sizeBoard(); });
coarse.addEventListener('change', sizeBoard);
addEventListener('resize', sizeBoard);
document.addEventListener('visibilitychange', () => { syncTimer(); if (document.visibilityState === 'hidden') save(); });
addEventListener('pagehide', save);

placeParts();
sizeBoard();
renderStats();
if (g) {
  level = g.level;
  if (g.state === 'won') {
    status.textContent = t('sudoku.status.won', { time: formatTime(g.elapsed) });
    status.dataset.state = 'won';
  }
  renderAll();
  syncTimer();
} else {
  startNew(level, false);
}
