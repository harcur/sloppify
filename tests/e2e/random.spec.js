// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { test, expect } from '@playwright/test';
import { trackExternalRequests, markNoticeSeen, expectAccessible } from './helpers.js';

let external;
test.beforeEach(async ({ page, baseURL }) => {
  external = trackExternalRequests(page, baseURL);
  await markNoticeSeen(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
});
test.afterEach(() => { expect(external, 'requests outside the site').toEqual([]); });

const tab = (page, name) => page.getByRole('tab', { name, exact: true });
const lastResult = (page) => page.locator('.random-history li').first();

test('the wheel picks one of its entries and can remove it', async ({ page }) => {
  await page.goto('./tools/random/');
  await expect(tab(page, 'wheel')).toHaveAttribute('aria-selected', 'true');
  await page.getByLabel('Entries, one per line').fill('red\ngreen\nblue');
  await expect(page.getByRole('img', { name: 'Wheel with 3 entries' })).toBeVisible();
  await page.getByLabel('Remove the winner after each spin').check();
  await page.getByRole('button', { name: 'Spin' }).click();
  await expect(lastResult(page)).toHaveText(/^wheel (red|green|blue)$/);
  const winner = (await lastResult(page).textContent()).replace('wheel ', '');
  await expect(page.getByRole('img', { name: 'Wheel with 2 entries' })).toBeVisible();
  await expect(page.getByLabel('Entries, one per line')).not.toHaveValue(new RegExp(`^${winner}$`, 'm'));
});

test('dice: buttons, notation and advantage', async ({ page }) => {
  await page.goto('./tools/random/');
  await tab(page, 'dice').click();
  const notation = page.getByLabel('Dice notation');
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(notation).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Roll' })).toBeDisabled();
  await page.getByRole('button', { name: 'Add a d6' }).click();
  await page.getByRole('button', { name: 'Add a d6' }).click();
  await page.getByRole('button', { name: 'Raise the modifier' }).click();
  await expect(notation).toHaveValue('2d6 + 1');
  await page.getByRole('button', { name: 'Roll' }).click();
  await expect(page.getByRole('img', { name: /^d6: [1-6]$/ })).toHaveCount(2);
  const total = Number(await page.locator('.random-total').textContent());
  expect(total).toBeGreaterThanOrEqual(3);
  expect(total).toBeLessThanOrEqual(13);
  await expect(lastResult(page)).toHaveText(`dice 2d6 + 1: ${total}`);

  await notation.fill('d20');
  await page.getByRole('button', { name: 'advantage', exact: true }).click();
  await notation.press('Enter');
  await expect(page.getByRole('img', { name: /^d20: \d+, dropped$/ })).toHaveCount(1);
  await expect(page.getByRole('img', { name: /^d20: \d+$/ })).toHaveCount(1);

  await notation.fill('2q6');
  await expect(page.getByRole('alert')).toContainText('Write dice like');
  await expect(page.getByRole('button', { name: 'Roll' })).toBeDisabled();
});

test('numbers without repeats, and settings survive a reload', async ({ page }) => {
  await page.goto('./tools/random/');
  await tab(page, 'numbers').click();
  await page.getByLabel('From', { exact: true }).fill('1');
  await page.getByLabel('To', { exact: true }).fill('5');
  await page.getByLabel('How many', { exact: true }).fill('5');
  await page.getByLabel('No repeats').check();
  await page.getByLabel('Sort').check();
  await page.getByRole('button', { name: 'Pick' }).click();
  await expect(page.locator('.random-number')).toHaveText(['1', '2', '3', '4', '5']);
  await page.getByLabel('How many', { exact: true }).fill('6');
  await page.getByRole('button', { name: 'Pick' }).click();
  await expect(page.getByRole('alert')).toContainText('aren’t that many');
  await page.reload();
  await expect(tab(page, 'numbers')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('To', { exact: true })).toHaveValue('5');
  await expect(page.locator('.random-history li')).toHaveCount(1);
});

test('straws: everyone pulls and the shortest is named', async ({ page }) => {
  await page.goto('./tools/random/');
  await tab(page, 'straws').click();
  await page.getByLabel('Entries, one per line').fill('Ann\nBo\nCy');
  await page.getByRole('button', { name: 'Pull the straw for Bo' }).click();
  await expect(page.getByRole('button', { name: /^Bo: straw [1-3] of 3$/ })).toBeVisible();
  await expect(page.getByText('2 straws left')).toBeVisible();
  await page.getByRole('button', { name: 'Pull all' }).click();
  await expect(lastResult(page)).toHaveText(/^straws (Ann|Bo|Cy) drew the shortest straw$/);
  const loser = (await lastResult(page).textContent()).match(/straws (\w+)/)[1];
  await expect(page.getByRole('button', { name: `${loser}: straw 1 of 3` })).toContainText('shortest');
});

test('coin, shuffle and teams', async ({ page }) => {
  await page.goto('./tools/random/');
  await tab(page, 'coin').click();
  await page.getByRole('button', { name: 'Flip' }).click();
  await expect(lastResult(page)).toHaveText(/^coin (heads|tails)$/);
  await expect(page.locator('.random-tally')).toHaveText(/Heads [01] · tails [01]/);

  await tab(page, 'shuffle').click();
  await page.getByLabel('Entries, one per line').fill('a\nb\nc\nd');
  await page.getByRole('button', { name: 'Shuffle' }).click();
  await expect(page.locator('.random-order li')).toHaveCount(4);

  await tab(page, 'teams').click();
  await expect(page.getByLabel('Entries, one per line')).toHaveValue('a\nb\nc\nd');
  await page.getByLabel('Teams', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Make teams' }).click();
  await expect(page.getByRole('heading', { name: 'team 2' })).toBeVisible();
  await expect(page.locator('.random-team li')).toHaveCount(4);
  await page.getByLabel('Teams', { exact: true }).fill('5');
  await page.getByRole('button', { name: 'Make teams' }).click();
  await expect(page.getByRole('alert')).toContainText('at least as many');
});

test('tabs work with the keyboard', async ({ page }) => {
  await page.goto('./tools/random/');
  await tab(page, 'wheel').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, 'dice')).toBeFocused();
  await expect(tab(page, 'dice')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(tab(page, 'teams')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, 'wheel')).toBeFocused();
});

