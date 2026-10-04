// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { initPage, guardStore } from '../../shared/page.js';
import { extendStrings, t, lang } from '../../shared/i18n.js';
import { h } from '../../shared/dom.js';
import { icon } from '../../shared/icons.js';
import { toast } from '../../shared/toast.js';
import { openStore, storageAvailable } from '../../shared/storage.js';
import { optionsSheet } from '../../shared/sheet.js';
import { strings } from './strings.js';
import {
  sanitize, currentList, findItem, openItems, doneItems,
  addList, renameList, removeList, nextListName,
  addItem, setDone, removeItem, clearDone, moveItem, reorder,
  setText, setDue, setNote, addStep, removeStep, stepCount,
  isoDate, dueStatus,
} from './logic.js';

extendStrings(strings);

const TOOL_ID = 'todo-list';
const name = t(`${TOOL_ID}.name`);
const SOURCE_PATH = 'tools/todo-list/';
const s = (key, vars) => t(`${TOOL_ID}.${key}`, vars);
const narrow = matchMedia('(max-width: 719px)');
const { main } = initPage({ toolId: TOOL_ID, toolName: name, license: 'MIT', sourcePath: SOURCE_PATH, app: true });

// Saved: every list with its tasks, and which list is showing.
const store = openStore(TOOL_ID, { version: 1 });
const persist = (await guardStore(store, name)) && storageAvailable();
let state = sanitize(persist ? store.get('state') : null, s('defaultList'));

function save() {
  if (persist && !store.set('state', state)) toast(s('full'), 6000);
}

// UI state that isn't saved.
let openId = null;      // task whose details are showing
let doneOpen = false;   // the "Done" section is expanded
let today = isoDate();

// Small icons ----------------------------------------------------------

const PATHS = {
  grip: '<circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
};
function glyph(kind) {
  const tpl = document.createElement('template');
  tpl.innerHTML = `<svg class="icon todo-glyph-${kind}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true" focusable="false">${PATHS[kind]}</svg>`;
  return tpl.content.firstElementChild;
}

// Page structure -------------------------------------------------------

const announcer = h('p', { class: 'sr-only', 'aria-live': 'polite' });
const announce = (msg) => { announcer.textContent = ''; requestAnimationFrame(() => { announcer.textContent = msg; }); };

const listNav = h('ul', { class: 'todo-lists' });
const newListBtn = h('button', { type: 'button', class: 'btn todo-new-list', 'data-key': 'newlist', onclick: onNewList },
  glyph('plus'), s('newList'));

const listName = h('input', {
  type: 'text', class: 'todo-list-name', 'aria-label': s('listName'), maxlength: 500,
  autocomplete: 'off', spellcheck: 'false', 'data-key': 'listname',
  oninput: () => { renameList(currentList(state), listName.value); save(); renderNav(); },
  onchange: () => {
    const list = currentList(state);
    if (!list.name) renameList(list, s('defaultList'));
    listName.value = list.name;
    save();
    renderNav();
  },
  onkeydown: (e) => { if (e.key === 'Enter') addInput.focus(); },
});
const deleteListBtn = h('button', { type: 'button', class: 'icon-btn todo-delete-list', 'aria-label': s('deleteList'), title: s('deleteList'), onclick: onDeleteList },
  icon('trash'));

const addInput = h('input', {
  type: 'text', class: 'todo-add-input', placeholder: s('addPlaceholder'), 'aria-label': s('addLabel'),
  maxlength: 500, autocomplete: 'off', enterkeyhint: 'done', 'data-key': 'add',
});
const addForm = h('form', { class: 'todo-add', onsubmit: onAdd },
  addInput,
  h('button', { type: 'submit', class: 'btn btn-primary todo-add-btn' }, s('add')),
);

const reorderHint = h('p', { class: 'sr-only', id: 'todo-reorder-hint' }, s('reorderHint'));
const openList = h('ul', { class: 'todo-items', 'aria-label': s('openTasks') });
const emptyMsg = h('p', { class: 'todo-empty' });
const doneList = h('ul', { class: 'todo-items todo-items-done' });
const doneSummary = h('summary', { class: 'todo-done-summary', 'data-key': 'donesummary' });
const clearDoneBtn = h('button', { type: 'button', class: 'btn todo-clear-done', 'data-key': 'cleardone', onclick: onClearDone }, s('clearDone'));
const doneSection = h('details', { class: 'todo-done' }, doneSummary, doneList, clearDoneBtn);
doneSection.addEventListener('toggle', () => { doneOpen = doneSection.open; });

