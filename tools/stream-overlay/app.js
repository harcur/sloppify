// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { initPage, guardStore } from '../../shared/page.js';
import { extendStrings, t } from '../../shared/i18n.js';
import { h } from '../../shared/dom.js';
import { openStore } from '../../shared/storage.js';
import { confirmDialog } from '../../shared/dialog.js';
import { toast } from '../../shared/toast.js';
import { optionsSheet } from '../../shared/sheet.js';
import { strings } from './strings.js';
import {
  SIZES, KINDS, EFFECT_ORDER, STYLE_ORDER, PALETTES, RANGES, MAX_ZONES, PRESET_NAMES,
  newZone, fitZone, normalize, resize, preset, usesFront, encode,
} from './design.js';
import { renderLayers } from './renderer.js';

extendStrings(strings);

const TOOL_ID = 'stream-overlay';
const SOURCE_PATH = 'tools/stream-overlay/';
const T = (key, vars) => t(`${TOOL_ID}.${key}`, vars);
const name = T('name');
const { main } = initPage({ toolId: TOOL_ID, toolName: name, license: 'MIT', sourcePath: SOURCE_PATH, app: true });
main.classList.add('so-main');
const narrow = matchMedia('(max-width: 719px)');

// Saved: the design.
const store = openStore(TOOL_ID, { version: 1 });
const saving = await guardStore(store, name);
const saved = saving ? store.get('design') : null;
let design = saved ? normalize(saved) : preset('gameplay', '1920x1080', newSeed());
let sel = design.zones[0]?.id ?? 0;
// edit or preview; in preview, which layers show. Peek is preview while Space is held.
let mode = 'edit';
let show = 'scene';
let peek = false;
// The open settings tab: always one on wide screens, none (the stage gets the room) allowed on phones.
let tab = 'zones';
let phoneTab = 'zones';

function newSeed() { return Math.floor(Math.random() * 2 ** 31); }
const byId = (id) => design.zones.find((z) => z.id === id);
const zoneName = (z) => {
  const same = design.zones.filter((o) => o.kind === z.kind);
  const kind = T(`kind.${z.kind}`);
  return same.length > 1 ? `${kind} ${same.indexOf(z) + 1}` : kind;
};
const describe = (z) => T('zone.label', { name: zoneName(z), x: z.x, y: z.y, w: z.w, h: z.h });
const previewing = () => mode === 'preview' || peek;

// Icons: stroke drawings on a 24px grid, static and trusted.
const ICONS = {
  undo: '<path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3"/>',
  full: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  copy: '<rect x="8" y="8" width="12" height="12"/><path d="M16 8V4H4v12h4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  zones: '<rect x="3" y="5" width="8" height="6"/><rect x="13" y="9" width="8" height="10"/>',
  art: '<path d="M3 17c4-8 6-8 9-2s5 6 9-2"/><path d="M3 11c4-6 6-6 9-1s5 5 9-1"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  use: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  more: '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3" stroke-linecap="round"/>',
};
const ico = (n) => {
  const tpl = document.createElement('template');
  tpl.innerHTML = `<svg class="icon so-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[n]}</svg>`;
  return tpl.content.firstElementChild;
};
const iconBtn = (n, label, onclick, cls = '') => h('button', { type: 'button', class: `so-ibtn ${cls}`, 'aria-label': label, title: label, onclick }, ico(n));

// Controls -----------------------------------------------------------

let uid = 0;
// A labelled field. `target` is the element the label names, when `el` wraps it.
function control(label, el, extra, target = el) {
  target.id ||= `so-${++uid}`;
  return h('div', { class: 'so-field' }, h('label', { for: target.id }, label), el, extra);
}
const dropdown = (options, onchange, attrs = {}) => h('select', { class: 'so-input', onchange: (e) => onchange(e.target.value), ...attrs },
  options.map(([value, label]) => h('option', { value }, label)));
const numberInput = (onchange) => h('input', { type: 'number', class: 'so-input', inputmode: 'numeric', onchange: (e) => onchange(e.target.value) });

// A range slider with its value shown next to its label.
function slider(key, label, format, oninput) {
  const [min, max] = RANGES[key];
  const out = h('output', { class: 'so-out' });
  const input = h('input', { type: 'range', class: 'so-range', min, max, step: 1 });
  input.addEventListener('input', () => { out.textContent = format(+input.value); oninput(+input.value, false); });
  input.addEventListener('change', () => oninput(+input.value, true));
  const wrap = control(label, input);
  wrap.firstChild.append(' ', out);
  return { wrap, set(v) { input.value = v; out.textContent = format(v); }, input };
}
const px = (n) => T('px', { n });
const plain = (n) => String(n);

