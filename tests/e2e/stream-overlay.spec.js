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

const open = async (page) => {
  await page.goto('./tools/stream-overlay/');
  await expect(page.locator('.so-stage[data-drawn="true"]')).toBeAttached();
};
const zone = (page, name) => page.getByRole('button', { name: new RegExp(`^${name}: left`) });
// Share of a canvas's pixels that aren't transparent.
const coverage = (locator) => locator.evaluate((c) => {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
  return n / (c.width * c.height);
});

test('draws a starting layout with art around its zones', async ({ page }) => {
  await open(page);
  await expect(zone(page, 'camera')).toBeVisible();
  await expect(zone(page, 'chat')).toBeVisible();
  const back = await coverage(page.locator('canvas.so-layer').first());
  const front = await coverage(page.locator('canvas.so-layer').last());
  expect(back).toBeGreaterThan(0.05);
  expect(front).toBeGreaterThan(0);
  expect(front).toBeLessThan(back);
});

test('keyboard: arrows move the zone, Shift resizes it, and it is saved', async ({ page }) => {
  await open(page);
  const cam = zone(page, 'camera');
  await cam.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowUp');
  await expect(cam).toHaveAccessibleName('camera: left 50, top 690, 480 by 340');
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(page.getByLabel('Width', { exact: true })).toHaveValue('470');
  await page.waitForTimeout(400);
  await page.reload();
  await expect(zone(page, 'camera')).toHaveAccessibleName('camera: left 50, top 690, 470 by 340');
});

test('dragging a zone moves it, dragging its corner resizes it', async ({ page }) => {
  await open(page);
  const chat = zone(page, 'chat');
  const box = await chat.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 2 + 20, { steps: 4 });
  await page.mouse.up();
  const x = +(await page.getByLabel('Left', { exact: true }).inputValue());
  expect(x).toBeLessThan(1500);
  await page.mouse.move(box.x + box.width - 6 - 40, box.y + box.height - 6 + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 60, box.y + box.height - 20, { steps: 4 });
  await page.mouse.up();
  expect(+(await page.getByLabel('Width', { exact: true }).inputValue())).toBeLessThan(380);
});

test('zones can be added, edited and removed', async ({ page }) => {
  await open(page);
  await page.getByLabel('Kind of zone to add').selectOption('buttons');
  await page.getByRole('button', { name: 'Add zone' }).click();
  await expect(zone(page, 'buttons')).toBeFocused();
  await expect(page.getByLabel('Effect on the art')).toHaveValue('pile');
  await page.getByLabel('Effect on the art').selectOption('splash');
  await expect(page.getByText('Paint splats around the edges')).toBeVisible();
  await page.getByLabel('Top', { exact: true }).fill('5000');
  await page.getByLabel('Top', { exact: true }).press('Enter');
  await expect(page.getByLabel('Top', { exact: true })).toHaveValue(String(1080 - 90));
  await page.getByRole('button', { name: 'Remove zone' }).click();
  await expect(zone(page, 'buttons')).toHaveCount(0);
  await expect(page.locator('[aria-live]').filter({ hasText: 'buttons removed' })).toBeAttached();
});

test('a starting layout replaces the zones after confirming', async ({ page }) => {
  await open(page);
  await page.getByLabel('Starting layout').selectOption('intermission');
  await page.getByRole('button', { name: 'Use layout' }).click();
  const dialog = page.getByRole('dialog', { name: 'replace this layout?' });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(zone(page, 'camera')).toBeVisible();
  await page.getByRole('button', { name: 'Use layout' }).click();
  await dialog.getByRole('button', { name: 'Replace' }).click();
  await expect(zone(page, 'camera')).toHaveCount(0);
  await expect(zone(page, 'info panel')).toBeVisible();
  // No zone has content under the art, so there's no front layer to add.
  await expect(page.getByRole('button', { name: 'Download front layer' })).toBeDisabled();
  await expect(page.getByText('the front layer is empty')).toBeVisible();
});

test('downloads a full size layer as a PNG', async ({ page }) => {
  await open(page);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download back layer' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('overlay-back-1920x1080.png');
});

test('the browser source link draws the layer on a transparent page', async ({ page }) => {
  await open(page);
  const link = await page.getByLabel('Front layer link', { exact: true }).inputValue();
  expect(link).toMatch(/view\.html#front\./);
  await page.goto(link);
  const canvas = page.getByRole('img', { name: 'front layer of the overlay, 1920 × 1080' });
  await expect(canvas).toBeVisible();
  await expect(page.locator('html[data-ready="front"]')).toBeAttached();
  expect(await coverage(canvas)).toBeGreaterThan(0);
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await expect(page.locator('.site-header')).toHaveCount(0);
  await page.goto('./tools/stream-overlay/view.html#front.broken');
  await expect(page.getByText('doesn’t hold a valid overlay')).toBeVisible();
});

for (const scheme of ['light', 'dark']) {
  test(`accessibility (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page);
    await expectAccessible(page, `stream overlay ${scheme}`);
    await page.getByLabel('Show zones').uncheck();
    await page.getByRole('button', { name: 'Use layout' }).click();
    await expectAccessible(page, `stream overlay dialog ${scheme}`);
  });
}
