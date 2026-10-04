// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { initPage, guardStore } from '../../shared/page.js';
import { extendStrings, t } from '../../shared/i18n.js';
import { h } from '../../shared/dom.js';
import { icon } from '../../shared/icons.js';
import { openStore } from '../../shared/storage.js';
import { confirmDialog, messageDialog } from '../../shared/dialog.js';
import { toast } from '../../shared/toast.js';
import { optionsSheet } from '../../shared/sheet.js';
import { strings } from './strings.js';
import { INKS, trimBox, inkFromPhoto, smoothPath, pointsBox, itemsBox, keepOnPage, resize, isSignatureList, DATE_FORMATS, isIsoDate, todayIso, formatDate, copyToPage } from './sig.js';

extendStrings(strings);

const TOOL_ID = 'sign-document';
const name = t(`${TOOL_ID}.name`);
const k = (key, vars) => t(`${TOOL_ID}.${key}`, vars);
const SOURCE_PATH = 'tools/sign-document/';
const { main } = initPage({ toolId: TOOL_ID, toolName: name, license: 'MIT', sourcePath: SOURCE_PATH, app: true });

// Saved: signatures (small PNGs), the ink colour and the date format. Documents are never stored.
const store = openStore(TOOL_ID, { version: 1 });
const saving = await guardStore(store, name);
let signatures = saving && isSignatureList(store.get('signatures')) ? store.get('signatures') : [];
let ink = saving && INKS[store.get('ink')] ? store.get('ink') : 'black';
let dateFormat = saving && DATE_FORMATS.includes(store.get('dateFormat')) ? store.get('dateFormat') : 'long';

const SANS = 'Helvetica, Arial, sans-serif';
const SCRIPT = '"Segoe Script", "Bradley Hand", "Apple Chancery", "URW Chancery L", cursive';
const NS = 'http://www.w3.org/2000/svg';
const MAX_SIGS = 6;
const narrow = matchMedia('(max-width: 719px)');
const rgb = (c) => `rgb(${c.join(',')})`;
const svgEl = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [a, v] of Object.entries(attrs)) if (v != null) el.setAttribute(a, String(v));
  return el;
};

// Document state -----------------------------------------------------

let kind = null; // 'pdf' | 'image'
let fileName = '';
let imageType = '';
let pages = []; // { w, h, items, fields, el, svg, canvas, img, scale }
let mode = 'move';
let selected = null; // { p, item }
let history = [];
let dirty = false;
let nextId = 1;

// Worker: PDF reading, drawing and writing, loaded only when needed.
let worker = null;
let seq = 0;
const waiting = new Map();
function call(msg, transfer = []) {
  if (!worker) {
    worker = new Worker(new URL('worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const p = waiting.get(data.id);
      waiting.delete(data.id);
      if (data.error) p?.reject(Object.assign(new Error(data.error), { code: data.error }));
      else p?.resolve(data);
    };
    worker.onerror = () => { for (const p of waiting.values()) p.reject(new Error('worker')); waiting.clear(); };
  }
  return new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    worker.postMessage({ ...msg, id }, transfer);
  });
}

// Elements -----------------------------------------------------------

const fileInput = h('input', {
  type: 'file', id: 'sd-file', hidden: true, accept: 'application/pdf,.pdf,image/png,image/jpeg,image/webp',
  onchange: () => { const f = fileInput.files[0]; fileInput.value = ''; if (f) openFile(f); },
});
const openBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => fileInput.click() }, icon('upload'), k('open'));
const openPanel = h('section', { class: 'sd-open', 'aria-label': k('open') },
  h('p', { class: 'sd-lead' }, k('lead')),
  h('div', { class: 'sd-drop' }, openBtn, h('p', { class: 'sd-hint' }, k('formats'))),
  h('p', { class: 'sd-note' }, k('privacy')),
);

const docName = h('h2', { class: 'sd-doc-name' });
const docMeta = h('p', { class: 'sd-doc-meta' });
const docNote = h('p', { class: 'sd-doc-note', hidden: true }, k('missing'));
const saveBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => save() }, icon('download'), k('save'));
const savePdfBtn = h('button', { type: 'button', class: 'btn', onclick: () => { options.close(); save(true); } }, k('savePdf'));
const closeBtn = h('button', { type: 'button', class: 'btn', onclick: () => { options.close(); closeDoc(); } }, k('close'));
const docBar = h('section', { class: 'sd-doc', 'aria-label': k('document') },
  docName, docMeta, docNote,
  h('div', { class: 'sd-row' }, saveBtn, savePdfBtn,
    h('button', { type: 'button', class: 'btn', onclick: () => { options.close(); fileInput.click(); } }, k('openOther')), closeBtn),
);

// Text and Date add to the page that's tapped. From the keyboard (no click position),
// pressing them adds to the middle of the page in view instead.
const modeBtns = ['move', 'pen', 'text', 'date'].map((m) => h('button', {
  type: 'button', class: 'sd-tool', 'data-mode': m, 'aria-pressed': 'false',
  onclick: (e) => { setMode(m); if (e.detail === 0 && kind && (m === 'text' || m === 'date')) addText(currentPage(), null, m === 'date'); },
}, k(`mode.${m}`)));
const undoBtn = h('button', { type: 'button', class: 'sd-tool', disabled: true, onclick: () => undo() }, k('undo'));
const sigsToggle = h('button', {
  type: 'button', class: 'sd-tool sd-mob', 'aria-expanded': 'false', 'aria-controls': 'sd-sigs', onclick: () => showSheet(!sigsPanel.classList.contains('sd-open-sheet')),
}, k('signTool'));
// Phones: the main action as a full-width button at the bottom, the options sheet for the rest.
const barOpen = h('button', { type: 'button', class: 'btn btn-primary sd-bar-main sd-no-doc', onclick: () => fileInput.click() }, icon('upload'), k('open'));
const barSave = h('button', { type: 'button', class: 'btn btn-primary sd-bar-main sd-doc-only', onclick: () => save() }, icon('download'), k('save'));
const optionsBtn = h('button', { type: 'button', class: 'sd-tool sd-opt sd-mob', 'aria-haspopup': 'dialog', onclick: () => options.open() }, k('options'));
const options = optionsSheet({ title: k('options'), sourcePath: SOURCE_PATH, returnFocus: optionsBtn });
options.body.append(h('p', { class: 'sd-hint sd-sheet-note' }, k('privacy')));
document.body.append(options.sheet);
const inkBtns = Object.keys(INKS).map((c) => h('button', {
  type: 'button', class: 'seg-btn', 'data-ink': c, 'aria-pressed': String(c === ink), onclick: () => setInk(c),
}, h('span', { class: `sd-swatch sd-swatch-${c}`, 'aria-hidden': 'true' }), k(`ink.${c}`)));
const inkGroup = () => h('div', { class: 'sd-ink' }, h('span', { class: 'sd-label', 'aria-hidden': 'true' }, k('ink')),
  h('div', { class: 'seg sd-seg', role: 'group', 'aria-label': k('ink') }, inkBtns));
