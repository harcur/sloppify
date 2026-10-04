// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { test, expect } from '@playwright/test';
import { trackExternalRequests, markNoticeSeen, expectAccessible } from './helpers.js';

let external;
test.beforeEach(async ({ page, baseURL }) => {
  external = trackExternalRequests(page, baseURL);
  await markNoticeSeen(page);
  await page.goto('./tools/todo-list/');
});
test.afterEach(() => { expect(external, 'requests outside the site').toEqual([]); });

const addField = (page) => page.getByRole('textbox', { name: 'New task' });
const openTasks = (page) => page.getByRole('list', { name: 'Open tasks' }).locator('.todo-text-main');

async function add(page, ...tasks) {
  for (const task of tasks) {
    await addField(page).fill(task);
    await addField(page).press('Enter');
  }
}

test('add, finish, reopen and keep tasks after a reload', async ({ page }) => {
  await expect(page.getByText('Nothing to do. Add a task above.')).toBeVisible();
  await add(page, 'buy milk', 'call mum');
  await expect(openTasks(page)).toHaveText(['call mum', 'buy milk']);
  await expect(addField(page)).toHaveValue('');

  await page.getByRole('checkbox', { name: 'buy milk' }).click();
  await expect(openTasks(page)).toHaveText(['call mum']);
  await page.getByText('Done (1)').click();
  await expect(page.getByRole('checkbox', { name: 'buy milk' })).toBeChecked();

  await page.reload();
  await expect(openTasks(page)).toHaveText(['call mum']);
  await expect(page.getByText('Done (1)')).toBeVisible();
});

test('details: edit text, due date, note and steps', async ({ page }) => {
  await add(page, 'tax return');
  await page.getByRole('button', { name: /^tax return/ }).click();
  const title = page.getByRole('textbox', { name: 'Task', exact: true });
  await expect(title).toBeFocused();
  await title.fill('file tax return');
  await expect(openTasks(page)).toHaveText(['file tax return']);

  await page.getByLabel('Due date').fill('2020-01-02');
  await expect(page.locator('.todo-due')).toContainText('Overdue');
  await page.getByRole('textbox', { name: 'Note' }).fill('receipts in drawer');
  const step = page.getByRole('textbox', { name: 'Add a step' });
  await step.fill('collect receipts');
  await step.press('Enter');
  await page.getByRole('textbox', { name: 'Add a step' }).fill('fill in form');
  await page.getByRole('textbox', { name: 'Add a step' }).press('Enter');
  await page.getByRole('checkbox', { name: 'collect receipts' }).click();
  await expect(page.locator('.todo-meta')).toContainText('1/2 steps');
  await expect(page.locator('.todo-meta')).toContainText('note');

  await expectAccessible(page, 'details open');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /^file tax return/ })).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Task', exact: true })).toHaveCount(0);
});

test('delete with undo, and star a task', async ({ page }) => {
  await add(page, 'a', 'b');
  await page.getByRole('button', { name: 'Important: a' }).click();
  await expect(page.getByRole('button', { name: 'Important: a' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: /^a/ }).first().click();
  await page.getByRole('button', { name: 'Delete task' }).click();
  await expect(openTasks(page)).toHaveText(['b']);
  await expect(page.getByText('Task deleted')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(openTasks(page)).toHaveText(['b', 'a']);
  await expect(page.getByRole('button', { name: 'Important: a' })).toHaveAttribute('aria-pressed', 'true');
});

test('reorder with the keyboard and by dragging', async ({ page }) => {
  await add(page, 'c', 'b', 'a');
  await expect(openTasks(page)).toHaveText(['a', 'b', 'c']);
  await page.getByRole('button', { name: 'Reorder: a' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(openTasks(page)).toHaveText(['b', 'a', 'c']);
  await expect(page.getByRole('button', { name: 'Reorder: a' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(openTasks(page)).toHaveText(['b', 'c', 'a']);

  const handle = page.getByRole('button', { name: 'Reorder: a' });
  const target = await page.getByRole('button', { name: 'Reorder: b' }).boundingBox();
  await handle.hover();
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + 2, { steps: 5 });
  await page.mouse.up();
  await expect(openTasks(page)).toHaveText(['a', 'b', 'c']);
});

test('several lists, rename and delete with undo', async ({ page }) => {
  await add(page, 'first list task');
  await page.getByRole('button', { name: 'New list' }).click();
  const listName = page.getByRole('textbox', { name: 'List name' });
  await expect(listName).toBeFocused();
  await listName.fill('Groceries');
  const nav = page.getByRole('navigation', { name: 'Lists' });
  // Clicking another list straight from the name field switches to it.
  await nav.getByRole('button', { name: /^Tasks/ }).click();
  await expect(openTasks(page)).toHaveText(['first list task']);
  await nav.getByRole('button', { name: /^Groceries/ }).click();
  await add(page, 'eggs');
  await expect(nav.getByRole('button', { name: /^Groceries/ })).toHaveAttribute('aria-current', 'true');

  await nav.getByRole('button', { name: /^Tasks/ }).click();
  await expect(openTasks(page)).toHaveText(['first list task']);
  await nav.getByRole('button', { name: /^Groceries/ }).click();
  // On phones Delete list is in the options sheet.
  const more = page.getByRole('button', { name: 'Options' });
  if (await more.isVisible()) {
    await more.click();
    await expectAccessible(page, 'options sheet');
  }
  await page.getByRole('button', { name: 'Delete list' }).click();
  await expect(nav.getByRole('button', { name: /^Groceries/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(nav.getByRole('button', { name: /^Groceries/ })).toBeVisible();
  await expect(openTasks(page)).toHaveText(['eggs']);
});

for (const scheme of ['light', 'dark']) {
  test(`accessible in ${scheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${scheme} empty`);
    await add(page, 'one', 'two');
    await page.getByRole('checkbox', { name: 'one' }).click();
    await page.getByText('Done (1)').click();
    await page.getByRole('button', { name: 'Important: two' }).click();
    await expectAccessible(page, `${scheme} with tasks`);
  });
}
