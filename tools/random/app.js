// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { initPage, guardStore } from '../../shared/page.js';
import { extendStrings, t } from '../../shared/i18n.js';
import { h } from '../../shared/dom.js';
import { openStore } from '../../shared/storage.js';
import { strings } from './strings.js';
import {
  DICE, LIMITS, cryptoRandom, randInt, shuffle, pickNumbers, parseDice, formatDice, poolSize, sortPool,
  rollDice, spinWheel, drawStraws, flipCoin, makeTeams, parseList,
} from './logic.js';

extendStrings(strings);

const TOOL_ID = 'random';
const name = t(`${TOOL_ID}.name`);
const { main } = initPage({ toolId: TOOL_ID, toolName: name, license: 'MIT', sourcePath: 'tools/random/' });

const MODES = ['wheel', 'dice', 'numbers', 'straws', 'coin', 'shuffle', 'teams'];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const still = () => reducedMotion.matches;

// Saved: the open mode, each mode's settings and the last results.
const store = openStore(TOOL_ID, { version: 1 });
const saving = await guardStore(store, name);
const load = (key, fallback) => (saving ? store.get(key, fallback) : fallback);
const save = (key, value) => { if (saving) store.set(key, value); };

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const int = (v, fallback, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : fallback);
const saved = isObj(load('settings', {})) ? load('settings', {}) : {};
const pick = (key) => (isObj(saved[key]) ? saved[key] : {});

const settings = {
  lists: {
    wheel: typeof pick('lists').wheel === 'string' ? pick('lists').wheel : t('random.listDefault.wheel'),
    people: typeof pick('lists').people === 'string' ? pick('lists').people : t('random.listDefault.people'),
  },
  wheel: { remove: pick('wheel').remove === true, rotation: Number.isFinite(pick('wheel').rotation) ? pick('wheel').rotation % 360 : 0 },
  dice: (() => {
    const d = pick('dice');
    const parsed = d.notation === '' ? { pool: [], mod: 0 } : typeof d.notation === 'string' && parseDice(d.notation);
    return { ...(parsed || { pool: [{ sides: 20, count: 1 }], mod: 0 }), adv: ['none', 'adv', 'dis'].includes(d.adv) ? d.adv : 'none' };
  })(),
  numbers: {
    min: int(pick('numbers').min, 1, -LIMITS.value, LIMITS.value),
    max: int(pick('numbers').max, 100, -LIMITS.value, LIMITS.value),
    count: int(pick('numbers').count, 1, 1, LIMITS.count),
    unique: pick('numbers').unique === true,
    sort: pick('numbers').sort === true,
  },
  coin: { heads: int(pick('coin').heads, 0, 0, 1e9), tails: int(pick('coin').tails, 0, 0, 1e9) },
  teams: { count: int(pick('teams').count, 2, 2, LIMITS.teams) },
};
const saveSettings = () => save('settings', { ...settings, dice: { notation: formatDice(settings.dice).replace('−', '-'), adv: settings.dice.adv } });

let history = load('history', []);
if (!Array.isArray(history)) history = [];
history = history.filter((e) => isObj(e) && MODES.includes(e.mode) && typeof e.text === 'string').slice(0, 30);

let mode = MODES.includes(load('mode')) ? load('mode') : 'wheel';

// Shared bits --------------------------------------------------------

const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  el.append(...kids.flat());
  return el;
}

const announcer = h('p', { class: 'sr-only', 'aria-live': 'polite' });
function announce(text) {
  announcer.textContent = '';
  setTimeout(() => { announcer.textContent = text; }, 50);
}

function record(m, text, spoken = text) {
  history.unshift({ mode: m, text });
  history = history.slice(0, 30);
  save('history', history);
  announce(spoken);
  renderHistory();
}

let runId = 0; // bumps on every mode switch so a finishing animation knows it's stale
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

function button(label, onclick, cls = 'btn') {
  return h('button', { type: 'button', class: cls, onclick }, label);
}