// Buttons that act as a set of choices: one of them pressed.
function choices(label, keys, text, onpick, cls = 'so-chips') {
  const labelId = `so-${++uid}`;
  const buttons = keys.map((k) => h('button', { type: 'button', class: 'so-chip', 'data-key': k, 'aria-pressed': 'false', onclick: () => onpick(k) }, text(k)));
  const group = h('div', { class: 'so-field', role: 'group', 'aria-labelledby': labelId },
    h('span', { class: 'so-label', id: labelId }, label), h('div', { class: cls }, buttons));
  return { group, set: (v) => { for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.key === v)); } };
}

// Stage --------------------------------------------------------------

const backCv = h('canvas', { class: 'so-layer', 'aria-hidden': 'true' });
const frontCv = h('canvas', { class: 'so-layer', 'aria-hidden': 'true' });
const mocks = h('div', { class: 'so-mocks', 'aria-hidden': 'true' });
const handles = h('div', { class: 'so-handles' });

// The selected zone's toolbar: next to the zone on wide screens, docked under the stage on phones.
const ctxEffect = dropdown(EFFECT_ORDER.map((k) => [k, T(`effect.${k}`)]), (v) => setZone('effect', v), { 'aria-label': T('effect.short'), title: T('effect') });
ctxEffect.classList.add('so-ctx-input');
const ctxPlace = h('button', { type: 'button', class: 'so-ctx-place', 'aria-pressed': 'false', 'aria-label': T('place.toggleLabel'), title: T('place.toggleLabel'),
  onclick: () => setZone('place', byId(sel)?.place === 'under' ? 'over' : 'under') }, T('place.toggle'));
const ctx = h('div', { class: 'so-ctx', role: 'toolbar' },
  ctxEffect, ctxPlace, h('span', { class: 'so-ctx-sep', 'aria-hidden': 'true' }),
  iconBtn('copy', T('zone.duplicate'), () => duplicateZone(sel, 'stage')),
  iconBtn('trash', T('zone.remove'), () => removeZone(sel, 'stage'), 'so-del'));

const stage = h('div', { class: 'so-stage', role: 'group', 'aria-describedby': 'so-stage-help' }, backCv, mocks, frontCv, handles, ctx);
const busy = h('span', { class: 'so-busy', hidden: true }, T('drawing'));
const errorMsg = h('p', { class: 'so-error', role: 'alert', hidden: true }, T('error'));

const modeBtns = ['edit', 'preview'].map((m) => h('button', { type: 'button', 'data-mode': m, 'aria-pressed': 'false', onclick: () => setMode(m) }, T(`mode.${m}`)));
const showGroup = () => h('div', { class: 'so-seg so-show', role: 'group', 'aria-label': T('show') },
  ['scene', 'back', 'front'].map((s) => h('button', { type: 'button', 'data-show': s, 'aria-pressed': 'false', onclick: () => { show = s; syncMode(); } }, T(`show.${s}`))));
const undoBtn = iconBtn('undo', T('undo'), () => undo());
const redoBtn = iconBtn('redo', T('redo'), () => redo());
const fsBtn = iconBtn('full', T('fullscreen'), () => enterFullscreen());
const seedBtn = h('button', { type: 'button', class: 'btn so-seed', onclick: newPattern }, T('seed'));
const barShow = showGroup();
const bar = h('div', { class: 'so-bar', role: 'toolbar', 'aria-label': T('stageTools') },
  h('div', { class: 'so-seg so-mode', role: 'group', 'aria-label': T('mode') }, modeBtns),
  barShow, busy, h('span', { class: 'so-grow' }), undoBtn, redoBtn, seedBtn, fsBtn);

// Full screen: the stage alone, in preview, with a slim bar that fades when the pointer rests.
const fsExit = h('button', { type: 'button', class: 'btn', onclick: () => exitFullscreen() }, T('fullscreen.exit'));
const fsBar = h('div', { class: 'so-fsbar' }, showGroup(), fsExit);
const wrap = h('div', { class: 'so-wrap' }, fsBar, stage);
const dock = h('div', { class: 'so-dock' });

const view = h('div', { class: 'so-view' },
  bar, wrap, dock,
  h('p', { class: 'sr-only', id: 'so-stage-help' }, T('stageHelp')),
  errorMsg,
);

// Zones tab ------------------------------------------------------------