const toolBar = h('section', { class: 'sd-tools', 'aria-label': k('tools') },
  barOpen, barSave,
  h('div', { class: 'sd-modes', role: 'group', 'aria-label': k('tools') }, sigsToggle, modeBtns, undoBtn, optionsBtn),
  h('p', { class: 'sd-mode-hint', 'aria-live': 'polite' }),
);
const modeHint = toolBar.querySelector('.sd-mode-hint');

const itemLabel = h('p', { class: 'sd-item-label' });
const textInput = h('input', { type: 'text', id: 'sd-text', class: 'sd-input', autocomplete: 'off', oninput: () => editText() });
const textField = h('div', { class: 'sd-field' }, h('label', { for: 'sd-text' }, k('item.textLabel')), textInput);
const dateInput = h('input', { type: 'date', id: 'sd-date', class: 'sd-input', required: true, onchange: () => editDate() });
const fmtSelect = h('select', { id: 'sd-fmt', class: 'sd-input', onchange: () => editDate() });
const dateFields = h('div', { class: 'sd-date-fields' },
  h('div', { class: 'sd-field' }, h('label', { for: 'sd-date' }, k('item.dateLabel')), dateInput),
  h('div', { class: 'sd-field' }, h('label', { for: 'sd-fmt' }, k('item.formatLabel')), fmtSelect));
const allPagesBtn = h('button', { type: 'button', class: 'btn', onclick: () => copyToAllPages() }, k('item.allPages'));
const itemPanel = h('section', { class: 'sd-sel', 'aria-label': k('item.panel'), hidden: true },
  itemLabel, textField, dateFields,
  h('div', { class: 'sd-row' },
    h('button', { type: 'button', class: 'btn', onclick: () => scaleSelected(1 / 1.15) }, k('item.smaller')),
    h('button', { type: 'button', class: 'btn', onclick: () => scaleSelected(1.15) }, k('item.larger')),
    h('button', { type: 'button', class: 'btn', onclick: () => removeSelected() }, icon('trash'), k('item.delete')),
    allPagesBtn,
    h('button', { type: 'button', class: 'btn btn-link', onclick: () => select(null, null) }, k('item.done')),
  ),
  h('p', { class: 'sd-hint sd-desk', id: 'sd-keys' }, k('item.keys')),
);

