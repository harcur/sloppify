// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { test, expect } from '@playwright/test';
import { trackExternalRequests, markNoticeSeen, expectAccessible } from './helpers.js';
import { newGame, serialize } from '../../tools/mines/logic.js';

let external;
test.beforeEach(async ({ page, baseURL }) => {
  external = trackExternalRequests(page, baseURL);
  await markNoticeSeen(page);
});
test.afterEach(() => { expect(external, 'requests outside the site').toEqual([]); });

// Known small boards, saved before the page loads.
// CORNER: the whole first row plus the first cell of the second. Opening any
// cell away from them floods the board and wins.
// WALL: the whole third row plus the first cell of the fourth. Opening below
// the wall leaves the two rows above it unopened.
const CORNER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const WALL = [18, 19, 20, 21, 22, 23, 24, 25, 26, 27];
async function loadKnownBoard(page, mines = CORNER) {
  const g = newGame('small');
  for (const i of mines) g.mine[i] = 1;
  g.state = 'playing';
  const saved = JSON.stringify(serialize(g));
  await page.addInitScript((game) => {
    if (localStorage.getItem('sloppify:mines:game')) return;
    localStorage.setItem('sloppify:mines:__schema', '1');
    localStorage.setItem('sloppify:mines:game', game);
  }, saved);
  await page.goto('./tools/mines/');
}

// On narrow screens the board sizes live in the options sheet.
async function chooseLevel(page, level) {
  const more = page.getByRole('button', { name: 'Options' });
  if (await more.isVisible()) await more.click();
  await page.getByRole('button', { name: new RegExp(`^${level}`) }).click();
}
const isNarrow = (page) => (page.viewportSize()?.width ?? 1000) < 720;

const cell = (page, row, col, state = 'hidden') => page.getByRole('gridcell', { name: `row ${row}, column ${col}: ${state}` });
const minesLeft = (page) => page.locator('.mines-stat').filter({ hasText: 'mines left' }).locator('.mines-stat-value');

test('the first cell opened is safe and opens an area', async ({ page }) => {
  await page.goto('./tools/mines/');
  await expect(page.getByRole('grid', { name: 'Minefield, 9 rows by 9 columns' })).toBeVisible();
  await cell(page, 5, 5).click();
  await expect(cell(page, 5, 5, 'empty')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'opened a mine' })).toHaveCount(0);
});

test('keyboard: arrows move, F flags, Enter opens', async ({ page }) => {
  await page.goto('./tools/mines/');
  await cell(page, 1, 1).focus();
  await page.keyboard.press('ArrowRight');
  await expect(cell(page, 1, 2)).toBeFocused();
  await page.keyboard.press('f');
  await expect(cell(page, 1, 2, 'flagged')).toBeFocused();
  await expect(minesLeft(page)).toHaveText('9');
  await page.keyboard.press('f');
  await expect(minesLeft(page)).toHaveText('10');
  await page.keyboard.press('End');
  await expect(cell(page, 1, 9)).toBeFocused();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(cell(page, 5, 9)).toHaveCount(0);
});

test('right-click and flag mode both place flags', async ({ page }) => {
  await page.goto('./tools/mines/');
  await cell(page, 2, 2).click({ button: 'right' });
  await expect(cell(page, 2, 2, 'flagged')).toBeVisible();
  const toggle = page.getByRole('button', { name: 'Flag mode' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await cell(page, 3, 3).click();
  await expect(cell(page, 3, 3, 'flagged')).toBeVisible();
  await expect(minesLeft(page)).toHaveText('8');
});

test('clearing the board wins, records the time, and survives a reload', async ({ page }) => {
  await loadKnownBoard(page);
  await cell(page, 9, 9).click();
  await expect(page.getByRole('status').filter({ hasText: 'Cleared in' })).toContainText('New best');
  await expect(cell(page, 1, 1, 'flagged')).toBeVisible();
  await expect(page.locator('.mines-record')).toContainText('1 won of 1');
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: 'Cleared in' })).toBeVisible();
  await expect(page.locator('.mines-record')).toContainText('best');
});

test('opening a mine ends the game and shows every mine', async ({ page }) => {
  await loadKnownBoard(page);
  await cell(page, 3, 3).click({ button: 'right' }); // a wrong flag
  await cell(page, 1, 1).click();
  await expect(page.getByRole('status').filter({ hasText: 'opened a mine' })).toBeVisible();
  await expect(cell(page, 1, 1, 'mine, exploded')).toBeVisible();
  await expect(cell(page, 1, 5, 'mine')).toBeVisible();
  await expect(cell(page, 3, 3, 'flagged, no mine')).toBeVisible();
});

