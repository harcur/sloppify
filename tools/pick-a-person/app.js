// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { initPage, guardStore } from '../../shared/page.js';
import { extendStrings, t } from '../../shared/i18n.js';
import { h } from '../../shared/dom.js';
import { icon } from '../../shared/icons.js';
import { sourceUrl } from '../../shared/config.js';
import { openStore } from '../../shared/storage.js';
import { strings } from './strings.js';
import { cleanNames, clampInt, MIN_PLAYERS, MAX_PLAYERS } from './pick.js';
import { s, setVibrate, buzz, colour } from './fx.js';
import { createBottle } from './bottle.js';
import { createFingers } from './fingers.js';
import { createWheel } from './wheel.js';
import { createStraws } from './straws.js';
import { createTeams } from './teams.js';

extendStrings(strings);

const TOOL_ID = 'pick-a-person';
const name = t(`${TOOL_ID}.name`);
const SOURCE_PATH = 'tools/pick-a-person/';
const narrow = matchMedia('(max-width: 719px)');
const { main } = initPage({ toolId: TOOL_ID, toolName: name, license: 'MIT', sourcePath: SOURCE_PATH, app: true });

// Saved: the mode in use, the players (a number or a list of names) and each
// mode's settings.
const store = openStore(TOOL_ID, { version: 1 });
const saving = await guardStore(store, name);
const saved = (key, fallback) => (saving ? store.get(key, fallback) : fallback);
const save = (key, value) => { if (saving) store.set(key, value); };

const MODES = ['bottle', 'fingers', 'wheel', 'straws', 'teams'];
const state = {
  mode: MODES.includes(saved('mode')) ? saved('mode') : 'bottle',
  source: saved('source') === 'names' ? 'names' : 'count',
  count: clampInt(saved('count'), MIN_PLAYERS, MAX_PLAYERS, 4),
  names: cleanNames(saved('names', [])),
};
const settings = saved('settings', {});
const settingsOf = (mode) => {
  if (!settings[mode] || typeof settings[mode] !== 'object') settings[mode] = {};
  return settings[mode];
};
const vibrateSetting = settingsOf('all');
setVibrate(vibrateSetting.vibrate !== false);

// Players: the names when there are at least two, otherwise numbers.
function players() {
  const names = state.source === 'names' && state.names.length >= MIN_PLAYERS;
  const labels = names ? [...state.names] : Array.from({ length: state.count }, (_, i) => String(i + 1));
  return { names, labels, count: labels.length };
}
// How a player is named in results: "Ada" or "player 3".
const who = (p, i) => (p.names ? p.labels[i] : t('pick-a-person.player', { n: i + 1 }));

// Layout ----------------------------------------------------------------

const announcer = h('p', { class: 'sr-only', 'aria-live': 'polite' });
const resultMain = h('span', { class: 'pp-result-main' });
const resultSub = h('span', { class: 'pp-result-sub' });
const result = h('p', { class: 'pp-result' }, resultMain, resultSub);
const stage = h('div', { class: 'pp-stage' });
const actions = h('div', { class: 'pp-actions' });
const moreBtn = h('button', { type: 'button', class: 'btn pp-more', 'aria-haspopup': 'dialog', onclick: () => sheet.showModal() }, t('pick-a-person.options'));

const ctx = {
  players,
  who,
  settings: settingsOf,
  saveSettings: () => save('settings', settings),
  say: (text) => { announcer.textContent = ''; announcer.textContent = text; },
  // Shows the result large on the stage, and announces it.
  result(main, sub = '', { announce = true } = {}) {
    resultMain.textContent = main ?? '';
    resultSub.textContent = sub;
    result.classList.toggle('is-on', !!main);
    result.classList.remove('pop');
    if (main) {
      void result.offsetWidth; // restart the pop animation
      result.classList.add('pop');
      if (announce) ctx.say(sub ? `${main}. ${sub}` : main);
    }
  },
  stage,
  buzz,
};

const MODE_ICONS = {
  bottle: '<path d="M10 2.5h4v4l2 3v12h-8v-12l2-3z"/><path d="M8 13h8"/>',
  fingers: '<path d="M6 5h5v5H6zM14 9h5v5h-5zM7 15h5v5H7z"/>',
  wheel: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"/>',
  straws: '<path d="M7 3v18M12 7v14M17 3v18"/>',
  teams: '<path d="M3 4h8v7H3zM13 4h8v7h-8zM3 13h8v7H3zM13 13h8v7h-8z"/>',
};
const modeBtns = MODES.map((m) => h('button', {
  type: 'button', class: 'pp-mode', 'data-mode': m, 'aria-pressed': 'false',
  onclick: () => setMode(m),
}, s('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false', class: 'pp-mode-icon' }), t(`pick-a-person.mode.${m}`)));
for (const b of modeBtns) b.firstChild.innerHTML = MODE_ICONS[b.dataset.mode];
const modeBar = h('div', { class: 'pp-modes', role: 'group', 'aria-label': t('pick-a-person.mode') }, modeBtns);