// Signatures: saved list plus the editor.
const sigList = h('ul', { class: 'sd-sig-list' });
const sigEmpty = h('p', { class: 'sd-hint' }, k('sig.none'));
// Ticks and crosses for checkboxes: fixed strokes on a 24-unit square, placed like a signature.
const MARKS = { tick: 'M3 13L9 19L21 5', cross: 'M5 5L19 19M19 5L5 19' };
const markSvg = (m) => {
  const svg = svgEl('svg', { class: 'sd-mark-icon', viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
  svg.append(svgEl('path', { d: MARKS[m] }));
  return svg;
};
const markBtns = Object.keys(MARKS).map((m) => h('button', { type: 'button', class: 'btn', onclick: () => placeMark(m) }, markSvg(m), k(`mark.${m}`)));
const marksRow = h('div', { class: 'sd-marks', role: 'group', 'aria-label': k('mark.title') }, h('span', { class: 'sd-label' }, k('mark.title')), markBtns);
const newSigBtn = h('button', { type: 'button', class: 'btn', 'aria-expanded': 'false', 'aria-controls': 'sd-editor', onclick: () => openEditor(!editorOpen) }, k('sig.new'));
const pad = h('canvas', { class: 'sd-pad', width: 900, height: 300, role: 'img', 'aria-label': k('sig.padLabel') });
const nameInput = h('input', { type: 'text', id: 'sd-name', class: 'sd-input', autocomplete: 'name', oninput: () => drawPad() });
const pictureInput = h('input', { type: 'file', id: 'sd-picture', hidden: true, accept: 'image/*', onchange: () => loadPicture() });
const sources = ['draw', 'type', 'picture'];
const sourceBtns = sources.map((s) => h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': String(s === 'draw'), onclick: () => setSource(s) }, k(`sig.${s}`)));
const nameField = h('div', { class: 'sd-field', hidden: true }, h('label', { for: 'sd-name' }, k('sig.typeLabel')), nameInput);
const pictureField = h('div', { class: 'sd-field', hidden: true },
  h('button', { type: 'button', class: 'btn', onclick: () => pictureInput.click() }, icon('upload'), k('sig.pickPicture')),
  h('p', { class: 'sd-hint' }, k('sig.pictureHint')), pictureInput);
const padHint = h('p', { class: 'sd-hint' }, k('sig.hint.draw'));
const editor = h('div', { class: 'sd-editor', id: 'sd-editor', hidden: true },
  h('div', { class: 'seg sd-seg sd-sources', role: 'group', 'aria-label': k('sig.source') }, sourceBtns),
  nameField, pictureField,
  h('div', { class: 'sd-pad-wrap' }, pad, h('span', { class: 'sd-pad-line', 'aria-hidden': 'true' })),
  padHint,
  inkGroup(),
  h('div', { class: 'sd-row' },
    h('button', { type: 'button', class: 'btn btn-primary', onclick: () => saveSignature() }, k('sig.save')),
    h('button', { type: 'button', class: 'btn', onclick: () => clearPad() }, k('sig.clear')),
    h('button', { type: 'button', class: 'btn', onclick: () => openEditor(false) }, k('sig.cancel')),
  ),
);
const sigsPanel = h('section', { class: 'sd-sigs', id: 'sd-sigs', 'aria-labelledby': 'sd-sigs-title' },
  h('div', { class: 'sd-sheet-head' },
    h('h2', { class: 'sd-h2', id: 'sd-sigs-title' }, k('sig.title')),
    h('button', { type: 'button', class: 'btn btn-link sd-mob', onclick: () => showSheet(false) }, k('sig.hide'))),
  sigList, sigEmpty, newSigBtn, marksRow, editor,
);

const pagesEl = h('div', { class: 'sd-pages', role: 'region', 'aria-label': k('pages') });
const side = h('div', { class: 'sd-side' }, docBar, toolBar, itemPanel, sigsPanel);
const layout = h('div', { class: 'sd-layout' }, side, pagesEl);

// Zoom: page width as a multiple of the fitted width. Pages scroll sideways when wider.
const ZOOMS = [1, 1.5, 2, 3];
let zoom = 0;
const zoomOut = h('button', { type: 'button', class: 'btn sd-zoom-btn', 'aria-label': k('zoom.out'), disabled: true, onclick: () => setZoom(zoom - 1) }, '\u2212');
const zoomIn = h('button', { type: 'button', class: 'btn sd-zoom-btn', 'aria-label': k('zoom.in'), onclick: () => setZoom(zoom + 1) }, '+');
const zoomLevel = h('span', { class: 'sd-zoom-level', 'aria-live': 'polite' }, '100%');
const zoomRow = h('div', { class: 'sd-zoom', role: 'group', 'aria-label': k('zoom.title') },
  h('span', { class: 'sd-label', 'aria-hidden': 'true' }, k('zoom.title')), zoomOut, zoomLevel, zoomIn);

// Long documents: jump to a page; the state line on phones follows the page in view.
const pageSelect = h('select', { id: 'sd-page', class: 'sd-input', onchange: () => goToPage(+pageSelect.value) });
const pageRow = h('div', { class: 'sd-field sd-page-row' }, h('label', { for: 'sd-page' }, k('goTo')), pageSelect);
let pageInView = 0;

const stateLine = h('p', { class: 'sd-state' }, name);
const bodyEl = h('div', { class: 'sd-body' }, openPanel, layout);
main.append(h('h1', { class: 'tool-title' }, name), stateLine, bodyEl, fileInput);
main.classList.add('sd-main');

// Phones: the tool bar sits at the bottom of the screen and the document's details go in
// the options sheet; on wider screens both sit in the side panel.
function arrange() {
  if (narrow.matches) {
    options.body.prepend(docBar, pageRow, zoomRow);
    main.insertBefore(toolBar, fileInput);
  } else {
    options.close();
    side.prepend(docBar, toolBar);
    toolBar.append(pageRow, zoomRow);
  }
  updateUi();
}
narrow.addEventListener('change', arrange);
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--sd-bar-h', `${narrow.matches ? toolBar.offsetHeight : 0}px`);
}).observe(toolBar);

// Opening and closing ----------------------------------------------

async function openFile(file) {
  if (kind && dirty && !(await confirmDialog({ title: k('discard.title'), body: k('discard.body'), confirmLabel: k('discard.ok'), danger: true }))) return;
  const pdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const image = /^image\/(png|jpeg|webp)$/.test(file.type);
  if (!pdf && !image) { messageDialog({ title: k('error.title'), body: k('error.type') }); return; }
  toast(k('opening'));
  let list, img;
  try {
    if (pdf) {
      const buffer = await file.arrayBuffer();
      const res = await call({ type: 'open', buffer }, [buffer]);
      list = res.pages.map((p, i) => ({ w: p.w, h: p.h, fields: res.fields.filter((f) => f.page === i) }));
    } else {
      img = new Image();
      img.alt = '';
      img.className = 'sd-img';
      img.src = URL.createObjectURL(file);
      await img.decode();
      list = [{ w: img.naturalWidth, h: img.naturalHeight, img }];
    }
  } catch (e) {
    if (img) URL.revokeObjectURL(img.src);
    const code = { encrypted: 'encrypted', unsupported: 'unsupported' }[e.code] || (pdf ? 'pdf' : 'image');
    messageDialog({ title: k('error.title'), body: k(`error.${code}`) });
    return;
  }
  resetDoc();
  kind = pdf ? 'pdf' : 'image';
  imageType = file.type;
  fileName = file.name;
  pages = list.map((p) => ({ fields: [], ...p, items: [], scale: 0 }));
  buildPages();
  pageInView = 0;
  pageSelect.replaceChildren(...pages.map((_, i) => h('option', { value: i + 1 }, k('page', { n: i + 1, total: pages.length }))));
  docName.textContent = fileName;
  docMeta.textContent = k(kind === 'image' ? 'meta.image' : pages.length === 1 ? 'meta.pdf1' : 'meta.pdf', { n: pages.length });
  const nFields = pages.reduce((n, p) => n + p.fields.length, 0);
  if (nFields) docMeta.textContent += ` \u00B7 ${k('meta.fields', { n: nFields })}`;
  savePdfBtn.hidden = kind === 'pdf';
  saveBtn.lastChild.textContent = barSave.lastChild.textContent = k(kind === 'pdf' ? 'save' : 'saveImage');
  main.classList.add('sd-has-doc');
  setMode('move');
  updateUi();
  docName.setAttribute('tabindex', '-1');
  docName.focus();
  toast(k('opened', { name: fileName }));
}

function resetDoc() {
  for (const p of pages) if (p.img) URL.revokeObjectURL(p.img.src);
  observer.disconnect();
  pagesEl.replaceChildren();
  docNote.hidden = true;
  pages = [];
  selected = null;
  history = [];
  dirty = false;
  setZoom(0);
}

async function closeDoc() {
  if (dirty && !(await confirmDialog({ title: k('discard.title'), body: k('discard.body'), confirmLabel: k('discard.ok'), danger: true }))) return;
  resetDoc();
  kind = null;
  main.classList.remove('sd-has-doc');
  showSheet(false);
  updateUi();
  openBtn.focus();
}

addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
main.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
main.addEventListener('drop', (e) => {
  const f = e.dataTransfer?.files?.[0];
  if (!f) return;
  e.preventDefault();
  openFile(f);
});

// Pages ---------------------------------------------------------------

const observer = new IntersectionObserver((entries) => {
  for (const en of entries) if (en.isIntersecting) renderPage(+en.target.dataset.page);
}, { rootMargin: '100% 0px' });

// The PDF's own form fields as real inputs over the page; their values go into the saved file.
function fieldInput(p, f) {
  const attrs = { class: `sd-field-input sd-field-${f.type}`, 'aria-label': f.name || k('field'), readonly: f.readOnly && f.type === 'text', disabled: f.readOnly && f.type !== 'text' };
  let el;
  if (f.type === 'text') el = f.multiline ? h('textarea', attrs) : h('input', { ...attrs, type: 'text', maxlength: f.maxLen || null });
  else if (f.type === 'choice') {
    const opts = f.options.includes(f.value) ? f.options : [f.value, ...f.options];
    el = h('select', attrs, opts.map((o) => h('option', { value: o }, o)));
  } else el = h('input', { ...attrs, type: f.type === 'radio' ? 'radio' : 'checkbox', name: f.type === 'radio' ? `sd-radio-${f.field}` : null });
  if (f.type === 'check' || f.type === 'radio') el.checked = f.value;
  else el.value = f.value;
  Object.assign(el.style, { left: `${(f.x / p.w) * 100}%`, top: `${(f.y / p.h) * 100}%`, width: `${(f.w / p.w) * 100}%`, height: `${(f.h / p.h) * 100}%` });
  el.style.setProperty('--fs', f.multiline ? 10 : Math.max(6, Math.min(12, f.h * 0.7)));
  el.addEventListener('input', () => { dirty = true; });
  el.addEventListener('change', () => { dirty = true; });
  f.el = el;
  return el;
}
const fieldValues = () => Object.fromEntries(pages.flatMap((p) => p.fields).map((f) => [f.id, f.type === 'check' || f.type === 'radio' ? f.el.checked : f.el.value]));
const fieldsChanged = () => pages.some((p) => p.fields.some((f) => (f.type === 'check' || f.type === 'radio' ? f.el.checked : f.el.value) !== f.value));

function buildPages() {
  pages.forEach((p, i) => {
    p.svg = svgEl('svg', { class: 'sd-overlay', viewBox: `0 0 ${p.w} ${p.h}`, 'data-page': i });
    p.el = h('div', { class: 'sd-page', role: 'group', tabindex: '-1', 'aria-label': k('page', { n: i + 1, total: pages.length }), 'data-page': i });
    p.el.style.aspectRatio = `${p.w} / ${p.h}`;
    if (p.img) p.el.append(p.img);
    else {
      p.canvas = h('canvas', { class: 'sd-canvas', 'aria-hidden': 'true' });
      p.el.append(p.canvas, h('p', { class: 'sd-loading' }, k('loadingPage')));
      observer.observe(p.el);
    }
    p.el.append(p.svg);
    if (p.fields.length) p.el.append(h('div', { class: 'sd-fields' }, p.fields.map((f) => fieldInput(p, f))));
    pagesEl.append(p.el);
    for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) p.svg.addEventListener(ev, (e) => onPointer(e, p));
    p.svg.addEventListener('keydown', (e) => onKey(e, p));
    p.svg.addEventListener('focusin', (e) => {
      const g = e.target.closest?.('.sd-item');
      const item = g && p.items.find((it) => it.id === +g.dataset.id);
      if (item && selected?.item !== item) select(p, item, false);
    });
  });
}