test('a game in progress is kept on reload, and a new game asks first', async ({ page }) => {
  await loadKnownBoard(page, WALL);
  await cell(page, 5, 5).click();
  await page.reload();
  await expect(cell(page, 5, 5, 'empty')).toBeVisible();
  await page.getByRole('button', { name: 'New game' }).click();
  const dialog = page.getByRole('dialog', { name: 'start a new game?' });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(cell(page, 5, 5, 'empty')).toBeVisible();
  await page.getByRole('button', { name: 'New game' }).click();
  await dialog.getByRole('button', { name: 'New game' }).click();
  await expect(cell(page, 5, 5)).toBeVisible();
});

test('resetting mines data clears the game but keeps favourites', async ({ page }) => {
  await page.goto('./tools/mines/');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'Add to favourites' }).click();
  await page.keyboard.press('Escape');
  await cell(page, 5, 5).click();
  await expect(cell(page, 5, 5, 'empty')).toBeVisible();

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'Reset mines data' }).click();
  await page.getByRole('dialog', { name: 'Reset mines data?' }).getByRole('button', { name: 'Reset mines data' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'mines data reset' })).toBeVisible();
  await expect(cell(page, 5, 5)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('sloppify:mines:game'))).toBeNull();
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('button', { name: 'Remove from favourites' })).toBeVisible();
});

test('the density slider sets the mine count, at once before the first move', async ({ page }) => {
  await page.goto('./tools/mines/');
  if (isNarrow(page)) await page.getByRole('button', { name: 'Options' }).click();
  const slider = page.getByRole('slider', { name: 'Mine density' });
  await expect(slider).toHaveAttribute('aria-valuetext', '10 mines, 12%');
  await slider.fill('20');
  await expect(slider).toHaveAttribute('aria-valuetext', '20 mines, 25%');
  await expect(minesLeft(page)).toHaveText('20');
  await expect(page.locator('.mines-level[data-level="small"]')).toContainText('20 mines');
  await expect(page.locator('.mines-record')).toContainText('small, 20 mines');
  if (isNarrow(page)) await page.getByRole('button', { name: 'Close' }).click();
  await cell(page, 5, 5).click();
  if (isNarrow(page)) await page.getByRole('button', { name: 'Options' }).click();
  await slider.fill('15');
  await expect(page.getByText('This game has 20 mines.')).toBeVisible();
  await expect(minesLeft(page)).toHaveText('20');
  await page.reload();
  await expect(minesLeft(page)).toHaveText('20');
  await expect(page.locator('#mines-density')).toHaveValue('15'); // in the closed sheet on narrow screens
});

test('the large board turns on its side on narrow screens', async ({ page }) => {
  await page.goto('./tools/mines/');
  await chooseLevel(page, 'large');
  const name = isNarrow(page) ? 'Minefield, 30 rows by 16 columns' : 'Minefield, 16 rows by 30 columns';
  await expect(page.getByRole('grid', { name })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.mines-level[data-level="large"]')).toHaveAttribute('aria-pressed', 'true');
});

test('on narrow screens the game fills the screen like an app', async ({ page }) => {
  test.skip(!isNarrow(page), 'narrow screens only');
  await page.goto('./tools/mines/');
  const view = page.viewportSize();
  await expect(page.getByRole('link', { name: 'sloppify' })).toBeHidden();
  await expect(page.locator('.site-footer')).toBeHidden();
  const box = await page.getByRole('grid').boundingBox();
  expect(box.width).toBeGreaterThan(view.width * 0.85);
  expect(await page.evaluate(() => document.scrollingElement.scrollHeight)).toBeLessThanOrEqual(view.height);
  for (const name of ['Flag mode', 'New game', 'Options']) {
    const b = await page.getByRole('button', { name, exact: true }).boundingBox();
    expect(b.y + b.height).toBeGreaterThan(view.height - 80);
  }
  // The site menu is still one tap away.
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('button', { name: 'Export' })).toBeVisible();
  await page.keyboard.press('Escape');
  // Options holds the side panel and the footer's source link.
  await page.getByRole('button', { name: 'Options' }).click();
  const sheet = page.getByRole('dialog', { name: 'Options' });
  await expect(sheet.getByRole('heading', { name: 'how to play' })).toBeVisible();
  await expect(sheet.getByRole('link', { name: 'Source on GitHub' })).toHaveAttribute('href', /tools\/mines\/$/);
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('button', { name: 'Options' })).toBeFocused();
});

for (const scheme of ['light', 'dark']) {
  test(`accessibility (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await loadKnownBoard(page, WALL);
    await cell(page, 1, 1).click({ button: 'right' });
    await cell(page, 7, 5).click();
    await expectAccessible(page, 'in progress');
    await page.getByRole('button', { name: 'New game' }).click();
    await expectAccessible(page, 'confirm dialog');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await cell(page, 3, 5).click();
    await expectAccessible(page, 'lost');
    if (isNarrow(page)) {
      await page.getByRole('button', { name: 'Options' }).click();
      const sheet = page.getByRole('dialog', { name: 'Options' });
      await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
      await expectAccessible(page, 'options sheet');
    }
  });
}