test('animations run and finish with motion allowed', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('./tools/random/');
  await page.getByRole('button', { name: 'Spin' }).click();
  await expect(page.getByRole('button', { name: 'Spin' })).toBeDisabled();
  await expect(lastResult(page)).toHaveText(/^wheel /, { timeout: 8000 });
  await tab(page, 'dice').click();
  await page.getByRole('button', { name: 'Roll' }).click();
  await expect(lastResult(page)).toHaveText(/^dice /);
  await tab(page, 'coin').click();
  await page.getByRole('button', { name: 'Flip' }).click();
  await expect(lastResult(page)).toHaveText(/^coin /);
});

for (const scheme of ['light', 'dark']) {
  test(`accessibility (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('./tools/random/');
    await page.getByRole('button', { name: 'Spin' }).click();
    await expectAccessible(page, 'wheel');
    await tab(page, 'dice').click();
    await page.getByLabel('Dice notation').fill('d20 + 2d6 + d100');
    await page.getByRole('button', { name: 'disadvantage' }).click();
    await page.getByRole('button', { name: 'Roll' }).click();
    await expectAccessible(page, 'dice');
    for (const [name, action] of [['numbers', 'Pick'], ['straws', 'Pull all'], ['coin', 'Flip'], ['shuffle', 'Shuffle'], ['teams', 'Make teams']]) {
      await tab(page, name).click();
      await page.getByRole('button', { name: action }).click();
      await expectAccessible(page, name);
    }
  });
}
