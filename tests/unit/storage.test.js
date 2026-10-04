// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage } from './memory-storage.js';
import {
  setBackend, openStore, exportAll, importAll, resetAll, resetTool, validateBackup, storageAvailable, BACKUP_FORMAT,
} from '../../shared/storage.js';

let mem;
beforeEach(() => { mem = new MemoryStorage(); setBackend(mem); });

test('values are namespaced per tool and round-trip as JSON', () => {
  const a = openStore('sudoku');
  const b = openStore('timer');
  a.set('state', { grid: [1, 2, 3] });
  b.set('state', 42);
  assert.deepEqual(a.get('state'), { grid: [1, 2, 3] });
  assert.equal(b.get('state'), 42);
  assert.equal(mem.getItem('sloppify:sudoku:state'), '{"grid":[1,2,3]}');
  assert.equal(a.get('missing', 'fallback'), 'fallback');
});

test('rejects invalid store ids', () => {
  assert.throws(() => openStore('Bad Id'));
  assert.throws(() => openStore('../x'));
});

test('reset and export never touch keys from other sites on the same origin', () => {
  mem.setItem('other-project:settings', 'keep me');
  openStore('hub').set('theme', 'dark');
  const backup = exportAll();
  assert.deepEqual(Object.keys(backup.tools), ['hub']);
  resetAll();
  assert.equal(mem.getItem('other-project:settings'), 'keep me');
  assert.equal(mem.getItem('sloppify:hub:theme'), null);
});

test('resetting one tool leaves other tools, the hub and other sites alone', () => {
  mem.setItem('other-project:settings', 'keep me');
  openStore('mines').set('game', { cells: [1] });
  openStore('minesweeper').set('game', 'similar prefix');
  openStore('sudoku').set('best', 90);
  openStore('hub').set('favourites', ['mines']);
  resetTool('mines');
  assert.equal(mem.getItem('sloppify:mines:game'), null);
  assert.equal(mem.getItem('sloppify:mines:__schema'), null);
  assert.equal(openStore('minesweeper').get('game'), 'similar prefix');
  assert.equal(openStore('sudoku').get('best'), 90);
  assert.deepEqual(openStore('hub').get('favourites'), ['mines']);
  assert.equal(mem.getItem('other-project:settings'), 'keep me');
  assert.throws(() => resetTool('../x'));
});

test('export then import restores the same data', () => {
  const s = openStore('sudoku', { version: 2, migrate: (d) => d });
  s.set('best', 120);
  openStore('hub').set('favourites', ['sudoku']);
  const backup = JSON.parse(JSON.stringify(exportAll(new Date('2026-10-01T00:00:00Z'))));
  assert.equal(backup.format, BACKUP_FORMAT);
  assert.equal(backup.tools.sudoku.schemaVersion, 2);
  assert.deepEqual(backup.tools.sudoku.data, { best: 120 });

  resetAll();
  openStore('hub').set('favourites', []);
  importAll(backup);
  assert.deepEqual(openStore('hub').get('favourites'), ['sudoku']);
  assert.equal(openStore('sudoku', { version: 2 }).get('best'), 120);
});

test('import replaces everything rather than merging', () => {
  openStore('timer').set('laps', [1, 2]);
  importAll({ format: BACKUP_FORMAT, formatVersion: 1, exportedAt: '', tools: { hub: { schemaVersion: 1, data: { theme: 'light' } } } });
  assert.equal(openStore('timer').get('laps'), null);
  assert.equal(openStore('hub').get('theme'), 'light');
});

test('invalid backups are rejected and nothing changes', () => {
  openStore('hub').set('theme', 'dark');
  const bad = [
    null, [], 'x',
    { format: 'other', formatVersion: 1, tools: {} },
    { format: BACKUP_FORMAT, formatVersion: 99, tools: {} },
    { format: BACKUP_FORMAT, formatVersion: 1, tools: { 'Bad Id': { schemaVersion: 1, data: {} } } },
    { format: BACKUP_FORMAT, formatVersion: 1, tools: { hub: { schemaVersion: 0, data: {} } } },
    { format: BACKUP_FORMAT, formatVersion: 1, tools: { hub: { schemaVersion: 1, data: [] } } },
    { format: BACKUP_FORMAT, formatVersion: 1, tools: { hub: { schemaVersion: 1, data: { __schema: 5 } } } },
  ];
  for (const b of bad) {
    assert.equal(validateBackup(b).ok, false, JSON.stringify(b));
    assert.throws(() => importAll(b));
  }
  assert.equal(openStore('hub').get('theme'), 'dark');
});

test('a failed import restores the previous data', () => {
  openStore('hub').set('theme', 'dark');
  const backup = { format: BACKUP_FORMAT, formatVersion: 1, exportedAt: '', tools: {
    hub: { schemaVersion: 1, data: { a: 1, b: 2, c: 3, d: 4 } },
  } };
  mem.failAt = mem.writes + 3;
  assert.throws(() => importAll(backup));
  assert.equal(openStore('hub').get('theme'), 'dark');
  assert.equal(openStore('hub').get('a'), null);
});

test('older data is migrated when the tool opens', () => {
  openStore('sudoku', { version: 1 }).set('score', 10);
  const s = openStore('sudoku', {
    version: 2,
    migrate: (data, from, to) => {
      assert.equal(from, 1);
      assert.equal(to, 2);
      return { best: { score: data.score } };
    },
  });
  assert.equal(s.status, 'ok');
  assert.deepEqual(s.get('best'), { score: 10 });
  assert.equal(s.get('score'), null);
});

test('data that cannot be migrated is marked incompatible and left intact', () => {
  openStore('sudoku', { version: 1 }).set('score', 10);
  const s = openStore('sudoku', { version: 2, migrate: () => { throw new Error('nope'); } });
  assert.equal(s.status, 'incompatible');
  assert.equal(s.get('score'), 10);
  s.clear();
  assert.equal(s.status, 'ok');
  assert.equal(s.get('score'), null);
});

test('data from a newer version is marked incompatible', () => {
  openStore('sudoku', { version: 3 });
  assert.equal(openStore('sudoku', { version: 2 }).status, 'incompatible');
});

test('works without storage', () => {
  setBackend(null);
  assert.equal(storageAvailable(), false);
  const s = openStore('hub');
  assert.equal(s.set('x', 1), false);
  assert.equal(s.get('x', 'none'), 'none');
});