let uid = 0;
function field(label, control, hint) {
  const id = control.id || (control.id = `random-f${++uid}`);
  const hintEl = hint && h('p', { class: 'random-hint', id: `${id}-hint` }, hint);
  if (hintEl) control.setAttribute('aria-describedby', hintEl.id);
  return h('div', { class: 'random-field' }, h('label', { for: id }, label), control, hintEl);
}

function check(label, checked, onchange) {
  const input = h('input', { type: 'checkbox', checked, onchange: () => onchange(input.checked) });
  return h('label', { class: 'random-check' }, input, h('span', {}, label));
}

function numberInput(value, onchange, attrs = {}) {
  const input = h('input', { type: 'number', inputmode: 'numeric', step: 1, value, class: 'random-num', ...attrs });
  input.addEventListener('input', () => onchange(input.value.trim() === '' ? NaN : Number(input.value)));
  return input;
}

// Text area for a list of entries, saved as typed.
function listEditor(key, onchange) {
  const area = h('textarea', { class: 'random-list', rows: 7, spellcheck: 'false' });
  area.value = settings.lists[key];
  const count = h('p', { class: 'random-hint', 'aria-live': 'polite' });
  const sync = () => { count.textContent = t('random.entriesCount', { n: parseList(area.value).length }); };
  area.addEventListener('input', () => {
    settings.lists[key] = area.value;
    saveSettings();
    sync();
    onchange?.();
  });
  sync();
  const el = field(t('random.entries'), area);
  el.append(count);
  return { el, area, entries: () => parseList(area.value) };
}

// Layout --------------------------------------------------------------

const tabs = MODES.map((m) => h('button', {
  type: 'button', role: 'tab', class: 'random-tab', id: `random-tab-${m}`, 'aria-controls': 'random-panel',
  onclick: () => setMode(m),
}, t(`random.mode.${m}`)));
const tablist = h('div', { class: 'random-tabs', role: 'tablist', 'aria-label': t('random.modes') }, tabs);
tablist.addEventListener('keydown', (e) => {
  const i = MODES.indexOf(mode);
  const j = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: MODES.length - 1 }[e.key];
  if (j == null) return;
  e.preventDefault();
  const next = (j + MODES.length) % MODES.length;
  setMode(MODES[next]);
  tabs[next].focus();
});

const panel = h('div', { class: 'random-panel', role: 'tabpanel', id: 'random-panel', tabindex: '-1' });
const historyList = h('ol', { class: 'random-history' });
const historyEmpty = h('p', { class: 'random-hint' }, t('random.history.empty'));
const clearHistory = button(t('random.history.clear'), () => { history = []; save('history', history); renderHistory(); }, 'btn btn-link');
const historySection = h('section', { class: 'random-history-section', 'aria-labelledby': 'random-history-h' },
  h('h2', { class: 'random-h2', id: 'random-history-h' }, t('random.history')),
  historyEmpty, historyList, clearHistory,
);

main.append(
  h('h1', { class: 'tool-title' }, name),
  h('div', { class: 'random-layout' }, h('div', { class: 'random-primary' }, tablist, panel), historySection),
  h('p', { class: 'random-fair' }, t('random.fair')),
  announcer,
);

function renderHistory() {
  historyList.replaceChildren(...history.map((e) => h('li', {},
    h('span', { class: 'random-history-mode' }, t(`random.mode.${e.mode}`)), ' ', e.text)));
  historyEmpty.hidden = history.length > 0;
  clearHistory.hidden = history.length === 0;
}

const builders = { wheel: wheelMode, dice: diceMode, numbers: numbersMode, straws: strawsMode, coin: coinMode, shuffle: shuffleMode, teams: teamsMode };

function setMode(m) {
  mode = m;
  runId++;
  save('mode', m);
  tabs.forEach((tab, i) => {
    const on = MODES[i] === m;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
  });
  panel.setAttribute('aria-labelledby', `random-tab-${m}`);
  panel.dataset.mode = m;
  const { stage, controls } = builders[m]();
  panel.replaceChildren(h('div', { class: 'random-stage' }, stage), h('div', { class: 'random-controls' }, controls));
}