// Players panel
const countValue = h('output', { class: 'pp-count-value', 'aria-live': 'off' });
const minus = h('button', { type: 'button', class: 'btn pp-step', 'aria-label': t('pick-a-person.fewer'), onclick: () => setCount(state.count - 1) }, '−');
const plus = h('button', { type: 'button', class: 'btn pp-step', 'aria-label': t('pick-a-person.more'), onclick: () => setCount(state.count + 1) }, '+');
const countBlock = h('div', { class: 'pp-count', role: 'group', 'aria-labelledby': 'pp-count-label' },
  h('span', { id: 'pp-count-label', class: 'pp-label' }, t('pick-a-person.count')), minus, countValue, plus);

const nameInput = h('input', {
  type: 'text', id: 'pp-name', class: 'pp-input', maxlength: '200', autocomplete: 'off', enterkeyhint: 'done',
});
const nameForm = h('form', { class: 'pp-add', onsubmit: (e) => { e.preventDefault(); addNames(nameInput.value); } },
  h('label', { for: 'pp-name', class: 'pp-label' }, t('pick-a-person.addLabel')),
  h('div', { class: 'pp-add-row' }, nameInput, h('button', { type: 'submit', class: 'btn' }, t('pick-a-person.add'))),
);
const chips = h('ul', { class: 'pp-chips', 'aria-label': t('pick-a-person.list') });
const namesNote = h('p', { class: 'pp-note' });
const clearBtn = h('button', { type: 'button', class: 'btn btn-link', onclick: () => setNames([]) }, t('pick-a-person.clear'));
const namesBlock = h('div', { class: 'pp-names' }, nameForm, namesNote, chips, clearBtn);

const sourceBtns = ['count', 'names'].map((v) => h('button', {
  type: 'button', class: 'seg-btn', 'data-v': v, onclick: () => setSource(v),
}, t(`pick-a-person.source.${v}`)));
const optionsBox = h('div', { class: 'pp-mode-options' });
const helpBox = h('div', { class: 'pp-help' });
const vibrateBox = navigator.vibrate ? h('label', { class: 'pp-check' },
  h('input', {
    type: 'checkbox', checked: vibrateSetting.vibrate !== false,
    onchange: (e) => { vibrateSetting.vibrate = e.target.checked; setVibrate(e.target.checked); ctx.saveSettings(); },
  }), t('pick-a-person.vibrate')) : null;

const side = h('div', { class: 'pp-side' },
  h('section', { class: 'pp-section', 'aria-labelledby': 'pp-players-h' },
    h('h2', { class: 'pp-h2', id: 'pp-players-h' }, t('pick-a-person.players')),
    h('div', { class: 'seg pp-seg', role: 'group', 'aria-labelledby': 'pp-players-h' }, sourceBtns),
    countBlock, namesBlock,
  ),
  h('section', { class: 'pp-section', 'aria-labelledby': 'pp-settings-h' },
    h('h2', { class: 'pp-h2', id: 'pp-settings-h' }, t('pick-a-person.settings')),
    optionsBox, vibrateBox,
  ),
  h('section', { class: 'pp-section', 'aria-labelledby': 'pp-help-h' },
    h('h2', { class: 'pp-h2', id: 'pp-help-h' }, t('pick-a-person.help')),
    helpBox,
  ),
);

const play = h('div', { class: 'pp-play' }, modeBar, h('div', { class: 'pp-stage-wrap' }, stage, result), actions);
const layout = h('div', { class: 'pp-layout' }, play, side);

// On narrow screens the page fills the screen; the side panel and the
// footer's text and source link move into a sheet.
const sheetBody = h('div', { class: 'pp-sheet-body' });
const sheet = h('dialog', { class: 'dialog pp-sheet', 'aria-labelledby': 'pp-sheet-title' },
  h('div', { class: 'pp-sheet-head' },
    h('h2', { class: 'dialog-title', id: 'pp-sheet-title' }, t('pick-a-person.options')),
    h('button', { type: 'button', class: 'btn', onclick: () => sheet.close() }, t('pick-a-person.close')),
  ),
  sheetBody,
  h('div', { class: 'pp-sheet-foot' },
    h('p', {}, t('footer.text')),
    h('p', {}, h('a', { href: sourceUrl(SOURCE_PATH), rel: 'noreferrer' }, icon('source'), t('footer.source'))),
  ),
);
sheet.addEventListener('close', () => { if (moreBtn.isConnected) moreBtn.focus(); });

