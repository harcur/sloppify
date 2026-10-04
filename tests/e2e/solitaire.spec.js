// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { test, expect } from '@playwright/test';
import { trackExternalRequests, markNoticeSeen, expectAccessible } from './helpers.js';
import { newGame, serialize, FOUNDATIONS, TABLEAU } from '../../tools/solitaire/logic.js';

let external;
test.beforeEach(async ({ page, baseURL }) => {
  external = trackExternalRequests(page, baseURL);
  await markNoticeSeen(page);
});
test.afterEach(() => { expect(external, 'requests outside the site').toEqual([]); });

const SUIT = { spades: 0, hearts: 1, diamonds: 2, clubs: 3 };
const RANK = { A: 1, J: 11, Q: 12, K: 13 };
const card = (r, s) => SUIT[s] * 13 + (RANK[r] ?? r) - 1;
const run = (s, from, to) => Array.from({ length: to - from + 1 }, (_, k) => card(from + k, s));

// Known positions, saved before the page loads. Cards not placed go in the stock.
// MID: the ace of hearts on the waste, a 6 of hearts (over a face-down 2 of
// clubs) that fits on the 7 of spades, and a king next to an empty column.
const MID = {
  waste: [card('A', 'hearts')],
  t0: [card(7, 'spades')], t1: [card(2, 'clubs'), card(6, 'hearts')], t2: [card('K', 'diamonds')],
  down: [0, 1, 0, 0, 0, 0, 0],
};
// NEAR: one card left in the stock; once it's on its foundation the rest finishes itself.
const NEAR = {
  stock: [card('Q', 'clubs')],
  f0: run('spades', 1, 12), f1: run('hearts', 1, 13), f2: run('diamonds', 1, 13), f3: run('clubs', 1, 11),
  t0: [card('K', 'spades')], t1: [card('K', 'clubs')],
};

async function load(page, piles, path = './tools/solitaire/') {
  const g = newGame(1);
  for (const p of ['stock', 'waste', ...FOUNDATIONS, ...TABLEAU]) g[p] = [];
  g.down = [0, 0, 0, 0, 0, 0, 0];
  Object.assign(g, structuredClone(piles));
  if (!piles.stock) {
    const used = new Set(Object.entries(piles).filter(([k]) => k !== 'down').flatMap(([, v]) => v));
    g.stock = Array.from({ length: 52 }, (_, i) => i).filter((c) => !used.has(c));
  }
  g.state = 'ready';
  const saved = JSON.stringify(serialize(g));
  await page.addInitScript((game) => {
    if (localStorage.getItem('sloppify:solitaire:game')) return;
    localStorage.setItem('sloppify:solitaire:__schema', '1');
    localStorage.setItem('sloppify:solitaire:game', game);
  }, saved);
  await page.goto(path);
}

const isNarrow = (page) => (page.viewportSize()?.width ?? 1000) < 720;
const cardBtn = (page, name) => page.getByRole('button', { name, exact: true });
const pile = (page, name) => page.getByRole('group', { name });
const moves = (page) => page.locator('.sol-stat').filter({ hasText: 'moves' }).locator('.sol-stat-value');

test('a new deal has seven columns and the stock turns over cards', async ({ page }) => {
  await page.goto('./tools/solitaire/');
  for (let k = 1; k <= 7; k++) await expect(pile(page, `Column ${k}, ${k - 1} face down, 1 face up`)).toHaveCount(1);
  await page.getByRole('button', { name: 'Turn over cards, 24 left' }).click();
  await expect(pile(page, 'Waste, 1 card')).toHaveCount(1);
  await expect(moves(page)).toHaveText('1');
});

test('deals on the page itself when the browser has no Worker', async ({ page }) => {
  await page.addInitScript(() => { delete window.Worker; });
  await page.goto('./tools/solitaire/');
  await expect(pile(page, 'Column 7, 6 face down, 1 face up')).toHaveCount(1);
  await page.getByRole('button', { name: 'Turn over cards, 24 left' }).click();
  await page.getByRole('button', { name: 'New game' }).click();
  await page.getByRole('dialog', { name: 'start a new game?' }).getByRole('button', { name: 'New game' }).click();
  await expect(page.getByRole('button', { name: 'Turn over cards, 24 left' })).toBeVisible();
});

test('a tap sends a card to the best place and turns up the card under it', async ({ page }) => {
  await load(page, MID);
  await cardBtn(page, 'ace of hearts').click();
  await expect(pile(page, 'Foundation 1, 1 card')).toContainText('A');
  await cardBtn(page, '6 of hearts').click();
  await expect(pile(page, 'Column 1, 0 face down, 2 face up')).toHaveCount(1);
  await expect(cardBtn(page, '2 of clubs')).toBeVisible();
  await expect(page.locator('[aria-live="polite"]')).toHaveText('6 of hearts to column 1. Turned up 2 of clubs');
});