// A stage with the visual, a result line and the main button.
function stageOf(visual, result, action) {
  return [visual, result, h('div', { class: 'random-actions' }, action)].filter(Boolean);
}
const resultLine = () => h('p', { class: 'random-result' });

// Wheel ---------------------------------------------------------------

const SEGMENT_COLOURS = 8;

function wheelSvg(entries) {
  const n = entries.length;
  const r = 100;
  const seg = 360 / n;
  const rad = (deg) => ((deg - 90) * Math.PI) / 180;
  const pt = (deg) => `${(r * Math.cos(rad(deg))).toFixed(3)} ${(r * Math.sin(rad(deg))).toFixed(3)}`;
  const size = Math.max(5, Math.min(13, 260 / n));
  return s('svg', { viewBox: '-102 -102 204 204', class: 'random-wheel-svg', 'aria-hidden': 'true', focusable: 'false' },
    entries.map((label, i) => {
      // Avoid two neighbours of the same colour where the circle closes.
      const colour = i === n - 1 && n % SEGMENT_COLOURS === 1 ? 3 : i % SEGMENT_COLOURS;
      const mid = (i + 0.5) * seg - 90;
      const text = label.length > 16 ? `${label.slice(0, 15)}…` : label;
      return s('g', { class: `random-seg random-c${colour}`, 'data-i': i },
        s('path', { d: `M0 0L${pt(i * seg)}A${r} ${r} 0 0 1 ${pt((i + 1) * seg)}Z` }),
        s('text', { transform: `rotate(${mid.toFixed(3)})`, x: 90, y: 0, 'text-anchor': 'end', 'dominant-baseline': 'central', 'font-size': size.toFixed(1) }, text),
      );
    }),
    s('circle', { class: 'random-wheel-hub', r: 9 }),
  );
}

