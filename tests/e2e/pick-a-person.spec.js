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
  await expect(page.locator('.pp-sector')).toHaveCount(NAMES.length);
  const won = await page.locator('.pp-seat.is-win').getAttribute('data-i');
  await expect(page.locator('.pp-sector.is-win')).toHaveAttribute('data-i', won);

  const panel = await openPanel(page);
  await panel.getByRole('button', { name: 'number', exact: true }).click();
  await closePanel(page);
  await expect(page.locator('.pp-seat')).toHaveCount(0);
  await expect(page.locator('.pp-sector')).toHaveCount(0);
  await expect(page.locator('.pp-dial-tick')).toHaveCount(12);
  await page.getByRole('button', { name: 'Spin', exact: true }).click();
  await expect(said(page)).toHaveText(/pointing at \d+ o’clock/);
});

// Sends a touch event listing every finger now on the area, as browsers do.
// fingers: [[id, x, y], ...] with x and y as fractions of the area.
async function touch(area, type, fingers) {
  return area.evaluate((el, [kind, list]) => {
    const r = el.getBoundingClientRect();
    const all = list.map(([id, x, y]) => new Touch({
      identifier: id, target: el, clientX: r.left + r.width * x, clientY: r.top + r.height * y,
    }));
    el.dispatchEvent(new TouchEvent(kind, { touches: all, targetTouches: all, changedTouches: all, bubbles: true, cancelable: true }));
  }, [type, fingers]);
}
const canTouch = (page) => page.evaluate(() => {
  try { return !!new Touch({ identifier: 1, target: document.body }); } catch { return false; }
});
const FIVE = [[1, 0.2, 0.3], [2, 0.8, 0.3], [3, 0.5, 0.5], [4, 0.25, 0.75], [5, 0.75, 0.75]];

test('fingers on the screen: five fingers, one picked, and it starts again', async ({ page }) => {
  await page.goto(URL);
  test.skip(!(await canTouch(page)), 'this browser cannot create touch events');
  await mode(page, 'fingers').click();
  const area = page.locator('.pp-touch');
  for (let n = 1; n <= 5; n++) await touch(area, 'touchstart', FIVE.slice(0, n));
  await expect(page.locator('.pp-finger')).toHaveCount(5);
  await touch(area, 'touchmove', FIVE.map(([id, x, y]) => [id, x + 0.01, y]));
  await expect(page.locator('.pp-finger.is-win')).toHaveCount(1, { timeout: 4000 });
  await expect(page.locator('.pp-finger.is-out')).toHaveCount(4);
  await expect(said(page)).toHaveText(/^[1-5] is picked\.$/);
  await expect(page.locator('.pp-touch-hint')).toHaveText('Lift all fingers to start again');
  // A new finger while others still hold is ignored.
  await touch(area, 'touchstart', [...FIVE, [6, 0.5, 0.2]]);
  await expect(page.locator('.pp-finger')).toHaveCount(5);
  await touch(area, 'touchend', []);
  await expect(page.locator('.pp-touch-hint')).toHaveText('Touch the screen to start again');
  // The next touch starts a new round.
  await touch(area, 'touchstart', [[7, 0.5, 0.5]]);
  await expect(page.locator('.pp-finger')).toHaveCount(1);
  await expect(page.locator('.pp-finger.is-win, .pp-finger.is-out')).toHaveCount(0);
  await expect(page.locator('.pp-touch-hint')).toHaveText('Waiting for more fingers');
});

test('fingers: says so when the phone cancels the touches', async ({ page }) => {
  await page.goto(URL);
  test.skip(!(await canTouch(page)), 'this browser cannot create touch events');
  await mode(page, 'fingers').click();
  const area = page.locator('.pp-touch');
  await touch(area, 'touchstart', FIVE.slice(0, 3));
  await touch(area, 'touchcancel', []); // what a three-finger system gesture does
  await expect(page.locator('.pp-touch-hint')).toContainText('Your phone took over the touch');
  await expect(page.locator('.pp-finger.is-win')).toHaveCount(0);
  await touch(area, 'touchstart', [[8, 0.5, 0.5]]);
  await expect(page.locator('.pp-touch-hint')).toHaveText('Waiting for more fingers');
});

