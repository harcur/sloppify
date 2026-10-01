// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { test, expect } from '@playwright/test';
import { trackExternalRequests, markNoticeSeen, expectAccessible } from './helpers.js';

const NAMES = ['Ada', 'Ben', 'Cleo', 'Dmitri', 'Eve', 'Farah'];
const URL = './tools/pick-a-person/';

let external;
test.beforeEach(async ({ page, baseURL }) => {
  external = trackExternalRequests(page, baseURL);
  await markNoticeSeen(page);
  // Results show at once under reduced motion, which keeps the tests quick.
  await page.emulateMedia({ reducedMotion: 'reduce' });
});
test.afterEach(() => { expect(external, 'requests outside the site').toEqual([]); });

// Saves a names list before the page loads.
async function withNames(page, names = NAMES) {
  await page.addInitScript((list) => {
    if (localStorage.getItem('sloppify:pick-a-person:__schema')) return;
    localStorage.setItem('sloppify:pick-a-person:__schema', '1');
    localStorage.setItem('sloppify:pick-a-person:names', JSON.stringify(list));
    localStorage.setItem('sloppify:pick-a-person:source', JSON.stringify('names'));
  }, names);
}

const isNarrow = (page) => (page.viewportSize()?.width ?? 1000) < 720;
const mode = (page, name) => page.getByRole('group', { name: 'Mode' }).getByRole('button', { name });
const result = (page) => page.locator('.pp-result-main');
const said = (page) => page.locator('p.sr-only[aria-live]');

// On narrow screens the players and settings live in the options sheet.
async function openPanel(page) {
  if (!isNarrow(page)) return page;
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  return page.getByRole('dialog', { name: 'Options' });
}
async function closePanel(page) {
  if (isNarrow(page)) await page.getByRole('dialog', { name: 'Options' }).getByRole('button', { name: 'Close' }).click();
}

test('names can be added, removed and are remembered', async ({ page }) => {
  await page.goto(URL);
  const panel = await openPanel(page);
  await panel.getByRole('button', { name: 'names', exact: true }).click();
  await panel.getByLabel('Add names').fill('Ada, Ben,  ben , Cleo');
  await panel.getByRole('button', { name: 'Add', exact: true }).click();
  const list = panel.getByRole('list', { name: 'Names' });
  await expect(list.getByRole('button')).toHaveText(['Ada×', 'Ben×', 'ben (2)×', 'Cleo×']);
  await list.getByRole('button', { name: 'Remove ben (2)' }).click();
  await expect(list.getByRole('button')).toHaveCount(3);
  await expect(list.getByRole('button', { name: 'Remove Cleo' })).toBeFocused();
  await page.reload();
  const again = await openPanel(page);
  await expect(again.getByRole('list', { name: 'Names' }).getByRole('button')).toHaveText(['Ada×', 'Ben×', 'Cleo×']);
});

test('the number of players can be changed', async ({ page }) => {
  await page.goto(URL);
  const panel = await openPanel(page);
  await panel.getByRole('button', { name: 'One more player' }).click();
  await expect(panel.locator('.pp-count-value')).toHaveText('5');
  for (let i = 0; i < 3; i++) await panel.getByRole('button', { name: 'One fewer player' }).click();
  await expect(panel.locator('.pp-count-value')).toHaveText('2');
  await expect(panel.getByRole('button', { name: 'One fewer player' })).toBeDisabled();
});

test('the wheel picks a name, and can take winners off', async ({ page }) => {
  await withNames(page);
  await page.goto(URL);
  await mode(page, 'wheel').click();
  await page.getByRole('button', { name: 'Spin', exact: true }).click();
  await expect(result(page)).toHaveText(new RegExp(`^(${NAMES.join('|')})$`));
  await expect(said(page)).toContainText('is picked');
  const first = await result(page).textContent();

  const panel = await openPanel(page);
  await panel.getByLabel('Take each winner off the wheel').check();
  await closePanel(page);
  await page.getByRole('button', { name: 'Spin again' }).click();
  await expect(page.locator('.pp-stage-note')).toHaveText('5 of 6 left on the wheel');
  await expect(result(page)).not.toHaveText(first);
  await page.getByRole('button', { name: 'Put everyone back' }).click();
  await expect(page.locator('.pp-stage-note')).toHaveText('');
});

