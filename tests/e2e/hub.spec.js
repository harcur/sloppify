// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { trackExternalRequests, markNoticeSeen, expectAccessible } from './helpers.js';

let external;
test.beforeEach(async ({ page, baseURL }) => { external = trackExternalRequests(page, baseURL); });
test.afterEach(() => { expect(external, 'requests outside the site').toEqual([]); });

test('first visit shows the notice once', async ({ page }) => {
  await page.goto('./');
  const dialog = page.getByRole('dialog', { name: 'before you start' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('no greed');
  await dialog.getByRole('button', { name: 'Got it' }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.getByRole('heading', { level: 3, name: 'sudoku' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('Escape dismisses the notice too', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0); // saved when the dialog's close event fires
  await page.reload();
  await expect(page.getByRole('heading', { level: 3, name: 'sudoku' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('favouriting moves a card into favourites and keeps focus on its star', async ({ page }) => {
  await markNoticeSeen(page);
  await page.goto('./');
  const star = page.getByRole('button', { name: 'Favourite sudoku' });
  await expect(star).toHaveAttribute('aria-pressed', 'false');
  await star.click();
  const favs = page.getByRole('region', { name: 'favourites' });
  await expect(favs.getByRole('link', { name: 'sudoku' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Favourite sudoku' })).toBeFocused();
  await page.reload();
  await expect(page.getByRole('region', { name: 'favourites' }).getByRole('link', { name: 'sudoku' })).toBeVisible();
});

test('opening a tool adds it to recent, and the tool menu can favourite it', async ({ page }) => {
  await markNoticeSeen(page);
  await page.goto('./tools/interest-calculator/');
  await expect(page.getByRole('heading', { level: 1, name: 'interest calculator' })).toBeVisible();
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'Add to favourites' }).click();
  await page.goto('./tools/sudoku/');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('link', { name: 'All tools' }).click();
  await expect(page.getByRole('region', { name: 'favourites' }).getByRole('link', { name: 'interest calculator' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'recent' }).getByRole('link', { name: 'sudoku' })).toBeVisible();
});

test('search filters and is remembered', async ({ page }) => {
  await markNoticeSeen(page);
  await page.goto('./');
  await page.getByRole('searchbox', { name: 'Search tools' }).fill('puzzle');
  await expect(page.getByRole('link', { name: 'sudoku' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'interest calculator' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('searchbox', { name: 'Search tools' })).toHaveValue('puzzle');
  await page.getByRole('searchbox', { name: 'Search tools' }).fill('zzzz');
  await expect(page.locator('#hub-groups').getByText('Nothing matches')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Nothing matches');
});

test('theme toggle overrides the system setting', async ({ page }) => {
  await markNoticeSeen(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('menu closes with Escape and returns focus', async ({ page }) => {
  await markNoticeSeen(page);
  await page.goto('./');
  const button = page.getByRole('button', { name: 'Menu' });
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(button).toBeFocused();
});

test('export, reset and import round-trip', async ({ page }, testInfo) => {
  await markNoticeSeen(page);
  await page.goto('./');
  await page.getByRole('button', { name: 'Favourite sudoku' }).click();

  await page.getByRole('button', { name: 'Menu' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  const file = testInfo.outputPath('backup.json');
  await (await downloadPromise).saveAs(file);
  const backup = JSON.parse(await fs.readFile(file, 'utf8'));
  expect(backup.format).toBe('sloppify-backup');
  expect(backup.tools.hub.data.favourites).toEqual(['sudoku']);

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'Reset everything' }).click();
  await page.getByRole('dialog', { name: 'Reset everything?' }).getByRole('button', { name: 'Reset everything' }).click();
  await page.waitForLoadState();
  await expect(page.getByRole('region', { name: 'favourites' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.getByRole('dialog', { name: 'Replace all your data?' }).getByRole('button', { name: 'Replace data' }).click();
  await expect(page.getByRole('region', { name: 'favourites' }).getByRole('link', { name: 'sudoku' })).toBeVisible();
});

test('a file that is not a backup changes nothing', async ({ page }, testInfo) => {
  await markNoticeSeen(page);
  await page.goto('./');
  await page.getByRole('button', { name: 'Favourite sudoku' }).click();
  const file = testInfo.outputPath('bad.json');
  await fs.writeFile(file, '{"hello": "world"}');
  await page.locator('input[type="file"]').setInputFiles(file);
  const dialog = page.getByRole('dialog', { name: 'Can’t import that file' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('region', { name: 'favourites' })).toBeVisible();
});

for (const scheme of ['light', 'dark']) {
  test(`accessibility (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('./');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectAccessible(page, 'notice');
    await page.getByRole('button', { name: 'Got it' }).click();
    await page.getByRole('button', { name: 'Favourite sudoku' }).click();
    await expectAccessible(page, 'hub');
    await page.getByRole('button', { name: 'Menu' }).click();
    await expectAccessible(page, 'hub menu');
    await page.goto('./tools/sudoku/');
    await expectAccessible(page, 'tool page');
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('button', { name: 'Reset everything' }).click();
    await expectAccessible(page, 'confirm dialog');
  });
}

test('every page in tools.json loads with its own source link', async ({ page, request }) => {
  await markNoticeSeen(page);
  const manifest = await (await request.get('./tools.json')).json();
  for (const tool of manifest.tools) {
    await page.goto(`./${tool.path}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Source on GitHub' })).toHaveAttribute('href', new RegExp(`${tool.path}$`));
  }
});