const undoText = h('span', { class: 'todo-undo-text', role: 'status' });
const undoBtn = h('button', { type: 'button', class: 'todo-undo-btn', onclick: onUndo }, s('undo'));
const undoBar = h('div', { class: 'todo-undo', hidden: true }, undoText, undoBtn);

// On phones the page fills the screen: the lists on top, the tasks in the
// middle, and the add field with New list and Options at the bottom. Delete
// list moves into the options sheet, with the footer's text and source link.
const moreBtn = h('button', { type: 'button', class: 'btn todo-more', 'aria-haspopup': 'dialog', onclick: () => options.open() }, s('options'));
const options = optionsSheet({ title: s('options'), sourcePath: SOURCE_PATH, returnFocus: moreBtn });
options.body.append(h('button', {
  type: 'button', class: 'btn todo-sheet-delete',
  onclick: () => { onDeleteList(); options.close(); },
}, icon('trash'), s('deleteList')));

const nav = h('nav', { class: 'todo-nav', 'aria-label': s('lists') }, listNav, newListBtn);
const head = h('div', { class: 'todo-head' }, listName, deleteListBtn);
const bottomRow = h('div', { class: 'todo-bottom-row' }, moreBtn);
const bottom = h('div', { class: 'todo-bottom' }, bottomRow);

main.append(
  h('h1', { class: 'tool-title' }, name),
  h('div', { class: 'todo-layout' },
    nav,
    h('section', { class: 'todo-panel', 'aria-labelledby': 'todo-list-heading' },
      h('h2', { class: 'sr-only', id: 'todo-list-heading' }),
      head,
      addForm,
      openList,
      emptyMsg,
      doneSection,
    ),
    bottom,
  ),
  reorderHint,
  undoBar,
  options.sheet,
  announcer,
);

function placeControls() {
  if (narrow.matches) {
    bottom.prepend(addForm);
    bottomRow.prepend(newListBtn);
    bottom.append(undoBar);
  } else {
    options.close();
    head.after(addForm);
    nav.append(newListBtn);
    main.append(undoBar);
  }
}
placeControls();
narrow.addEventListener('change', placeControls);

// Rendering ------------------------------------------------------------
// The whole list is rebuilt after each change. Focus is kept on the control
// with the same data-key, or moved to the first fallback key that exists.

function focusKey(keys) {
  for (const key of keys) {
    const el = key && main.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (el && el.offsetParent !== null) { el.focus(); return; }
  }
}

function render({ fallback = [] } = {}) {
  const active = document.activeElement;
  const key = main.contains(active) ? active.dataset.key : null;
  const list = currentList(state);

  renderNav();
  document.getElementById('todo-list-heading').textContent = list.name;
  if (active !== listName) listName.value = list.name;

  const open = openItems(list);
  const done = doneItems(list);
  if (openId && !findItem(list, openId)) openId = null;
  openList.replaceChildren(...open.map((item) => renderItem(item, list)));
  doneList.replaceChildren(...done.map((item) => renderItem(item, list)));
  emptyMsg.textContent = open.length ? '' : (done.length ? s('allDone') : s('empty'));
  emptyMsg.hidden = open.length > 0;
  doneSection.hidden = done.length === 0;
  doneSection.open = doneOpen;
  doneSummary.textContent = s('doneSection', { n: done.length });

  if (key) focusKey([key, ...fallback, 'add']);
}

