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
const phone = (page) => page.viewportSize().width < 720;
// Opens a settings tab: a tab on wide screens, a tool at the bottom on phones.
const openTab = async (page, name) => {
  if (!phone(page)) { await page.getByRole('tab', { name }).click(); return; }
  const tool = page.getByRole('navigation', { name: 'Tools' }).getByRole('button', { name, exact: true });
  if (await tool.getAttribute('aria-pressed') !== 'true') await tool.click();
};
// Canvas size and starting layouts: in Use it on wide screens, in the options sheet on phones.
const openLayouts = async (page) => {
  if (phone(page)) await page.getByRole('button', { name: 'More' }).click();
  else await openTab(page, 'Use it');
};
const useLayout = async (page, value) => {
  await openLayouts(page);
  await page.getByLabel('Starting layout').selectOption(value);
  await page.getByRole('button', { name: 'Use layout' }).click();
};
const zone = (page, name) => page.getByRole('button', { name: new RegExp(`^${name}: left`) });
const effects = (page) => page.getByRole('group', { name: 'Effect on the art' });
const position = async (page) => {
  const more = page.locator('details', { hasText: 'Position, size and kind' });
  if (!(await more.evaluate((d) => d.open))) await more.locator('summary').click();
};
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
  await page.keyboard.press('Alt+ArrowDown');
  await expect(cam).toHaveAccessibleName('camera: left 50, top 691, 470 by 340');
  await page.waitForTimeout(400);
  await page.reload();
  await expect(zone(page, 'camera')).toHaveAccessibleName('camera: left 50, top 691, 470 by 340');
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

test('zones can be added, edited and removed from the list', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Add zone' }).click();
  await page.locator('#so-add-menu').getByRole('button', { name: 'buttons' }).click();
  await expect(page.getByRole('list', { name: 'Zones' }).getByRole('button', { name: /^buttons/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(effects(page).getByRole('button', { name: 'gravity' })).toHaveAttribute('aria-pressed', 'true');
  await effects(page).getByRole('button', { name: 'paint splash' }).click();
  await expect(page.getByText('Paint splats around the edges')).toBeVisible();
  await position(page);
  await page.getByLabel('Top', { exact: true }).fill('5000');
  await page.getByLabel('Top', { exact: true }).press('Enter');
  await expect(page.getByLabel('Top', { exact: true })).toHaveValue(String(1080 - 90));
  await page.getByRole('button', { name: 'Remove buttons' }).click();
  await expect(zone(page, 'buttons')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'buttons removed' })).toBeVisible();
});

test('the zone toolbar removes and duplicates, and undo brings a zone back', async ({ page }) => {
  await open(page);
  await zone(page, 'chat').click();
  await page.getByRole('toolbar', { name: 'chat zone' }).getByRole('button', { name: 'Duplicate zone' }).click();
  await expect(zone(page, 'chat 2')).toBeVisible();
  // The copy is selected, so the toolbar now acts on it.
  await page.getByRole('toolbar', { name: 'chat 2 zone' }).getByRole('button', { name: 'Remove zone' }).click();
  await expect(zone(page, 'chat 2')).toHaveCount(0);
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect(zone(page, 'chat 2')).toBeVisible();
  // Delete removes the focused zone; Ctrl+Z brings it back, Ctrl+Shift+Z removes it again.
  await zone(page, 'info panel').focus();
  await page.keyboard.press('Delete');
  await expect(zone(page, 'info panel')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(zone(page, 'info panel')).toBeVisible();
  await page.keyboard.press('Control+Shift+z');
  await expect(zone(page, 'info panel')).toHaveCount(0);
});

test('several zones are edited, moved and removed together', async ({ page }) => {
  await open(page);
  await openTab(page, 'Zones');
  const list = page.getByRole('list', { name: 'Zones' });
  const row = (n) => list.getByRole('button', { name: new RegExp(`^${n}`) });
  // Select all, then give every zone the same effect.
  await page.getByRole('button', { name: 'Select all' }).click();
  for (const n of ['camera', 'chat']) await expect(row(n)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: /^All \d+ zones$/ })).toBeVisible();
  await expect(page.getByText('The selected zones have different effects')).toBeVisible();
  await effects(page).getByRole('button', { name: 'vines' }).click();
  await expect(effects(page).getByRole('button', { name: 'vines' })).toHaveAttribute('aria-pressed', 'true');
  await row('camera').click();
  await expect(effects(page).getByRole('button', { name: 'vines' })).toHaveAttribute('aria-pressed', 'true');
  await expect(row('chat')).toHaveAttribute('aria-pressed', 'false');
  // Select several picks zones one tap at a time.
  await page.getByRole('button', { name: 'Select several' }).click();
  await row('chat').click();
  await expect(page.getByRole('heading', { name: '2 zones selected' })).toBeVisible();
  await expect(page.locator('details', { hasText: 'Position, size and kind' })).toBeHidden();
  // Arrow keys move both by the same amount.
  const cam = zone(page, 'camera');
  const chat = zone(page, 'chat');
  const before = [await cam.getAttribute('aria-label'), await chat.getAttribute('aria-label')];
  await cam.focus();
  await page.keyboard.press('ArrowUp');
  const top = (s) => s.match(/top (\d+)/)[1];
  await expect(cam).toHaveAccessibleName(before[0].replace(/top \d+/, `top ${+top(before[0]) - 10}`));
  await expect(chat).toHaveAccessibleName(before[1].replace(/top \d+/, `top ${+top(before[1]) - 10}`));
  // Delete removes both; undo brings both back.
  await page.keyboard.press('Delete');
  await expect(cam).toHaveCount(0);
  await expect(chat).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: '2 zones removed' })).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(cam).toBeVisible();
  await expect(chat).toBeVisible();
});

