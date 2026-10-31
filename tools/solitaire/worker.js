// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Runs the solvers off the main thread, so the page never freezes on slow
// phones: finds winnable deals, and the next move for a hint.
import * as solver from './solver.js';
import * as freecell from './freecell-solver.js';

self.addEventListener('message', (e) => {
  const { id, job } = e.data;
  self.postMessage({ id, result: run(job) });
});

function run({ type, variant, game }) {
  if (variant === 'freecell') return type === 'hint' ? freecell.hint(game) : freecell.winnableDeal().game;
  return type === 'hint' ? solver.hint(game) : solver.winnableDeal(variant).game;
}
