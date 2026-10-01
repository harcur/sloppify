// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { initPage, guardStore } from '../../shared/page.js';
import { extendStrings, t, lang } from '../../shared/i18n.js';
import { h } from '../../shared/dom.js';
import { openStore } from '../../shared/storage.js';
import { strings } from './strings.js';
import { amortize, byYear, grow, doublingYears, effectiveRate, findRate, niceCeil, parseNumber, separators, COMPOUNDING } from './logic.js';

extendStrings(strings);

const TOOL_ID = 'interest-calculator';
const s = (key, vars) => t(`${TOOL_ID}.${key}`, vars);
const name = s('name');
const { main } = initPage({ toolId: TOOL_ID, toolName: name, license: 'MIT', sourcePath: 'tools/interest-calculator/' });

// Saved: the chosen situation and what was typed in each one, as typed.
const store = openStore(TOOL_ID, { version: 1 });
const saving = await guardStore(store, name);

// Situations and their fields ----------------------------------------
// type: money | rate | term (with a years/months unit) | select.
// need: 'positive' (above 0), 'nonneg' (0 or more), 'optional' (empty means 0).
const MODES = {
  loan: [
    { key: 'amount', type: 'money', need: 'positive', def: '250000', wide: true },
    { key: 'rate', type: 'rate', def: '5' },
    { key: 'term', type: 'term', def: '25', unit: 'years' },
    { key: 'kind', type: 'select', options: ['annuity', 'serial'], def: 'annuity', wide: true, hint: true },
    { key: 'extra', type: 'money', need: 'optional', def: '', wide: true, monthly: true, hint: true },
  ],
  savings: [
    { key: 'start', type: 'money', need: 'nonneg', def: '10000', wide: true },
    { key: 'monthly', type: 'money', need: 'optional', def: '200', wide: true, monthly: true },
    { key: 'rate', type: 'rate', def: '6' },
    { key: 'term', type: 'term', def: '20', unit: 'years' },
    { key: 'compounding', type: 'select', options: Object.keys(COMPOUNDING), def: 'monthly', wide: true, hint: true },
    { key: 'inflation', type: 'rate', need: 'optional', def: '', wide: true, hint: true },
  ],
  payoff: [
    { key: 'balance', type: 'money', need: 'positive', def: '5000', wide: true },
    { key: 'rate', type: 'rate', def: '20' },
    { key: 'payment', type: 'money', need: 'positive', def: '150', monthly: true },
  ],
  rate: [
    { key: 'amount', type: 'money', need: 'positive', def: '10000', wide: true },
    { key: 'payment', type: 'money', need: 'positive', def: '330', monthly: true, hint: true },
    { key: 'term', type: 'term', def: '36', unit: 'months' },
    { key: 'upfrontFee', type: 'money', need: 'optional', def: '', hint: true },
    { key: 'monthlyFee', type: 'money', need: 'optional', def: '', monthly: true, hint: true },
  ],
};
const UNITS = ['years', 'months'];

const savedInputs = saving ? store.get('inputs', {}) : {};
const values = {};
for (const [m, fields] of Object.entries(MODES)) {
  values[m] = {};
  for (const f of fields) {
    const v = savedInputs?.[m]?.[f.key];
    values[m][f.key] = typeof v === 'string' && (f.type !== 'select' || f.options.includes(v)) ? v : f.def;
    if (f.type === 'term') {
      const u = savedInputs?.[m]?.[`${f.key}Unit`];
      values[m][`${f.key}Unit`] = UNITS.includes(u) ? u : f.unit;
    }
  }
}
let mode = saving && MODES[store.get('mode')] ? store.get('mode') : 'loan';
const persist = () => { if (saving) { store.set('mode', mode); store.set('inputs', values); } };

