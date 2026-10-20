// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Plain blocking script in <head>, so the saved theme applies before first paint.
(function () {
  try {
    var t = JSON.parse(localStorage.getItem('sloppify:hub:theme'));
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* storage blocked: follow the system setting */ }
})();