const zoneList = h('ul', { class: 'so-zlist', 'aria-label': T('zones') });
const addMenu = h('div', { class: 'so-add-menu', id: 'so-add-menu', hidden: true,
  onkeydown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeAddMenu(true); } } },
KINDS.map((k) => h('button', { type: 'button', 'data-kind': k, onclick: () => addZone(k) }, T(`kind.${k}`))));
const addBtn = h('button', { type: 'button', class: 'btn', 'aria-expanded': 'false', 'aria-controls': 'so-add-menu',
  onclick: () => (addMenu.hidden ? openAddMenu() : closeAddMenu(false)) }, T('zone.add'));
const maxNote = h('p', { class: 'so-note', hidden: true }, T('zone.max'));
const noZones = h('p', { class: 'so-note' }, T('zone.none'));

const zf = {};
const setZone = (key, value, commit = true) => {
  const z = byId(sel);
  if (!z) return;
  Object.assign(z, fitZone({ ...z, [key]: value }, design));
  syncZoneInputs();
  placeZone(z);
  if (key === 'kind' || key === 'effect' || key === 'place') renderZones();
  if (commit) changed(); else queueRender(true);
};
zf.title = h('h3', { class: 'so-h3' });
zf.size = h('span', { class: 'so-out' });
zf.effect = choices(T('effect'), EFFECT_ORDER, (k) => T(`effect.${k}`), (k) => setZone('effect', k));
zf.hint = h('p', { class: 'so-hint', 'aria-live': 'polite' });
zf.place = choices(T('place'), ['over', 'under'], (k) => T(`place.${k}`), (k) => setZone('place', k), 'so-seg so-seg-wide');
zf.kind = dropdown(KINDS.map((k) => [k, T(`kind.${k}`)]), (v) => setZone('kind', v));
for (const k of ['x', 'y', 'w', 'h']) zf[k] = numberInput((v) => setZone(k, Math.round(+v)));
zf.r = slider('r', T('r'), px, (v, c) => setZone('r', v, c));
zf.frame = slider('frame', T('frame'), px, (v, c) => setZone('frame', v, c));
zf.fuzz = slider('fuzz', T('fuzz'), px, (v, c) => setZone('fuzz', v, c));
zf.power = slider('power', T('power'), plain, (v, c) => setZone('power', v, c));

const zoneEditor = h('div', { class: 'so-editor' },
  h('div', { class: 'so-editor-head' }, zf.title, zf.size),
  zf.effect.group, zf.hint,
  zf.place.group,
  zf.power.wrap,
  h('details', { class: 'so-more' }, h('summary', {}, T('zone.shape')), zf.r.wrap, zf.frame.wrap, zf.fuzz.wrap),
  h('details', { class: 'so-more' }, h('summary', {}, T('zone.position')),
    h('div', { class: 'so-grid' }, ['x', 'y', 'w', 'h'].map((k) => control(T(k), zf[k]))),
    control(T('kind'), zf.kind)),
);

// Art tab ---------------------------------------------------------------

const setArt = (key, value, commit = true) => { design[key] = value; syncArt(); if (commit) changed(); else queueRender(true); };
const swatch = (k) => {
  const dots = h('span', { class: 'so-dots', 'aria-hidden': 'true' });
  const p = PALETTES[k];
  for (const c of [p.bg, ...p.colors.slice(0, 3)]) {
    const dot = h('i');
    dot.style.background = c;
    dots.append(dot);
  }
  return [dots, T(`palette.${k}`)];
};
const af = {
  style: choices(T('style'), STYLE_ORDER, (k) => T(`style.${k}`), (k) => setArt('style', k)),
  palette: choices(T('palette'), Object.keys(PALETTES), swatch, (k) => setArt('palette', k), 'so-swatches'),
  density: slider('density', T('density'), plain, (v, c) => setArt('density', v, c)),
  reach: slider('reach', T('reach'), (n) => (n >= 100 ? T('reach.all') : T('percent', { n })), (v, c) => setArt('reach', v, c)),
  fill: h('input', { type: 'checkbox', id: 'so-fill', onchange: (e) => setArt('fill', e.target.checked) }),
};

// Use it tab -------------------------------------------------------------

const links = {};
const linkRow = (layer) => {
  const input = h('input', { type: 'text', class: 'so-input so-link', readonly: true, spellcheck: 'false' });
  links[layer] = input;
  const copy = h('button', { type: 'button', class: 'btn', 'aria-label': T(`copy.${layer}`), onclick: () => copyLink(input) }, T('copy'));
  return control(T(`link.${layer}`), h('div', { class: 'so-row' }, input, copy), null, input);
};
const downloads = {};
for (const layer of ['back', 'front']) {
  downloads[layer] = h('button', { type: 'button', class: 'btn', onclick: () => download(layer) }, T(`download.${layer}`));
}
const frontEmpty = h('p', { class: 'so-note' }, T('frontEmpty'));
const stepBack = h('li');
const stepFront = h('li', {}, T('step.front'));