function wheelMode() {
  const rotor = h('div', { class: 'random-rotor' });
  const pointer = s('svg', { class: 'random-pointer', viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' }, s('path', { d: 'M3 2h18L12 22z' }));
  const wheel = h('div', { class: 'random-wheel', role: 'img' }, rotor, pointer);
  const result = resultLine();
  const spin = button(t('random.wheel.spin'), go, 'btn btn-primary random-go');
  const list = listEditor('wheel', draw);
  const remove = check(t('random.wheel.remove'), settings.wheel.remove, (v) => { settings.wheel.remove = v; saveSettings(); });
  const setRotation = (deg) => { rotor.style.transform = `rotate(${deg}deg)`; };

  function draw() {
    const entries = list.entries();
    wheel.setAttribute('aria-label', t('random.wheel.label', { n: entries.length }));
    rotor.replaceChildren(entries.length >= 2 ? wheelSvg(entries) : h('p', { class: 'random-hint random-wheel-empty' }, t('random.needTwo')));
    setRotation(settings.wheel.rotation);
    spin.disabled = entries.length < 2;
  }

  async function go() {
    const entries = list.entries();
    if (entries.length < 2) return;
    const run = runId;
    const from = settings.wheel.rotation;
    const { index, rotation } = spinWheel(entries.length, from, cryptoRandom, still() ? 1 : 5 + randInt(0, 2));
    spin.disabled = true;
    list.area.readOnly = true;
    result.textContent = '';
    rotor.querySelector('.random-win')?.classList.remove('random-win');
    if (!still()) {
      const anim = rotor.animate([{ transform: `rotate(${from}deg)` }, { transform: `rotate(${rotation}deg)` }],
        { duration: 4200, easing: 'cubic-bezier(0.12, 0.75, 0.2, 1)', fill: 'forwards' });
      await anim.finished.catch(() => {});
      setRotation(rotation);
      anim.cancel();
    }
    settings.wheel.rotation = rotation % 360;
    setRotation(settings.wheel.rotation);
    saveSettings();
    spin.disabled = false;
    list.area.readOnly = false;
    if (run !== runId) return;
    const item = entries[index];
    rotor.querySelector(`[data-i="${index}"]`)?.classList.add('random-win');
    result.textContent = item;
    record('wheel', item, t('random.wheel.result', { item }));
    if (settings.wheel.remove) {
      const lines = list.area.value.split('\n');
      lines.splice(lines.findIndex((l) => l.trim() === item), 1);
      list.area.value = settings.lists.wheel = lines.join('\n');
      saveSettings();
      await wait(still() ? 0 : 1200);
      if (run === runId) list.area.dispatchEvent(new Event('input'));
    }
  }

  draw();
  return { stage: stageOf(wheel, result, spin), controls: [list.el, remove] };
}

// Dice ----------------------------------------------------------------

const DIE_SHAPES = {
  4: 'M50 6L95 88H5Z',
  6: 'M10 10H90V90H10Z',
  8: 'M50 3L97 50L50 97L3 50Z',
  10: 'M50 3L95 40L50 97L5 40Z',
  12: 'M50 4L96 37L78 93H22L4 37Z',
  20: 'M50 3L93 27V73L50 97L7 73V27Z',
};
const TEXT_Y = { 4: 68, 10: 45, 12: 56 };
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

function dieFace(sides, value) {
  if (sides === 6) {
    return PIPS[value].map((p) => s('circle', { class: 'random-pip', cx: 28 + (p % 3) * 22, cy: 28 + Math.floor(p / 3) * 22, r: 7.5 }));
  }
  const digits = String(value).length;
  return [s('text', { x: 50, y: TEXT_Y[sides] ?? 52, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': digits > 2 ? 24 : 32 }, String(value))];
}

function dieSvg(sides, value) {
  const shape = DIE_SHAPES[sides] ? s('path', { class: 'random-die-body', d: DIE_SHAPES[sides] }) : s('circle', { class: 'random-die-body', cx: 50, cy: 50, r: 46 });
  const facets = sides === 20 ? s('path', { class: 'random-die-facet', d: 'M50 24L76 70H24Z' }) : null;
  const face = s('g', { class: 'random-die-face' }, dieFace(sides, value));
  return { svg: s('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true', focusable: 'false' }, shape, facets, face), face };
}

const dieClass = (sides) => `random-die random-die-${DICE.includes(sides) ? sides : 'x'}`;

function diceMode() {
  const d = settings.dice;
  const tray = h('div', { class: 'random-tray' });
  const total = h('p', { class: 'random-total' });
  const result = h('p', { class: 'random-result random-breakdown' });
  const roll = button(t('random.dice.roll'), go, 'btn btn-primary random-go');
  const notation = h('input', { type: 'text', class: 'random-text', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off' });
  const error = h('p', { class: 'random-error', role: 'alert' });
  const modValue = h('output', { class: 'random-mod-value' });
  const counts = new Map();
  const addBtns = DICE.map((sides) => {
    const badge = h('span', { class: 'random-badge' });
    counts.set(sides, badge);
    return h('button', {
      type: 'button', class: 'btn random-add', 'aria-label': t('random.dice.add', { sides }),
      onclick: () => change(() => {
        if (poolSize(d.pool) >= LIMITS.dice) return;
        const entry = d.pool.find((x) => x.sides === sides);
        if (entry) entry.count++; else d.pool.push({ sides, count: 1 });
      }),
    }, h('span', { class: dieClass(sides) }, dieSvg(sides, sides === 6 ? 6 : sides).svg), h('span', {}, `d${sides}`), badge);
  });
  const advBtns = ['none', 'adv', 'dis'].map((v) => h('button', {
    type: 'button', class: 'seg-btn', 'data-value': v,
    onclick: () => { d.adv = v; saveSettings(); sync(); },
  }, t(`random.dice.${v}`)));

  function sync(fromInput = false) {
    d.pool = sortPool(d.pool);
    if (!fromInput) { notation.value = formatDice(d); error.textContent = ''; }
    modValue.textContent = d.mod > 0 ? `+${d.mod}` : d.mod < 0 ? `−${-d.mod}` : '0';
    for (const [sides, badge] of counts) {
      const n = d.pool.find((x) => x.sides === sides)?.count ?? 0;
      badge.textContent = n ? `×${n}` : '';
    }
    advBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === d.adv)));
    roll.disabled = poolSize(d.pool) === 0;
  }
  // The dice about to be rolled, before a roll.
  function preview() {
    const dice = d.pool.flatMap(({ sides, count }) => Array.from({ length: count }, () => sides));
    tray.replaceChildren(...dice.map((sides) => h('span', { class: `${dieClass(sides)} random-die-big random-idle`, 'aria-hidden': 'true' },
      dieSvg(sides, sides === 6 ? 6 : sides).svg, h('span', { class: 'random-die-name' }, `d${sides}`))));
    total.textContent = dice.length ? '' : t('random.dice.empty');
    result.textContent = '';
  }
  function change(fn) { fn(); saveSettings(); sync(); preview(); }

  notation.addEventListener('input', () => {
    const parsed = parseDice(notation.value.replace(/−/g, '-'));
    if (!parsed) { error.textContent = notation.value.trim() ? t('random.dice.invalid') : ''; roll.disabled = true; return; }
    error.textContent = '';
    d.pool = parsed.pool;
    d.mod = parsed.mod;
    saveSettings();
    sync(true);
    preview();
  });
  notation.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !roll.disabled) go(); });

  async function go() {
    const run = runId;
    const r = rollDice(d, d.adv);
    roll.disabled = true;
    total.textContent = '';
    result.textContent = '';
    const dice = r.dice.map((die, i) => {
      const { svg, face } = dieSvg(die.sides, die.value);
      const el = h('span', { class: `${dieClass(die.sides)} random-die-big`, role: 'img', 'aria-label': t(die.dropped ? 'random.dice.dropped' : 'random.dice.die', die) },
        svg, h('span', { class: 'random-die-name', 'aria-hidden': 'true' }, `d${die.sides}`));
      if (!still()) el.style.animationDelay = `${(i % 10) * 40}ms`;
      return { el, face, die };
    });
    tray.replaceChildren(...dice.map((x) => x.el));
    if (!still()) {
      tray.classList.add('random-rolling');
      for (let k = 0; k < 11; k++) {
        for (const { face, die } of dice) face.replaceChildren(...dieFace(die.sides, randInt(1, die.sides)));
        await wait(70);
      }
      for (const { face, die } of dice) face.replaceChildren(...dieFace(die.sides, die.value));
      tray.classList.remove('random-rolling');
    }
    const kept20 = r.dice.filter((x) => x.sides === 20 && !x.dropped);
    dice.forEach(({ el, die }) => {
      el.classList.toggle('random-dropped', die.dropped);
      el.classList.toggle('random-crit', !die.dropped && die.sides === 20 && die.value === 20);
      el.classList.toggle('random-fumble', !die.dropped && die.sides === 20 && die.value === 1);
    });
    const kept = r.dice.filter((x) => !x.dropped).map((x) => x.value);
    const mod = r.mod ? ` ${r.mod < 0 ? '−' : '+'} ${Math.abs(r.mod)}` : '';
    const nat = kept20.length === 1 && [1, 20].includes(kept20[0].value) ? ` · ${t(kept20[0].value === 20 ? 'random.dice.nat20' : 'random.dice.nat1')}` : '';
    total.textContent = String(r.total);
    result.textContent = `${kept.join(' + ')}${mod}${nat}`;
    roll.disabled = false;
    if (run !== runId) return;
    record('dice', `${t('random.dice.result', { dice: formatDice(d), total: r.total })}${nat}`);
  }

  sync();
  preview();
  const modBtn = (label, delta) => h('button', {
    type: 'button', class: 'btn random-step', 'aria-label': label,
    onclick: () => change(() => { d.mod = Math.max(-LIMITS.mod, Math.min(LIMITS.mod, d.mod + delta)); }),
  }, delta < 0 ? '−' : '+');
  const modLabel = h('span', { id: 'random-mod-label' }, t('random.dice.modifier'));

  return {
    stage: stageOf(h('div', { class: 'random-dice-stage' }, tray, total), result, roll),
    controls: [
      h('div', { class: 'random-field', role: 'group', 'aria-label': t('random.dice.pool') },
        h('span', { class: 'random-label' }, t('random.dice.pool')),
        h('div', { class: 'random-add-grid' }, addBtns),
      ),
      field(t('random.dice.notation'), notation, t('random.dice.notationHint')),
      error,
      h('div', { class: 'random-row' },
        h('div', { class: 'random-field', role: 'group', 'aria-labelledby': 'random-mod-label' },
          modLabel,
          h('div', { class: 'random-stepper' }, modBtn(t('random.dice.modDown'), -1), modValue, modBtn(t('random.dice.modUp'), 1)),
        ),
        button(t('random.dice.clear'), () => change(() => { d.pool = []; d.mod = 0; }), 'btn random-clear'),
      ),
      h('div', { class: 'random-field', role: 'group', 'aria-labelledby': 'random-adv-label' },
        h('span', { class: 'random-label', id: 'random-adv-label' }, t('random.dice.d20')),
        h('div', { class: 'seg random-seg' }, advBtns),
      ),
    ],
  };
}

