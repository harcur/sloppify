// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Runs the solver off the main thread, so the page never freezes on slow
// phones: finds winnable deals, and the next move for a hint.
import { winnableDeal, hint } from './solver.js';

self.addEventListener('message', (e) => {
  const { id, type, draw, game } = e.data;
  const result = type === 'hint' ? hint(game) : winnableDeal(draw).game;
  self.postMessage({ id, result });
});