test('fingers: a lift the browser never reported does not leave a finger stuck', async ({ page }) => {
  await page.goto(URL);
  test.skip(!(await canTouch(page)), 'this browser cannot create touch events');
  await mode(page, 'fingers').click();
  const area = page.locator('.pp-touch');
  await touch(area, 'touchstart', FIVE.slice(0, 3));
  await expect(page.locator('.pp-finger.is-win')).toHaveCount(1, { timeout: 4000 });
  // No touchend arrives; the next touch lists only a new finger.
  await touch(area, 'touchstart', [[9, 0.5, 0.5]]);
  await expect(page.locator('.pp-finger')).toHaveCount(1);
  await touch(area, 'touchstart', [[9, 0.5, 0.5], [10, 0.2, 0.2]]);
  await expect(page.locator('.pp-finger.is-win')).toHaveCount(1, { timeout: 4000 });
  // Lifting during the wait takes the finger away and waits again.
  await touch(area, 'touchend', [[9, 0.5, 0.5]]);
  await touch(area, 'touchstart', [[11, 0.5, 0.5], [12, 0.2, 0.2]]);
  await expect(page.locator('.pp-finger')).toHaveCount(2);
  await touch(area, 'touchend', [[11, 0.5, 0.5]]);
  await expect(page.locator('.pp-finger:not(.is-gone)')).toHaveCount(1);
  await expect(page.locator('.pp-touch-hint')).toHaveText('Waiting for more fingers');
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

// Taps the screen where a straw stands. The tap goes to the stage, which
// picks the nearest straw (the buttons only take keyboard input).
const tap = (straw) => straw.click({ force: true });

// Taps straws left to right, one per person, until the short one comes out.
async function drawUntilShort(page) {
  for (let i = 0; i < 30 && !(await page.locator('.pp-straw.is-short').count()); i++) {
    await tap(page.getByRole('button', { name: /^Straw \d+$/ }).first());
  }
}

test('straws: each person taps one straw until the short one', async ({ page }) => {
  await page.goto(URL); // 4 players by default, no names needed
  await mode(page, 'straws').click();
  await expect(page.locator('.pp-turn')).toHaveText('Tap a straw. 4 left');
  const straws = page.locator('.pp-straw');
  await expect(straws).toHaveCount(4);
  await tap(straws.first());
  if (!(await page.locator('.pp-straw.is-short').count())) {
    await expect(page.getByRole('button', { name: 'Straw 1: long' })).toBeDisabled();
    await expect(page.locator('.pp-turn')).toHaveText('Tap a straw. 3 left');
  }
  await drawUntilShort(page);
  await expect(page.locator('.pp-straw.is-short')).toHaveCount(1);
  await expect(result(page)).toHaveText('Short straw');
  await expect(page.locator('.pp-result-sub')).toHaveText('whoever drew it is picked');
  await expect(page.getByRole('button', { name: /^Straw \d+$/ })).toHaveCount(0); // all taken or shown
  await page.getByRole('button', { name: 'New draw' }).click();
  await expect(page.getByRole('button', { name: /^Straw \d+$/ })).toHaveCount(4);
});

test('straws: thirty straws fan out inside the stage, and Draw for me draws one', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('sloppify:pick-a-person:__schema')) return;
    localStorage.setItem('sloppify:pick-a-person:__schema', '1');
    localStorage.setItem('sloppify:pick-a-person:count', '30');
  });
  await page.goto(URL);
  await mode(page, 'straws').click();
  await expect(page.locator('.pp-straw')).toHaveCount(30);
  const inside = () => page.evaluate(() => {
    const area = document.querySelector('.pp-straws').getBoundingClientRect();
    return [...document.querySelectorAll('.pp-straw-body')].every((b) => {
      const r = b.getBoundingClientRect();
      return r.left >= area.left - 1 && r.right <= area.right + 1 && r.top >= area.top - 1;
    });
  });
  expect(await inside()).toBe(true);
  // A tap just past the outermost straw's tip still draws it; one a few
  // fingers away draws nothing.
  const tip = await page.locator('.pp-straw-body').last().boundingBox();
  await page.mouse.click(tip.x + tip.width + 90, tip.y);
  await expect(page.locator('.pp-straw.is-drawn')).toHaveCount(0);
  await page.mouse.click(tip.x + tip.width + 10, tip.y + 10);
  await expect(page.getByRole('button', { name: /^Straw 30: (long|short)$/ })).toHaveCount(1);
  await expect(page.locator('.pp-straw.is-drawn')).toHaveCount(1);
  const pick = page.getByRole('button', { name: 'Draw for me' });
  for (let i = 0; i < 30 && !(await page.locator('.pp-straw.is-short').count()); i++) await pick.click();
  await expect(result(page)).toHaveText('Short straw');
  await expect(pick).toBeDisabled();
  expect(await inside()).toBe(true); // every straw pulled out, still on screen
});

test('straws: a straw can be drawn from the keyboard', async ({ page }) => {
  await page.goto(URL);
  await mode(page, 'straws').click();
  await page.getByRole('button', { name: 'Straw 2', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /^Straw 2: (long|short)$/ })).toHaveCount(1);
  await expect(page.locator('.pp-straw.is-drawn')).toHaveCount(1);
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
    await drawUntilShort(page);
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