// Numbers -------------------------------------------------------------

function numbersMode() {
  const n = settings.numbers;
  const out = h('div', { class: 'random-numbers' });
  const error = h('p', { class: 'random-error', role: 'alert' });
  const go = button(t('random.numbers.pick'), pickNow, 'btn btn-primary random-go');
  const set = (key) => (v) => { n[key] = v; if (Number.isInteger(v)) saveSettings(); error.textContent = ''; };

  async function pickNow() {
    const run = runId;
    const r = pickNumbers(n);
    if (r.error) { error.textContent = t(`random.numbers.error.${r.error}`); return; }
    error.textContent = '';
    go.disabled = true;
    const cells = r.values.map(() => h('span', { class: 'random-number' }));
    out.replaceChildren(...cells);
    out.classList.toggle('random-many', r.values.length > 6);
    if (!still()) {
      out.classList.add('random-rolling');
      for (let k = 0; k < 8; k++) {
        cells.forEach((c) => { c.textContent = String(randInt(r.min, r.max)); });
        await wait(55);
      }
      out.classList.remove('random-rolling');
    }
    cells.forEach((c, i) => { c.textContent = String(r.values[i]); });
    go.disabled = false;
    if (run !== runId) return;
    record('numbers', t('random.numbers.result', { min: r.min, max: r.max, values: r.values.join(', ') }));
  }

  const enter = (e) => { if (e.key === 'Enter') pickNow(); };
  const inputs = [
    field(t('random.numbers.min'), numberInput(n.min, set('min'), { onkeydown: enter })),
    field(t('random.numbers.max'), numberInput(n.max, set('max'), { onkeydown: enter })),
    field(t('random.numbers.count'), numberInput(n.count, set('count'), { min: 1, max: LIMITS.count, onkeydown: enter })),
  ];
  return {
    stage: stageOf(out, null, go),
    controls: [
      h('div', { class: 'random-row random-row-3' }, inputs),
      error,
      check(t('random.numbers.unique'), n.unique, (v) => { n.unique = v; saveSettings(); }),
      check(t('random.numbers.sort'), n.sort, (v) => { n.sort = v; saveSettings(); }),
    ],
  };
}