let queue = Promise.resolve();
function renderPage(i) {
  const p = pages[i];
  if (!p || p.busy) return;
  const dpr = devicePixelRatio || 1;
  const want = Math.min(4, Math.sqrt(8e6 / (p.w * p.h)), Math.max(0.5, (p.el.clientWidth * dpr) / p.w));
  if (p.scale && want <= p.scale * 1.25) return;
  p.busy = true;
  const current = pages;
  queue = queue.then(async () => {
    if (current !== pages) return;
    try {
      const res = await call({ type: 'render', page: i, scale: want, skip: p.fields.map((f) => f.id) });
      if (current !== pages) { res.bitmap.close?.(); return; }
      p.canvas.getContext('bitmaprenderer').transferFromImageBitmap(res.bitmap);
      p.scale = want;
      p.el.querySelector('.sd-loading')?.remove();
      if (res.missing) docNote.hidden = false;
    } catch (e) {
      const msg = p.el.querySelector('.sd-loading');
      if (msg) msg.textContent = k(e.code === 'unsupported' ? 'error.unsupported' : 'pageFailed');
    } finally { p.busy = false; }
  });
}

// Sharper pages after a resize or zoom: re-render the ones near the screen at the new width.
function refreshPages() {
  for (const p of pages) p.el.style.setProperty('--sd-ppu', p.el.clientWidth / p.w);
  for (const [i, p] of pages.entries()) {
    const r = p.el.getBoundingClientRect();
    if (p.canvas && r.bottom > -innerHeight && r.top < innerHeight * 2) renderPage(i);
  }
  drawOverlays();
}
new ResizeObserver(refreshPages).observe(pagesEl);

function goToPage(n) {
  const p = pages[n - 1];
  if (!p) return;
  options.close();
  p.el.scrollIntoView({ block: 'start' });
  if (!narrow.matches) p.el.focus({ preventScroll: true });
}

