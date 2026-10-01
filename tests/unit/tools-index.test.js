// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, formatIndex, validateTool } from '../../scripts/tools-index.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const categories = { tool: { label: { en: 'tool' } }, game: { label: { en: 'game' } } };
const good = { name: { en: 'demo' }, description: { en: 'A demo' }, category: 'tool', tags: ['x'], license: 'MIT' };

test('tools.json is up to date with every tool.json (run: node scripts/tools-index.mjs)', () => {
  assert.equal(readFileSync(join(root, 'tools.json'), 'utf8'), formatIndex(buildIndex(root)));
});

test('every tool folder is listed, the template is not', () => {
  const ids = buildIndex(root).tools.map((t) => t.id);
  assert.ok(ids.includes('mines'));
  assert.ok(!ids.includes('_template'));
});

test('the template config is valid, so copying it gives a working start', () => {
  const cfg = JSON.parse(readFileSync(join(root, 'tools/_template/tool.json'), 'utf8'));
  assert.deepEqual(validateTool('my-tool', cfg, categories), []);
});

test('invalid configs are reported, not skipped', () => {
  assert.deepEqual(validateTool('demo', good, categories), []);
  const bad = (patch) => validateTool('demo', { ...good, ...patch }, categories);
  assert.equal(bad({ name: 'demo' }).length, 1);
  assert.equal(bad({ description: { en: '' } }).length, 1);
  assert.equal(bad({ category: 'toy' }).length, 1);
  assert.equal(bad({ tags: 'x' }).length, 1);
  assert.equal(bad({ license: '' }).length, 1);
  assert.equal(bad({ colour: 'red' }).length, 1);
  assert.equal(validateTool('Demo Tool', good, categories).length, 1);
});

test('a folder without tool.json, or a copyleft tool without LICENSE, fails the build', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sloppify-'));
  try {
    mkdirSync(join(dir, 'tools/a'), { recursive: true });
    writeFileSync(join(dir, 'tools/categories.json'), JSON.stringify(categories));
    writeFileSync(join(dir, 'tools/a/index.html'), '');
    assert.throws(() => buildIndex(dir), /tools\/a\/: has no tool\.json/);
    writeFileSync(join(dir, 'tools/a/tool.json'), JSON.stringify({ ...good, license: 'GPL-3.0-or-later' }));
    assert.throws(() => buildIndex(dir), /needs its own LICENSE/);
    writeFileSync(join(dir, 'tools/a/LICENSE'), 'GPL');
    assert.deepEqual(buildIndex(dir).tools.map((t) => [t.id, t.path]), [['a', 'tools/a/']]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
