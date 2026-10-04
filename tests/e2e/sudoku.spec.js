// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { test, expect } from '@playwright/test';
import { trackExternalRequests, markNoticeSeen, expectAccessible } from './helpers.js';
import { newGame, serialize } from '../../tools/sudoku/logic.js';

let external;
test.beforeEach(async ({ page, baseURL }) => {
  external = trackExternalRequests(page, baseURL);
  await markNoticeSeen(page);
});
test.afterEach(() => { expect(external, 'requests outside the site').toEqual([]); });

// A known board, saved before the page loads: a valid full grid with a few
// cells left empty. Row 1 starts 1 2 3, row 5 is 5 6 4 8 9 7 2 3 1.
const SOLUTION = Array.from({ length: 81 }, (_, i) => {
  const r = Math.floor(i / 9);
  return ((r * 3 + Math.floor(r / 3) + (i % 9)) % 9) + 1;
});
async function loadKnownBoard(page, blanks = [0, 1, 40]) {
  const puzzle = SOLUTION.slice();
  for (const i of blanks) puzzle[i] = 0;
  const saved = JSON.stringify(serialize(newGame('easy', { puzzle, solution: SOLUTION })));
  await page.addInitScript((game) => {
    if (localStorage.getItem('sloppify:sudoku:game')) return;
    localStorage.setItem('sloppify:sudoku:__schema', '1');
    localStorage.setItem('sloppify:sudoku:game', game);
  }, saved);
  await page.goto('./tools/sudoku/');
}

const isNarrow = (page) => (page.viewportSize()?.width ?? 1000) < 720;
const cell = (page, row, col, state = 'empty') => page.getByRole('gridcell', { name: `row ${row}, column ${col}: ${state}`, exact: true });
const digit = (page, d) => page.getByRole('group', { name: 'Digits' }).getByRole('button', { name: new RegExp(`^${d},`) });

test('a new puzzle appears with givens to fill around', async ({ page }) => {
  await page.goto('./tools/sudoku/');
  const board = page.getByRole('grid', { name: 'Sudoku board, 9 rows by 9 columns' });
  await expect(board).toBeVisible();
  await expect(board.getByRole('gridcell', { name: /given$/ }).first()).toBeVisible();
  const givens = await board.getByRole('gridcell', { name: /given$/ }).count();
  expect(givens).toBeGreaterThanOrEqual(38);
});

test('pick a cell, then a digit; picking it again clears it', async ({ page }) => {
  await loadKnownBoard(page);
  await cell(page, 1, 1).click();
  await digit(page, 7).click();
  await expect(cell(page, 1, 1, '7, repeats in its row, column or box')).toBeVisible();
  await digit(page, 7).click();
  await expect(cell(page, 1, 1)).toBeVisible();
  await digit(page, 1).click();
  await expect(cell(page, 1, 1, '1')).toBeVisible();
});

test('keyboard: arrows move, digits place, notes, erase and undo', async ({ page }) => {
  await loadKnownBoard(page);
  await cell(page, 1, 1).click();
  await page.keyboard.press('ArrowRight');
  await expect(cell(page, 1, 2)).toBeFocused();
  await page.keyboard.press('n');
  await expect(page.getByRole('button', { name: 'Notes' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('2');
  await page.keyboard.press('8');
  await expect(cell(page, 1, 2, 'empty, notes 2 8')).toBeFocused();
  await page.keyboard.press('n');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('2'); // wrong here, and clears the 2 note next door
  await expect(cell(page, 1, 2, 'empty, notes 8')).toBeVisible();
  await page.keyboard.press('Backspace');
  await expect(cell(page, 1, 1)).toBeFocused();
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(cell(page, 1, 2, 'empty, notes 2 8')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+Digit5');
  await expect(cell(page, 1, 2, 'empty, notes 2 5 8')).toBeFocused();
});

test('givens cannot be changed', async ({ page }) => {
  await loadKnownBoard(page);
  await cell(page, 1, 3, '3, given').click();
  await page.keyboard.press('9');
  await expect(cell(page, 1, 3, '3, given')).toBeVisible();
});

test('solving the board wins, records the time, and survives a reload', async ({ page }) => {
  await loadKnownBoard(page);
  await cell(page, 1, 1).click();
  await page.keyboard.press('1');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('2');
  await cell(page, 5, 5).click();
  await page.keyboard.press('9');
  await expect(page.getByRole('status').filter({ hasText: 'Solved in' })).toContainText('New best');
  await expect(page.locator('.sdk-record')).toContainText('1 solved');
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: 'Solved in' })).toBeVisible();
});

test('a hint fills a cell and is noted on the win', async ({ page }) => {
  await loadKnownBoard(page, [40]);
  await page.getByRole('button', { name: 'Hint' }).click();
  await expect(cell(page, 5, 5, '9, from a hint')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'with 1 hint' })).toBeVisible();
});