let trackFrame = 0;
function trackPage() {
  if (trackFrame || pages.length < 2) return;
  trackFrame = requestAnimationFrame(() => {
    trackFrame = 0;
    const i = pages.indexOf(currentPage());
    if (i < 0 || i === pageInView) return;
    pageInView = i;
    pageSelect.value = String(i + 1);
    updateUi();
  });
}
addEventListener('scroll', trackPage, { passive: true });
bodyEl.addEventListener('scroll', trackPage, { passive: true });

function setZoom(i) {
  i = Math.max(0, Math.min(ZOOMS.length - 1, i));
  const scroller = narrow.matches ? bodyEl : document.scrollingElement;
  const at = scroller.scrollTop / (scroller.scrollHeight || 1);
  zoom = i;
  pagesEl.style.setProperty('--sd-zoom', ZOOMS[i]);
  pagesEl.classList.toggle('sd-zoomed', i > 0);
  zoomLevel.textContent = `${ZOOMS[i] * 100}%`;
  zoomOut.disabled = i === 0;
  zoomIn.disabled = i === ZOOMS.length - 1;
  scroller.scrollTop = at * scroller.scrollHeight;
  pagesEl.scrollLeft = (pagesEl.scrollWidth - pagesEl.clientWidth) / 2;
  refreshPages();
}

// Overlay items -------------------------------------------------------
// Items keep their own local size (w0 x h0) and are scaled uniformly to w x h.

const unitsPerPx = (p) => p.w / (p.svg.getBoundingClientRect().width || p.w);
const local = (it) => it.w / it.w0;

const itemName = (p, it) => k(it.date ? 'item.date' : it.mark ? `item.${it.mark}` : `item.${it.type}`, { n: p.items.indexOf(it) + 1, page: pages.indexOf(p) + 1, text: it.text ?? '' });

