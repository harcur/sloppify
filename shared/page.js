// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// The shared shell for every page: header with menu, footer, first-visit
// notice, theme, recents, favourites and offline caching.

import { config, sourceUrl } from './config.js';
import { t, lang } from './i18n.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { openStore, importAll, resetAll, validateBackup, storageAvailable } from './storage.js';
import { downloadBackup } from './backup.js';
import { confirmDialog, messageDialog, customDialog } from './dialog.js';
import { toast } from './toast.js';

export const root = new URL('../', import.meta.url);
export const hubStore = openStore('hub', { version: 1 });

const RECENT_MAX = 20;
const THEMES = ['system', 'light', 'dark'];
const FLASH_KEY = 'sloppify:flash'; // sessionStorage, survives one reload

const strList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

export function getFavourites() { return strList(hubStore.get('favourites', [])); }
export function isFavourite(id) { return getFavourites().includes(id); }
export function toggleFavourite(id) {
  const favs = getFavourites();
  const on = !favs.includes(id);
  hubStore.set('favourites', on ? [...favs, id] : favs.filter((x) => x !== id));
  return on;
}

export function getRecent() { return strList(hubStore.get('recent', [])); }
function recordRecent(id) {
  hubStore.set('recent', [id, ...getRecent().filter((x) => x !== id)].slice(0, RECENT_MAX));
}

function getTheme() {
  const v = hubStore.get('theme', 'system');
  return THEMES.includes(v) ? v : 'system';
}
function applyTheme(v) {
  if (v === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', v);
}

function flash(message) {
  try { sessionStorage.setItem(FLASH_KEY, message); } catch { /* blocked */ }
}
function showFlash() {
  try {
    const m = sessionStorage.getItem(FLASH_KEY);
    if (m) { sessionStorage.removeItem(FLASH_KEY); toast(m); }
  } catch { /* blocked */ }
}

/**
 * Call once per page.
 *   hub:  initPage({ sourcePath: '' })
 *   tool: initPage({ toolId: 'sudoku', toolName: 'sudoku', license: 'MIT', sourcePath: 'tools/sudoku/' })
 *   app:  true for games that fill the screen on narrow viewports. The header
 *         shrinks to a floating menu button and the footer is hidden, so the
 *         page must show the footer's text and source link itself there.
 * Returns { main, slot }: slot is an empty area in the header (the hub puts search there).
 */
export function initPage({ toolId = null, toolName = '', license = 'MIT', sourcePath = '', app = false } = {}) {
  document.documentElement.lang = lang;
  document.documentElement.classList.toggle('app-page', app);
  applyTheme(getTheme());

  const main = document.getElementById('main');
  main.setAttribute('tabindex', '-1');
  const slot = h('div', { class: 'header-slot' });
  const header = h('header', { class: 'site-header' },
    h('div', { class: 'wrap header-inner' },
      h('a', { class: 'logo', href: root.href }, config.name),
      slot,
      buildMenu({ toolId, toolName }),
    ),
  );
  document.body.prepend(h('a', { class: 'skip', href: '#main' }, t('skip')), header);
  main.after(buildFooter({ license, sourcePath }));

  if (toolId) recordRecent(toolId);

  if (!storageAvailable()) toast(t('storage.unavailable'), 8000);
  else if (!hubStore.get('noticeSeen', false)) showNotice();
  else showFlash();

  registerServiceWorker();
  return { main, slot };
}

/** For tools: if a store's saved data can't be read, offer export and a reset of that tool. */
export async function guardStore(store, toolName) {
  if (store.status !== 'incompatible') return true;
  const ok = await confirmDialog({
    title: t('incompat.title'),
    body: t('incompat.body', { tool: toolName }),
    confirmLabel: t('incompat.reset', { tool: toolName }),
    danger: true,
    offerExport: true,
  });
  if (ok) store.clear();
  return ok;
}

function buildMenu({ toolId, toolName }) {
  const panelId = 'site-menu';
  const button = h('button', {
    type: 'button', class: 'icon-btn menu-btn',
    'aria-expanded': 'false', 'aria-controls': panelId, 'aria-label': t('menu'),
  }, icon('menu'));

  const item = (iconName, label, onclick, extra = '') =>
    h('button', { type: 'button', class: `menu-item ${extra}`.trim(), onclick }, icon(iconName), label);

  const items = [];

  if (toolId) {
    items.push(h('a', { class: 'menu-item', href: root.href }, icon('back'), t('menu.back')));
    const fav = h('button', { type: 'button', class: 'menu-item' });
    const syncFav = () => {
      const on = isFavourite(toolId);
      fav.dataset.on = String(on);
      fav.replaceChildren(icon('star'), on ? t('menu.favRemove') : t('menu.favAdd'));
    };
    fav.addEventListener('click', () => {
      const on = toggleFavourite(toolId);
      syncFav();
      toast(t(on ? 'toast.favAdded' : 'toast.favRemoved', { name: toolName }));
    });
    syncFav();
    items.push(fav, h('hr', { class: 'menu-sep' }));
  }

  const themeButtons = THEMES.map((v) => h('button', {
    type: 'button', class: 'seg-btn', 'data-value': v,
    onclick: () => { hubStore.set('theme', v); applyTheme(v); syncTheme(); },
  }, t(`theme.${v}`)));
  const syncTheme = () => {
    const cur = getTheme();
    for (const b of themeButtons) b.setAttribute('aria-pressed', String(b.dataset.value === cur));
  };
  syncTheme();
  items.push(
    h('p', { class: 'menu-label', id: 'menu-theme-label' }, t('menu.theme')),
    h('div', { class: 'seg', role: 'group', 'aria-labelledby': 'menu-theme-label' }, themeButtons),
    h('hr', { class: 'menu-sep' }),
  );

  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true' });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) importFlow(file);
  });

  items.push(
    h('p', { class: 'menu-label' }, t('menu.data')),
    item('download', t('data.export'), () => { close(true); downloadBackup(); toast(t('toast.exported')); }),
    item('upload', t('data.import'), () => { close(true); fileInput.click(); }),
    item('trash', t('data.reset'), () => { close(true); resetFlow(); }, 'danger'),
    fileInput,
  );

  const panel = h('div', { class: 'menu-panel', id: panelId, hidden: true }, items);
  const wrap = h('div', { class: 'menu' }, button, panel);

  const outside = (e) => { if (!wrap.contains(e.target)) close(false); };
  function open() {
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    panel.querySelector('a, button')?.focus();
    document.addEventListener('pointerdown', outside, true);
  }
  function close(focusButton) {
    if (panel.hidden) return;
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    if (focusButton) button.focus();
  }
  button.addEventListener('click', () => (panel.hidden ? open() : close(false)));
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) { e.stopPropagation(); close(true); }
  });
  wrap.addEventListener('focusout', (e) => {
    if (e.relatedTarget && !wrap.contains(e.relatedTarget)) close(false);
  });
  return wrap;
}

