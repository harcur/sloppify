// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Makes puzzles off the main thread, so the page never freezes on slow phones.
import { generate } from './logic.js';

self.addEventListener('message', (e) => {
  const { id, level } = e.data;
  const { puzzle, solution } = generate(level);
  self.postMessage({ id, puzzle, solution });
});