function itemNode(p, it) {
  const sel = selected?.item === it;
  const g = svgEl('g', {
    class: `sd-item${sel ? ' sd-selected' : ''}`, tabindex: '0', role: 'button', 'data-id': it.id,
    'aria-pressed': String(sel), 'aria-label': itemName(p, it),
    'aria-describedby': 'sd-keys', transform: `translate(${it.x} ${it.y}) scale(${local(it)})`,
  });
  g.append(svgEl('rect', { class: 'sd-hit', width: it.w0, height: it.h0 }));
  if (it.type === 'sig') g.append(svgEl('image', { href: it.src, width: it.w0, height: it.h0, preserveAspectRatio: 'none' }));
  else if (it.type === 'ink') g.append(svgEl('path', { d: it.d, stroke: it.color, 'stroke-width': it.lw, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  else {
    const tx = svgEl('text', { x: 0, y: it.fs, fill: it.color, 'font-size': it.fs, 'font-family': SANS });
    tx.textContent = it.text;
    g.append(tx);
  }
  if (sel) g.append(svgEl('rect', { class: 'sd-outline', width: it.w0, height: it.h0, 'vector-effect': 'non-scaling-stroke' }));
  return g;
}

function drawOverlay(p) {
  const focusedId = document.activeElement?.closest?.('.sd-item')?.dataset.id;
  p.svg.replaceChildren(...p.items.map((it) => itemNode(p, it)));
  if (selected?.p === p) {
    const it = selected.item;
    const s = 22 * unitsPerPx(p);
    p.svg.append(svgEl('rect', { class: 'sd-handle', x: it.x + it.w - s * 0.2, y: it.y + it.h - s * 0.2, width: s, height: s, 'aria-hidden': 'true' }));
  }
  if (focusedId && p.svg.contains(document.activeElement) === false) p.svg.querySelector(`[data-id="${focusedId}"]`)?.focus();
}
const drawOverlays = () => pages.forEach(drawOverlay);

function snapshot() {
  history.push(pages.map((p) => p.items.map((it) => ({ ...it }))));
  if (history.length > 60) history.shift();
  dirty = true;
  undoBtn.disabled = false;
}

function undo() {
  const last = history.pop();
  if (!last) return;
  pages.forEach((p, i) => { p.items = last[i]; });
  selected = null;
  undoBtn.disabled = !history.length;
  dirty = true;
  drawOverlays();
  updateItemPanel();
  toast(k('undone'));
}

function select(p, item, focus = true) {
  const before = selected?.p;
  selected = item ? { p, item } : null;
  if (before && before !== p) drawOverlay(before);
  if (p) drawOverlay(p);
  updateItemPanel();
  if (focus && item) p.svg.querySelector(`[data-id="${item.id}"]`)?.focus();
}

function updateItemPanel() {
  itemPanel.hidden = !selected;
  if (!selected) return;
  const { p, item } = selected;
  itemLabel.textContent = itemName(p, item);
  allPagesBtn.hidden = pages.length < 2;
  textField.hidden = item.type !== 'text' || !!item.date;
  dateFields.hidden = !item.date;
  if (item.date) {
    dateInput.value = item.date;
    // Some locales write two styles the same way; list each wording once.
    const seen = new Set();
    fmtSelect.replaceChildren(...DATE_FORMATS.flatMap((f) => {
      const text = formatDate(item.date, f);
      if (seen.has(text) && f !== item.fmt) return [];
      seen.add(text);
      return h('option', { value: f, selected: f === item.fmt }, text);
    }));
  } else if (item.type === 'text' && textInput.value !== item.text) textInput.value = item.text;
}

function addItem(p, item) {
  snapshot();
  item.id = nextId++;
  keepOnPage(item, p.w, p.h);
  p.items.push(item);
  select(p, item, item.type !== 'ink');
}

function removeSelected() {
  if (!selected) return;
  const { p, item } = selected;
  snapshot();
  p.items = p.items.filter((it) => it !== item);
  selected = null;
  drawOverlay(p);
  updateItemPanel();
  toast(k('removed'));
  p.el.focus?.();
}

// Initials on every page: the selected item copied to the same spot on each other page.
function copyToAllPages() {
  if (!selected || pages.length < 2) return;
  const { p, item } = selected;
  snapshot();
  for (const other of pages) {
    if (other === p) continue;
    other.items.push({ ...copyToPage(item, p, other), id: nextId++ });
    drawOverlay(other);
  }
  toast(k(pages.length === 2 ? 'copied1' : 'copied', { n: pages.length - 1 }));
}

function scaleSelected(f) {
  if (!selected) return;
  snapshot();
  const { p, item } = selected;
  resize(item, f, p.w);
  keepOnPage(item, p.w, p.h);
  drawOverlay(p);
}

const measureCtx = document.createElement('canvas').getContext('2d');
function textWidth(text, fs) {
  measureCtx.font = `${fs}px ${SANS}`;
  return Math.max(fs, measureCtx.measureText(text).width);
}

let textTimer = 0;
function editText() {
  if (selected?.item.type !== 'text') return;
  const { p, item } = selected;
  if (!textTimer) snapshot();
  clearTimeout(textTimer);
  textTimer = setTimeout(() => { textTimer = 0; }, 800);
  setText(p, item, textInput.value);
}

function setText(p, item, text) {
  const f = local(item);
  item.text = text;
  item.w0 = textWidth(text, item.fs);
  item.w = item.w0 * f;
  drawOverlay(p);
  itemLabel.textContent = itemName(p, item);
}

function editDate() {
  if (!selected?.item.date) return;
  const { p, item } = selected;
  snapshot();
  if (isIsoDate(dateInput.value)) item.date = dateInput.value;
  item.fmt = dateFormat = DATE_FORMATS.includes(fmtSelect.value) ? fmtSelect.value : dateFormat;
  if (saving) store.set('dateFormat', dateFormat);
  setText(p, item, formatDate(item.date, item.fmt));
  updateItemPanel();
}

// Text starts as a placeholder to type over; a date starts as today in the browser's own locale.
function addText(p, at, isDate) {
  const fs = Math.max(p.w, p.h) / 60;
  const date = isDate ? todayIso() : undefined;
  const text = isDate ? formatDate(date, dateFormat) : k('item.defaultText');
  const w0 = textWidth(text, fs), h0 = fs * 1.3;
  const [x, y] = at ? [at[0], at[1] - fs] : [(p.w - w0) / 2, viewCentreY(p) - h0 / 2];
  addItem(p, { type: 'text', text, date, fmt: isDate ? dateFormat : undefined, fs, color: rgb(INKS[ink]), x, y, w: w0, h: h0, w0, h0 });
  const field = isDate ? dateInput : textInput;
  field.focus();
  if (!isDate) textInput.select();
}

// Pointer and keyboard ------------------------------------------------

let drag = null;
function pagePoint(e, p) {
  const r = p.svg.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * p.w, ((e.clientY - r.top) / r.height) * p.h];
}

function onPointer(e, p) {
  const [x, y] = pagePoint(e, p);
  if (e.type === 'pointerdown') {
    if (e.button > 0) return;
    const handle = e.target.closest('.sd-handle');
    const g = e.target.closest('.sd-item');
    const item = g && p.items.find((it) => it.id === +g.dataset.id);
    if (mode === 'pen' && !handle) {
      drag = { kind: 'ink', pts: [[x, y]], path: svgEl('path', { class: 'sd-live', stroke: rgb(INKS[ink]), 'stroke-width': penWidth(p), fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }) };
      p.svg.append(drag.path);
    } else if (handle && selected) {
      drag = { kind: 'resize', item: selected.item, x, y, w: selected.item.w, h: selected.item.h, before: false };
    } else if (item) {
      select(p, item);
      drag = { kind: 'move', item, x, y, ix: item.x, iy: item.y, before: false };
    } else if (mode === 'text' || mode === 'date') {
      e.preventDefault();
      addText(p, [x, y], mode === 'date');
      return;
    } else {
      select(null, null);
      return;
    }
    p.svg.setPointerCapture?.(e.pointerId);
    e.preventDefault();
    return;
  }
  if (!drag) return;
  if (e.type === 'pointermove') {
    if (drag.kind === 'ink') {
      drag.pts.push([x, y]);
      drag.path.setAttribute('d', smoothPath(drag.pts));
      return;
    }
    if (!drag.before) { snapshot(); drag.before = true; }
    const it = drag.item;
    if (drag.kind === 'move') { it.x = drag.ix + x - drag.x; it.y = drag.iy + y - drag.y; } else {
      const w = Math.max(p.w * 0.02, drag.w + Math.max(x - drag.x, ((y - drag.y) * drag.w) / drag.h));
      it.h = (drag.h * w) / drag.w;
      it.w = w;
    }
    keepOnPage(it, p.w, p.h);
    drawOverlay(p);
    return;
  }
  // pointerup / pointercancel
  const d = drag;
  drag = null;
  if (d.kind === 'ink') {
    d.path.remove();
    if (e.type === 'pointercancel') return;
    const lw = penWidth(p);
    const box = pointsBox(d.pts, lw);
    const pts = d.pts.map(([px, py]) => [px - box.x, py - box.y]);
    addItem(p, { type: 'ink', d: smoothPath(pts), lw, color: rgb(INKS[ink]), x: box.x, y: box.y, w: box.w, h: box.h, w0: box.w, h0: box.h });
  }
}

const penWidth = (p) => Math.max(p.w, p.h) / 400;

function onKey(e, p) {
  const g = e.target.closest?.('.sd-item');
  if (!g || !selected || selected.p !== p) return;
  const it = selected.item;
  const step = (e.shiftKey ? 5 : 1) * (p.w / 100);
  const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (moves[e.key]) {
    snapshot();
    it.x += moves[e.key][0];
    it.y += moves[e.key][1];
    keepOnPage(it, p.w, p.h);
    drawOverlay(p);
  } else if (e.key === '+' || e.key === '=') scaleSelected(1.1);
  else if (e.key === '-' || e.key === '_') scaleSelected(1 / 1.1);
  else if (e.key === 'Delete' || e.key === 'Backspace') removeSelected();
  else if (e.key === 'Escape') { select(null, null); g.blur(); } else return;
  e.preventDefault();
}

function setMode(m) {
  mode = m;
  for (const b of modeBtns) b.setAttribute('aria-pressed', String(b.dataset.mode === m));
  main.dataset.mode = m;
  modeHint.textContent = k(`modeHint.${m}`);
}

function setInk(c) {
  ink = c;
  if (saving) store.set('ink', c);
  for (const b of inkBtns) b.setAttribute('aria-pressed', String(b.dataset.ink === c));
  drawPad();
}

// The page currently most in view, for placing a signature.
function currentPage() {
  let best = pages[0], seen = -1;
  for (const p of pages) {
    const r = p.el.getBoundingClientRect();
    const v = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
    if (v > seen) { seen = v; best = p; }
  }
  return best;
}

// Middle of the visible part of a page, in page units.
function viewCentreY(p) {
  const r = p.el.getBoundingClientRect();
  return ((Math.max(r.top, 0) + Math.min(r.bottom, innerHeight)) / 2 - r.top) * unitsPerPx(p);
}

function placeSignature(sig) {
  if (!kind) return;
  const p = currentPage();
  const cy = viewCentreY(p);
  const w = p.w * 0.28, hh = (w * sig.h) / sig.w;
  addItem(p, { type: 'sig', src: sig.src, x: (p.w - w) / 2, y: cy - hh / 2, w, h: hh, w0: w, h0: hh });
  if (narrow.matches) showSheet(false, false);
  p.svg.querySelector(`[data-id="${selected.item.id}"]`)?.focus();
  toast(k('placed', { page: pages.indexOf(p) + 1 }));
}

function placeMark(m) {
  if (!kind) return;
  const p = currentPage();
  const size = Math.max(p.w, p.h) / 35;
  addItem(p, { type: 'ink', mark: m, d: MARKS[m], lw: 3, color: rgb(INKS[ink]), x: (p.w - size) / 2, y: viewCentreY(p) - size / 2, w: size, h: size, w0: 24, h0: 24 });
  if (narrow.matches) showSheet(false, false);
  p.svg.querySelector(`[data-id="${selected.item.id}"]`)?.focus();
}

function showSheet(open, focus = true) {
  sigsPanel.classList.toggle('sd-open-sheet', open);
  sigsToggle.setAttribute('aria-expanded', String(open));
  if (open && focus) sigsPanel.querySelector('button')?.focus();
  else if (!open && focus && narrow.matches && kind) sigsToggle.focus();
}

// Saving ---------------------------------------------------------------

const imgCache = new Map();
async function sigImage(src) {
  if (!imgCache.has(src)) {
    const img = new Image();
    img.src = src;
    await img.decode();
    imgCache.set(src, img);
  }
  return imgCache.get(src);
}

async function drawItems(ctx, items) {
  for (const it of items) {
    ctx.save();
    ctx.translate(it.x, it.y);
    ctx.scale(local(it), local(it));
    if (it.type === 'sig') ctx.drawImage(await sigImage(it.src), 0, 0, it.w0, it.h0);
    else if (it.type === 'ink') {
      Object.assign(ctx, { strokeStyle: it.color, lineWidth: it.lw, lineCap: 'round', lineJoin: 'round' });
      ctx.stroke(new Path2D(it.d));
    } else {
      Object.assign(ctx, { fillStyle: it.color, font: `${it.fs}px ${SANS}` });
      ctx.fillText(it.text, 0, it.fs);
    }
    ctx.restore();
  }
}

function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

const baseName = () => fileName.replace(/\.[^.]+$/, '') || 'document';
let busy = false;

async function save(asPdf = false) {
  if (!kind || busy) return;
  if (!pages.some((p) => p.items.length) && !fieldsChanged() && !(await confirmDialog({ title: k('empty.title'), body: k('empty.body'), confirmLabel: k('empty.ok') }))) return;
  busy = true;
  toast(k('saving'));
  try {
    if (kind === 'pdf') {
      const overlays = [];
      for (const [i, p] of pages.entries()) {
        const box = itemsBox(p.items, p.w, p.h);
        if (!box) continue;
        const s = Math.min(4, Math.sqrt(6e6 / (box.w * box.h)));
        const c = h('canvas', { width: Math.ceil(box.w * s), height: Math.ceil(box.h * s) });
        const ctx = c.getContext('2d');
        ctx.scale(c.width / box.w, c.height / box.h);
        ctx.translate(-box.x, -box.y);
        await drawItems(ctx, p.items);
        const rgba = ctx.getImageData(0, 0, c.width, c.height).data;
        overlays.push({ page: i, rect: box, width: c.width, height: c.height, rgba });
      }
      const res = await call({ type: 'save', overlays, values: fieldValues() }, overlays.map((o) => o.rgba.buffer));
      download(new Blob([res.bytes], { type: 'application/pdf' }), `${baseName()}-signed.pdf`);
    } else {
      const p = pages[0];
      const s = Math.min(1, Math.sqrt(16e6 / (p.w * p.h)));
      const c = h('canvas', { width: Math.round(p.w * s), height: Math.round(p.h * s) });
      const ctx = c.getContext('2d');
      ctx.scale(s, s);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, p.w, p.h);
      ctx.drawImage(p.img, 0, 0, p.w, p.h);
      await drawItems(ctx, p.items);
      const jpeg = asPdf || imageType === 'image/jpeg';
      const blob = await new Promise((r) => c.toBlob(r, jpeg ? 'image/jpeg' : 'image/png', 0.92));
      if (asPdf) {
        const jb = await blob.arrayBuffer();
        const res = await call({ type: 'imagePdf', jpeg: jb, width: c.width, height: c.height }, [jb]);
        download(new Blob([res.bytes], { type: 'application/pdf' }), `${baseName()}-signed.pdf`);
      } else download(blob, `${baseName()}-signed.${jpeg ? 'jpg' : 'png'}`);
    }
    dirty = false;
    toast(k('saved'));
  } catch {
    messageDialog({ title: k('error.title'), body: k('error.save') });
  } finally { busy = false; }
}

// Signature editor ------------------------------------------------------

let editorOpen = false;
let source = 'draw';
let strokes = [];
let picture = null;
const padCtx = pad.getContext('2d', { willReadFrequently: true });

function openEditor(open) {
  editorOpen = open;
  editor.hidden = !open;
  newSigBtn.setAttribute('aria-expanded', String(open));
  if (open) { clearPad(); setSource(source); } else newSigBtn.focus();
}

function setSource(s) {
  source = s;
  sourceBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(sources[i] === s)));
  nameField.hidden = s !== 'type';
  pictureField.hidden = s !== 'picture';
  padHint.textContent = k(`sig.hint.${s}`);
  pad.classList.toggle('sd-pad-draw', s === 'draw');
  drawPad();
  if (s === 'type') nameInput.focus();
}

