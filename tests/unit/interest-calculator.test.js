// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNumber, separators, annuityPayment, amortize, byYear, grow, effectiveRate, doublingYears, findRate, niceCeil, MAX_MONTHS } from '../../tools/interest-calculator/logic.js';

const near = (actual, expected, tolerance = 0.01) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);

test('numbers are read the way people type them', () => {
  const cases = [
    ['250000', 250000], ['250 000', 250000], ['250 000', 250000], ['250,000', 250000],
    ['1,234.56', 1234.56], ['1.234,56', 1234.56], ['1 234,5', 1234.5], ['2,50,000', 250000],
    ['4.5', 4.5], ['4,5', 4.5], ['5 %', 5], ['250k', 250000], ['1.2m', 1200000], ['0', 0], ['.5', 0.5], ['-3', -3],
  ];
  for (const [input, expected] of cases) assert.equal(parseNumber(input), expected, input);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('   '), null);
  for (const bad of ['abc', '1.2.3,4,5', '1,2.3,4', '--1', '.', '12x']) assert.ok(Number.isNaN(parseNumber(bad)), bad);
});

test('a lone separator before three digits follows the locale', () => {
  assert.equal(parseNumber('1,500', '.'), 1500);
  assert.equal(parseNumber('1,500', ','), 1.5);
  assert.equal(parseNumber('1.500', ','), 1500);
  assert.equal(parseNumber('1.500', '.'), 1.5);
  assert.deepEqual(separators('en-US'), { group: ',', decimal: '.' });
  assert.equal(separators('de-DE').decimal, ',');
});

test('the annuity payment matches the textbook value', () => {
  near(annuityPayment(250000, 5, 300), 1461.48);
  near(annuityPayment(200000, 6, 360), 1199.10);
  near(annuityPayment(12000, 0, 12), 1000, 1e-9);
});

test('an annuity loan is repaid exactly on time with equal payments', () => {
  const p = amortize({ principal: 250000, rate: 5, months: 300 });
  assert.ok(p.paidOff);
  assert.equal(p.months, 300);
  near(p.firstPayment, 1461.48);
  near(p.lastPayment, 1461.48);
  near(p.totalPaid, 1461.48 * 300, 2);
  near(p.totalInterest, p.totalPaid - 250000, 1e-6);
  near(p.rows[0].interest, 1041.67);
  assert.ok(p.rows.at(-1).balance < 1e-6);
});

test('an equal-principal loan pays the same principal every month', () => {
  const p = amortize({ principal: 120000, rate: 6, months: 120, kind: 'serial' });
  assert.equal(p.months, 120);
  for (const r of p.rows) near(r.principal, 1000, 1e-6);
  near(p.firstPayment, 1600);
  near(p.lastPayment, 1005);
  // Interest is the average balance × rate: (120000 + 1000) / 2 × 0.5 % × 120.
  near(p.totalInterest, 36300, 1e-6);
});

test('extra payments shorten the loan and cut interest', () => {
  const base = amortize({ principal: 250000, rate: 5, months: 300 });
  const extra = amortize({ principal: 250000, rate: 5, months: 300, extra: 200 });
  assert.ok(extra.paidOff);
  assert.ok(extra.months < base.months);
  assert.ok(extra.totalInterest < base.totalInterest);
  near(extra.firstPayment, base.firstPayment + 200);
});

test('a fixed payment pays off a debt, unless it never covers the interest', () => {
  const p = amortize({ principal: 5000, rate: 20, payment: 150 });
  assert.ok(p.paidOff);
  assert.equal(p.months, 50);
  assert.ok(p.lastPayment < 150);
  near(p.totalPaid, 5000 + p.totalInterest, 1e-6);
  const never = amortize({ principal: 5000, rate: 24, payment: 100 });
  assert.equal(never.paidOff, false);
  assert.equal(never.months, 0);
  const slow = amortize({ principal: 100000, rate: 1.2, payment: 100.01 });
  assert.equal(slow.paidOff, false);
  assert.equal(slow.months, MAX_MONTHS);
});

