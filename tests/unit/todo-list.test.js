// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newState, sanitize, currentList, openItems, doneItems,
  addList, removeList, nextListName,
  addItem, setDone, removeItem, clearDone, moveItem, reorder,
  setText, setDue, addStep, removeStep, stepCount,
  isoDate, dueStatus,
} from '../../tools/todo-list/logic.js';

const texts = (items) => items.map((i) => i.text);

function listWith(...names) {
  const state = newState('Tasks');
  const list = currentList(state);
  for (const n of [...names].reverse()) addItem(list, n);
  return { state, list };
}

test('new tasks go on top, blank ones are ignored, whitespace is tidied', () => {
  const { list } = listWith('a');
  addItem(list, '  b   c ');
  assert.equal(addItem(list, '   '), null);
  assert.deepEqual(texts(list.items), ['b c', 'a']);
});

test('finished tasks leave the open list, most recent first', () => {
  const { list } = listWith('a', 'b', 'c');
  setDone(list.items[0], true, 1);
  setDone(list.items[2], true, 2);
  assert.deepEqual(texts(openItems(list)), ['b']);
  assert.deepEqual(texts(doneItems(list)), ['c', 'a']);
  setDone(list.items[0], false);
  assert.deepEqual(texts(openItems(list)), ['a', 'b']);
  clearDone(list);
  assert.deepEqual(texts(list.items), ['a', 'b']);
});

test('moving and reordering only touch open tasks', () => {
  const { list } = listWith('a', 'b', 'c', 'd');
  setDone(list.items[1], true);
  assert.equal(moveItem(list, list.items[0].id, 5), true);
  assert.deepEqual(texts(openItems(list)), ['c', 'd', 'a']);
  assert.equal(moveItem(list, openItems(list)[0].id, 0), false);
  const ids = openItems(list).map((i) => i.id).reverse();
  assert.equal(reorder(list, ids), true);
  assert.deepEqual(texts(openItems(list)), ['a', 'd', 'c']);
  assert.deepEqual(texts(doneItems(list)), ['b']);
  assert.equal(reorder(list, ids.slice(1)), false);
});

test('editing keeps the old text when the new one is blank', () => {
  const { list } = listWith('a');
  assert.equal(setText(list.items[0], '  '), false);
  assert.equal(list.items[0].text, 'a');
  setText(list.items[0], 'b');
  assert.equal(list.items[0].text, 'b');
  removeItem(list, list.items[0].id);
  assert.equal(list.items.length, 0);
});

test('steps are counted', () => {
  const { list } = listWith('a');
  const item = list.items[0];
  addStep(item, 'one');
  const two = addStep(item, 'two');
  assert.equal(addStep(item, ''), null);
  two.done = true;
  assert.deepEqual(stepCount(item), { done: 1, total: 2 });
  removeStep(item, two.id);
  assert.deepEqual(stepCount(item), { done: 0, total: 1 });
});

test('due dates: only valid dates are kept, status relative to today', () => {
  const { list } = listWith('a');
  setDue(list.items[0], 'tomorrow');
  assert.equal(list.items[0].due, '');
  setDue(list.items[0], '2026-03-01');
  assert.equal(list.items[0].due, '2026-03-01');
  assert.equal(dueStatus('', '2026-02-28'), '');
  assert.equal(dueStatus('2026-03-01', '2026-03-02'), 'overdue');
  assert.equal(dueStatus('2026-03-01', '2026-03-01'), 'today');
  assert.equal(dueStatus('2026-03-01', '2026-02-28'), 'tomorrow');
  assert.equal(dueStatus('2026-03-31', '2026-03-29'), 'later');
  assert.equal(isoDate(new Date(2026, 0, 5)), '2026-01-05');
});

test('lists: add, name, remove; the last list is emptied, not removed', () => {
  const state = newState('Tasks');
  assert.equal(nextListName(state, 'List {n}'), 'List 2');
  const second = addList(state, nextListName(state, 'List {n}'));
  assert.equal(state.current, second.id);
  addList(state, 'List 3');
  assert.equal(nextListName(state, 'List {n}'), 'List 4');
  removeList(state, state.current, 'Tasks');
  assert.equal(state.current, second.id);
  for (const l of [...state.lists]) removeList(state, l.id, 'Tasks');
  assert.equal(state.lists.length, 1);
  assert.equal(currentList(state).name, 'Tasks');
});

test('sanitize repairs or replaces bad saved data', () => {
  assert.equal(sanitize(null, 'Tasks').lists[0].name, 'Tasks');
  assert.equal(sanitize({ lists: [] }, 'Tasks').lists.length, 1);
  const state = sanitize({
    current: 'missing',
    lists: [
      null,
      { id: 'x', name: '', items: [
        { id: 'i', text: 'keep', done: true, doneAt: 5, due: 'soon', important: 'yes', steps: [{ text: 's' }, null] },
        { id: 'i', text: 'duplicate id' },
        { text: '' },
      ] },
    ],
  }, 'Tasks');
  const list = currentList(state);
  assert.equal(state.current, 'x');
  assert.equal(list.name, 'Tasks');
  assert.deepEqual(texts(list.items), ['keep', 'duplicate id']);
  assert.notEqual(list.items[1].id, 'i');
  const [kept] = list.items;
  assert.equal(kept.due, '');
  assert.equal(kept.important, false);
  assert.equal(kept.doneAt, 5);
  assert.deepEqual(texts(kept.steps), ['s']);
  assert.deepEqual(sanitize(JSON.parse(JSON.stringify(state)), 'Tasks'), state);
});
