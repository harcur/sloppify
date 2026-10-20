// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Lists, tasks and steps as plain data. No DOM access, so it runs under Node
// for tests. Every change returns nothing and edits the state in place; the
// page saves the whole state after each change.
//
// state = { current: listId, lists: [{ id, name, items: [item] }] }
// item  = { id, text, done, doneAt, due: 'YYYY-MM-DD' | '', important, note, steps: [{ id, text, done }] }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT = 500;
const MAX_NOTE = 5000;

let seq = 0;
export const newId = () => Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 6);

const clean = (s, max = MAX_TEXT) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function newState(listName) {
  const list = { id: newId(), name: listName, items: [] };
  return { current: list.id, lists: [list] };
}

// Turns anything read from storage into a valid state, dropping what doesn't fit.
export function sanitize(data, listName) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.lists)) return newState(listName);
  const ids = new Set();
  const id = (v) => {
    const s = typeof v === 'string' && v && !ids.has(v) ? v : newId();
    ids.add(s);
    return s;
  };
  const lists = data.lists.filter((l) => l && typeof l === 'object').map((l) => ({
    id: id(l.id),
    name: clean(l.name) || listName,
    items: (Array.isArray(l.items) ? l.items : []).filter((i) => i && typeof i === 'object' && clean(i.text)).map((i) => ({
      id: id(i.id),
      text: clean(i.text),
      done: i.done === true,
      doneAt: i.done === true && Number.isFinite(i.doneAt) ? i.doneAt : 0,
      due: typeof i.due === 'string' && DATE_RE.test(i.due) ? i.due : '',
      important: i.important === true,
      note: String(i.note ?? '').slice(0, MAX_NOTE),
      steps: (Array.isArray(i.steps) ? i.steps : []).filter((s) => s && clean(s.text)).map((s) => ({
        id: id(s.id), text: clean(s.text), done: s.done === true,
      })),
    })),
  }));
  if (!lists.length) return newState(listName);
  const current = lists.some((l) => l.id === data.current) ? data.current : lists[0].id;
  return { current, lists };
}

export const currentList = (state) => state.lists.find((l) => l.id === state.current) ?? state.lists[0];
export const findItem = (list, id) => list.items.find((i) => i.id === id) ?? null;
export const openItems = (list) => list.items.filter((i) => !i.done);
// Most recently finished first.
export const doneItems = (list) => list.items.filter((i) => i.done).sort((a, b) => b.doneAt - a.doneAt);

// Lists ---------------------------------------------------------------

export function addList(state, name) {
  const list = { id: newId(), name: clean(name) || name, items: [] };
  state.lists.push(list);
  state.current = list.id;
  return list;
}

export function renameList(list, name) {
  list.name = clean(name);
}

// Removes a list. The last list is never removed, only emptied.
export function removeList(state, id, fallbackName) {
  const i = state.lists.findIndex((l) => l.id === id);
  if (i < 0) return;
  state.lists.splice(i, 1);
  if (!state.lists.length) state.lists.push({ id: newId(), name: fallbackName, items: [] });
  if (state.current === id) state.current = state.lists[Math.min(i, state.lists.length - 1)].id;
}

// A name for a new list that isn't taken yet: "List 2", "List 3", ...
export function nextListName(state, pattern) {
  const taken = new Set(state.lists.map((l) => l.name));
  for (let n = state.lists.length + 1; ; n++) {
    const name = pattern.replace('{n}', n);
    if (!taken.has(name)) return name;
  }
}

// Tasks ---------------------------------------------------------------

// New tasks go to the top of the open tasks.
export function addItem(list, text) {
  const t = clean(text);
  if (!t) return null;
  const item = { id: newId(), text: t, done: false, doneAt: 0, due: '', important: false, note: '', steps: [] };
  list.items.unshift(item);
  return item;
}

export function setDone(item, done, now = Date.now()) {
  item.done = done;
  item.doneAt = done ? now : 0;
}

export function removeItem(list, id) {
  list.items = list.items.filter((i) => i.id !== id);
}

export function clearDone(list) {
  list.items = list.items.filter((i) => !i.done);
}

// Moves an open task to a position among the open tasks. Finished tasks keep their place.
export function moveItem(list, id, to) {
  const open = openItems(list);
  const from = open.findIndex((i) => i.id === id);
  if (from < 0) return false;
  const target = Math.max(0, Math.min(open.length - 1, to));
  if (target === from) return false;
  const [item] = open.splice(from, 1);
  open.splice(target, 0, item);
  list.items = [...open, ...list.items.filter((i) => i.done)];
  return true;
}

// Puts open tasks in the given order (after a drag). Unknown ids are ignored.
export function reorder(list, ids) {
  const open = openItems(list);
  const byId = new Map(open.map((i) => [i.id, i]));
  const sorted = ids.map((id) => byId.get(id)).filter(Boolean);
  if (sorted.length !== open.length) return false;
  list.items = [...sorted, ...list.items.filter((i) => i.done)];
  return true;
}

export function setText(item, text) {
  const t = clean(text);
  if (t) item.text = t;
  return !!t;
}

export function setDue(item, due) {
  item.due = typeof due === 'string' && DATE_RE.test(due) ? due : '';
}

export function setNote(item, note) {
  item.note = String(note ?? '').slice(0, MAX_NOTE);
}

// Steps ---------------------------------------------------------------

export function addStep(item, text) {
  const t = clean(text);
  if (!t) return null;
  const step = { id: newId(), text: t, done: false };
  item.steps.push(step);
  return step;
}

export function removeStep(item, id) {
  item.steps = item.steps.filter((s) => s.id !== id);
}

export const stepCount = (item) => ({ done: item.steps.filter((s) => s.done).length, total: item.steps.length });

// Dates ---------------------------------------------------------------

// Local calendar date as YYYY-MM-DD.
export function isoDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const dayNumber = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};

// 'overdue' | 'today' | 'tomorrow' | 'later' | '' (no date)
export function dueStatus(due, today) {
  if (!due) return '';
  const diff = dayNumber(due) - dayNumber(today);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  return 'later';
}