test('keyboard: Enter picks a card up and puts it down, Escape cancels', async ({ page }) => {
  await load(page, MID);
  await cardBtn(page, 'king of diamonds').click(); // a king alone in its column stays put
  await expect(page.locator('[aria-live="polite"]')).toHaveText('No move for king of diamonds');
  await cardBtn(page, '6 of hearts').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.locator('[aria-live="polite"]')).toHaveText('Put back');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight');
  await expect(cardBtn(page, 'king of diamonds')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('[aria-live="polite"]')).toHaveText('6 of hearts can’t go on column 3');
  await page.keyboard.press('Enter'); // pick up the king of diamonds
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.sol-slot[data-pile="t3"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(pile(page, 'Column 4, 0 face down, 1 face up')).toHaveCount(1);
  await expect(cardBtn(page, 'king of diamonds')).toBeFocused();
  await page.keyboard.press('ArrowUp'); // foundation 1, above column 4
  await page.keyboard.press('ArrowLeft'); // skips the gap to the waste
  await expect(cardBtn(page, 'ace of hearts')).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter'); // twice on the same card: best place
  await expect(pile(page, 'Foundation 1, 1 card')).toHaveCount(1);
});

test('dragging puts a card where it is dropped, and undo takes it back', async ({ page }) => {
  await load(page, MID);
  const six = await cardBtn(page, '6 of hearts').boundingBox();
  const seven = await cardBtn(page, '7 of spades').boundingBox();
  await page.mouse.move(six.x + six.width / 2, six.y + 10);
  await page.mouse.down();
  await page.mouse.move(six.x, six.y + 40, { steps: 4 });
  await page.mouse.move(seven.x + seven.width / 2, seven.y + seven.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(pile(page, 'Column 1, 0 face down, 2 face up')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(pile(page, 'Column 2, 1 face down, 1 face up')).toHaveCount(1);
  await expect(pile(page, 'Column 1, 0 face down, 1 face up')).toHaveCount(1);
});

test('the last cards finish on their own, and the win is recorded', async ({ page }) => {
  await load(page, NEAR);
  await page.getByRole('button', { name: 'Turn over cards, 1 left' }).click();
  await cardBtn(page, 'queen of clubs').click();
  await expect(page.getByRole('status')).toContainText('Solved in');
  await expect(page.getByRole('status')).toContainText('New best');
  await expect(pile(page, 'Foundation 4, 13 cards')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('.sol-record')).toContainText('1 won of 1');
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Solved in');
});

test('a game in progress is kept on reload, and a new game asks first', async ({ page }) => {
  await load(page, MID);
  await cardBtn(page, 'ace of hearts').click();
  await page.reload();
  await expect(pile(page, 'Foundation 1, 1 card')).toHaveCount(1);
  await page.getByRole('button', { name: 'New game' }).click();
  const dialog = page.getByRole('dialog', { name: 'start a new game?' });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(pile(page, 'Foundation 1, 1 card')).toHaveCount(1);
  await page.getByRole('button', { name: 'New game' }).click();
  await dialog.getByRole('button', { name: 'New game' }).click();
  await expect(pile(page, 'Column 7, 6 face down, 1 face up')).toHaveCount(1);
});

test('turning over three cards at a time', async ({ page }) => {
  await page.goto('./tools/solitaire/');
  await expect(page.getByRole('group', { name: 'Card table' })).toBeVisible(); // the first deal is in
  const more = page.getByRole('button', { name: 'Options' });
  if (await more.isVisible()) await more.click();
  await page.getByRole('button', { name: /^three cards/ }).click();
  // Pressed once the new deal is in (on phones the sheet has closed by then).
  await expect(page.locator('.sol-draw[data-draw="3"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Turn over cards, 24 left' }).click();
  await expect(pile(page, 'Waste, 3 cards')).toHaveCount(1);
});

test('on narrow screens the game fills the screen like an app', async ({ page }) => {
  test.skip(!isNarrow(page), 'narrow screens only');
  await page.goto('./tools/solitaire/');
  await expect(page.getByRole('group', { name: 'Card table' })).toBeVisible();
  const view = page.viewportSize();
  await expect(page.locator('.site-footer')).toBeHidden();
  expect(await page.evaluate(() => document.scrollingElement.scrollHeight)).toBeLessThanOrEqual(view.height);
  const board = await page.locator('.sol-board').boundingBox();
  expect(board.width).toBeGreaterThan(view.width * 0.9);
  for (const name of ['Undo', 'New game', 'Options']) {
    const b = await page.getByRole('button', { name, exact: true }).boundingBox();
    expect(b.y + b.height).toBeGreaterThan(view.height - 80);
  }
  await page.getByRole('button', { name: 'Options' }).click();
  const sheet = page.getByRole('dialog', { name: 'Options' });
  await expect(sheet.getByRole('heading', { name: 'how to play' })).toBeVisible();
  await expect(sheet.getByRole('link', { name: 'Source on GitHub' })).toHaveAttribute('href', /tools\/solitaire\/$/);
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('button', { name: 'Options' })).toBeFocused();
});

for (const scheme of ['light', 'dark']) {
  test(`accessibility (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await load(page, MID);
    await cardBtn(page, 'ace of hearts').click();
    await cardBtn(page, '6 of hearts').focus();
    await page.keyboard.press('Enter');
    await expectAccessible(page, 'card picked up');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'New game' }).click();
    await expectAccessible(page, 'confirm dialog');
    await page.getByRole('button', { name: 'Cancel' }).click();
    if (isNarrow(page)) {
      await page.getByRole('button', { name: 'Options' }).click();
      await expectAccessible(page, 'options sheet');
    }
  });

  test(`accessibility when solved (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await load(page, NEAR);
    await page.getByRole('button', { name: 'Turn over cards, 1 left' }).click();
    await cardBtn(page, 'queen of clubs').click();
    await expect(page.getByRole('status')).toContainText('Solved in');
    await expectAccessible(page, 'solved');
  });
}
