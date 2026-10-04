// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { h } from './dom.js';
import { t } from './i18n.js';
import { toast } from './toast.js';
import { downloadBackup } from './backup.js';

let n = 0;

// Native modal <dialog>: traps focus, closes on Escape, restores focus afterwards.
function open({ title, body, actions, initialFocus }) {
  return new Promise((resolve) => {
    const id = `dialog-title-${++n}`;
    const returnTo = document.activeElement;
    let result = false;
    const dlg = h('dialog', { class: 'dialog', 'aria-labelledby': id },
      h('h2', { class: 'dialog-title', id }, title),
      h('p', { class: 'dialog-body' }, body),
    );
    const done = (value) => { result = value; dlg.close(); };
    dlg.append(h('div', { class: 'dialog-actions' }, actions(done)));
    dlg.addEventListener('close', () => {
      dlg.remove();
      if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus();
      resolve(result);
    });
    document.body.append(dlg);
    dlg.showModal();
    dlg.querySelector(initialFocus)?.focus();
  });
}

export function confirmDialog({ title, body, confirmLabel, danger = false, offerExport = false }) {
  return open({
    title,
    body,
    initialFocus: '[data-cancel]',
    actions: (done) => [
      offerExport && h('button', {
        type: 'button', class: 'btn btn-link',
        onclick: () => { downloadBackup(); toast(t('toast.exported')); },
      }, t('dialog.exportFirst')),
      h('span', { class: 'dialog-spacer' }),
      h('button', { type: 'button', class: 'btn', 'data-cancel': true, onclick: () => done(false) }, t('dialog.cancel')),
      h('button', { type: 'button', class: danger ? 'btn btn-danger' : 'btn btn-primary', onclick: () => done(true) }, confirmLabel),
    ],
  });
}

export function messageDialog({ title, body }) {
  return open({
    title,
    body,
    initialFocus: '[data-ok]',
    actions: (done) => [
      h('span', { class: 'dialog-spacer' }),
      h('button', { type: 'button', class: 'btn btn-primary', 'data-ok': true, onclick: () => done(true) }, t('dialog.ok')),
    ],
  });
}

// Generic dialog with custom actions, used for the first-visit notice.
export function customDialog(opts) {
  return open(opts);
}
