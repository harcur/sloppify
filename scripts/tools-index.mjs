// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Builds tools.json, the hub's list of tools, from each tool's own config.
//
// Every folder in tools/ that has a tool.json is a tool; folders starting
// with "_" (the template) are skipped. The folder name is the tool's id and
// its path. Categories come from tools/categories.json.
//
//   node scripts/tools-index.mjs           write tools.json
//   node scripts/tools-index.mjs --check   fail if tools.json is out of date
//
// Dev tooling only, never deployed. CI checks the committed file and the
// deploy job regenerates it before publishing.

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const NOTE = 'Generated from tools/*/tool.json by scripts/tools-index.mjs. Do not edit by hand.';

const isText = (v) => typeof v === 'string' && v.trim() !== '';
const isLocalized = (v) => v && typeof v === 'object' && !Array.isArray(v) && isText(v.en) && Object.values(v).every(isText);

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`${file}: ${e.message}`);
  }
}

// Returns a list of problems with one tool's config (empty when it's valid).
export function validateTool(id, cfg, categories, dir) {
  const problems = [];
  const say = (m) => problems.push(`tools/${id}/tool.json: ${m}`);
  if (!ID_RE.test(id)) say('folder name must be lowercase letters, digits and dashes');
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return [...problems, `tools/${id}/tool.json: must be a JSON object`];
  if (!isLocalized(cfg.name)) say('"name" must be an object of non-empty strings with at least "en"');
  if (!isLocalized(cfg.description)) say('"description" must be an object of non-empty strings with at least "en"');
  if (!Object.hasOwn(categories, cfg.category)) say(`"category" must be one of: ${Object.keys(categories).join(', ')}`);
  if (!Array.isArray(cfg.tags) || !cfg.tags.every(isText)) say('"tags" must be a list of non-empty strings');
  if (!isText(cfg.license)) say('"license" must be an SPDX identifier, such as "MIT"');
  const known = new Set(['name', 'description', 'category', 'tags', 'license']);
  for (const k of Object.keys(cfg)) if (!known.has(k)) say(`unknown field "${k}"`);
  if (dir && !existsSync(join(dir, 'index.html'))) say('the folder has no index.html');
  if (dir && isText(cfg.license) && cfg.license !== 'MIT' && !existsSync(join(dir, 'LICENSE'))) {
    say(`license is ${cfg.license}, so the folder needs its own LICENSE file`);
  }
  return problems;
}

// Reads every tool config under root and returns the tools.json content.
export function buildIndex(root) {
  const toolsDir = join(root, 'tools');
  const categories = readJson(join(toolsDir, 'categories.json'));
  const problems = [];
  const tools = [];
  const ids = readdirSync(toolsDir)
    .filter((d) => !d.startsWith('_') && statSync(join(toolsDir, d)).isDirectory())
    .sort();
  for (const id of ids) {
    const dir = join(toolsDir, id);
    const file = join(dir, 'tool.json');
    if (!existsSync(file)) {
      problems.push(`tools/${id}/: has no tool.json, so the hub can't list it`);
      continue;
    }
    const cfg = readJson(file);
    const found = validateTool(id, cfg, categories, dir);
    if (found.length) { problems.push(...found); continue; }
    tools.push({
      id,
      name: cfg.name,
      description: cfg.description,
      category: cfg.category,
      tags: cfg.tags,
      license: cfg.license,
      path: `tools/${id}/`,
    });
  }
  if (problems.length) throw new Error(`Invalid tools:\n  ${problems.join('\n  ')}`);
  return { note: NOTE, categories, tools };
}

export const formatIndex = (index) => `${JSON.stringify(index, null, 2)}\n`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const out = join(root, 'tools.json');
  try {
    const next = formatIndex(buildIndex(root));
    if (process.argv.includes('--check')) {
      const current = existsSync(out) ? readFileSync(out, 'utf8') : '';
      if (current !== next) {
        console.error('tools.json is out of date. Run: node scripts/tools-index.mjs');
        process.exit(1);
      }
      console.log('tools.json is up to date.');
    } else {
      writeFileSync(out, next);
      console.log(`Wrote tools.json with ${JSON.parse(next).tools.length} tools.`);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