test('rows are summed by year', () => {
  const years = byYear(amortize({ principal: 12000, rate: 0, months: 18 }).rows);
  assert.equal(years.length, 2);
  near(years[0].principal, 8000);
  near(years[1].principal, 4000);
  near(years[1].balance, 0);
});

test('savings compound as expected', () => {
  // 10 000 at 6 % compounded monthly for 10 years: 10000 × 1.005^120.
  near(grow({ start: 10000, monthly: 0, rate: 6, months: 120 }).balance, 18193.97);
  // Yearly compounding: 10000 × 1.06^10.
  near(grow({ start: 10000, monthly: 0, rate: 6, months: 120, compounding: 'yearly' }).balance, 17908.48);
  // 100 a month at 6 % for 10 years: future value of an ordinary annuity.
  const g = grow({ start: 0, monthly: 100, rate: 6, months: 120 });
  near(g.balance, 16387.93);
  near(g.deposits, 12000);
  near(g.interest, g.balance - 12000, 1e-6);
  assert.equal(g.years.length, 10);
  near(g.years.at(-1).balance, g.balance, 1e-6);
});

test('simple interest never earns interest on interest', () => {
  const g = grow({ start: 10000, monthly: 0, rate: 5, months: 120, compounding: 'simple' });
  near(g.balance, 15000);
  near(g.lastYearInterest, 500);
});

test('the last year of interest and inflation', () => {
  const g = grow({ start: 10000, monthly: 0, rate: 6, months: 24, compounding: 'yearly', inflation: 2 });
  near(g.lastYearInterest, 10600 * 0.06);
  near(g.real, g.balance / 1.02 ** 2);
  assert.equal(grow({ start: 100, monthly: 10, rate: 5, months: 18 }).years.length, 2);
});

test('effective rates and doubling times', () => {
  near(effectiveRate(12, 12), 12.6825, 1e-4);
  near(effectiveRate(5, 1), 5, 1e-12);
  near(effectiveRate(5, 0), 5, 1e-12);
  near(doublingYears(6, 'yearly'), 11.896, 1e-3);
  near(doublingYears(5, 'simple'), 20, 1e-12);
  assert.equal(doublingYears(0), Infinity);
});

test('the rate of a loan is found from its payment', () => {
  const pay = annuityPayment(10000, 9, 36);
  const r = findRate({ amount: 10000, payment: pay, months: 36 });
  near(r.rate, 9, 1e-6);
  near(r.effective, effectiveRate(9, 12), 1e-6);
  assert.deepEqual(findRate({ amount: 1200, payment: 100, months: 12 }), { rate: 0, effective: 0 });
  assert.equal(findRate({ amount: 10000, payment: 100, months: 36 }), null);
  assert.equal(findRate({ amount: 100, payment: 10, months: 12, upfrontFee: 100 }), null);
});

test('fees raise the real cost of a loan', () => {
  const pay = annuityPayment(10000, 9, 36);
  const bare = findRate({ amount: 10000, payment: pay, months: 36 });
  const fees = findRate({ amount: 10000, payment: pay, months: 36, upfrontFee: 500, monthlyFee: 5 });
  assert.ok(fees.effective > bare.effective + 3);
  // Paying it back: the fee-free amount at the found rate equals what was received.
  const r = fees.rate / 1200;
  near(((pay + 5) * (1 - (1 + r) ** -36)) / r, 9500, 1e-6);
  // Very expensive credit still converges.
  const steep = findRate({ amount: 1000, payment: 500, months: 12 });
  near(annuityPayment(1000, steep.rate, 12), 500, 1e-6);
});

test('nice rounding for suggested payments and chart scales', () => {
  assert.equal(niceCeil(312.5), 320);
  assert.equal(niceCeil(1234), 1300);
  assert.equal(niceCeil(9.1), 10);
  assert.equal(niceCeil(1000), 1000);
  assert.equal(niceCeil(0), 0);
});