// Canvas size and starting layouts: last in Use it on wide screens, in the options sheet on phones.
const sizeSelect = dropdown(Object.entries(SIZES).map(([k, [w, hh]]) => [k, T(hh > w ? 'size.tall' : 'size.wide', { w, h: hh })]), (v) => {
  design = resize(design, v);
  sel = design.zones[0]?.id ?? 0;
  rebuild();
  changed();
});
const presetSelect = dropdown(PRESET_NAMES.map((k) => [k, T(`preset.${k}`)]), () => {});
const layoutGroup = h('section', { class: 'so-section so-layout-group', 'aria-labelledby': 'so-h-layout' },
  h('h3', { class: 'so-h3', id: 'so-h-layout' }, T('layout')),
  control(T('size'), sizeSelect),
  h('div', { class: 'so-row' }, control(T('preset'), presetSelect), h('button', { type: 'button', class: 'btn', onclick: usePreset }, T('preset.use'))));

async function usePreset() {
  const key = presetSelect.value;
  if (design.zones.length) {
    const ok = await confirmDialog({
      title: T('preset.title'),
      body: T('preset.body', { name: T(`preset.${key}`) }),
      confirmLabel: T('preset.ok'),
    });
    if (!ok) return;
  }
  design = preset(key, design.size, design.seed);
  sel = design.zones[0]?.id ?? 0;
  options.close();
  rebuild();
  changed();
}

// Panel: tabs on wide screens, the tool row on phones -------------------

const TABS = ['zones', 'art', 'use'];
const panels = {
  zones: h('div', {}, zoneList, h('div', { class: 'so-add' }, addBtn, addMenu), maxNote, noZones, zoneEditor,
    h('p', { class: 'so-hint so-keys' }, T('keys'))),
  art: h('div', {}, af.style.group, af.palette.group, af.density.wrap, af.reach.wrap,
    h('label', { class: 'so-check', for: 'so-fill' }, af.fill, T('fill')),
    h('button', { type: 'button', class: 'btn so-seed-panel', onclick: newPattern }, T('seed'))),
  use: h('div', {},
    h('div', { class: 'so-downloads' }, downloads.back, downloads.front),
    frontEmpty,
    linkRow('back'), linkRow('front'),
    h('ol', { class: 'so-steps' }, stepBack, h('li', {}, T('step.content')), stepFront, h('li', {}, T('step.link')))),
};
const tabBtns = {};
for (const k of TABS) {
  tabBtns[k] = h('button', { type: 'button', role: 'tab', id: `so-tab-${k}`, 'aria-controls': `so-panel-${k}`, onclick: () => { tab = k; syncTabs(); } }, T(k));
  Object.assign(panels[k], { id: `so-panel-${k}`, className: 'so-tabpanel' });
  panels[k].setAttribute('role', 'tabpanel');
  panels[k].setAttribute('aria-labelledby', `so-tab-${k}`);
}
const tabList = h('div', { class: 'so-tabs', role: 'tablist', 'aria-label': T('options'),
  onkeydown: (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    tab = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length];
    syncTabs();
    tabBtns[tab].focus();
  } }, TABS.map((k) => tabBtns[k]));
const panel = h('div', { class: 'so-panel' }, tabList, TABS.map((k) => panels[k]));

const toolBtn = (iconName, label, onclick) => h('button', { type: 'button', class: 'so-tool', 'aria-pressed': 'false', onclick }, ico(iconName), h('span', {}, label));
const tools = {
  zones: toolBtn('zones', T('zones'), () => togglePhoneTab('zones')),
  art: toolBtn('art', T('art'), () => togglePhoneTab('art')),
  preview: toolBtn('eye', T('mode.preview'), () => setMode(mode === 'preview' ? 'edit' : 'preview')),
  use: toolBtn('use', T('use'), () => togglePhoneTab('use')),
};
const moreBtn = h('button', { type: 'button', class: 'so-tool', 'aria-haspopup': 'dialog', onclick: () => options.open() }, ico('more'), h('span', {}, T('more')));
const toolRow = h('nav', { class: 'so-tools', 'aria-label': T('tools') }, tools.zones, tools.art, tools.preview, tools.use, moreBtn);
const options = optionsSheet({ title: T('options'), sourcePath: SOURCE_PATH, returnFocus: moreBtn });

