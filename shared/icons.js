// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Static, trusted SVG markup only. Stroke icons on a 24px grid.
// TODO: replace "source" with the official mark-github icon from GitHub's
// Octicons (MIT), vendored into this folder, before launch.
const paths = {
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5 21 21"/>',
  star: '<polygon points="12 3 14.8 8.9 21 9.6 16.4 13.9 17.6 20 12 17 6.4 20 7.6 13.9 3 9.6 9.2 8.9"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 15V4M7 9l5-5 5 5M5 20h14"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  back: '<path d="M10 6l-6 6 6 6M4 12h16"/>',
  source: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/>',
};

export function icon(name) {
  const t = document.createElement('template');
  t.innerHTML = `<svg class="icon icon-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
  return t.content.firstElementChild;
}
