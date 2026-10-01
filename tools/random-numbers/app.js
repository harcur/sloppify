// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { initPage, guardStore } from '../../shared/page.js';
import { extendStrings, t } from '../../shared/i18n.js';
import { h } from '../../shared/dom.js';
import { openStore } from '../../shared/storage.js';
import { toast } from '../../shared/toast.js';
import { strings } from './strings.js';
import { LIMITS, randInt, pickNumbers, sum, readInt } from './logic.js';

extendStrings(strings);

const TOOL_ID = 'random-numbers';
const name = t(`${TOOL_ID}.name`);
const { main } = initPage({ toolId: TOOL_ID, toolName: name, license: 'MIT', sourcePath: 'tools/random-numbers/' });

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const TILES = 4; // more numbers than this show as a list
const HISTORY = 20;

// Saved: the settings and the last picks.
const store = openStore(TOOL_ID, { version: 1 });
const saving = await guardStore(store, name);
const load = (key, fallback) => (saving ? store.get(key, fallback) : fallback);
const save = (key, value) => { if (saving) store.set(key, value); };

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const stored = load('settings', {}) || {};
const settings = {
  min: isInt(stored.min, -LIMITS.value, LIMITS.value) ? stored.min : 1,
  max: isInt(stored.max, -LIMITS.value, LIMITS.value) ? stored.max : 100,
  count: isInt(stored.count, 1, LIMITS.count) ? stored.count : 1,
  unique: stored.unique === true,
  sort: stored.sort === true,
};
let history = load('history', []);
history = (Array.isArray(history) ? history : []).filter((e) => e && Number.isInteger(e.min) && Number.isInteger(e.max)
  && Array.isArray(e.values) && e.values.length && e.values.every(Number.isInteger)).slice(0, HISTORY);

const t2 = (key, vars) => t(`${TOOL_ID}.${key}`, vars);
const fmt = (n) => String(n).replace('-', '−');

// Elements -----------------------------------------------------------

const caption = h('p', { class: 'rn-caption' });
const out = h('div', { class: 'rn-out' });
const total = h('p', { class: 'rn-sum' });
const error = h('p', { class: 'rn-error', role: 'alert' });
const stage = h('section', { class: 'rn-stage', 'aria-label': t2('results') }, caption, out, total, error);

const pickBtn = h('button', { type: 'button', class: 'btn btn-primary rn-pick', onclick: () => pick() }, t2('pick'));
const copyBtn = h('button', { type: 'button', class: 'btn rn-copy', onclick: () => copy() }, t2('copy'));
const actions = h('div', { class: 'rn-actions' }, pickBtn, copyBtn);

function numberField(value, onchange, attrs = {}) {
  const input = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', class: 'rn-input', value: fmt(value), ...attrs });
  input.addEventListener('input', () => onchange(readInt(input.value), input));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') pick(); });
  return input;
}

const fromInput = numberField(settings.min, (v) => setting('min', v), { id: 'rn-from' });
const toInput = numberField(settings.max, (v) => setting('max', v), { id: 'rn-to' });
const countInput = numberField(settings.count, (v) => setting('count', v), { 'aria-label': t2('count'), class: 'rn-input rn-count' });
const step = (delta) => {
  const now = Number.isInteger(settings.count) ? settings.count : 1;
  const next = Math.max(1, Math.min(LIMITS.count, now + delta));
  countInput.value = String(next);
  setting('count', next);
};

function check(label, key) {
  const input = h('input', { type: 'checkbox', checked: settings[key], onchange: () => setting(key, input.checked) });
  return h('label', { class: 'rn-check' }, input, h('span', {}, label));
}

const historyList = h('ol', { class: 'rn-history' });
const historyEmpty = h('p', { class: 'rn-hint' }, t2('history.empty'));
const clearBtn = h('button', { type: 'button', class: 'btn btn-link', onclick: () => { history = []; save('history', history); renderHistory(); } }, t2('history.clear'));

const side = h('div', { class: 'rn-side' },
  h('section', { class: 'rn-section', 'aria-labelledby': 'rn-range-h' },
    h('h2', { class: 'rn-h2', id: 'rn-range-h' }, t2('range')),
    h('div', { class: 'rn-pair' },
      h('div', { class: 'rn-field' }, h('label', { for: 'rn-from' }, t2('from')), fromInput),
      h('div', { class: 'rn-field' }, h('label', { for: 'rn-to' }, t2('to')), toInput),
    ),
  ),
  h('section', { class: 'rn-section', 'aria-labelledby': 'rn-count-h' },
    h('h2', { class: 'rn-h2', id: 'rn-count-h' }, t2('howMany')),
    h('div', { class: 'rn-stepper' },
      h('button', { type: 'button', class: 'btn rn-step', 'aria-label': t2('fewer'), onclick: () => step(-1) }, '−'),
      countInput,
      h('button', { type: 'button', class: 'btn rn-step', 'aria-label': t2('more'), onclick: () => step(1) }, '+'),
    ),
    check(t2('unique'), 'unique'),
    check(t2('sort'), 'sort'),
  ),
  h('section', { class: 'rn-section', 'aria-labelledby': 'rn-history-h' },
    h('h2', { class: 'rn-h2', id: 'rn-history-h' }, t2('history')),
    historyEmpty, historyList, clearBtn,
  ),
);

