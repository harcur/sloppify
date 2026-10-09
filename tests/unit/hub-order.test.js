// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderTools, withinOneEdit } from '../../hub-order.js';

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

test('search ignores case and accents', () => {
  assert.deepEqual(ids(orderTools(tools, { query: 'ALPHA' })[0]), ['a']);
  const cafe = [tool('k', 'Café')];
  assert.deepEqual(ids(orderTools(cafe, { query: 'cafe' })[0]), ['k']);
  assert.deepEqual(ids(orderTools(cafe, { query: 'CAFÉ' })[0]), ['k']);
});

test('search allows one typo in words of four or more letters', () => {
  assert.deepEqual(ids(orderTools(tools, { query: 'foxtrut' })[0]), ['f']);
  assert.deepEqual(ids(orderTools(tools, { query: 'fxotrot' })[0]), ['f']);
  assert.deepEqual(ids(orderTools(tools, { query: 'puzle' })[0]), ['e']);
  assert.deepEqual(ids(orderTools(tools, { query: 'puzzzle' })[0]), ['e']);
  assert.deepEqual(ids(orderTools(tools, { query: 'chra' })[0]), ['c']);
  assert.deepEqual(orderTools(tools, { query: 'fuxtuot' }), []); // two typos
  assert.deepEqual(ids(orderTools(tools, { query: 'ecjo' })[0]), ['e']);
  assert.deepEqual(orderTools(tools, { query: 'ecj' }), []); // under four letters: exact only
});

test('exact matches come before fuzzy ones', () => {
  const list = [tool('x', 'mines'), tool('y', 'miner')];
  assert.deepEqual(ids(orderTools(list, { query: 'miner' })[0]), ['y', 'x']);
});

test('withinOneEdit', () => {
  assert.ok(withinOneEdit('abcd', 'abcd'));
  assert.ok(withinOneEdit('abcd', 'abxd'));
  assert.ok(withinOneEdit('abcd', 'abd'));
  assert.ok(withinOneEdit('abd', 'abcd'));
  assert.ok(withinOneEdit('abcd', 'bacd'));
  assert.ok(!withinOneEdit('abcd', 'badc'));
  assert.ok(!withinOneEdit('abcd', 'ab'));
});
