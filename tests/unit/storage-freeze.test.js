// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Own file: freeze() lasts until the page (here, the process) ends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage } from './memory-storage.js';
import { setBackend, openStore, resetTool, freeze } from '../../shared/storage.js';

test('after a reset and freeze, a late save cannot bring the data back', () => {
  const mem = new MemoryStorage();
  setBackend(mem);
  const store = openStore('mines');
  store.set('game', { cells: [1] });
  resetTool('mines');
  freeze();
  assert.equal(store.set('game', { cells: [1] }), false);
  assert.equal(mem.getItem('sloppify:mines:game'), null);
});