const stateLine = h('p', { class: 'so-state', 'aria-live': 'polite' });

main.append(
  h('h1', { class: 'tool-title' }, name),
  stateLine,
  h('p', { class: 'so-intro' }, T('intro')),
  h('div', { class: 'so-layout' }, view, panel),
  toolRow,
  options.sheet,
);

// Syncing the page with the design ------------------------------------

function pct(el, z) {
  el.style.left = `${(z.x / design.w) * 100}%`;
  el.style.top = `${(z.y / design.h) * 100}%`;
  el.style.width = `${(z.w / design.w) * 100}%`;
  el.style.height = `${(z.h / design.h) * 100}%`;
}

function placeZone(z) {
  const btn = handles.querySelector(`[data-id="${z.id}"]`);
  const mock = mocks.querySelector(`[data-id="${z.id}"]`);
  if (!btn) return;
  pct(btn, z);
  pct(mock, z);
  const radius = `${(Math.min(z.r, z.w / 2, z.h / 2) / design.w) * 100}cqw`;
  btn.style.borderRadius = mock.style.borderRadius = radius;
  btn.setAttribute('aria-label', describe(z));
  if (z.id === sel) placeCtx();
}

function renderZones() {
  handles.replaceChildren();
  mocks.replaceChildren();
  zoneList.replaceChildren();
  for (const z of design.zones) {
    const label = zoneName(z);
    handles.append(h('button', { type: 'button', class: 'so-zone', 'data-id': z.id, 'aria-pressed': String(z.id === sel) },
      h('span', { class: 'so-zone-name', 'aria-hidden': 'true' }, label),
      h('span', { class: 'so-grip', 'aria-hidden': 'true' })));
    mocks.append(h('div', { class: 'so-mock', 'data-id': z.id, 'data-name': label }));
    zoneList.append(h('li', { class: 'so-zitem', 'data-id': z.id },
      h('button', { type: 'button', class: 'so-zrow', 'data-id': z.id, 'aria-pressed': String(z.id === sel), onclick: () => select(z.id) },
        h('span', { class: 'so-zname' }, label),
        h('span', { class: 'so-zmeta' }, `${T(`effect.${z.effect}`)} · ${T(`place.short.${z.place}`)}`)),
      iconBtn('x', T('zone.removeNamed', { name: label }), () => removeZone(z.id, 'list'), 'so-del')));
    placeZone(z);
  }
  const full = design.zones.length >= MAX_ZONES;
  addBtn.disabled = full;
  if (full) closeAddMenu(false);
  maxNote.hidden = !full;
  zoneList.hidden = !design.zones.length;
  const n = design.zones.length;
  stateLine.textContent = `${name} · ${n === 1 ? T('state.one') : T('state.many', { n })}`;
}

function select(id) {
  sel = id;
  for (const el of document.querySelectorAll('.so-zone, .so-zrow')) el.setAttribute('aria-pressed', String(+el.dataset.id === sel));
  syncZoneInputs();
  placeCtx();
}

function syncZoneInputs() {
  const z = byId(sel);
  zoneEditor.hidden = !z;
  noZones.hidden = !!design.zones.length;
  if (!z) return;
  zf.title.textContent = zoneName(z);
  zf.size.textContent = T('zone.size', { w: z.w, h: z.h });
  zf.effect.set(z.effect);
  zf.hint.textContent = T(`hint.${z.effect}`);
  zf.place.set(z.place);
  zf.kind.value = z.kind;
  for (const k of ['x', 'y', 'w', 'h']) {
    zf[k].value = z[k];
    zf[k].min = 0;
    zf[k].max = k === 'x' || k === 'w' ? design.w : design.h;
  }
  for (const k of ['r', 'frame', 'fuzz', 'power']) zf[k].set(z[k]);
  ctxEffect.value = z.effect;
  ctxPlace.setAttribute('aria-pressed', String(z.place === 'under'));
  ctx.setAttribute('aria-label', T('zone.toolbar', { name: zoneName(z) }));
}

// The toolbar sits above the zone, or below it when there's no room, kept inside the stage.
function placeCtx() {
  const z = byId(sel);
  ctx.hidden = !z || previewing();
  if (ctx.hidden || narrow.matches) return;
  const k = stage.clientWidth / design.w;
  const sw = stage.clientWidth;
  const sh = stage.clientHeight;
  const bw = ctx.offsetWidth;
  const bh = ctx.offsetHeight;
  let top = z.y * k - bh - 6;
  if (top < 4) top = (z.y + z.h) * k + 6;
  if (top + bh > sh - 4) top = Math.max(4, z.y * k + 4);
  ctx.style.top = `${top}px`;
  ctx.style.left = `${Math.max(4, Math.min(z.x * k, sw - bw - 4))}px`;
}

