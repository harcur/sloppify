// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { initPage } from '../../shared/page.js';
import { extendStrings, t } from '../../shared/i18n.js';
import { h } from '../../shared/dom.js';
// import { openStore } from '../../shared/storage.js';
import { strings } from './strings.js';

extendStrings(strings);

const TOOL_ID = 'interest-calculator';
const name = t(`${TOOL_ID}.name`);

const { main } = initPage({ toolId: TOOL_ID, toolName: name, license: 'MIT', sourcePath: 'tools/interest-calculator/' });

// Saved data for this tool, when it needs some:
// const store = openStore(TOOL_ID, { version: 1, migrate: (data, from, to) => data });
// if (!(await guardStore(store, name))) { /* user kept the old data: stop here */ }  // guardStore is in page.js
// store.set('settings', { ... });

main.append(
  h('h1', { class: 'tool-title' }, name),
  h('p', { class: 'tool-placeholder' }, t(`${TOOL_ID}.placeholder`)),
);