async function importFlow(file) {
  let data = null;
  try { data = JSON.parse(await file.text()); } catch { /* not JSON */ }
  if (!validateBackup(data).ok) {
    await messageDialog({ title: t('import.invalidTitle'), body: t('import.invalid') });
    return;
  }
  const ok = await confirmDialog({
    title: t('import.title'),
    body: t('import.body', { file: file.name }),
    confirmLabel: t('import.confirm'),
    danger: true,
    offerExport: true,
  });
  if (!ok) return;
  try {
    importAll(data);
    flash(t('toast.imported'));
    location.reload();
  } catch {
    await messageDialog({ title: t('import.invalidTitle'), body: t('import.failed') });
  }
}

async function resetFlow() {
  const ok = await confirmDialog({
    title: t('reset.title'),
    body: t('reset.body'),
    confirmLabel: t('reset.confirm'),
    danger: true,
    offerExport: true,
  });
  if (!ok) return;
  resetAll();
  flash(t('toast.reset'));
  location.reload();
}

function showNotice() {
  customDialog({
    title: t('notice.title'),
    body: t('notice.body'),
    initialFocus: '[data-ok]',
    actions: (done) => [
      h('a', { class: 'dialog-link', href: sourceUrl(''), rel: 'noreferrer' }, t('notice.code')),
      h('span', { class: 'dialog-spacer' }),
      h('button', { type: 'button', class: 'btn btn-primary', 'data-ok': true, onclick: () => done(true) }, t('notice.ok')),
    ],
  }).then(() => {
    // Closing with Escape counts as dismissed too.
    hubStore.set('noticeSeen', true);
    showFlash();
  });
}

function buildFooter({ license, sourcePath }) {
  return h('footer', { class: 'site-footer' },
    h('div', { class: 'wrap footer-inner' },
      h('p', { class: 'footer-text' }, t('footer.text')),
      h('p', { class: 'footer-meta' },
        h('span', {}, license),
        h('span', { 'aria-hidden': 'true' }, '\u00b7'),
        h('a', { href: sourceUrl(sourcePath), rel: 'noreferrer' }, icon('source'), t('footer.source')),
      ),
    ),
  );
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register(new URL('sw.js', root)).catch(() => { /* offline support is optional */ });
}