// Numbers ------------------------------------------------------------
// Digits follow the browser's locale, so amounts look the way people write them.
const locale = navigator.language;
const { decimal } = separators(locale);
const nf = (opts) => new Intl.NumberFormat(locale, opts);
const whole = nf({ maximumFractionDigits: 0 });
const cents = nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
const typed = nf({ maximumFractionDigits: 2 });
const signed = nf({ maximumFractionDigits: 0, signDisplay: 'exceptZero' });
const two = nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
const one = nf({ maximumFractionDigits: 1 });
const percent = nf({ style: 'percent', maximumFractionDigits: 2 });
const roughPercent = nf({ style: 'percent', maximumFractionDigits: 0 });
// Large amounts also in words ("1.25 million"), when the words match the page language.
const wordsFmt = locale.split('-')[0] === lang ? nf({ notation: 'compact', compactDisplay: 'long', maximumSignificantDigits: 3 }) : null;

const money = (x) => (Math.abs(x) < 100 && Math.abs(x - Math.round(x)) > 0.004 ? cents : whole).format(x);
const pct = (x) => percent.format(x / 100);
const finePercent = nf({ style: 'percent', maximumFractionDigits: 1 });
// Small shares keep a decimal, so 0.4 % doesn't read as nothing.
const share = (part, of) => { const x = of ? part / of : 0; return (x > 0 && x < 0.1 ? finePercent : roughPercent).format(x); };
const words = (x) => (wordsFmt && Math.abs(x) >= 10000 ? s('about', { words: wordsFmt.format(x) }) : null);
const plural = new Intl.PluralRules(lang);
function duration(months) {
  const n = Math.round(months);
  const y = Math.floor(n / 12);
  const m = n % 12;
  const ys = s(`dur.y.${plural.select(y)}`, { n: y });
  const ms = s(`dur.m.${plural.select(m)}`, { n: m });
  if (y && m) return s('dur.both', { y: ys, m: ms });
  return y ? ys : ms;
}
const monthYear = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' });

// Reading the fields -------------------------------------------------

function read(m) {
  const v = {};
  const errors = {};
  for (const f of MODES[m]) {
    const raw = values[m][f.key];
    if (f.type === 'select') { v[f.key] = raw; continue; }
    const n = parseNumber(raw, decimal);
    let err = null;
    if (n === null) {
      if (f.need === 'optional') v[f.key] = 0;
      else err = { money: f.need === 'positive' ? 'positive' : 'nonneg', rate: 'rate', term: 'term' }[f.type];
    } else if (Number.isNaN(n)) err = 'number';
    else if (f.type === 'money') err = n < 0 ? 'nonneg' : f.need === 'positive' && n === 0 ? 'positive' : null;
    else if (f.type === 'rate') err = n < 0 || n > 100 ? 'rate' : null;
    else if (f.type === 'term') {
      const months = Math.round(values[m][`${f.key}Unit`] === 'years' ? n * 12 : n);
      if (months < 1 || months > 1200) err = 'term';
      v[f.key] = months;
      continue;
    }
    if (err) errors[f.key] = err;
    else if (n !== null) v[f.key] = n;
  }
  return { v, errors };
}

// Building blocks for results ----------------------------------------

const openDetails = new Set();
function details(key, summary, ...content) {
  const d = h('details', { class: 'ic-details', open: openDetails.has(key) }, h('summary', {}, summary), ...content);
  d.addEventListener('toggle', () => (d.open ? openDetails.add(key) : openDetails.delete(key)));
  return d;
}

const block = (title, ...content) => h('section', { class: 'ic-block' }, h('h2', { class: 'ic-h2' }, title), ...content);

function headline(label, value, sub) {
  return h('div', { class: 'ic-headline' },
    h('h2', { class: 'ic-headline-label' }, label),
    h('p', { class: 'ic-headline-value' }, value),
    sub && h('p', { class: 'ic-headline-sub' }, sub),
  );
}

function stats(pairs) {
  return h('dl', { class: 'ic-stats' }, pairs.filter(Boolean).map(([k, v, sub]) =>
    h('div', { class: 'ic-stat' }, h('dt', {}, k), h('dd', {}, v, sub && h('span', { class: 'ic-stat-sub' }, sub)))));
}

