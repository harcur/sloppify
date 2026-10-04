// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { initPage, guardStore } from '../../shared/page.js';
import { extendStrings, t } from '../../shared/i18n.js';
import { h } from '../../shared/dom.js';
import { openStore } from '../../shared/storage.js';
import { confirmDialog } from '../../shared/dialog.js';
import { toast } from '../../shared/toast.js';
import { strings } from './strings.js';
import {
  SIZES, KINDS, EFFECT_ORDER, PLACES, STYLE_ORDER, PALETTES, RANGES, MAX_ZONES, PRESET_NAMES,
  newZone, fitZone, normalize, resize, preset, usesFront, encode,
} from './design.js';
import { renderLayers } from './renderer.js';

extendStrings(strings);

const TOOL_ID = 'stream-overlay';
const T = (key, vars) => t(`${TOOL_ID}.${key}`, vars);
const name = T('name');
const { main } = initPage({ toolId: TOOL_ID, toolName: name, license: 'MIT', sourcePath: 'tools/stream-overlay/' });

// Saved: the design, and whether zone outlines are shown.
const store = openStore(TOOL_ID, { version: 1 });
const saving = await guardStore(store, name);
const saved = saving ? store.get('design') : null;
let design = saved ? normalize(saved) : preset('gameplay', '1920x1080', newSeed());
const savedUi = saving ? store.get('ui') : null;
let ui = { showZones: savedUi?.showZones !== false };
let sel = design.zones[0]?.id ?? 0;

function newSeed() { return Math.floor(Math.random() * 2 ** 31); }
const byId = (id) => design.zones.find((z) => z.id === id);
const zoneName = (z) => {
  const same = design.zones.filter((o) => o.kind === z.kind);
  const kind = T(`kind.${z.kind}`);
  return same.length > 1 ? `${kind} ${same.indexOf(z) + 1}` : kind;
};
const describe = (z) => T('zone.label', { name: zoneName(z), x: z.x, y: z.y, w: z.w, h: z.h });

// Controls -----------------------------------------------------------