const announcer = h('p', { class: 'sr-only', 'aria-live': 'polite' });
main.append(
  h('h1', { class: 'tool-title' }, name),
  h('div', { class: 'rn-layout' }, stage, actions, side),
  h('p', { class: 'rn-fair' }, t2('fair')),
  announcer,
);

// Behaviour ----------------------------------------------------------

function setting(key, value) {
  settings[key] = value;
  error.textContent = '';
  if (typeof value === 'boolean' || Number.isInteger(value)) save('settings', settings);
}

let current = null; // { min, max, values } on show
let cells = [];

// Builds tiles (few numbers) or a numbered list (many) with empty cells.
function build(n) {
  if (n <= TILES) {
    cells = Array.from({ length: n }, () => h('span', { class: 'rn-tile' }));
    out.replaceChildren(h('div', { class: `rn-tiles rn-tiles-${n}` }, cells));
  } else {
    cells = Array.from({ length: n }, () => h('span', { class: 'rn-value' }));
    out.replaceChildren(h('ol', { class: 'rn-list', tabindex: '0', 'aria-label': t2('list', { n }) }, cells.map((c, i) => {
      const li = h('li', { class: 'rn-row' }, h('span', { class: 'rn-index' }, `${i + 1}.`), c);
      li.style.animationDelay = `${Math.min(i, 15) * 30}ms`;
      return li;
    })));
  }
}
const fill = (values) => cells.forEach((c, i) => { c.textContent = fmt(values[i]); });

function captionFor({ min, max, values }) {
  return values.length > 1 ? t2('captionMany', { min: fmt(min), max: fmt(max), n: values.length }) : t2('caption', { min: fmt(min), max: fmt(max) });
}

function show(result) {
  current = result;
  build(result.values.length);
  fill(result.values);
  caption.textContent = captionFor(result);
  total.textContent = result.values.length > 1 ? t2('sum', { sum: fmt(sum(result.values)) }) : '';
}

// Restart a CSS animation on an element by toggling its class.
function replay(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let busy = false;

async function pick() {
  if (busy) return;
  const r = pickNumbers(settings);
  if (r.error) {
    const { min, max } = settings;
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    error.textContent = t2(`error.${r.error}`, { n: settings.count, min: fmt(lo), max: fmt(hi) });
    return;
  }
  busy = true;
  error.textContent = '';
  stage.classList.remove('rn-pop');
  if (!reducedMotion.matches) {
    build(r.values.length);
    caption.textContent = captionFor(r);
    total.textContent = '';
    stage.classList.add('rn-rolling');
    for (let k = 0; k < 9; k++) {
      fill(r.values.map(() => randInt(r.min, r.max)));
      await wait(55);
    }
    stage.classList.remove('rn-rolling');
  }
  show(r);
  replay(stage, 'rn-pop');
  history.unshift({ min: r.min, max: r.max, values: r.values });
  history = history.slice(0, HISTORY);
  save('history', history);
  renderHistory();
  const values = r.values.map(fmt).join(', ');
  announcer.textContent = '';
  const spoken = r.values.length > 1 ? t2('announceMany', { n: r.values.length, values, sum: fmt(sum(r.values)) }) : values;
  setTimeout(() => { announcer.textContent = spoken; }, 50);
  busy = false;
}

async function copy() {
  if (!current) return;
  try {
    await navigator.clipboard.writeText(current.values.join(', '));
    toast(t2('copied'));
  } catch {
    toast(t2('copyFailed'), 5000);
  }
}

function renderHistory() {
  historyList.replaceChildren(...history.map((e) => h('li', {},
    h('span', { class: 'rn-history-range' }, t2('caption', { min: fmt(e.min), max: fmt(e.max) })),
    h('span', { class: 'rn-history-values' }, e.values.map(fmt).join(', ')))));
  historyEmpty.hidden = history.length > 0;
  clearBtn.hidden = history.length === 0;
}

// Start with the last pick, or a prompt to make one.
if (history.length) show(history[0]);
else {
  caption.textContent = t2('caption', { min: fmt(settings.min), max: fmt(settings.max) });
  out.replaceChildren(h('p', { class: 'rn-hint' }, t2('waiting')));
}
renderHistory();
