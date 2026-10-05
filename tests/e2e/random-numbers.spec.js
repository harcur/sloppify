// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { test, expect } from '@playwright/test';
import { trackExternalRequests, markNoticeSeen, expectAccessible } from './helpers.js';

let external;
test.beforeEach(async ({ page, baseURL }) => {
  external = trackExternalRequests(page, baseURL);
  await markNoticeSeen(page);
});
test.afterEach(() => { expect(external, 'requests outside the site').toEqual([]); });

const from = (page) => page.getByLabel('From', { exact: true });
const to = (page) => page.getByLabel('To', { exact: true });
const count = (page) => page.getByLabel('How many numbers');
const pick = (page) => page.getByRole('button', { name: 'Pick', exact: true });
const tiles = (page) => page.locator('.rn-tile');
const historyRows = (page) => page.locator('.rn-history li');

test('picks a number in the range and records it', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./tools/random-numbers/');
  await expect(page.getByText('Press Pick for a number.')).toBeVisible();
  await from(page).fill('5');
  await to(page).fill('7');
  await pick(page).click();
  await expect(tiles(page)).toHaveCount(1);
  expect(['5', '6', '7']).toContain(await tiles(page).textContent());
  await expect(page.locator('.rn-caption')).toHaveText('5 to 7');
  await expect(historyRows(page)).toHaveCount(1);
  await expect(page.locator('[aria-live="polite"].sr-only')).toHaveText(/^[567]$/);
});

test('up to four numbers are tiles, more are a numbered list with a sum', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./tools/random-numbers/');
  await page.getByRole('button', { name: 'More numbers' }).click();
  await page.getByRole('button', { name: 'More numbers' }).click();
  await page.getByRole('button', { name: 'More numbers' }).click();
  await expect(count(page)).toHaveValue('4');
  await pick(page).click();
  await expect(tiles(page)).toHaveCount(4);
  await count(page).fill('12');
  await pick(page).click();
  await expect(page.locator('.rn-list li')).toHaveCount(12);
  await expect(page.locator('.rn-list li').first()).toContainText('1.');
  await expect(page.locator('.rn-sum')).toHaveText(/^Sum \d+$/);
  await expect(page.locator('.rn-caption')).toHaveText('1 to 100 · 12 numbers');
});

test('no repeats and sorting, and an impossible request is explained', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./tools/random-numbers/');
  await from(page).fill('1');
  await to(page).fill('5');
  await count(page).fill('5');
  await page.getByLabel('No repeats').check();
  await page.getByLabel('Sort smallest first').check();
  await pick(page).click();
  await expect(page.locator('.rn-value')).toHaveText(['1', '2', '3', '4', '5']);
  await count(page).fill('6');
  await pick(page).click();
  await expect(page.getByRole('alert')).toHaveText('There aren’t 6 different numbers between 1 and 5.');
  await to(page).fill('abc');
  await pick(page).click();
  await expect(page.getByRole('alert')).toContainText('Enter whole numbers');
});

test('settings and history survive a reload, and history can be cleared', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./tools/random-numbers/');
  await from(page).fill('-3');
  await to(page).fill('3');
  await to(page).press('Enter');
  await expect(historyRows(page)).toHaveCount(1);
  const shown = await tiles(page).textContent();
  await page.reload();
  await expect(from(page)).toHaveValue('−3');
  await expect(to(page)).toHaveValue('3');
  await expect(tiles(page)).toHaveText(shown);
  await page.getByRole('button', { name: 'Clear history' }).click();
  await expect(historyRows(page)).toHaveCount(0);
  await expect(page.getByText('Your picks show up here.')).toBeVisible();
});

test('a new pick animates: flicker, then pop and flash', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('./tools/random-numbers/');
  await pick(page).click();
  await expect(page.locator('.rn-stage')).toHaveClass(/rn-rolling/);
  await expect(page.locator('.rn-stage')).toHaveClass(/rn-pop/);
  await expect(historyRows(page)).toHaveCount(1);
  await pick(page).click();
  await expect(historyRows(page)).toHaveCount(2);
});

test('on phones Pick is pinned to the bottom of the screen', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) >= 720, 'narrow screens only');
  await page.goto('./tools/random-numbers/');
  const view = page.viewportSize();
  const box = await pick(page).boundingBox();
  expect(box.y + box.height).toBeGreaterThan(view.height - 80);
  await page.locator('.site-footer').scrollIntoViewIfNeeded();
  const link = await page.getByRole('link', { name: 'Source on GitHub' }).boundingBox();
  const bar = await page.locator('.rn-actions').boundingBox();
  expect(link.y + link.height).toBeLessThanOrEqual(bar.y);
});

test('on phones Pick stays at the bottom of the visible area when it is smaller than the page', async ({ page, browserName }) => {
  test.skip((page.viewportSize()?.width ?? 1000) >= 720, 'narrow screens only');
  test.skip(browserName !== 'chromium', 'zooms through the Chrome DevTools Protocol');
  await page.goto('./tools/random-numbers/');
  // Zooming in shrinks the visual viewport, like an open keyboard does.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
  await expect.poll(() => page.evaluate(() => {
    const bar = document.querySelector('.rn-actions').getBoundingClientRect();
    return Math.abs(visualViewport.offsetTop + visualViewport.height - bar.bottom);
  })).toBeLessThan(2);
});

for (const scheme of ['light', 'dark']) {
  test(`accessibility (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.goto('./tools/random-numbers/');
    await expectAccessible(page, 'empty');
    await pick(page).click();
    await expectAccessible(page, 'one number');
    await count(page).fill('8');
    await pick(page).click();
    await expectAccessible(page, 'list');
    await count(page).fill('0');
    await pick(page).click();
    await expectAccessible(page, 'error');
  });
}