function placeSide() {
  if (narrow.matches) sheetBody.append(side);
  else {
    if (sheet.open) sheet.close();
    layout.append(side);
  }
}

main.append(h('h1', { class: 'tool-title' }, name), layout, sheet, announcer);

// Modes -----------------------------------------------------------------

const makers = { bottle: createBottle, fingers: createFingers, wheel: createWheel, straws: createStraws, teams: createTeams };
const built = {};
let current = null;

function setMode(m) {
  if (current && current.id === m) return;
  current?.leave();
  state.mode = m;
  save('mode', m);
  current = built[m] ??= { id: m, ...makers[m](ctx) };
  stage.dataset.mode = m;
  stage.replaceChildren(current.stage);
  actions.replaceChildren(...current.actions, moreBtn);
  optionsBox.replaceChildren(...(current.options ? [current.options] : []));
  optionsBox.closest('.pp-section').hidden = !current.options && !vibrateBox;
  helpBox.replaceChildren(...t(`pick-a-person.help.${m}`).split('\n').map((p) => h('p', {}, p)));
  for (const b of modeBtns) b.setAttribute('aria-pressed', String(b.dataset.mode === m));
  ctx.result(null);
  current.enter();
}

// Players ---------------------------------------------------------------

function renderPlayers() {
  for (const b of sourceBtns) b.setAttribute('aria-pressed', String(b.dataset.v === state.source));
  countBlock.hidden = state.source !== 'count';
  namesBlock.hidden = state.source !== 'names';
  countValue.textContent = String(state.count);
  minus.disabled = state.count <= MIN_PLAYERS;
  plus.disabled = state.count >= MAX_PLAYERS;
  chips.replaceChildren(...state.names.map((n, i) => {
    const chip = h('button', { type: 'button', class: 'pp-chip', 'aria-label': t('pick-a-person.remove', { name: n }), onclick: () => removeName(i) },
      h('span', { class: 'pp-chip-dot', 'aria-hidden': 'true' }), n, h('span', { class: 'pp-chip-x', 'aria-hidden': 'true' }, '×'));
    chip.style.setProperty('--c', colour(i));
    return h('li', {}, chip);
  }));
  chips.hidden = !state.names.length;
  clearBtn.hidden = !state.names.length;
  const n = state.names.length;
  namesNote.textContent = n >= MAX_PLAYERS ? t('pick-a-person.names.full', { max: MAX_PLAYERS })
    : n < MIN_PLAYERS ? t('pick-a-person.names.few', { count: state.count })
      : t('pick-a-person.names.count', { n });
}

function playersChanged() {
  renderPlayers();
  current?.playersChanged();
}

function setSource(v) {
  state.source = v;
  save('source', v);
  playersChanged();
}

function setCount(n) {
  state.count = clampInt(n, MIN_PLAYERS, MAX_PLAYERS);
  save('count', state.count);
  playersChanged();
  ctx.say(t('pick-a-person.countSaid', { n: state.count }));
}

function setNames(list) {
  state.names = cleanNames(list);
  save('names', state.names);
  playersChanged();
}

// Several names can be typed or pasted at once, split by commas or lines.
function addNames(text) {
  const before = state.names.length;
  setNames([...state.names, ...text.split(/[,\n;]/)]);
  const added = state.names.length - before;
  if (added) {
    nameInput.value = '';
    ctx.say(added === 1 ? t('pick-a-person.added', { name: state.names.at(-1) }) : t('pick-a-person.addedMany', { n: added }));
  }
  nameInput.focus();
}

function removeName(i) {
  const [gone] = state.names.splice(i, 1);
  setNames(state.names);
  ctx.say(t('pick-a-person.removed', { name: gone }));
  (chips.children[Math.min(i, chips.children.length - 1)]?.firstChild ?? nameInput).focus();
}

// Start -------------------------------------------------------------------

narrow.addEventListener('change', placeSide);
document.addEventListener('visibilitychange', () => { if (document.hidden) current?.skip?.(); });
placeSide();
renderPlayers();
setMode(state.mode);