// List buttons and their contents are kept and only their text updated, so
// a click that starts while the list name field is losing focus still lands.
const navItems = new Map();
function renderNav() {
  const list = currentList(state);
  const ids = new Set(state.lists.map((l) => l.id));
  for (const id of navItems.keys()) if (!ids.has(id)) navItems.delete(id);
  const items = state.lists.map((l) => {
    if (!navItems.has(l.id)) {
      const parts = {
        name: h('span', { class: 'todo-list-btn-name' }),
        count: h('span', { class: 'todo-list-btn-count', 'aria-hidden': 'true' }),
        sr: h('span', { class: 'sr-only' }),
      };
      parts.btn = h('button', { type: 'button', class: 'todo-list-btn', 'data-key': `list:${l.id}`, onclick: () => selectList(l.id) },
        parts.name, parts.count, parts.sr);
      parts.li = h('li', {}, parts.btn);
      navItems.set(l.id, parts);
    }
    const p = navItems.get(l.id);
    const n = openItems(l).length;
    if (l.id === list.id) p.btn.setAttribute('aria-current', 'true');
    else p.btn.removeAttribute('aria-current');
    p.name.textContent = l.name || s('defaultList');
    p.count.textContent = n || '';
    p.sr.textContent = n ? `, ${s('openCount', { n })}` : '';
    return p.li;
  });
  if (items.length !== listNav.children.length || items.some((li, i) => listNav.children[i] !== li)) listNav.replaceChildren(...items);
}

function dueLabel(due) {
  const status = dueStatus(due, today);
  if (status === 'today') return s('today');
  if (status === 'tomorrow') return s('tomorrow');
  const [y, m, d] = due.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (y !== new Date().getFullYear()) opts.year = 'numeric';
  const text = new Intl.DateTimeFormat(lang, opts).format(date);
  return status === 'overdue' ? s('overdue', { date: text }) : text;
}

function renderMeta(item) {
  const parts = [];
  if (item.due) {
    parts.push(h('span', { class: `todo-due todo-due-${dueStatus(item.due, today)}` }, dueLabel(item.due)));
  }
  const { done, total } = stepCount(item);
  if (total) parts.push(h('span', {}, s('stepCount', { done, total })));
  if (item.note.trim()) parts.push(h('span', {}, s('hasNote')));
  return parts.length ? h('span', { class: 'todo-meta' }, parts) : null;
}

function renderItem(item, list) {
  const expanded = item.id === openId;
  const detailsId = `todo-details-${item.id}`;
  const text = h('span', { class: 'todo-text-main' }, item.text);
  const meta = h('span', { class: 'todo-meta-slot' }, renderMeta(item));
  const check = h('input', {
    type: 'checkbox', class: 'todo-check', 'aria-label': item.text, 'data-key': `check:${item.id}`,
    onchange: () => toggleDone(item, list),
  });
  check.checked = item.done;

  const li = h('li', { class: `todo-item${item.done ? ' is-done' : ''}${expanded ? ' is-expanded' : ''}`, 'data-id': item.id },
    h('div', { class: 'todo-row' },
      item.done ? h('span', { class: 'todo-handle-space' }) : h('button', {
        type: 'button', class: 'todo-handle', 'data-key': `handle:${item.id}`,
        'aria-label': s('reorder', { task: item.text }), 'aria-describedby': 'todo-reorder-hint',
        onkeydown: (e) => onHandleKey(e, item, list),
        onpointerdown: (e) => onDragStart(e, item),
      }, glyph('grip')),
      h('label', { class: 'todo-check-wrap' }, check),
      h('button', {
        type: 'button', class: 'todo-text', 'data-key': `text:${item.id}`,
        'aria-expanded': String(expanded), 'aria-controls': expanded ? detailsId : null,
        onclick: () => toggleDetails(item),
      }, text, meta),
      h('button', {
        type: 'button', class: 'todo-star', 'data-key': `star:${item.id}`,
        'aria-pressed': String(item.important), 'aria-label': s('importantFor', { task: item.text }), title: s('important'),
        onclick: () => { item.important = !item.important; save(); render(); },
      }, icon('star')),
    ),
  );
  if (expanded) li.append(renderDetails(item, list, detailsId, { text, meta, check }));
  return li;
}