const key = (part, label, value, pctText) => h('li', { class: `ic-key ic-key-${part}` },
  h('span', { class: 'ic-swatch', 'aria-hidden': 'true' }),
  h('span', { class: 'ic-key-label' }, label),
  value != null && h('span', { class: 'ic-key-value' }, value),
  pctText && h('span', { class: 'ic-key-pct' }, pctText),
);

// One bar split in two, to scale, with both parts written out.
function split(a, b) {
  const total = a.value + b.value;
  const barA = h('div', { class: 'ic-split-a' });
  const barB = h('div', { class: 'ic-split-b' });
  barA.style.flexGrow = String(a.value);
  barB.style.flexGrow = String(b.value);
  return h('div', { class: 'ic-split' },
    h('div', { class: 'ic-split-bar', 'aria-hidden': 'true' }, barA, barB),
    h('ul', { class: 'ic-keys' },
      key('a', a.label, money(a.value), share(a.value, total)),
      key('b', b.label, money(b.value), share(b.value, total)),
    ),
    h('p', { class: 'ic-split-total' }, s('total', { value: money(total) })),
  );
}

function table(head, rows, current = -1) {
  return h('div', { class: 'ic-table-wrap' }, h('table', { class: 'ic-table' },
    h('thead', {}, h('tr', {}, head.map((c) => h('th', { scope: 'col' }, c)))),
    h('tbody', {}, rows.map((r, i) => h('tr', { class: i === current ? 'ic-current' : null },
      r.map((c, j) => (j === 0 ? h('th', { scope: 'row' }, c) : h('td', {}, c)))))),
  ));
}

// Stacked bars per year: part a (principal or deposits) under part b (interest).
function chart({ title, label, rows, aLabel, bLabel, tableHead, tableRows }) {
  const max = niceCeil(Math.max(...rows.map((r) => r.a + r.b)));
  const dense = rows.length > 30 ? ' ic-dense' : '';
  const bars = rows.map((r) => {
    const segA = h('div', { class: 'ic-seg-a' });
    const segB = h('div', { class: 'ic-seg-b' });
    segA.style.flexGrow = String(r.a);
    segB.style.flexGrow = String(r.b);
    const bar = h('div', { class: 'ic-bar' }, segB, segA);
    bar.style.height = `${((r.a + r.b) / max) * 100}%`;
    return bar;
  });
  return h('section', { class: 'ic-block' },
    h('h2', { class: 'ic-h2' }, title),
    h('ul', { class: 'ic-keys ic-keys-inline' }, key('a', aLabel), key('b', bLabel)),
    h('div', { class: 'ic-chart', role: 'img', 'aria-label': label },
      h('div', { class: 'ic-axis-y' }, h('span', {}, money(max)), h('span', {}, money(max / 2)), h('span', {}, '0')),
      h('div', { class: `ic-bars${dense}` }, bars),
      // Year labels sit under their bars: every year for short spans, else the first and last.
      h('span', { class: 'ic-axis-name' }, s('year')),
      h('div', { class: `ic-axis-x${dense}` }, rows.map((r, i) => h('span', {}, rows.length <= 10 || i === 0 || i === rows.length - 1 ? i + 1 : ''))),
    ),
    details('years', s('byYear'), table(tableHead, tableRows)),
  );
}

const perspective = (lines) => block(s('perspective'), h('ul', { class: 'ic-lines' }, lines.filter(Boolean).map((l) => h('li', {}, l))));
const notice = (text) => h('p', { class: 'ic-notice' }, text);
const method = (...lines) => details('method', s('method'), lines.filter(Boolean).map((l) => h('p', { class: 'ic-method' }, l)), h('p', { class: 'ic-method' }, s('disclaimer')));

