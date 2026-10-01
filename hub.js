// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { initPage, root, hubStore, getFavourites, getRecent, toggleFavourite } from './shared/page.js';
import { t, lang } from './shared/i18n.js';
import { h } from './shared/dom.js';
import { icon } from './shared/icons.js';
import { orderTools, localize } from './hub-order.js';

const { main, slot } = initPage({ license: 'MIT', sourcePath: '' });

const input = h('input', {
  type: 'search', id: 'search', class: 'search-input',
  placeholder: t('hub.placeholder'), autocomplete: 'off', spellcheck: 'false',
  'aria-controls': 'hub-groups',
});
slot.append(h('div', { class: 'search', role: 'search' },
  h('label', { for: 'search', class: 'sr-only' }, t('hub.search')),
  icon('search'),
  input,
));

const status = h('p', { class: 'sr-only', role: 'status' });
const list = h('div', { id: 'hub-groups' });
main.append(h('h1', { class: 'sr-only' }, t('hub.title')), status, list);

let manifest = null;
input.value = String(hubStore.get('search', '') ?? '');
input.addEventListener('input', () => {
  hubStore.set('search', input.value);
  render();
});

load();

async function load() {
  try {
    // Check with the server every time (a 304 when unchanged), so new tools show up right after a deploy.
    const res = await fetch(new URL('tools.json', root), { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    manifest = await res.json();
  } catch {
    list.replaceChildren(h('p', { class: 'hub-message' }, t('hub.loadFailed')));
    return;
  }
  render();
  restoreScroll();
}

function render(focusStarOf = null) {
  if (!manifest) return;
  const favs = getFavourites();
  const q = input.value.trim();
  const groups = orderTools(manifest.tools, {
    favourites: favs, recent: getRecent(), query: q, lang, categories: manifest.categories ?? {},
  });

  if (!groups.length) {
    const msg = q ? t('hub.noResults', { q }) : '';
    list.replaceChildren(h('p', { class: 'hub-message' }, msg));
    status.textContent = msg;
    return;
  }

  if (q) {
    const n = groups[0].items.length;
    status.textContent = n === 1 ? t('hub.result1') : t('hub.results', { n });
  } else if (!focusStarOf) {
    status.textContent = '';
  }

  const showLabels = groups.length > 1;
  list.replaceChildren(...groups.map((g) => {
    const headingId = `group-${g.key}`;
    return h('section', { class: 'group', 'aria-labelledby': headingId },
      h('div', { class: showLabels ? 'group-head' : 'sr-only' },
        h('h2', { class: 'group-label', id: headingId }, t(`hub.group.${g.key}`)),
        showLabels && h('span', { class: 'group-rule', 'aria-hidden': 'true' }),
      ),
      h('ul', { class: 'grid' }, g.items.map((tool) => card(tool, favs.includes(tool.id)))),
    );
  }));

  if (focusStarOf) list.querySelector(`[data-star="${CSS.escape(focusStarOf)}"]`)?.focus();
}

function card(tool, isFav) {
  const name = localize(tool.name, lang);
  const category = String(tool.category ?? '').replace(/[^a-z0-9-]/g, '');
  const catLabel = localize(manifest.categories?.[tool.category]?.label, lang) || category;
  const href = /^[a-z0-9/_-]+$/i.test(tool.path ?? '') ? tool.path : '#';

  const star = h('button', {
    type: 'button', class: 'star',
    'aria-pressed': String(isFav),
    'aria-label': t('hub.star', { name }),
    'data-star': tool.id,
  }, icon('star'));
  star.addEventListener('click', () => {
    const on = toggleFavourite(tool.id);
    status.textContent = t(on ? 'toast.favAdded' : 'toast.favRemoved', { name });
    render(tool.id);
  });

  return h('li', { class: `card cat-${category}` },
    h('div', { class: 'card-top' }, h('span', { class: 'card-cat' }, catLabel), star),
    h('h3', { class: 'card-name' }, h('a', { href }, name)),
    h('p', { class: 'card-desc' }, localize(tool.description, lang)),
  );
}

// Remember scroll position between visits.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
let scrollTimer = 0;
const saveScroll = () => hubStore.set('scroll', Math.round(window.scrollY));
window.addEventListener('scroll', () => {
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(saveScroll, 200);
}, { passive: true });
window.addEventListener('pagehide', saveScroll);

function restoreScroll() {
  const y = Number(hubStore.get('scroll', 0)) || 0;
  if (y > 0) requestAnimationFrame(() => window.scrollTo(0, y));
}