function renderDetails(item, list, id, row) {
  const refreshRow = () => {
    row.text.textContent = item.text;
    row.check.setAttribute('aria-label', item.text);
    row.meta.replaceChildren(renderMeta(item) ?? '');
    save();
  };
  const field = (label, control) => h('label', { class: 'todo-field' }, h('span', { class: 'todo-label' }, label), control);

  const title = h('input', {
    type: 'text', class: 'todo-input', value: item.text, maxlength: 500, 'data-key': `title:${item.id}`,
    oninput: () => { if (setText(item, title.value)) refreshRow(); },
    onchange: () => { title.value = item.text; },
  });
  const clearDue = h('button', {
    type: 'button', class: 'btn btn-link todo-clear-due', hidden: !item.due, 'data-key': `cleardue:${item.id}`,
    onclick: () => { setDue(item, ''); due.value = ''; clearDue.hidden = true; refreshRow(); due.focus(); },
  }, s('clearDue'));
  const due = h('input', {
    type: 'date', class: 'todo-input todo-date', value: item.due, 'data-key': `due:${item.id}`,
    onchange: () => { setDue(item, due.value); clearDue.hidden = !item.due; refreshRow(); },
  });
  const note = h('textarea', {
    class: 'todo-input todo-note', rows: 3, maxlength: 5000, 'data-key': `note:${item.id}`,
    oninput: () => { setNote(item, note.value); refreshRow(); },
  });
  note.value = item.note;

  const steps = item.steps.map((step) => {
    const box = h('input', {
      type: 'checkbox', class: 'todo-check', 'data-key': `step:${step.id}`,
      onchange: () => { step.done = box.checked; save(); render(); },
    });
    box.checked = step.done;
    return h('li', { class: `todo-step${step.done ? ' is-done' : ''}` },
      h('label', { class: 'todo-step-label' }, box, h('span', {}, step.text)),
      h('button', {
        type: 'button', class: 'todo-icon-btn', 'aria-label': s('removeStep', { step: step.text }), 'data-key': `steprm:${step.id}`,
        onclick: () => { removeStep(item, step.id); save(); render({ fallback: [`stepadd:${item.id}`] }); },
      }, glyph('x')),
    );
  });
  const stepInput = h('input', {
    type: 'text', class: 'todo-input', placeholder: s('addStep'), 'aria-label': s('addStep'),
    maxlength: 500, autocomplete: 'off', enterkeyhint: 'done', 'data-key': `stepadd:${item.id}`,
    onkeydown: (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (addStep(item, stepInput.value)) { save(); render(); }
    },
  });

  return h('div', {
    class: 'todo-details', id, role: 'group', 'aria-label': s('details'),
    onkeydown: (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      openId = null;
      render();
      focusKey([`text:${item.id}`]);
    },
  },
  field(s('task'), title),
  h('div', { class: 'todo-field' },
    h('label', { class: 'todo-label', for: `todo-due-${item.id}` }, s('due')),
    h('div', { class: 'todo-due-row' }, Object.assign(due, { id: `todo-due-${item.id}` }), clearDue),
  ),
  field(s('note'), note),
  h('div', { class: 'todo-field', role: 'group', 'aria-labelledby': `todo-steps-${item.id}` },
    h('span', { class: 'todo-label', id: `todo-steps-${item.id}` }, s('steps')),
    steps.length ? h('ul', { class: 'todo-steps' }, steps) : null,
    stepInput,
  ),
  h('div', { class: 'todo-details-actions' },
    h('button', {
      type: 'button', class: 'btn btn-link todo-delete', 'data-key': `delete:${item.id}`,
      onclick: () => deleteItem(item, list),
    }, s('deleteTask')),
    h('span', { class: 'dialog-spacer' }),
    h('button', {
      type: 'button', class: 'btn', 'data-key': `close:${item.id}`,
      onclick: () => { openId = null; render({ fallback: [`text:${item.id}`] }); },
    }, s('close')),
  ),
  );
}

// Actions --------------------------------------------------------------

// The neighbour that should get focus when a task leaves its section.
function neighbourKey(item, list) {
  const section = item.done ? doneItems(list) : openItems(list);
  const i = section.indexOf(item);
  const next = section[i + 1] ?? section[i - 1];
  return next ? `check:${next.id}` : 'add';
}

function onAdd(e) {
  e.preventDefault();
  const item = addItem(currentList(state), addInput.value);
  if (!item) return;
  addInput.value = '';
  save();
  render();
  announce(s('added', { task: item.text }));
}

