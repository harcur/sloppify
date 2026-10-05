// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

let el = null;
let timer = 0;

// Short status message, announced to screen readers. An optional action
// ({ label, onClick }) adds a button, such as Undo, that clears the toast.
export function toast(message, ms = 3000, action = null) {
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
  }
  // Inside an open modal dialog the rest of the page is inert, so show it there.
  const host = document.querySelector('dialog[open]') ?? document.body;
  if (el.parentNode !== host) host.append(el);
  el.replaceChildren(message);
  clearTimeout(timer);
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.addEventListener('click', () => { clearTimeout(timer); el.replaceChildren(); action.onClick(); });
    el.append(btn);
  }
  timer = setTimeout(() => { el.replaceChildren(); }, ms);
}
