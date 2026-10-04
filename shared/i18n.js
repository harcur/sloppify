// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { config } from './config.js';
import { strings as shared } from './strings.js';

export const lang = config.lang;
const layers = [shared];

// Tools add their own strings on top of the shared ones.
export function extendStrings(dict) {
  layers.push(dict);
}

// t('hub.results', { n: 3 }) -> "3 results". Falls back to English, then to the key.
export function t(key, vars = {}) {
  let s;
  for (let i = layers.length - 1; i >= 0 && s == null; i--) {
    s = layers[i][lang]?.[key] ?? layers[i].en?.[key];
  }
  if (s == null) return key;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}