function toggleDone(item, list) {
  const fallback = neighbourKey(item, list);
  setDone(item, !item.done);
  if (openId === item.id) openId = null;
  save();
  render({ fallback: [fallback] });
  announce(s(item.done ? 'markedDone' : 'markedOpen', { task: item.text }));
}

function toggleDetails(item) {
  openId = openId === item.id ? null : item.id;
  render();
  if (openId) focusKey([`title:${item.id}`]);
}

function deleteItem(item, list) {
  const fallback = neighbourKey(item, list);
  const snapshot = JSON.stringify(state);
  removeItem(list, item.id);
  openId = null;
  save();
  render();
  focusKey([fallback, 'add']);
  offerUndo(s('deletedTask'), snapshot);
}

function onClearDone() {
  const snapshot = JSON.stringify(state);
  clearDone(currentList(state));
  save();
  render();
  focusKey(['add']);
  offerUndo(s('clearedDone'), snapshot);
}

function selectList(id) {
  state.current = id;
  openId = null;
  save();
  render();
}

function onNewList() {
  addList(state, nextListName(state, s('listPattern')));
  openId = null;
  save();
  render();
  listName.focus();
  listName.select();
}

function onDeleteList() {
  const snapshot = JSON.stringify(state);
  removeList(state, state.current, s('defaultList'));
  openId = null;
  save();
  render();
  focusKey([`list:${state.current}`]);
  offerUndo(s('deletedList'), snapshot);
}

// Undo -----------------------------------------------------------------
// Deleting never asks first. Instead the previous state is kept for a few
// seconds and can be brought back.

let undoSnapshot = null;
let undoTimer = 0;

function offerUndo(message, snapshot) {
  undoSnapshot = snapshot;
  undoText.textContent = message;
  undoBar.hidden = false;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(hideUndo, 8000);
}

function hideUndo() {
  clearTimeout(undoTimer);
  undoBar.hidden = true;
  undoText.textContent = '';
  undoSnapshot = null;
}

function onUndo() {
  if (!undoSnapshot) return;
  state = sanitize(JSON.parse(undoSnapshot), s('defaultList'));
  hideUndo();
  save();
  render();
  focusKey(['add']);
  announce(s('undone'));
}

// Reordering -----------------------------------------------------------

function onHandleKey(e, item, list) {
  const open = openItems(list);
  const i = open.indexOf(item);
  const to = { ArrowUp: i - 1, ArrowDown: i + 1, Home: 0, End: open.length - 1 }[e.key];
  if (to === undefined) return;
  e.preventDefault();
  if (!moveItem(list, item.id, to)) return;
  save();
  render();
  announce(s('moved', { pos: openItems(list).indexOf(item) + 1, n: open.length }));
}

// Drag by the handle with mouse, pen or touch. The row moves in the page
// while dragging; the new order is saved on release.
function onDragStart(e, item) {
  if (e.button !== 0) return;
  const handle = e.currentTarget;
  const li = handle.closest('.todo-item');
  e.preventDefault();
  handle.focus();
  handle.setPointerCapture(e.pointerId);
  li.classList.add('is-dragging');

  // The dragged row itself never leaves the DOM (that would end the pointer
  // capture); the rows it passes are moved around it instead.
  const move = (ev) => {
    const rows = [...openList.children];
    const from = rows.indexOf(li);
    const others = rows.filter((el) => el !== li);
    let to = others.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return ev.clientY < r.top + r.height / 2;
    });
    if (to < 0) to = others.length;
    if (to < from) li.after(...rows.slice(to, from));
    else if (to > from) li.before(...rows.slice(from + 1, to + 1));
  };
  const end = () => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', end);
    handle.removeEventListener('pointercancel', end);
    li.classList.remove('is-dragging');
    const list = currentList(state);
    const before = openItems(list).indexOf(item);
    if (reorder(list, [...openList.children].map((el) => el.dataset.id))) {
      const after = openItems(list).indexOf(item);
      save();
      render();
      if (after !== before) announce(s('moved', { pos: after + 1, n: openItems(list).length }));
    }
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

// Due labels ("Today", "Overdue") follow the date when the tab comes back.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && isoDate() !== today) {
    today = isoDate();
    render();
  }
});

render();