function paidChart(plan) {
  const years = byYear(plan.rows);
  return chart({
    title: s('chart.paid'),
    label: s('chart.paidLabel', {
      n: years.length,
      first: share(years[0].interest, years[0].interest + years[0].principal),
      last: share(years.at(-1).interest, years.at(-1).interest + years.at(-1).principal),
    }),
    rows: years.map((y) => ({ a: y.principal, b: y.interest })),
    aLabel: s('principal'),
    bLabel: s('interest'),
    tableHead: [s('year'), s('principal'), s('interest'), s('balance')],
    tableRows: years.map((y, i) => [i + 1, money(y.principal), money(y.interest), money(y.balance)]),
  });
}

// Results per situation ----------------------------------------------
// Each returns { nodes, label, value, announce }.

const RESULTS = {
  loan(v) {
    const serial = v.kind === 'serial';
    const base = amortize({ principal: v.amount, rate: v.rate, months: v.term, kind: v.kind });
    const plan = v.extra > 0 ? amortize({ principal: v.amount, rate: v.rate, months: v.term, kind: v.kind, extra: v.extra }) : base;
    const label = s(serial ? 'loan.firstPayment' : 'loan.payment');
    const value = money(base.firstPayment);
    const first = plan.rows[0];
    const last = plan.rows.at(-1);
    const avg = plan.totalPaid / plan.months;
    const rates = [-2, -1, 0, 1, 2].map((d) => v.rate + d).filter((r) => r >= 0 && r <= 100);
    const rateRows = rates.map((r) => {
      const p = amortize({ principal: v.amount, rate: r, months: v.term, kind: v.kind, extra: v.extra });
      const pay = p.firstPayment - v.extra;
      return [r === v.rate ? s('loan.rates.now', { rate: pct(r) }) : pct(r), money(pay), money(p.totalInterest), r === v.rate ? '–' : signed.format(pay - (base.firstPayment))];
    });
    const nodes = [
      headline(label, value, serial ? s('loan.falling', { last: money(base.lastPayment) }) : s('loan.over', { n: base.months, time: duration(base.months) })),
      stats([
        [s('loan.totalInterest'), money(plan.totalInterest), words(plan.totalInterest)],
        [s('loan.totalPaid'), money(plan.totalPaid), words(plan.totalPaid)],
        [s('loan.time'), duration(plan.months)],
      ]),
      split({ label: s('loan.borrowed'), value: v.amount }, { label: s('interest'), value: plan.totalInterest }),
      perspective([
        s('perOne', { x: two.format(plan.totalPaid / v.amount) }),
        v.extra > 0 && s('loan.extra', { extra: money(v.extra), sooner: duration(base.months - plan.months), saved: money(base.totalInterest - plan.totalInterest) }),
        v.rate > 0 && s('loan.share', { time: duration(plan.totalInterest / avg), total: duration(plan.months) }),
        v.rate > 0 && s('loan.day', { day: money((v.amount * v.rate) / 100 / 365), month: money(first.interest) }),
        v.rate > 0 && plan.months > 1 && s('loan.split', { first: share(first.interest, first.payment), last: share(last.interest, last.payment) }),
      ]),
      block(s('loan.rates'), table([s('loan.rates.rate'), label, s('loan.totalInterest'), s('loan.rates.diff')], rateRows, rates.indexOf(v.rate))),
      paidChart(plan),
      method(s(serial ? 'loan.method.serial' : 'loan.method.annuity'), v.extra > 0 && s('loan.method.extra')),
    ];
    return { nodes, label, value, announce: s('loan.announce', { label, value, interest: money(plan.totalInterest) }) };
  },

  savings(v) {
    const g = grow({ start: v.start, monthly: v.monthly, rate: v.rate, months: v.term, compounding: v.compounding, inflation: v.inflation });
    const label = s('sav.after', { time: duration(v.term) });
    const value = money(g.balance);
    const lastMonth = money(g.lastYearInterest / 12);
    let last = null;
    if (v.term >= 12 && g.lastYearInterest > 0) {
      const vars = { amount: money(g.lastYearInterest), month: lastMonth, deposit: money(v.monthly) };
      last = !v.monthly ? s('sav.last', vars) : s(g.lastYearInterest / 12 > v.monthly ? 'sav.lastMore' : 'sav.lastLess', vars);
    }
    const nodes = [
      headline(label, value, words(g.balance)),
      stats([
        [s('sav.putIn'), money(g.deposits), words(g.deposits)],
        [s('sav.earned'), money(g.interest), words(g.interest)],
        v.inflation > 0 && [s('sav.real'), money(g.real), words(g.real)],
      ]),
    ];
    if (g.balance > 0) {
      const years = g.years;
      nodes.push(
        split({ label: s('sav.deposits'), value: g.deposits }, { label: s('interest'), value: g.interest }),
        perspective([
          s('sav.share', { pct: share(g.interest, g.balance) }),
          g.deposits > 0 && s('sav.each', { x: two.format(g.balance / g.deposits) }),
          v.rate > 0 ? s('sav.double', { years: one.format(doublingYears(v.rate, v.compounding)) }) : s('sav.doubleNever'),
          last,
          v.inflation > 0 && s('sav.inflation', { inf: pct(v.inflation), real: money(g.real) }),
        ]),
        chart({
          title: s('sav.chart'),
          label: s('sav.chartLabel', { n: years.length, total: money(g.balance), interest: money(g.interest) }),
          rows: years.map((y) => ({ a: y.deposits, b: y.interest })),
          aLabel: s('sav.deposits'),
          bLabel: s('interest'),
          tableHead: [s('year'), s('sav.deposits'), s('interest'), s('sav.balance')],
          tableRows: years.map((y, i) => [i + 1, money(y.deposits), money(y.interest), money(y.balance)]),
        }),
      );
    }
    const per = COMPOUNDING[v.compounding];
    nodes.push(method(per
      ? s('sav.method.compound', { rate: pct(v.rate), freq: s(`freq.${v.compounding}`), eff: pct(effectiveRate(v.rate, per)) })
      : s('sav.method.simple', { rate: pct(v.rate) })));
    return { nodes, label, value, announce: s('sav.announce', { label, value, interest: money(g.interest) }) };
  },

  payoff(v) {
    const p = amortize({ principal: v.balance, rate: v.rate, payment: v.payment });
    const label = s('pay.time');
    const monthInterest = (v.balance * v.rate) / 1200;
    const options = [...new Set((p.paidOff ? [v.payment, v.payment * 1.25, v.payment * 1.5, v.payment * 2] : [monthInterest * 1.25, monthInterest * 1.5, monthInterest * 2, monthInterest * 3])
      .map((x, i) => (i === 0 && p.paidOff ? x : niceCeil(x))))];
    const moreRows = [];
    for (const pay of options) {
      const o = amortize({ principal: v.balance, rate: v.rate, payment: pay });
      if (!o.paidOff) continue;
      moreRows.push([pay === v.payment ? s('pay.more.now', { value: money(pay) }) : money(pay), duration(o.months), money(o.totalInterest),
        p.paidOff && pay !== v.payment ? money(p.totalInterest - o.totalInterest) : '–']);
    }
    const more = moreRows.length > 1 && block(s('pay.more'), table([s('pay.more.payment'), s('pay.more.time'), s('loan.totalInterest'), s('pay.more.saved')], moreRows, p.paidOff ? 0 : -1));
    if (!p.paidOff) {
      const text = v.payment <= monthInterest ? s('pay.never', { interest: money(monthInterest) }) : s('pay.tooLong');
      return { nodes: [h('h2', { class: 'ic-headline-label' }, label), notice(text), more, method(s('pay.method'))], label, value: '–', announce: s('pay.announceNever') };
    }
    const value = duration(p.months);
    const end = new Date();
    end.setDate(1);
    end.setMonth(end.getMonth() + p.months);
    const nodes = [
      headline(label, value, s('pay.by', { date: monthYear.format(end) })),
      stats([
        [s('loan.totalInterest'), money(p.totalInterest), words(p.totalInterest)],
        [s('loan.totalPaid'), money(p.totalPaid), words(p.totalPaid)],
      ]),
      split({ label: s('pay.owed'), value: v.balance }, { label: s('interest'), value: p.totalInterest }),
      perspective([
        s('pay.perOne', { x: two.format(p.totalPaid / v.balance) }),
        v.rate > 0 && p.months > 1 && s('pay.first', { interest: money(p.rows[0].interest), principal: money(p.rows[0].principal) }),
      ]),
      more,
      paidChart(p),
      method(s('pay.method')),
    ];
    return { nodes, label, value, announce: s('pay.announce', { time: value, interest: money(p.totalInterest) }) };
  },

  rate(v) {
    const label = s('rate.effective');
    const r = findRate({ amount: v.amount, payment: v.payment, months: v.term, upfrontFee: v.upfrontFee, monthlyFee: v.monthlyFee });
    if (!r) return { nodes: [h('h2', { class: 'ic-headline-label' }, label), notice(s('rate.none')), method(s('rate.method'))], label, value: '–', announce: s('rate.none') };
    const fees = v.upfrontFee + v.monthlyFee * v.term;
    const totalPaid = v.payment * v.term + fees;
    const cost = totalPaid - v.amount;
    const bare = fees > 0 ? findRate({ amount: v.amount, payment: v.payment, months: v.term }) : null;
    const value = pct(r.effective);
    const nodes = [
      headline(label, value, s('rate.nominal', { rate: pct(r.rate) })),
      stats([
        [s('rate.totalPaid'), money(totalPaid), words(totalPaid)],
        [s('rate.cost'), money(cost), words(cost)],
        [s('rate.costMonth'), money(cost / v.term)],
      ]),
      split({ label: s('rate.borrowed'), value: v.amount }, { label: s('rate.costPart'), value: Math.max(cost, 0) }),
      perspective([
        s('perOne', { x: two.format(totalPaid / v.amount) }),
        s('rate.compare', { rate: pct(r.effective), base: whole.format(1000), cost: money(r.effective * 10) }),
        bare && s('rate.fees', { rate: pct(bare.effective), pp: two.format(r.effective - bare.effective) }),
      ]),
      method(s('rate.method')),
    ];
    return { nodes, label, value, announce: s('rate.announce', { rate: value }) };
  },
};