test('Shift and Ctrl click add zones to the selection on the stage', async ({ page }) => {
  test.skip(phone(page), 'no modifier keys on phones');
  await open(page);
  await zone(page, 'camera').click();
  await zone(page, 'chat').click({ modifiers: ['Shift'] });
  const bar = page.getByRole('toolbar', { name: '2 selected zones' });
  await expect(bar).toBeVisible();
  await expectAccessible(page, 'stream overlay several zones');
  // Dragging one of them moves both.
  const before = await zone(page, 'chat').boundingBox();
  const box = await zone(page, 'camera').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 - 30, { steps: 4 });
  await page.mouse.up();
  const after = await zone(page, 'chat').boundingBox();
  expect(after.y).toBeLessThan(before.y - 10);
  await expect(bar).toBeVisible();
  await bar.getByLabel('Effect').selectOption('glitch');
  await bar.getByRole('button', { name: 'Content under the art’s edges' }).click();
  await expect(bar.getByRole('button', { name: 'Content under the art’s edges' })).toHaveAttribute('aria-pressed', 'true');
  await zone(page, 'camera').click({ modifiers: ['Control'] });
  await expect(page.getByRole('toolbar', { name: 'chat zone' })).toBeVisible();
  await expect(effects(page).getByRole('button', { name: 'glitch' })).toHaveAttribute('aria-pressed', 'true');
  // Ctrl+A selects every zone; Escape goes back to one.
  await zone(page, 'chat').focus();
  await page.keyboard.press('Control+a');
  await expect(page.getByRole('toolbar', { name: /selected zones$/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('toolbar', { name: 'chat zone' })).toBeVisible();
});

test('the toolbar puts a zone\'s content under the art, which fills the front layer', async ({ page }) => {
  await open(page);
  await zone(page, 'camera').click();
  const under = page.getByRole('toolbar', { name: 'camera zone' }).getByRole('button', { name: 'Content under the art’s edges' });
  await expect(under).toHaveAttribute('aria-pressed', 'true');
  await under.click();
  await expect(under).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => coverage(page.locator('canvas.so-layer').last())).toBe(0);
});

test('preview hides the zones and shows one layer at a time', async ({ page }) => {
  await open(page);
  if (phone(page)) await page.getByRole('navigation', { name: 'Tools' }).getByRole('button', { name: 'Preview' }).click();
  else await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(zone(page, 'camera')).toBeHidden();
  await expect(page.getByRole('toolbar', { name: 'camera zone' })).toBeHidden();
  const layers = page.getByRole('group', { name: 'Show layers' }).first();
  await layers.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('canvas.so-layer').last()).toBeHidden();
  await layers.getByRole('button', { name: 'Front' }).click();
  await expect(page.locator('canvas.so-layer').first()).toBeHidden();
  await page.keyboard.press('p');
  await expect(zone(page, 'camera')).toBeVisible();
});

test('full screen previews the overlay and returns to editing', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Full screen preview' }).click();
  const exit = page.getByRole('button', { name: 'Exit full screen' });
  await expect(exit).toBeVisible();
  await expect(exit).toBeFocused();
  await expect(zone(page, 'camera')).toBeHidden();
  await exit.click();
  await expect(exit).toBeHidden();
  await expect(zone(page, 'camera')).toBeVisible();
});

test('a starting layout replaces the zones after confirming', async ({ page }) => {
  await open(page);
  await useLayout(page, 'intermission');
  const dialog = page.getByRole('dialog', { name: 'replace this layout?' });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(zone(page, 'camera')).toBeAttached();
  await page.getByRole('button', { name: 'Use layout' }).click();
  await dialog.getByRole('button', { name: 'Replace' }).click();
  await expect(zone(page, 'camera')).toHaveCount(0);
  await expect(zone(page, 'info panel')).toBeVisible();
  // No zone has content under the art, so there's no front layer to add.
  await openTab(page, 'Use it');
  await expect(page.getByRole('button', { name: 'Download front layer' })).toBeDisabled();
  await expect(page.getByText('the front layer is empty')).toBeVisible();
});

test('the art stream layout uses a taped canvas, hatching and the art effects', async ({ page }) => {
  await open(page);
  await useLayout(page, 'art');
  await page.getByRole('dialog', { name: 'replace this layout?' }).getByRole('button', { name: 'Replace' }).click();
  await openTab(page, 'Art');
  await expect(page.getByRole('group', { name: 'Style' }).getByRole('button', { name: 'pen hatching' })).toHaveAttribute('aria-pressed', 'true');
  await openTab(page, 'Zones');
  await zone(page, 'canvas').click();
  await expect(effects(page).getByRole('button', { name: 'tape' })).toHaveAttribute('aria-pressed', 'true');
  for (const [name, hint] of [['vines', 'Vines grow out'], ['glitch', 'Colour slices tear off']]) {
    await effects(page).getByRole('button', { name }).click();
    await expect(page.getByText(hint)).toBeVisible();
  }
  await expect(page.locator('.so-stage[data-drawn="true"]')).toBeAttached();
  expect(await coverage(page.locator('canvas.so-layer').first())).toBeGreaterThan(0.15);
});

test('downloads a full size layer as a PNG', async ({ page }) => {
  await open(page);
  await openTab(page, 'Use it');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download back layer' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('overlay-back-1920x1080.png');
});

test('the browser source link draws the layer on a transparent page', async ({ page }) => {
  await open(page);
  await openTab(page, 'Use it');
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
    await page.keyboard.press('p');
    await openTab(page, 'Art');
    await expectAccessible(page, `stream overlay art ${scheme}`);
    await useLayout(page, 'art');
    await expectAccessible(page, `stream overlay dialog ${scheme}`);
  });
}