let uid = 0;
// A labelled field. `target` is the element the label names, when `el` wraps it.
function control(label, el, extra, target = el) {
  target.id ||= `so-${++uid}`;
  return h('div', { class: 'so-field' }, h('label', { for: target.id }, label), el, extra);
}
const dropdown = (options, onchange) => h('select', { class: 'so-input', onchange: (e) => onchange(e.target.value) },
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

// Stage --------------------------------------------------------------

const backCv = h('canvas', { class: 'so-layer', 'aria-hidden': 'true' });
const frontCv = h('canvas', { class: 'so-layer', 'aria-hidden': 'true' });
const mocks = h('div', { class: 'so-mocks', 'aria-hidden': 'true' });
const handles = h('div', { class: 'so-handles' });
const stage = h('div', { class: 'so-stage', role: 'group', 'aria-describedby': 'so-stage-help' }, backCv, mocks, frontCv, handles);
const busy = h('span', { class: 'so-busy', hidden: true }, T('drawing'));
const showBox = h('input', { type: 'checkbox', id: 'so-show', onchange: (e) => { ui.showZones = e.target.checked; store.set('ui', ui); syncShow(); } });
const errorMsg = h('p', { class: 'so-error', role: 'alert', hidden: true }, T('error'));

const view = h('div', { class: 'so-view' },
  stage,
  h('div', { class: 'so-bar' },
    h('label', { class: 'so-check', for: 'so-show' }, showBox, T('showZones')),
    busy,
    h('button', { type: 'button', class: 'btn so-seed', onclick: () => { design.seed = newSeed(); changed(); } }, T('seed')),
  ),
  h('p', { class: 'so-help', id: 'so-stage-help' }, T('stageHelp')),
  errorMsg,
);

// Zones list ---------------------------------------------------------

const zoneList = h('ul', { class: 'so-zone-list' });
const addKind = dropdown(KINDS.map((k) => [k, T(`kind.${k}`)]), () => {});
const addBtn = h('button', { type: 'button', class: 'btn', onclick: addZone }, T('zone.add'));
const maxNote = h('p', { class: 'so-note', hidden: true }, T('zone.max'));

// Selected zone ------------------------------------------------------

const zf = {};
const setZone = (key, value, commit = true) => {
  const z = byId(sel);
  if (!z) return;
  Object.assign(z, fitZone({ ...z, [key]: value }, design));
  syncZoneInputs();
  placeZone(z);
  if (key === 'kind') renderZones();
  if (commit) changed(); else queueRender(true);
};
zf.kind = dropdown(KINDS.map((k) => [k, T(`kind.${k}`)]), (v) => setZone('kind', v));
zf.effect = dropdown(EFFECT_ORDER.map((k) => [k, T(`effect.${k}`)]), (v) => setZone('effect', v));
zf.hint = h('p', { class: 'so-hint', id: 'so-effect-hint' });
zf.effect.setAttribute('aria-describedby', 'so-effect-hint');
zf.place = dropdown(PLACES.map((k) => [k, T(`place.${k}`)]), (v) => setZone('place', v));
for (const k of ['x', 'y', 'w', 'h']) zf[k] = numberInput((v) => setZone(k, Math.round(+v)));
zf.r = slider('r', T('r'), px, (v, c) => setZone('r', v, c));
zf.frame = slider('frame', T('frame'), px, (v, c) => setZone('frame', v, c));
zf.fuzz = slider('fuzz', T('fuzz'), px, (v, c) => setZone('fuzz', v, c));
zf.power = slider('power', T('power'), plain, (v, c) => setZone('power', v, c));
const removeBtn = h('button', { type: 'button', class: 'btn btn-link so-remove', onclick: removeZone }, T('zone.remove'));

const zonePanel = h('div', { class: 'so-zone-panel' },
  control(T('kind'), zf.kind),
  control(T('effect'), zf.effect, zf.hint),
  control(T('place'), zf.place),
  h('div', { class: 'so-grid' }, ['x', 'y', 'w', 'h'].map((k) => control(T(k), zf[k]))),
  zf.r.wrap, zf.frame.wrap, zf.fuzz.wrap, zf.power.wrap,
  removeBtn,
);
const noZones = h('p', { class: 'so-note' }, T('zone.none'));

// Art and layout -----------------------------------------------------

const setArt = (key, value, commit = true) => { design[key] = value; if (commit) changed(); else queueRender(true); };
const af = {
  style: dropdown(STYLE_ORDER.map((k) => [k, T(`style.${k}`)]), (v) => setArt('style', v)),
  palette: dropdown(Object.keys(PALETTES).map((k) => [k, T(`palette.${k}`)]), (v) => setArt('palette', v)),
  density: slider('density', T('density'), plain, (v, c) => setArt('density', v, c)),
  reach: slider('reach', T('reach'), (n) => (n >= 100 ? T('reach.all') : T('percent', { n })), (v, c) => setArt('reach', v, c)),
  fill: h('input', { type: 'checkbox', id: 'so-fill', onchange: (e) => setArt('fill', e.target.checked) }),
  size: dropdown(Object.entries(SIZES).map(([k, [w, hh]]) => [k, T(hh > w ? 'size.tall' : 'size.wide', { w, h: hh })]), (v) => {
    design = resize(design, v);
    sel = design.zones[0]?.id ?? 0;
    rebuild();
    changed();
  }),
  preset: dropdown(PRESET_NAMES.map((k) => [k, T(`preset.${k}`)]), () => {}),
};

async function usePreset() {
  const key = af.preset.value;
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
  rebuild();
  changed();
}

// Output -------------------------------------------------------------

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

const section = (key, ...children) => h('section', { class: 'so-section', 'aria-labelledby': `so-h-${key}` },
  h('h2', { class: 'so-h2', id: `so-h-${key}` }, T(key)), children);

const panel = h('div', { class: 'so-panel' },
  section('zones', zoneList, h('div', { class: 'so-row' }, control(T('zone.addKind'), addKind), addBtn), maxNote),
  section('zone', zonePanel, noZones),
  section('art',
    control(T('style'), af.style), control(T('palette'), af.palette), af.density.wrap, af.reach.wrap,
    h('label', { class: 'so-check', for: 'so-fill' }, af.fill, T('fill'))),
  section('layout',
    control(T('size'), af.size),
    h('div', { class: 'so-row' }, control(T('preset'), af.preset), h('button', { type: 'button', class: 'btn', onclick: usePreset }, T('preset.use')))),
  section('use',
    h('div', { class: 'so-downloads' }, downloads.back, downloads.front),
    frontEmpty,
    linkRow('back'), linkRow('front'),
    h('ol', { class: 'so-steps' }, stepBack, h('li', {}, T('step.content')), stepFront, h('li', {}, T('step.link')))),
);

const announcer = h('p', { class: 'sr-only', 'aria-live': 'polite' });
const say = (msg) => { announcer.textContent = msg; };

main.append(
  h('h1', { class: 'tool-title' }, name),
  h('p', { class: 'so-intro' }, T('intro')),
  h('div', { class: 'so-layout' }, view, panel),
  announcer,
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
  btn.dataset.place = z.place;
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
    mocks.append(h('div', { class: 'so-mock', 'data-id': z.id }));
    zoneList.append(h('li', {}, h('button', {
      type: 'button', class: 'so-zone-item', 'data-id': z.id, 'aria-pressed': String(z.id === sel),
      onclick: () => select(z.id),
    }, label)));
    placeZone(z);
  }
  const full = design.zones.length >= MAX_ZONES;
  addBtn.disabled = full;
  maxNote.hidden = !full;
}