function clearPad() {
  strokes = [];
  picture = null;
  nameInput.value = '';
  drawPad();
}

function drawPad() {
  const { width: W, height: H } = pad;
  padCtx.clearRect(0, 0, W, H);
  const color = rgb(INKS[ink]);
  if (source === 'draw') {
    Object.assign(padCtx, { strokeStyle: color, lineWidth: 6, lineCap: 'round', lineJoin: 'round' });
    for (const s of strokes) padCtx.stroke(new Path2D(smoothPath(s)));
  } else if (source === 'type') {
    const text = nameInput.value.trim();
    if (!text) return;
    let fs = 130;
    padCtx.font = `italic ${fs}px ${SCRIPT}`;
    const w = padCtx.measureText(text).width;
    if (w > W - 60) fs = Math.max(30, (fs * (W - 60)) / w);
    Object.assign(padCtx, { font: `italic ${fs}px ${SCRIPT}`, fillStyle: color, textAlign: 'center', textBaseline: 'alphabetic' });
    padCtx.fillText(text, W / 2, H * 0.68);
  } else if (picture) {
    const f = Math.min((W - 20) / picture.width, (H - 20) / picture.height);
    const w = picture.width * f, hh = picture.height * f;
    const x = Math.floor((W - w) / 2), y = Math.floor((H - hh) / 2);
    padCtx.drawImage(picture, x, y, w, hh);
    const part = padCtx.getImageData(x, y, Math.ceil(w), Math.ceil(hh));
    padCtx.putImageData(inkFromPhoto(part.data, INKS[ink]) && part, x, y);
  }
}