// Straws --------------------------------------------------------------

let round = null; // { names, lengths, pulled } kept while switching modes

function strawsMode() {
  const row = h('div', { class: 'random-straws' });
  const result = resultLine();
  const status = h('p', { class: 'random-hint' });
  const pullAll = button(t('random.straws.pullAll'), () => {
    row.querySelectorAll('.random-straw:not(.random-pulled)').forEach((b) => b.click());
  }, 'btn');
  const fresh = button(t('random.straws.draw'), () => { start(); draw(); }, 'btn btn-primary random-go');
  const list = listEditor('people', () => { start(); draw(); });

  function start() {
    const names = list.entries();
    round = { names, lengths: drawStraws(names.length), pulled: names.map(() => false), done: false };
  }
  const same = () => round && round.names.join('\n') === list.entries().join('\n');

  function draw() {
    const { names, lengths, pulled } = round;
    const n = names.length;
    result.textContent = '';
    if (n < 2) {
      row.replaceChildren(h('p', { class: 'random-hint' }, t('random.needTwo')));
      pullAll.disabled = true;
      status.textContent = '';
      return;
    }
    const done = pulled.every(Boolean);
    row.replaceChildren(...names.map((nm, i) => {
      const straw = h('span', { class: 'random-straw-body' });
      straw.style.setProperty('--len', pulled[i] ? (0.3 + (0.7 * (lengths[i] - 1)) / (n - 1)).toFixed(3) : '0.32');
      const label = pulled[i] ? t('random.straws.pulled', { name: nm, len: lengths[i], n }) : t('random.straws.pull', { name: nm });
      return h('button', {
        type: 'button', class: `random-straw${pulled[i] ? ' random-pulled' : ''}`,
        'aria-label': label, 'aria-disabled': pulled[i] ? 'true' : null, 'data-i': i,
        onclick: () => {
          if (round.pulled[i]) return;
          round.pulled[i] = true;
          const btn = row.querySelector(`[data-i="${i}"]`);
          btn.classList.add('random-pulled');
          btn.firstChild.style.setProperty('--len', (0.3 + (0.7 * (lengths[i] - 1)) / (n - 1)).toFixed(3));
          btn.setAttribute('aria-disabled', 'true');
          btn.setAttribute('aria-label', t('random.straws.pulled', { name: nm, len: lengths[i], n }));
          syncStatus();
          if (round.pulled.every(Boolean)) finish();
          else announce(t('random.straws.pulled', { name: nm, len: lengths[i], n }));
        },
      }, straw, h('span', { class: 'random-straw-name' }, nm), h('span', { class: 'random-straw-tag' }));
    }));
    if (done) markShortest();
    syncStatus();
  }
  function markShortest() {
    const i = round.lengths.indexOf(1);
    const btn = row.querySelector(`[data-i="${i}"]`);
    btn.classList.add('random-short');
    btn.lastChild.textContent = t('random.straws.short');
    result.textContent = t('random.straws.result', { name: round.names[i] });
  }
  function syncStatus() {
    const left = round.pulled.filter((p) => !p).length;
    status.textContent = left ? t('random.straws.left', { n: left }) : '';
    pullAll.disabled = left === 0;
  }
  async function finish() {
    if (round.done) return;
    round.done = true;
    const run = runId;
    await wait(still() ? 0 : 600);
    if (run !== runId) return;
    markShortest();
    record('straws', t('random.straws.result', { name: round.names[round.lengths.indexOf(1)] }));
  }

  if (!same()) start();
  draw();
  return {
    stage: [h('p', { class: 'random-hint' }, t('random.straws.hint')), ...stageOf(row, result, [fresh, pullAll]), status],
    controls: [list.el],
  };
}