test('a game in progress is kept on reload, and a new game asks first', async ({ page }) => {
  await loadKnownBoard(page);
  await cell(page, 1, 1).click();
  await page.keyboard.press('1');
  await page.reload();
  await expect(cell(page, 1, 1, '1')).toBeVisible();
  await page.getByRole('button', { name: 'New game' }).click();
  const dialog = page.getByRole('dialog', { name: 'start a new game?' });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(cell(page, 1, 1, '1')).toBeVisible();
  await page.getByRole('button', { name: 'New game' }).click();
  await dialog.getByRole('button', { name: 'New game' }).click();
  await expect(cell(page, 1, 1, '1')).toHaveCount(0);
  await expect(page.getByRole('gridcell', { name: /given$/ }).first()).toBeVisible();
});

test('difficulty buttons start a puzzle at that level', async ({ page }) => {
  await page.goto('./tools/sudoku/');
  await expect(page.getByRole('gridcell', { name: /given$/ }).first()).toBeVisible();
  const more = page.getByRole('button', { name: 'Options' });
  if (await more.isVisible()) await more.click();
  await page.getByRole('button', { name: 'hard', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.sdk-stat-value').first()).toHaveText('hard');
  await expect(page.locator('.sdk-level[data-level="hard"]')).toHaveAttribute('aria-pressed', 'true');
});

test('on narrow screens the game fills the screen like an app', async ({ page }) => {
  test.skip(!isNarrow(page), 'narrow screens only');
  await page.goto('./tools/sudoku/');
  const view = page.viewportSize();
  await expect(page.getByRole('link', { name: 'sloppify' })).toBeHidden();
  await expect(page.locator('.site-footer')).toBeHidden();
  const box = await page.getByRole('grid').boundingBox();
  expect(box.width).toBeGreaterThan(view.width * 0.85);
  expect(await page.evaluate(() => document.scrollingElement.scrollHeight)).toBeLessThanOrEqual(view.height);
  for (const name of ['New game', 'Options']) {
    const b = await page.getByRole('button', { name, exact: true }).boundingBox();
    expect(b.y + b.height).toBeGreaterThan(view.height - 80);
  }
  await page.getByRole('button', { name: 'Options' }).click();
  const sheet = page.getByRole('dialog', { name: 'Options' });
  await expect(sheet.getByRole('heading', { name: 'how to play' })).toBeVisible();
  await expect(sheet.getByRole('link', { name: 'Source on GitHub' })).toHaveAttribute('href', /tools\/sudoku\/$/);
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('button', { name: 'Options' })).toBeFocused();
});

for (const scheme of ['light', 'dark']) {
  test(`accessibility (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await loadKnownBoard(page, [0, 1, 2, 40]);
    await cell(page, 1, 1).click();
    await page.keyboard.press('2'); // a repeat
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+Digit4');
    await page.getByRole('button', { name: 'Hint' }).click();
    await expectAccessible(page, 'in progress');
    await page.getByRole('button', { name: 'New game' }).click();
    await expectAccessible(page, 'confirm dialog');
    await page.getByRole('button', { name: 'Cancel' }).click();
    if (isNarrow(page)) {
      await page.getByRole('button', { name: 'Options' }).click();
      const sheet = page.getByRole('dialog', { name: 'Options' });
      await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
      await expectAccessible(page, 'options sheet');
    }
  });
}