function syncArt() {
  af.style.set(design.style);
  af.palette.set(design.palette);
  sizeSelect.value = design.size;
  af.density.set(design.density);
  af.reach.set(design.reach);
  af.fill.checked = design.fill;
  stage.style.setProperty('--ar', String(design.w / design.h));
  stage.setAttribute('aria-label', T('stage', { w: design.w, h: design.h }));
  stepBack.textContent = T('step.back', { w: design.w, h: design.h });
}

function syncOutput() {
  const front = usesFront(design);
  const data = encode(design);
  for (const layer of ['back', 'front']) links[layer].value = new URL(`view.html#${layer}.${data}`, location.href).href;
  downloads.front.disabled = !front;
  frontEmpty.hidden = front;
  stepFront.hidden = !front;
}

function syncMode() {
  const on = previewing();
  stage.classList.toggle('so-preview', on);
  stage.classList.toggle('so-show-back', on && show === 'back');
  stage.classList.toggle('so-show-front', on && show === 'front');
  for (const b of modeBtns) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  for (const b of document.querySelectorAll('[data-show]')) b.setAttribute('aria-pressed', String(b.dataset.show === show));
  barShow.hidden = mode !== 'preview';
  tools.preview.setAttribute('aria-pressed', String(mode === 'preview'));
  placeCtx();
}

function syncTabs() {
  const open = narrow.matches ? phoneTab : tab;
  for (const k of TABS) {
    panels[k].hidden = k !== open;
    tabBtns[k].setAttribute('aria-selected', String(k === tab));
    tabBtns[k].tabIndex = k === tab ? 0 : -1;
    if (tools[k]) tools[k].setAttribute('aria-pressed', String(k === phoneTab));
  }
  main.classList.toggle('so-panel-closed', narrow.matches && !phoneTab);
}

function togglePhoneTab(k) {
  phoneTab = phoneTab === k ? null : k;
  syncTabs();
}

function syncHistory() {
  undoBtn.disabled = !past.length;
  redoBtn.disabled = !future.length;
}

// Phones: the zone toolbar docks under the stage, and the canvas size and layouts move to the options sheet.
function arrange() {
  if (narrow.matches) {
    dock.append(ctx);
    options.body.append(layoutGroup);
  } else {
    stage.append(ctx);
    panels.use.append(layoutGroup);
    options.close();
  }
  syncTabs();
  placeCtx();
}
narrow.addEventListener('change', arrange);

function rebuild() {
  renderZones();
  select(sel);
  syncArt();
  syncOutput();
  syncMode();
  syncHistory();
  queueRender();
}

// Undo history: a copy of the design before each committed change, this visit only.
const past = [];
const future = [];
let committed = JSON.stringify(design);

function record() {
  const now = JSON.stringify(design);
  if (now === committed) return;
  past.push(committed);
  if (past.length > 50) past.shift();
  future.length = 0;
  committed = now;
  syncHistory();
}

function step(from, to, msg) {
  if (!from.length) return;
  to.push(committed);
  committed = from.pop();
  design = JSON.parse(committed);
  if (!byId(sel)) sel = design.zones[0]?.id ?? 0;
  rebuild();
  saveSoon();
  say(msg);
}
const undo = () => step(past, future, T('undone'));
const redo = () => step(future, past, T('redone'));

let saveTimer = 0;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    store.set('design', design);
    syncOutput();
  }, 250);
}

function changed() {
  record();
  queueRender();
  saveSoon();
}

const announcer = h('p', { class: 'sr-only', 'aria-live': 'polite' });
main.append(announcer);
const say = (msg) => { announcer.textContent = msg; };

// Modes and full screen -------------------------------------------------

function setMode(m) {
  // Zones can't be focused in preview, so focus goes to the switch.
  const fromZone = document.activeElement?.closest?.('.so-zone');
  mode = m;
  syncMode();
  if (fromZone && m === 'preview') (narrow.matches ? tools.preview : modeBtns[1]).focus();
}

