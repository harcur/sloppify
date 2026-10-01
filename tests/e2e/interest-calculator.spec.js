// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { test, expect } from '@playwright/test';
import { trackExternalRequests, markNoticeSeen, expectAccessible } from './helpers.js';

let external;
test.beforeEach(async ({ page, baseURL }) => {
  external = trackExternalRequests(page, baseURL);
  await markNoticeSeen(page);
  await page.goto('./tools/interest-calculator/');
});
test.afterEach(() => { expect(external, 'requests outside the site').toEqual([]); });

const headline = (page) => page.locator('.ic-headline-value');
const mode = (page, name) => page.getByRole('button', { name, exact: true }).click();

test('a loan shows its monthly payment, total cost and a rate table', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Loan', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Amount borrowed')).toHaveValue('250,000');
  await expect(page.getByRole('heading', { name: 'Monthly payment' })).toBeVisible();
  await expect(headline(page)).toHaveText('1,461');
  await expect(page.locator('.ic-stats')).toContainText('188,443');
  await expect(page.getByText('You pay back 1.75 for every 1 you borrow.')).toBeVisible();
  await expect(page.getByRole('row', { name: /5% \(yours\)/ })).toContainText('1,461');

  await page.getByLabel('Amount borrowed').fill('100000');
  await expect(headline(page)).toHaveText('585');
  await page.getByLabel('Amount borrowed').press('Tab');
  await expect(page.getByLabel('Amount borrowed')).toHaveValue('100,000');
});

test('equal principal and extra payments change the plan', async ({ page }) => {
  await page.getByLabel('Repayment type').selectOption('serial');
  await expect(page.getByRole('heading', { name: 'First monthly payment' })).toBeVisible();
  await expect(page.locator('.ic-headline-sub')).toContainText('falling to');
  await page.getByLabel('Extra payment each month').fill('200');
  await expect(page.getByText(/Paying 200 extra a month clears the loan .* sooner and saves/)).toBeVisible();
});

test('a term can be given in months', async ({ page }) => {
  await page.getByLabel('Repayment time').fill('300');
  await page.getByRole('combobox', { name: 'Unit' }).selectOption('months');
  await expect(headline(page)).toHaveText('1,461');
});

test('bad input is marked and explained', async ({ page }) => {
  const rate = page.getByLabel('Interest rate');
  await rate.fill('abc');
  await expect(rate).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Enter a number, like 250000 or 4.5')).toBeVisible();
  await expect(page.getByText('Fix the marked fields to see the result.')).toBeVisible();
  await rate.fill('4,5');
  await expect(rate).not.toHaveAttribute('aria-invalid');
  await expect(headline(page)).toHaveText('1,390');
});

test('savings grow, with the result in today’s money', async ({ page }) => {
  await mode(page, 'Savings');
  await expect(page.getByRole('heading', { name: 'Amount after 20 years' })).toBeVisible();
  await expect(headline(page)).toHaveText('125,510');
  await page.getByLabel('Inflation').fill('2');
  await expect(page.locator('.ic-stats')).toContainText('In today’s money');
  await page.getByLabel('Interest added').selectOption('simple');
  await expect(page.getByText(/Simple interest/)).toBeAttached();
  await expect(page.getByRole('img', { name: /balance at the end of each year/ })).toBeVisible();
});

test('paying off a debt, and a payment that never does', async ({ page }) => {
  await mode(page, 'Pay off debt');
  await expect(headline(page)).toHaveText('4 years 2 months');
  await expect(page.getByRole('row', { name: /150 \(yours\)/ })).toBeVisible();
  await page.getByLabel('Payment each month').fill('80');
  await expect(page.getByText(/never paid off: the interest alone is 83.33 a month/)).toBeVisible();
});

test('finding the rate of an offer, with fees', async ({ page }) => {
  await mode(page, 'Find the rate');
  await expect(headline(page)).toHaveText('12.18%');
  await page.getByLabel('Fees at the start').fill('300');
  await expect(page.getByText(/so the fees add/)).toBeVisible();
  await page.getByLabel('Payment each month').fill('100');
  await expect(page.getByText(/add up to less than the amount borrowed/)).toBeVisible();
});

test('the situation and inputs are remembered', async ({ page }) => {
  await mode(page, 'Savings');
  await page.getByLabel('Starting amount').fill('5000');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Savings', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Starting amount')).toHaveValue('5,000');
});

test('results are announced when a field is changed', async ({ page }) => {
  await page.getByLabel('Interest rate').fill('6');
  await page.getByLabel('Interest rate').press('Tab');
  await expect(page.locator('[aria-live="polite"]')).toHaveText('Monthly payment 1,611. Total interest 233,226.');
});

for (const scheme of ['light', 'dark']) {
  test(`accessibility (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    for (const name of ['Loan', 'Savings', 'Pay off debt', 'Find the rate']) {
      await mode(page, name);
      for (const d of await page.locator('details').all()) await d.locator('summary').click();
      await expectAccessible(page, name);
    }
    await page.getByLabel('Amount borrowed').fill('x');
    await expectAccessible(page, 'invalid');
  });
}
