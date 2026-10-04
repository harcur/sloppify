// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Finds winnable deals off the main thread, so the page never freezes on slow phones.
import { winnableDeal } from './solver.js';

self.addEventListener('message', (e) => {
  const { id, draw } = e.data;
  self.postMessage({ id, game: winnableDeal(draw).game });
});
