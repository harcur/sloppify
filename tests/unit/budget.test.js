// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Size budgets from docs/TOOL-GUIDELINES.md. Uncompressed bytes; README.md and LICENSE don't count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

const KB = 1024;
const BUDGET = { tool: 60 * KB, data: 200 * KB, shared: 50 * KB, hub: 20 * KB, image: 20 * KB };

// Tools allowed over budget. Each needs a reason here and an entry in docs/DECISIONS.md.
// Example: 'chess': { tool: 180 * KB, reason: 'vendored engine' },
const EXCEPTIONS = {
  'pick-a-person': { tool: 80 * KB, reason: 'five party modes in one tool' },
};

const root = new URL('../../', import.meta.url).pathname;
const IGNORED = new Set(['README.md', 'LICENSE']);
const IMAGES = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg']);

function files(dir, skipDirs = []) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return skipDirs.includes(name) ? [] : files(path);
    return IGNORED.has(name) ? [] : [path];
  });
}
const size = (paths) => paths.reduce((sum, p) => sum + statSync(p).size, 0);
const kb = (bytes) => `${(bytes / KB).toFixed(1)} KB`;

const toolDirs = readdirSync(join(root, 'tools')).filter((d) => statSync(join(root, 'tools', d)).isDirectory());

for (const id of toolDirs) {
  const dir = join(root, 'tools', id);
  const limits = { ...BUDGET, ...EXCEPTIONS[id] };
  test(`tools/${id} stays within its budget`, () => {
    const own = size(files(dir, ['data']));
    assert.ok(own <= limits.tool, `tools/${id} is ${kb(own)}, budget ${kb(limits.tool)}`);
    if (existsSync(join(dir, 'data'))) {
      const data = size(files(join(dir, 'data')));
      assert.ok(data <= limits.data, `tools/${id}/data is ${kb(data)}, budget ${kb(limits.data)}`);
    }
  });
}

test('shared/ stays within its budget', () => {
  const total = size(files(join(root, 'shared')));
  assert.ok(total <= BUDGET.shared, `shared/ is ${kb(total)}, budget ${kb(BUDGET.shared)}`);
});

test('hub stays within its budget', () => {
  const hub = readdirSync(root).filter((n) => n === 'index.html' || n === 'tools.json' || /^hub.*\.(js|css)$/.test(n));
  const total = size(hub.map((n) => join(root, n)));
  assert.ok(total <= BUDGET.hub, `hub is ${kb(total)}, budget ${kb(BUDGET.hub)}`);
});

test('no image is over budget', () => {
  const images = [...files(root, ['node_modules', '.git', 'test-results', 'playwright-report', '_site'])]
    .filter((p) => IMAGES.has(extname(p).toLowerCase()));
  for (const p of images) {
    const s = statSync(p).size;
    assert.ok(s <= BUDGET.image, `${basename(p)} is ${kb(s)}, budget ${kb(BUDGET.image)}`);
  }
});