test('the bottle points at a name, or at an hour without names', async ({ page }) => {
  await withNames(page);
  await page.goto(URL);
  await mode(page, 'bottle').click();
  await page.getByRole('button', { name: 'Spin', exact: true }).click();
  await expect(result(page)).toHaveText(new RegExp(`^(${NAMES.join('|')})$`));
  await expect(page.locator('.pp-seat.is-win')).toHaveText(await result(page).textContent());

  const panel = await openPanel(page);
  await panel.getByRole('button', { name: 'number', exact: true }).click();
  await closePanel(page);
  await expect(page.locator('.pp-seat')).toHaveCount(0);
  await page.getByRole('button', { name: 'Spin', exact: true }).click();
  await expect(said(page)).toHaveText(/pointing at \d+ o’clock/);
});

test('fingers on the screen: one is picked after a countdown', async ({ page }) => {
  await page.goto(URL);
  await mode(page, 'fingers').click();
  const area = page.locator('.pp-touch');
  const box = await area.boundingBox();
  // Three touches, sent as pointer events.
  await area.evaluate((el, b) => {
    const at = [[0.3, 0.4], [0.7, 0.4], [0.5, 0.7]];
    at.forEach(([x, y], i) => el.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 10 + i, pointerType: 'touch', isPrimary: i === 0, bubbles: true, cancelable: true,
      clientX: b.x + b.width * x, clientY: b.y + b.height * y,
    })));
  }, box);
  await expect(page.locator('.pp-finger')).toHaveCount(3);
  await expect(page.locator('.pp-finger.is-win')).toHaveCount(1, { timeout: 4000 });
  await expect(page.locator('.pp-finger.is-out')).toHaveCount(2);
  await expect(said(page)).toHaveText(/^[123] is picked\.$/);
  await expect(page.locator('.pp-touch-hint')).toHaveText('Lift all fingers to start again');
  await area.evaluate((el) => {
    for (const id of [10, 11, 12]) el.dispatchEvent(new PointerEvent('pointerup', { pointerId: id, pointerType: 'touch', bubbles: true }));
  });
  await expect(page.locator('.pp-touch-hint')).toHaveText('Touch the screen to start again');
});

test('fingers without touch: teams from the player list', async ({ page }) => {
  await withNames(page);
  await page.goto(URL);
  await mode(page, 'fingers').click();
  const panel = await openPanel(page);
  await panel.getByRole('group', { name: 'Pick' }).getByRole('button', { name: 'teams' }).click();
  await panel.getByLabel('Number of teams').selectOption('3');
  await closePanel(page);
  await page.getByRole('button', { name: 'Pick from 6 players' }).click();
  await expect(page.locator('.pp-finger.is-team')).toHaveCount(6, { timeout: 4000 });
  await expect(said(page)).toContainText('Team C:');
  for (const letter of ['A', 'B', 'C']) await expect(page.locator('.pp-finger-tag', { hasText: letter })).toHaveCount(2);
});

test('straws: players draw in turn until the short one', async ({ page }) => {
  await withNames(page);
  await page.goto(URL);
  await mode(page, 'straws').click();
  await expect(page.locator('.pp-turn')).toHaveText('Ada, pick a straw');
  const straws = page.getByRole('button', { name: /^Straw \d+$/ });
  await expect(straws).toHaveCount(6);
  await straws.first().click();
  const short = await page.locator('.pp-straw.is-short').count();
  if (!short) {
    await expect(page.getByRole('button', { name: /drawn by Ada: long/ })).toBeDisabled();
    await expect(page.locator('.pp-turn')).toHaveText('Ben, pick a straw');
    await page.getByRole('button', { name: 'Draw the rest' }).click();
  }
  await expect(page.locator('.pp-straw.is-short')).toHaveCount(1);
  await expect(page.locator('.pp-result-sub')).toHaveText('drew the short straw');
  await expect(result(page)).toHaveText(new RegExp(`^(${NAMES.join('|')})$`));
  await page.getByRole('button', { name: 'New draw' }).click();
  await expect(straws).toHaveCount(6);
});