// Page ---------------------------------------------------------------

const modeBtns = Object.keys(MODES).map((m) => h('button', {
  type: 'button', class: 'seg-btn ic-mode', 'data-mode': m, onclick: () => setMode(m),
}, s(`mode.${m}`)));
const intro = h('p', { class: 'ic-intro' });
const form = h('form', { class: 'ic-form', novalidate: true, onsubmit: (e) => e.preventDefault() });
const results = h('div', { class: 'ic-results' });
const announcer = h('p', { class: 'sr-only', 'aria-live': 'polite' });
const peekLabel = h('span', { class: 'ic-peek-label' });
const peekValue = h('span', { class: 'ic-peek-value' });
// On phones the main result stays in view under the header while typing.
// The marker stays where the strip starts out, to tell when the strip is stuck.
const peekMark = h('div', { class: 'ic-peek-mark' });
const peek = h('div', { class: 'ic-peek', 'aria-hidden': 'true' }, h('div', { class: 'ic-peek-inner' }, peekLabel, peekValue));

main.append(
  h('h1', { class: 'tool-title' }, name),
  h('div', { class: 'seg ic-modes', role: 'group', 'aria-label': s('modes') }, modeBtns),
  intro,
  peekMark,
  peek,
  h('div', { class: 'ic-layout' }, form, results),
  announcer,
);