// Coin ----------------------------------------------------------------

function coinMode() {
  const c = settings.coin;
  const coin = h('div', { class: 'random-coin' },
    h('span', { class: 'random-face random-heads' }, t('random.coin.heads')),
    h('span', { class: 'random-face random-tails' }, t('random.coin.tails')),
  );
  const result = resultLine();
  const tally = h('p', { class: 'random-tally' });
  const flip = button(t('random.coin.flip'), go, 'btn btn-primary random-go');
  let side = 'heads';
  const rest = (sd) => (sd === 'tails' ? 'rotateX(180deg)' : 'rotateX(0deg)');
  const sync = () => { tally.textContent = t('random.coin.tally', c); };

  async function go() {
    const run = runId;
    const next = flipCoin();
    flip.disabled = true;
    result.textContent = '';
    if (!still()) {
      const from = side === 'tails' ? 180 : 0;
      const to = 360 * 4 + (next === 'tails' ? 180 : 0);
      const anim = coin.animate([
        { transform: `translateY(0) rotateX(${from}deg)` },
        { transform: `translateY(-90px) rotateX(${(from + to) / 2}deg)`, offset: 0.45 },
        { transform: `translateY(0) rotateX(${to}deg)` },
      ], { duration: 1000, easing: 'cubic-bezier(0.3, 0.6, 0.4, 1)' });
      await anim.finished.catch(() => {});
    }
    side = next;
    coin.style.transform = rest(side);
    c[side]++;
    saveSettings();
    sync();
    flip.disabled = false;
    if (run !== runId) return;
    result.textContent = t(`random.coin.${side}`);
    record('coin', t(`random.coin.${side}`));
  }

  sync();
  coin.style.transform = rest(side);
  const reset = button(t('random.coin.reset'), () => { c.heads = 0; c.tails = 0; saveSettings(); sync(); }, 'btn');
  return {
    stage: stageOf(h('div', { class: 'random-coin-stage', 'aria-hidden': 'true' }, coin), result, flip),
    controls: [tally, reset],
  };
}