let fullscreen = false;
let modeBefore = 'edit';
let idleTimer = 0;
function wake() {
  fsBar.classList.remove('so-idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => fsBar.classList.add('so-idle'), 2000);
}
function enterFullscreen() {
  if (fullscreen) return;
  fullscreen = true;
  modeBefore = mode;
  setMode('preview');
  // The exit button only shows once the stage is full screen, so focus it then.
  const shown = () => { fsExit.focus(); wake(); };
  const fallback = () => { wrap.classList.add('so-fakefs'); shown(); };
  if (wrap.requestFullscreen) wrap.requestFullscreen().then(shown, fallback);
  else fallback();
}
function exitFullscreen() {
  if (document.fullscreenElement === wrap) { document.exitFullscreen(); return; }
  leftFullscreen();
}
function leftFullscreen() {
  if (!fullscreen) return;
  fullscreen = false;
  wrap.classList.remove('so-fakefs');
  setMode(modeBefore);
  fsBtn.focus();
}
document.addEventListener('fullscreenchange', () => { if (document.fullscreenElement !== wrap) leftFullscreen(); });
wrap.addEventListener('pointermove', () => { if (fullscreen) wake(); });
fsBar.addEventListener('focusin', wake);

// Editing zones -----------------------------------------------------

function openAddMenu() {
  addMenu.hidden = false;
  addBtn.setAttribute('aria-expanded', 'true');
  addMenu.querySelector('button').focus();
}
function closeAddMenu(focus) {
  addMenu.hidden = true;
  addBtn.setAttribute('aria-expanded', 'false');
  if (focus) addBtn.focus();
}
document.addEventListener('click', (e) => { if (!addMenu.hidden && !e.target.closest('.so-add')) closeAddMenu(false); });

const nextId = () => Math.max(0, ...design.zones.map((o) => o.id)) + 1;
function insert(z, from) {
  z.id = nextId();
  design.zones.push(z);
  sel = z.id;
  renderZones();
  select(z.id);
  changed();
  say(T('say.added', { name: zoneName(z) }));
  (from === 'list' && narrow.matches ? zoneList.querySelector(`.so-zrow[data-id="${z.id}"]`) : handles.querySelector(`[data-id="${z.id}"]`))?.focus();
}

function addZone(kind) {
  closeAddMenu(false);
  if (design.zones.length >= MAX_ZONES) return;
  if (mode === 'preview') setMode('edit');
  insert(newZone(kind, design), 'list');
}

function duplicateZone(id, from) {
  const z = byId(id);
  if (!z || design.zones.length >= MAX_ZONES) return;
  insert(fitZone({ ...z, x: z.x + 20, y: z.y + 20 }, design), from);
}

// One step, no confirmation: the toast offers undo, as does Ctrl+Z.
function removeZone(id, from) {
  const z = byId(id);
  if (!z) return;
  const label = zoneName(z);
  const i = design.zones.indexOf(z);
  design.zones.splice(i, 1);
  sel = design.zones[Math.min(i, design.zones.length - 1)]?.id ?? 0;
  renderZones();
  select(sel);
  changed();
  toast(T('say.removed', { name: label }), 6000, { label: T('undo'), onClick: () => undo() });
  const next = from === 'list' || narrow.matches
    ? zoneList.querySelector(`.so-zrow[data-id="${sel}"]`)
    : handles.querySelector(`[data-id="${sel}"]`);
  (next ?? addBtn).focus();
}

function newPattern() {
  design.seed = newSeed();
  changed();
}

// Drag a zone to move it, or its corner to resize it. Snaps to 5 px.
let drag = null;
const snap = (v) => Math.round(v / 5) * 5;
handles.addEventListener('pointerdown', (e) => {
  const btn = e.target.closest('.so-zone');
  if (!btn || e.button !== 0) return;
  e.preventDefault();
  btn.focus();
  const z = byId(+btn.dataset.id);
  select(z.id);
  if (!narrow.matches) { tab = 'zones'; syncTabs(); }
  drag = { z, btn, size: !!e.target.closest('.so-grip'), x: e.clientX, y: e.clientY, from: { ...z }, k: design.w / stage.clientWidth, moved: false };
  btn.setPointerCapture(e.pointerId);
});
handles.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = (e.clientX - drag.x) * drag.k;
  const dy = (e.clientY - drag.y) * drag.k;
  if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4 * drag.k) return;
  drag.moved = true;
  stage.classList.add('so-dragging');
  const f = drag.from;
  const next = drag.size ? { ...f, w: snap(f.w + dx), h: snap(f.h + dy) } : { ...f, x: snap(f.x + dx), y: snap(f.y + dy) };
  Object.assign(drag.z, fitZone(next, design));
  placeZone(drag.z);
  syncZoneInputs();
  queueRender(true);
});
const endDrag = () => {
  if (drag?.moved) { changed(); say(describe(drag.z)); }
  stage.classList.remove('so-dragging');
  drag = null;
  placeCtx();
};
handles.addEventListener('pointerup', endDrag);
handles.addEventListener('pointercancel', endDrag);
handles.addEventListener('click', (e) => {
  const btn = e.target.closest('.so-zone');
  if (btn) select(+btn.dataset.id);
});

