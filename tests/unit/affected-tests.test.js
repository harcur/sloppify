// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { affectedSpecs, describe } from '../../scripts/affected-tests.mjs';

const SPECS = new Set(['tests/e2e/hub.spec.js', 'tests/e2e/mines.spec.js', 'tests/e2e/sudoku.spec.js']);
const pick = (...files) => describe(affectedSpecs(files, (p) => SPECS.has(p)));

test('a tool change runs only that tool', () => {
  assert.equal(pick('tools/mines/app.js', 'tools/mines/style.css'), 'tests/e2e/mines.spec.js');
  assert.equal(pick('tools/sudoku/logic.js', 'tests/e2e/mines.spec.js'), 'tests/e2e/mines.spec.js tests/e2e/sudoku.spec.js');
});

test('a new tool without a spec yet, or a tool README, runs nothing', () => {
  assert.equal(pick('tools/new-thing/app.js'), 'none');
  assert.equal(pick('tools/mines/README.md'), 'none');
});

test('hub files run the hub', () => {
  assert.equal(pick('hub.js'), 'tests/e2e/hub.spec.js');
  assert.equal(pick('tools.json', 'tools/categories.json'), 'tests/e2e/hub.spec.js');
});

test('shared code, config, CI, helpers and unknown files run everything', () => {
  for (const f of ['shared/page.js', 'sw.js', 'tests/e2e/helpers.js', 'playwright.config.js', 'package.json',
    'package-lock.json', '.github/workflows/ci.yml', 'scripts/affected-tests.mjs', 'something-new.js']) {
    assert.equal(pick('tools/mines/app.js', f), 'all', f);
  }
});

test('docs, unit tests and the template run nothing', () => {
  assert.equal(pick('docs/DECISIONS.md', 'CLAUDE.md', '.claude/skills/x/SKILL.md', 'tests/unit/mines.test.js', 'tools/_template/app.js', 'REUSE.toml'), 'none');
  assert.equal(pick(), 'none');
});
