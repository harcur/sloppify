// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// The options sheet of an app page (initPage({ app: true })). On narrow
// screens the page fills the screen and hides the site footer, so whatever
// doesn't fit (settings, help) goes in here, followed by the footer's text and
// source link. It slides up from the bottom; on wide screens it's not used.

import { t } from './i18n.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { sourceUrl } from './config.js';

let count = 0;

// returnFocus: the button that opens the sheet; focus goes back to it on close.
export function optionsSheet({ title, sourcePath, returnFocus = null }) {
  const titleId = `sheet-title-${++count}`;
  const body = h('div', { class: 'sheet-body' });
  const sheet = h('dialog', { class: 'dialog sheet', 'aria-labelledby': titleId },
    h('div', { class: 'sheet-head' },
      h('h2', { class: 'dialog-title', id: titleId }, title),
      h('button', { type: 'button', class: 'btn', onclick: () => sheet.close() }, t('sheet.close')),
    ),
    body,
    h('div', { class: 'sheet-foot' },
      h('p', {}, t('footer.text')),
      h('p', {}, h('a', { href: sourceUrl(sourcePath), rel: 'noreferrer' }, icon('source'), t('footer.source'))),
    ),
  );
  sheet.addEventListener('close', () => { if (returnFocus?.isConnected) returnFocus.focus(); });
  return {
    sheet,
    body,
    open: () => { if (!sheet.open) sheet.showModal(); },
    close: () => { if (sheet.open) sheet.close(); },
  };
}