// On a zone: arrow keys move it by 10 px (1 px with Alt), Shift and arrow keys
// resize it, Delete removes it, D duplicates it.
const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
handles.addEventListener('keydown', (e) => {
  const btn = e.target.closest('.so-zone');
  if (!btn || e.ctrlKey || e.metaKey) return;
  const z = byId(+btn.dataset.id);
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    removeZone(z.id, 'stage');
    return;
  }
  if (e.key === 'd' || e.key === 'D') {
    e.preventDefault();
    duplicateZone(z.id, 'stage');
    return;
  }
  const dir = ARROWS[e.key];
  if (!dir) return;
  e.preventDefault();
  select(z.id);
  const [dx, dy] = dir.map((v) => v * (e.altKey ? 1 : 10));
  const next = e.shiftKey ? { ...z, w: z.w + dx, h: z.h + dy } : { ...z, x: z.x + dx, y: z.y + dy };
  Object.assign(z, fitZone(next, design));
  placeZone(z);
  syncZoneInputs();
  changed();
  say(describe(z));
});

// Editor keys: undo and redo, P for preview, F for full screen, Space held to peek.
const typing = (el) => el.matches?.('input:not([type="range"]):not([type="checkbox"]), select, textarea');
document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]')) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (k === 'z' || k === 'y')) {
    if (typing(e.target)) return;
    e.preventDefault();
    if (k === 'y' || e.shiftKey) redo(); else undo();
    return;
  }
  if (e.key === 'Escape' && wrap.classList.contains('so-fakefs')) { exitFullscreen(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey || e.target.matches?.('input, select, textarea')) return;
  if (k === 'p') setMode(mode === 'preview' ? 'edit' : 'preview');
  else if (k === 'f') (fullscreen ? exitFullscreen() : enterFullscreen());
  else if (e.key === ' ' && !e.repeat && mode === 'edit' && (e.target === document.body || e.target.closest?.('.so-zone'))) {
    e.preventDefault();
    peek = true;
    syncMode();
  }
});
document.addEventListener('keyup', (e) => {
  if (e.key === ' ' && peek) { peek = false; syncMode(); }
});
addEventListener('blur', () => { if (peek) { peek = false; syncMode(); } });

// Drawing ------------------------------------------------------------
// One render at a time; edits made meanwhile collapse into the next one.
// While dragging, previews are drawn at a lower resolution to keep up;
// full screen is drawn at full size.

let rendering = false;
let queued = null;

function queueRender(fast = false) {
  queued = { fast: fast && (queued?.fast ?? true) };
  if (!rendering) drawLoop();
}

async function drawLoop() {
  rendering = true;
  const slow = setTimeout(() => { busy.hidden = false; }, 300);
  while (queued) {
    const { fast } = queued;
    queued = null;
    const full = Math.min(fullscreen ? 1 : 0.75, (stage.clientWidth * (devicePixelRatio || 1)) / design.w) || 0.5;
    try {
      const out = await renderLayers(design, fast ? Math.min(full, 0.3) : full);
      paint(backCv, out.back);
      paint(frontCv, out.front);
      errorMsg.hidden = true;
    } catch {
      errorMsg.hidden = false;
    }
  }
  clearTimeout(slow);
  busy.hidden = true;
  rendering = false;
  stage.dataset.drawn = 'true';
}

function paint(canvas, bmp) {
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close?.();
}

let resizeTimer = 0;
new ResizeObserver(() => {
  placeCtx();
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => queueRender(), 200);
}).observe(stage);

// Output -------------------------------------------------------------

async function download(layer) {
  const btn = downloads[layer];
  btn.disabled = true;
  say(T('preparing'));
  try {
    const out = await renderLayers(design, 1, true);
    const url = URL.createObjectURL(out[layer]);
    const a = h('a', { href: url, download: `overlay-${layer}-${design.w}x${design.h}.png`, class: 'sr-only' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch {
    errorMsg.hidden = false;
  }
  btn.disabled = layer === 'front' && !usesFront(design);
}

async function copyLink(input) {
  try {
    await navigator.clipboard.writeText(input.value);
    toast(T('copied'));
  } catch {
    input.focus();
    input.select();
    toast(T('copyManual'), 5000);
  }
}

arrange();
rebuild();