let padStroke = null;
pad.addEventListener('pointerdown', (e) => {
  if (source !== 'draw' || e.button > 0) return;
  pad.setPointerCapture?.(e.pointerId);
  padStroke = [padPoint(e)];
  strokes.push(padStroke);
  drawPad();
  e.preventDefault();
});
pad.addEventListener('pointermove', (e) => {
  if (!padStroke) return;
  for (const ev of e.getCoalescedEvents?.() || [e]) padStroke.push(padPoint(ev));
  drawPad();
});
for (const ev of ['pointerup', 'pointercancel']) pad.addEventListener(ev, () => { padStroke = null; });
function padPoint(e) {
  const r = pad.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * pad.width, ((e.clientY - r.top) / r.height) * pad.height];
}

async function loadPicture() {
  const f = pictureInput.files[0];
  pictureInput.value = '';
  if (!f) return;
  try {
    picture = await createImageBitmap(f);
    drawPad();
  } catch {
    messageDialog({ title: k('error.title'), body: k('error.image') });
  }
}

function saveSignature() {
  const data = padCtx.getImageData(0, 0, pad.width, pad.height);
  const box = trimBox(data.data, pad.width, pad.height, 6);
  if (!box) { toast(k('sig.emptyPad')); return; }
  const c = h('canvas', { width: box.w, height: box.h });
  c.getContext('2d').putImageData(padCtx.getImageData(box.x, box.y, box.w, box.h), 0, 0);
  const sig = { id: `s${Date.now().toString(36)}`, src: c.toDataURL('image/png'), w: box.w, h: box.h };
  signatures = [sig, ...signatures].slice(0, MAX_SIGS);
  const kept = saving && store.set('signatures', signatures);
  toast(k(kept ? 'sig.saved' : 'sig.notStored'));
  openEditor(false);
  renderSigs();
  if (kind) placeSignature(sig);
  else sigList.querySelector('button')?.focus();
}

function renderSigs() {
  sigList.replaceChildren(...signatures.map((s, i) => h('li', { class: 'sd-sig' },
    h('button', {
      type: 'button', class: 'sd-sig-place', disabled: !kind, 'aria-label': k('sig.place', { n: i + 1 }), onclick: () => placeSignature(s),
    }, h('img', { src: s.src, alt: '' })),
    h('button', { type: 'button', class: 'icon-btn sd-sig-remove', 'aria-label': k('sig.remove', { n: i + 1 }), onclick: () => removeSignature(s) }, icon('trash')),
  )));
  sigEmpty.textContent = k(signatures.length ? (kind ? 'sig.tap' : 'sig.openFirst') : 'sig.none');
  for (const b of markBtns) b.disabled = !kind;
}

async function removeSignature(s) {
  if (!(await confirmDialog({ title: k('sig.removeTitle'), body: k('sig.removeBody'), confirmLabel: k('sig.removeOk'), danger: true }))) return;
  signatures = signatures.filter((x) => x !== s);
  if (saving) store.set('signatures', signatures);
  renderSigs();
  toast(k('sig.removed'));
  (sigList.querySelector('button') || newSigBtn).focus();
}

function updateUi() {
  openPanel.hidden = !!kind;
  docBar.hidden = zoomRow.hidden = !kind;
  pageRow.hidden = pages.length < 2;
  toolBar.hidden = !kind && !narrow.matches;
  const where = pages.length > 1 ? k('page', { n: pageInView + 1, total: pages.length }) : docMeta.textContent;
  stateLine.textContent = kind ? `${fileName} \u00B7 ${where}` : name;
  if (!kind) itemPanel.hidden = true;
  renderSigs();
}

arrange();
setMode('move');
