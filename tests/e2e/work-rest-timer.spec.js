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

const time = (page) => page.getByRole('timer');
const isNarrow = (page) => (page.viewportSize()?.width ?? 1000) < 720;

// On narrow screens the settings live in the options sheet.
async function openSettings(page) {
  if (isNarrow(page)) await page.getByRole('button', { name: 'Settings' }).click();
}
async function closeSettings(page) {
  if (isNarrow(page)) await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Close' }).click();
}

test('starts, pauses and resumes', async ({ page }) => {
  await page.clock.install();
  await page.goto('./tools/work-rest-timer/');
  await expect(time(page)).toHaveText('25:00');
  await page.getByRole('button', { name: 'Start work' }).click();
  await page.clock.runFor(61_000);
  await expect(time(page)).toHaveText('23:59');
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Paused at 23:59' })).toBeVisible();
  await page.clock.runFor(10_000);
  await expect(time(page)).toHaveText('23:59');
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
});

test('a finished work session moves on to a short rest and is counted', async ({ page }) => {
  await page.clock.install();
  await page.goto('./tools/work-rest-timer/');
  await openSettings(page);
  await page.getByLabel('Work', { exact: true }).fill('1');
  await page.getByLabel('Work', { exact: true }).press('Tab');
  await closeSettings(page);
  await expect(time(page)).toHaveText('1:00');
  await page.getByRole('button', { name: 'Start work' }).click();
  await page.clock.runFor(61_000);
  await expect(page.getByRole('status').filter({ hasText: 'Work done. Time for a short rest.' })).toBeVisible();
  await expect(time(page)).toHaveText('5:00');
  await expect(page.getByText('work sessions today: 1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start short rest' })).toBeVisible();
});

test('settings and a running timer survive a reload', async ({ page }) => {
  await page.goto('./tools/work-rest-timer/');
  await openSettings(page);
  await page.getByRole('button', { name: '50 minutes work, 10 minutes rest' }).click();
  await closeSettings(page);
  await expect(time(page)).toHaveText('50:00');
  await page.getByRole('button', { name: 'Start work' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await openSettings(page);
  await expect(page.getByLabel('Work', { exact: true })).toHaveValue('50');
});

test('minimal view hides everything but the glass, time and one button; Escape leaves it', async ({ page }) => {
  await page.goto('./tools/work-rest-timer/');
  await page.getByRole('button', { name: 'Minimal' }).click();
  await expect(page.getByRole('button', { name: 'Skip' })).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Intervals' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Leave minimal view' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Skip' })).toBeVisible();
});

test('on phones it fills the screen like an app, with settings in a sheet', async ({ page }) => {
  test.skip(!isNarrow(page), 'phone layout only');
  await page.goto('./tools/work-rest-timer/');
  const start = page.getByRole('button', { name: 'Start work' });
  const box = await start.boundingBox();
  const vh = page.viewportSize().height;
  expect(box.y).toBeGreaterThan(vh * 0.6);
  expect(await page.evaluate(() => document.scrollingElement.scrollHeight <= innerHeight + 1)).toBe(true);
  await expect(page.getByRole('heading', { name: 'Intervals' })).toBeHidden();
  await page.getByRole('button', { name: 'Settings' }).click();
  const sheet = page.getByRole('dialog', { name: 'Settings' });
  await expect(sheet.getByRole('heading', { name: 'Intervals' })).toBeVisible();
  await expect(sheet.getByRole('link', { name: 'Source on GitHub' })).toHaveAttribute('href', /tools\/work-rest-timer\/$/);
  await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  await expectAccessible(page, 'settings sheet');
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('button', { name: 'Settings' })).toBeFocused();
});

for (const scheme of ['light', 'dark']) {
  test(`accessible in ${scheme} mode, normal and minimal`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('./tools/work-rest-timer/');
    await expectAccessible(page, `work-rest-timer ${scheme}`);
    await page.getByRole('button', { name: 'Minimal' }).click();
    await expectAccessible(page, `work-rest-timer minimal ${scheme}`);
  });
}
