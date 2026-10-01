// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

let el = null;
let timer = 0;

// Short status message, announced to screen readers.
export function toast(message, ms = 3000) {
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
  }
  // Inside an open modal dialog the rest of the page is inert, so show it there.
  const host = document.querySelector('dialog[open]') ?? document.body;
  if (el.parentNode !== host) host.append(el);
  el.textContent = message;
  clearTimeout(timer);
  timer = setTimeout(() => { el.textContent = ''; }, ms);
}