// Shuffle and teams -------------------------------------------------

function shuffleMode() {
  const out = h('ol', { class: 'random-order' });
  const error = h('p', { class: 'random-error', role: 'alert' });
  const go = button(t('random.shuffle.go'), () => {
    const entries = list.entries();
    if (entries.length < 2) { error.textContent = t('random.needTwo'); return; }
    error.textContent = '';
    const order = shuffle(entries);
    out.replaceChildren(...order.map((item, i) => {
      const li = h('li', {}, item);
      if (!still()) li.style.animationDelay = `${Math.min(i, 20) * 35}ms`;
      return li;
    }));
    record('shuffle', t('random.shuffle.result', { list: order.join(', ') }));
  }, 'btn btn-primary random-go');
  const list = listEditor('people', () => { error.textContent = ''; });
  return { stage: stageOf(out, error, go), controls: [list.el] };
}

function teamsMode() {
  const tm = settings.teams;
  const out = h('div', { class: 'random-teams' });
  const error = h('p', { class: 'random-error', role: 'alert' });
  const go = button(t('random.teams.go'), () => {
    const entries = list.entries();
    if (!Number.isInteger(tm.count) || tm.count < 2 || tm.count > LIMITS.teams) { error.textContent = t('random.teams.tooFew'); return; }
    if (entries.length < tm.count) { error.textContent = t('random.teams.tooFew'); return; }
    error.textContent = '';
    const teams = makeTeams(entries, tm.count);
    out.replaceChildren(...teams.map((team, i) => {
      const card = h('section', { class: 'random-team', 'aria-labelledby': `random-team-${i}` },
        h('h3', { class: 'random-team-name', id: `random-team-${i}` }, t('random.teams.team', { n: i + 1 })),
        h('ul', {}, team.map((m) => h('li', {}, m))),
      );
      if (!still()) card.style.animationDelay = `${i * 60}ms`;
      return card;
    }));
    record('teams', teams.map((team, i) => `${t('random.teams.team', { n: i + 1 })}: ${team.join(', ')}`).join('; '));
  }, 'btn btn-primary random-go');
  const list = listEditor('people', () => { error.textContent = ''; });
  const count = numberInput(tm.count, (v) => { tm.count = v; if (Number.isInteger(v)) saveSettings(); error.textContent = ''; }, { min: 2, max: LIMITS.teams });
  return { stage: stageOf(out, error, go), controls: [field(t('random.teams.count'), count), list.el] };
}

renderHistory();
setMode(mode);