const fieldEls = {};
// Amounts get their digit grouping, so their size is easy to read.
function grouped(raw) {
  const n = parseNumber(raw, decimal);
  return Number.isFinite(n) && n >= 0 ? typed.format(n) : raw;
}

function buildForm() {
  for (const k of Object.keys(fieldEls)) delete fieldEls[k];
  form.replaceChildren(h('div', { class: 'ic-fields' }, MODES[mode].map(buildField)));
}

function buildField(f) {
  const id = `ic-${mode}-${f.key}`;
  const hint = f.hint ? h('p', { class: 'ic-hint', id: `${id}-hint` }, s(`h.${mode}.${f.key}`)) : null;
  const error = h('p', { class: 'ic-error', id: `${id}-error` });
  const set = (raw, commit) => { values[mode][f.key] = raw; persist(); render(commit); };
  let control;
  if (f.type === 'select') {
    control = h('select', { id, class: 'ic-select', 'aria-describedby': hint && hint.id, onchange: (e) => set(e.target.value, true) },
      f.options.map((o) => h('option', { value: o, selected: values[mode][f.key] === o }, s(`o.${o}`))));
  } else {
    const suffix = f.type === 'rate' ? s('u.pct') : f.monthly ? s('u.month') : null;
    const suffixEl = suffix && h('span', { class: 'ic-suffix', id: `${id}-unit` }, suffix);
    const input = h('input', {
      id, type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', class: 'ic-input',
      value: f.type === 'money' ? grouped(values[mode][f.key]) : values[mode][f.key],
      'aria-describedby': [suffixEl && suffixEl.id, hint && hint.id, error.id].filter(Boolean).join(' '),
      oninput: (e) => set(e.target.value, false),
      onchange: (e) => {
        if (f.type === 'money') e.target.value = grouped(e.target.value);
        set(e.target.value, true);
      },
    });
    const parts = [input, suffixEl];
    if (f.type === 'term') {
      const unitKey = `${f.key}Unit`;
      parts.push(h('select', {
        class: 'ic-unit', 'aria-label': s('u.unit'),
        onchange: (e) => { values[mode][unitKey] = e.target.value; persist(); render(true); },
      }, UNITS.map((u) => h('option', { value: u, selected: values[mode][unitKey] === u }, s(`u.${u}`)))));
    }
    control = h('div', { class: 'ic-control' }, parts);
    fieldEls[f.key] = { input, error };
  }
  return h('div', { class: `ic-field${f.wide ? ' ic-wide' : ''}` }, h('label', { class: 'ic-label', for: id }, s(`f.${mode}.${f.key}`)), control, hint, error);
}

