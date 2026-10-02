// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Picks the browser tests a change needs, so a pull request that touches one
// tool runs that tool's tests instead of every tool's. Playwright's own
// --only-changed follows imports, and our tests open pages by URL instead of
// importing tool code, so it would miss most changes.
//
// The rule: a file that belongs to one tool runs that tool's spec
// (tests/e2e/<id>.spec.js); hub files run the hub spec; anything shared, and
// anything not listed here, runs everything. Docs run nothing.
//
//   node scripts/affected-tests.mjs [base]         print "all", "none" or spec paths
//   node scripts/affected-tests.mjs --run [base] [-- playwright args]
//                                                  run them (base defaults to origin/main)
//
// Dev tooling only, never deployed. CI runs everything on main before deploying.

import { existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join } from 'node:path';

const HUB = new Set([
  'index.html', 'hub.js', 'hub.css', 'hub-order.js', 'tools.json', 'manifest.webmanifest', 'icon.svg',
  'tools/categories.json', 'scripts/tools-index.mjs',
]);
const SPEC_RE = /^tests\/e2e\/([a-z0-9-]+)\.spec\.js$/;
const TOOL_RE = /^tools\/([a-z0-9][a-z0-9-]*)\//;

// Changes that can't affect any page or test.
const isInert = (f) => /\.md$/.test(f) || /^(docs|\.claude|LICENSES)\//.test(f)
  || ['REUSE.toml', 'LICENSE', '.gitignore'].includes(f)
  || f.startsWith('tools/_template/') || /^tests\/unit\//.test(f);

/**
 * files: changed paths, relative to the repo root, with forward slashes.
 * specExists(path): whether a spec file exists.
 * Returns { all: true } or { all: false, specs: [...] } (sorted, maybe empty).
 */
export function affectedSpecs(files, specExists) {
  const specs = new Set();
  for (const f of files) {
    if (isInert(f)) continue;
    const spec = f.match(SPEC_RE);
    if (spec) { if (specExists(f)) specs.add(f); continue; }
    if (HUB.has(f)) { specs.add('tests/e2e/hub.spec.js'); continue; }
    const tool = f.match(TOOL_RE);
    if (tool) {
      const own = `tests/e2e/${tool[1]}.spec.js`;
      if (specExists(own)) specs.add(own);
      continue;
    }
    return { all: true }; // shared code, config, CI, test helpers, or something new
  }
  return { all: false, specs: [...specs].sort() };
}

export const describe = (r) => (r.all ? 'all' : r.specs.length ? r.specs.join(' ') : 'none');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const args = process.argv.slice(2);
  const dash = args.indexOf('--');
  const own = dash < 0 ? args : args.slice(0, dash);
  const extra = dash < 0 ? [] : args.slice(dash + 1);
  const run = own.includes('--run');
  const base = own.find((a) => !a.startsWith('--')) ?? 'origin/main';

  let files;
  try {
    const committed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { cwd: root, encoding: 'utf8' });
    // Locally, uncommitted and untracked changes count too.
    const local = run ? execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' })
      .split('\n').filter(Boolean).map((l) => l.slice(3).split(' -> ').pop()) : [];
    files = [...committed.split('\n').filter(Boolean), ...local];
  } catch (e) {
    console.error(`Couldn't compare with ${base}, so everything runs: ${e.message.split('\n')[0]}`);
    files = null;
  }
  const result = files ? affectedSpecs(files, (p) => existsSync(join(root, p))) : { all: true };

  if (!run) {
    console.log(describe(result));
  } else if (!result.all && !result.specs.length) {
    console.log('No browser tests affected.');
  } else {
    console.log(`Running: ${describe(result)}`);
    const r = spawnSync('npx', ['playwright', 'test', ...(result.all ? [] : result.specs), ...extra], { cwd: root, stdio: 'inherit' });
    process.exit(r.status ?? 1);
  }
}