test('teams: everyone in one team, sizes within one', async ({ page }) => {
  await withNames(page, [...NAMES, 'Gus']);
  await page.goto(URL);
  await mode(page, 'teams').click();
  const panel = await openPanel(page);
  await panel.getByRole('button', { name: 'team size' }).click();
  await panel.getByLabel('Players per team').selectOption('3');
  await closePanel(page);
  await page.getByRole('button', { name: 'Make teams' }).click();
  const teams = page.locator('.pp-team');
  await expect(teams).toHaveCount(3);
  const members = await page.locator('.pp-team-list li').allTextContents();
  expect(members.sort()).toEqual([...NAMES, 'Gus'].sort());
  for (let i = 0; i < 3; i++) expect([2, 3]).toContain(await teams.nth(i).locator('li').count());
  await expect(page.getByRole('heading', { name: 'Team A' })).toBeVisible();
  await page.getByRole('button', { name: 'Shuffle again' }).click();
  await expect(teams).toHaveCount(3);
});

test('the mode is remembered', async ({ page }) => {
  await page.goto(URL);
  await mode(page, 'teams').click();
  await page.reload();
  await expect(mode(page, 'teams')).toHaveAttribute('aria-pressed', 'true');
});

test('on narrow screens it fills the screen like an app', async ({ page }) => {
  test.skip(!isNarrow(page), 'narrow screens only');
  await page.goto(URL);
  const view = page.viewportSize();
  await expect(page.locator('.site-footer')).toBeHidden();
  expect(await page.evaluate(() => document.scrollingElement.scrollHeight)).toBeLessThanOrEqual(view.height);
  const go = await page.getByRole('button', { name: 'Spin', exact: true }).boundingBox();
  expect(go.y + go.height).toBeGreaterThan(view.height - 80);
  const sheet = await openPanel(page);
  await expect(sheet.getByRole('heading', { name: 'players' })).toBeVisible();
  await expect(sheet.getByRole('link', { name: 'Source on GitHub' })).toHaveAttribute('href', /tools\/pick-a-person\/$/);
  await closePanel(page);
  await expect(page.getByRole('button', { name: 'Options', exact: true })).toBeFocused();
});

for (const scheme of ['light', 'dark']) {
  test(`accessibility (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await withNames(page);
    await page.goto(URL);
    await mode(page, 'bottle').click();
    await page.getByRole('button', { name: 'Spin', exact: true }).click();
    await expect(result(page)).not.toBeEmpty();
    await expectAccessible(page, 'bottle');
    await mode(page, 'wheel').click();
    await page.getByRole('button', { name: 'Spin', exact: true }).click();
    await expect(result(page)).not.toBeEmpty();
    await expectAccessible(page, 'wheel');
    await mode(page, 'fingers').click();
    await page.getByRole('button', { name: 'Pick from 6 players' }).click();
    await expect(page.locator('.pp-finger.is-win')).toHaveCount(1, { timeout: 4000 });
    await expectAccessible(page, 'fingers');
    await mode(page, 'straws').click();
    await page.getByRole('button', { name: 'Draw the rest' }).click();
    await expect(page.locator('.pp-straw.is-short')).toHaveCount(1);
    await expectAccessible(page, 'straws');
    await mode(page, 'teams').click();
    await page.getByRole('button', { name: 'Make teams' }).click();
    await expectAccessible(page, 'teams');
    if (isNarrow(page)) {
      const sheet = await openPanel(page);
      await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
      await expectAccessible(page, 'options sheet');
    }
  });
}
