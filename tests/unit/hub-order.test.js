// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderTools } from '../../hub-order.js';

const tool = (id, name, category = 'tool', tags = []) => ({ id, name: { en: name }, description: { en: `${name} description` }, category, tags });
const tools = [
  tool('b', 'bravo'), tool('a', 'alpha'), tool('c', 'charlie', 'game'),
  tool('d', 'delta'), tool('e', 'echo', 'game', ['puzzle']), tool('f', 'foxtrot'), tool('g', 'golf'),
];
const ids = (group) => group.items.map((t) => t.id);

test('first visit: one alphabetical group', () => {
  const g = orderTools(tools);
  assert.equal(g.length, 1);
  assert.equal(g[0].key, 'all');
  assert.deepEqual(ids(g[0]), ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
});

test('favourites first, by most recent use, then recent, then the rest', () => {
  const g = orderTools(tools, { favourites: ['a', 'c'], recent: ['d', 'c', 'e', 'a', 'f', 'g', 'b'] });
  assert.deepEqual(g.map((x) => x.key), ['favourites', 'recent', 'rest']);
  assert.deepEqual(ids(g[0]), ['c', 'a']);
  assert.deepEqual(ids(g[1]), ['d', 'e', 'f', 'g']);
  assert.deepEqual(ids(g[2]), ['b']);
});

test('no tool appears twice and unknown ids are ignored', () => {
  const g = orderTools(tools, { favourites: ['a', 'zzz', 'a'], recent: ['a', 'zzz', 'b', 'b'] });
  const all = g.flatMap(ids);
  assert.equal(new Set(all).size, all.length);
  assert.equal(all.length, tools.length);
});

test('search returns one flat list matching every word', () => {
  assert.deepEqual(ids(orderTools(tools, { query: 'puzzle', favourites: ['a'] })[0]), ['e']);
  assert.deepEqual(ids(orderTools(tools, { query: 'game ECHO' })[0]), ['e']);
  assert.equal(orderTools(tools, { query: 'game ECHO' })[0].key, 'results');
  assert.deepEqual(orderTools(tools, { query: 'nothing here' }), []);
});