function render(commit = false) {
  const { v, errors } = read(mode);
  for (const [k, { input, error }] of Object.entries(fieldEls)) {
    const err = errors[k];
    error.textContent = err ? s(`err.${err}`) : '';
    if (err) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
  }
  if (Object.keys(errors).length) {
    results.replaceChildren(h('p', { class: 'ic-invalid' }, s('invalid')));
    syncPeek();
    if (commit) announcer.textContent = s('invalid');
    return;
  }
  const out = RESULTS[mode](v);
  results.replaceChildren(...out.nodes.filter(Boolean));
  peekLabel.textContent = out.label;
  peekValue.textContent = out.value;
  if (commit) announcer.textContent = out.announce;
  syncPeek();
}

// The strip shows only once it is stuck under the header (so it never covers
// the form in its starting place) and while the main result is out of view.
const header = document.querySelector('.site-header');
function syncPeek() {
  const top = header.getBoundingClientRect().bottom;
  const stuck = peekMark.getBoundingClientRect().top < top;
  const shown = results.querySelector('.ic-headline-value')?.getBoundingClientRect();
  const hidden = shown && (shown.bottom < top + peek.firstElementChild.offsetHeight || shown.top > innerHeight);
  peek.classList.toggle('is-on', Boolean(stuck && hidden));
}
let peekFrame = 0;
const queuePeek = () => { if (!peekFrame) peekFrame = requestAnimationFrame(() => { peekFrame = 0; syncPeek(); }); };
addEventListener('scroll', queuePeek, { passive: true });
addEventListener('resize', queuePeek);

function setMode(m) {
  mode = m;
  for (const b of modeBtns) b.setAttribute('aria-pressed', String(b.dataset.mode === m));
  intro.textContent = s(`intro.${m}`);
  persist();
  buildForm();
  render();
}

setMode(mode);
