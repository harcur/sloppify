// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Interest maths, with no DOM access so it can be tested directly.
// Rates are annual percentages (5 means 5 % a year). Everything runs in
// whole months: payments and deposits happen at the end of each month.

export const MAX_MONTHS = 1200; // 100 years

const done = (balance, start) => balance <= start * 1e-9 + 1e-9;

/** Separators the given locale writes numbers with, e.g. { group: ',', decimal: '.' }. */
export function separators(locale) {
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  return {
    group: parts.find((p) => p.type === 'group')?.value ?? ',',
    decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.',
  };
}

/**
 * Reads a number the way people type it: "250 000", "250,000", "1.234,5",
 * "4,5", "5 %", "250k", "1.2m". Returns null for an empty field and NaN for
 * anything unreadable. `decimal` is the locale's decimal separator, used
 * only when a lone separator could be either.
 */
export function parseNumber(input, decimal = '.') {
  let s = String(input ?? '').trim().toLowerCase().replace(/[\s  '_%]/g, '');
  if (!s) return null;
  let scale = 1;
  if (/[km]$/.test(s)) { scale = s.endsWith('k') ? 1e3 : 1e6; s = s.slice(0, -1); }
  s = s.replace(/^−/, '-');
  if (!/^-?[\d.,]+$/.test(s) || !/\d/.test(s)) return NaN;
  const dots = s.split('.').length - 1;
  const commas = s.split(',').length - 1;
  let dec = null;
  if (dots && commas) dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
  else if (dots + commas === 1) {
    const sep = dots ? '.' : ',';
    const after = s.length - s.indexOf(sep) - 1;
    dec = sep === decimal || after !== 3 ? sep : null;
  }
  let clean = s.replace(/[.,]/g, '');
  if (dec) {
    const [whole, frac, ...rest] = s.split(dec);
    if (rest.length || /[.,]/.test(frac)) return NaN;
    clean = `${whole.replace(/[.,]/g, '')}.${frac}`;
  }
  const n = Number(clean) * scale;
  return Number.isFinite(n) ? n : NaN;
}

/** Equal monthly payment that repays `principal` over `months` at `rate` % a year. */
export function annuityPayment(principal, rate, months) {
  const r = rate / 1200;
  if (r === 0) return principal / months;
  return (principal * r) / (1 - (1 + r) ** -months);
}

/**
 * Month-by-month repayment of a loan.
 *   kind 'annuity': equal payments (interest share falls over time).
 *   kind 'serial': equal principal each month plus that month's interest.
 *   payment: a fixed monthly payment instead of a term (paying off a debt).
 *   extra: paid on top every month, straight off the balance.
 * Returns { paidOff, months, rows: [{ interest, principal, payment, balance }],
 * totalInterest, totalPaid, firstPayment, lastPayment }. paidOff is false
 * when the payment never covers the interest or it takes over 100 years.
 */
export function amortize({ principal, rate, months = 0, kind = 'annuity', payment = null, extra = 0 }) {
  const r = rate / 1200;
  const fixed = payment ?? (kind === 'annuity' ? annuityPayment(principal, rate, months) : 0);
  const step = kind === 'serial' ? principal / months : 0;
  const rows = [];
  let balance = principal;
  let totalInterest = 0;
  let totalPaid = 0;
  while (!done(balance, principal) && rows.length < MAX_MONTHS) {
    const interest = balance * r;
    const due = (payment == null && kind === 'serial' ? step + interest : fixed) + extra;
    if (due <= interest) break;
    const pay = Math.min(due, balance + interest);
    balance -= pay - interest;
    totalInterest += interest;
    totalPaid += pay;
    rows.push({ interest, principal: pay - interest, payment: pay, balance: Math.max(balance, 0) });
  }
  return {
    paidOff: done(balance, principal),
    months: rows.length,
    rows,
    totalInterest,
    totalPaid,
    firstPayment: rows[0]?.payment ?? 0,
    lastPayment: rows.at(-1)?.payment ?? 0,
  };
}

/** Rows of 12 months summed: [{ principal, interest, balance }] with balance at the year's end. */
export function byYear(rows) {
  const years = [];
  for (let i = 0; i < rows.length; i += 12) {
    const chunk = rows.slice(i, i + 12);
    years.push({
      principal: chunk.reduce((a, r) => a + r.principal, 0),
      interest: chunk.reduce((a, r) => a + r.interest, 0),
      balance: chunk.at(-1).balance,
    });
  }
  return years;
}

export const COMPOUNDING = { daily: 365, monthly: 12, yearly: 1, simple: 0 };

/** Effective yearly rate (%) for a nominal rate compounded `per` times a year. */
export function effectiveRate(rate, per) {
  if (!per) return rate;
  return ((1 + rate / 100 / per) ** per - 1) * 100;
}

/**
 * Savings or an investment growing month by month.
 * start: amount at the beginning; monthly: deposit at the end of each month.
 * compounding: a key of COMPOUNDING. 'simple' pays interest only on what
 * was deposited, never on earlier interest.
 * inflation: % a year, to give the end amount in today's money.
 * Returns { months, balance, deposits, interest, real, lastYearInterest,
 * years: [{ deposits, interest, balance }] } with cumulative values at each year's end.
 */
export function grow({ start, monthly, rate, months, compounding = 'monthly', inflation = 0 }) {
  const per = COMPOUNDING[compounding];
  const r = per ? (1 + effectiveRate(rate, per) / 100) ** (1 / 12) - 1 : rate / 1200;
  let deposits = start;
  let interest = 0;
  const years = [];
  const earned = [0];
  for (let m = 1; m <= months; m++) {
    interest += (per ? deposits + interest : deposits) * r;
    deposits += monthly;
    earned.push(interest);
    if (m % 12 === 0 || m === months) years.push({ deposits, interest, balance: deposits + interest });
  }
  const balance = deposits + interest;
  return {
    months,
    balance,
    deposits,
    interest,
    real: balance / (1 + inflation / 100) ** (months / 12),
    lastYearInterest: interest - earned[Math.max(0, months - 12)],
    years,
  };
}

/** Years for money to double at `rate` % a year (no deposits). Infinity at 0 %. */
export function doublingYears(rate, compounding = 'monthly') {
  if (rate <= 0) return Infinity;
  const per = COMPOUNDING[compounding];
  if (!per) return 100 / rate;
  return Math.log(2) / Math.log(1 + effectiveRate(rate, per) / 100);
}

/**
 * The rate a loan really costs: the monthly rate at which what you receive
 * (amount minus fees up front) equals the payments you make. Returns
 * { rate, effective } as yearly percentages (rate = monthly × 12), or null
 * when the payments add up to less than you receive.
 */
export function findRate({ amount, payment, months, upfrontFee = 0, monthlyFee = 0 }) {
  const received = amount - upfrontFee;
  const pay = payment + monthlyFee;
  if (received <= 0 || pay <= 0 || pay * months < received - 1e-9) return null;
  if (pay * months <= received + 1e-9) return { rate: 0, effective: 0 };
  const value = (r) => (r === 0 ? pay * months : (pay * (1 - (1 + r) ** -months)) / r);
  let lo = 0;
  let hi = 1;
  while (value(hi) > received && hi < 1e6) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (value(mid) > received) lo = mid; else hi = mid;
  }
  const r = (lo + hi) / 2;
  return { rate: r * 1200, effective: ((1 + r) ** 12 - 1) * 100 };
}

/** Rounds up to two significant figures: 312.5 -> 320, 1234 -> 1300. */
export function niceCeil(x) {
  if (x <= 0) return 0;
  const step = 10 ** Math.max(0, Math.floor(Math.log10(x)) - 1);
  return Math.ceil(x / step - 1e-9) * step;
}