function select(id) {
  sel = id;
  for (const el of document.querySelectorAll('.so-zone, .so-zone-item')) el.setAttribute('aria-pressed', String(+el.dataset.id === sel));
  syncZoneInputs();
}

function syncZoneInputs() {
  const z = byId(sel);
  zonePanel.hidden = !z;
  noZones.hidden = !!z;
  if (!z) return;
  for (const k of ['kind', 'effect', 'place']) zf[k].value = z[k];
  zf.hint.textContent = T(`hint.${z.effect}`);
  for (const k of ['x', 'y', 'w', 'h']) {
    zf[k].value = z[k];
    zf[k].min = 0;
    zf[k].max = k === 'x' || k === 'w' ? design.w : design.h;
  }
  for (const k of ['r', 'frame', 'fuzz', 'power']) zf[k].set(z[k]);
}

function syncArt() {
  for (const k of ['style', 'palette', 'size']) af[k].value = design[k];
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

function syncShow() {
  showBox.checked = ui.showZones;
  stage.classList.toggle('so-hide', !ui.showZones);
}

function rebuild() {
  renderZones();
  select(sel);
  syncArt();
  syncShow();
  syncOutput();
  queueRender();
}

let saveTimer = 0;
function changed() {
  queueRender();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    store.set('design', design);
    syncOutput();
  }, 250);
}

// Editing zones -----------------------------------------------------

function addZone() {
  if (design.zones.length >= MAX_ZONES) return;
  const z = newZone(addKind.value, design);
  z.id = Math.max(0, ...design.zones.map((o) => o.id)) + 1;
  design.zones.push(z);
  sel = z.id;
  renderZones();
  select(z.id);
  changed();
  say(T('say.added', { name: zoneName(z) }));
  handles.querySelector(`[data-id="${z.id}"]`)?.focus();
}

function removeZone() {
  const z = byId(sel);
  if (!z) return;
  const label = zoneName(z);
  const i = design.zones.indexOf(z);
  design.zones.splice(i, 1);
  sel = design.zones[Math.min(i, design.zones.length - 1)]?.id ?? 0;
  renderZones();
  select(sel);
  changed();
  say(T('say.removed', { name: label }));
  (zoneList.querySelector('[aria-pressed="true"]') ?? addBtn).focus();
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
  drag = { z, btn, size: !!e.target.closest('.so-grip'), x: e.clientX, y: e.clientY, from: { ...z }, k: design.w / stage.clientWidth, moved: false };
  btn.setPointerCapture(e.pointerId);
});
handles.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = (e.clientX - drag.x) * drag.k;
  const dy = (e.clientY - drag.y) * drag.k;
  if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4 * drag.k) return;
  drag.moved = true;
  const f = drag.from;
  const next = drag.size ? { ...f, w: snap(f.w + dx), h: snap(f.h + dy) } : { ...f, x: snap(f.x + dx), y: snap(f.y + dy) };
  Object.assign(drag.z, fitZone(next, design));
  placeZone(drag.z);
  syncZoneInputs();
  queueRender(true);
});
const endDrag = () => {
  if (drag?.moved) { changed(); say(describe(drag.z)); }
  drag = null;
};
handles.addEventListener('pointerup', endDrag);
handles.addEventListener('pointercancel', endDrag);
handles.addEventListener('click', (e) => {
  const btn = e.target.closest('.so-zone');
  if (btn) select(+btn.dataset.id);
});

// Arrow keys move the zone by 10 px, Shift and arrow keys resize it.
const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
handles.addEventListener('keydown', (e) => {
  const btn = e.target.closest('.so-zone');
  const dir = ARROWS[e.key];
  if (!btn || !dir || e.altKey || e.ctrlKey || e.metaKey) return;
  e.preventDefault();
  const z = byId(+btn.dataset.id);
  select(z.id);
  const [dx, dy] = dir.map((v) => v * 10);
  const next = e.shiftKey ? { ...z, w: z.w + dx, h: z.h + dy } : { ...z, x: z.x + dx, y: z.y + dy };
  Object.assign(z, fitZone(next, design));
  placeZone(z);
  syncZoneInputs();
  changed();
  say(describe(z));
});

// Drawing ------------------------------------------------------------
// One render at a time; edits made meanwhile collapse into the next one.
// While dragging, previews are drawn at a lower resolution to keep up.

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
    const full = Math.min(0.75, (stage.clientWidth * (devicePixelRatio || 1)) / design.w) || 0.5;
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

rebuild();
