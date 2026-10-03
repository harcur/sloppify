// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Draw straws. One straw per player stands in a cup, all showing the same
// length; one is short. The phone goes round and each person taps one
// straw, until someone pulls out the short one. No names or turns needed:
// whoever is holding the phone drew it.

import { h } from '../../shared/dom.js';
import { t } from '../../shared/i18n.js';
import { randomInt, strawLayout } from './pick.js';
import { colour, confetti, reduced } from './fx.js';

const PASS_MS = 900; // after a long straw, a moment to pass the phone on

// Heights as a percentage of the straws area: a resting straw's top in the
// front row, how much higher each row behind it stands, and how far above
// its straw a row's tap area starts.
const REST = 38;
const STEP = 9;
const LIFT = 6;

export function createStraws(ctx) {
  let count = 0;
  let short = 0;
  let drawn = [];
  let over = false;
  let lock = 0;

  const row = h('div', { class: 'pp-straw-row' });
  const turn = h('p', { class: 'pp-turn' });
  const cup = h('div', { class: 'pp-cup', 'aria-hidden': 'true' });
  const stage = h('div', { class: 'pp-straws-stage' }, turn, h('div', { class: 'pp-straws' }, row, cup));
  let laidWidth = 0;
  new ResizeObserver(() => { if (row.clientWidth !== laidWidth) layout(); }).observe(row);
  const mainBtn = h('button', { type: 'button', class: 'btn pp-go', onclick: () => newRound(true) }, t('pick-a-person.straws.again'));

  function newRound(announce) {
    clearTimeout(lock);
    lock = 0;
    count = ctx.players().count;
    short = randomInt(count);
    drawn = [];
    over = false;
    ctx.result(null);
    row.replaceChildren(...Array.from({ length: count }, (_, i) => {
      const b = h('button', { type: 'button', class: 'pp-straw', onclick: () => draw(i) }, h('span', { class: 'pp-straw-body' }));
      b.style.setProperty('--c', colour(i));
      b.style.setProperty('--d', `${i * 30}ms`);
      return b;
    }));
    stage.style.setProperty('--n', String(count));
    layout();
    render();
    if (announce) ctx.say(t('pick-a-person.straws.ready', { n: count }));
  }

  function layout() {
    laidWidth = row.clientWidth;
    if (!laidWidth) return; // hidden: the observer lays out once it shows
    const spots = strawLayout(count, laidWidth);
    [...row.children].forEach((b, i) => {
      const { r, rows, x, w } = spots[i];
      const back = rows - 1 - r; // rows in front of this one
      const rest = REST - back * STEP;
      const top = r === 0 ? 0 : rest - LIFT;
      const bottom = back === 0 ? 100 : rest + STEP - LIFT;
      b.style.setProperty('--x', String(x - w / 2));
      b.style.setProperty('--w', String(w));
      b.style.setProperty('--t', String(top));
      b.style.setProperty('--h', String(bottom - top));
      b.style.setProperty('--rest', String(rest));
    });
  }

  function render() {
    const left = count - drawn.length;
    turn.textContent = over ? '' : lock ? t('pick-a-person.straws.pass') : t('pick-a-person.straws.turn', { n: left });
    [...row.children].forEach((b, i) => {
      const isDrawn = drawn.includes(i);
      b.disabled = isDrawn || over || !!lock;
      b.classList.toggle('is-drawn', isDrawn);
      b.classList.toggle('is-short', isDrawn && i === short);
      b.classList.toggle('is-revealed', over && !isDrawn);
      b.setAttribute('aria-label', !isDrawn && !over ? t('pick-a-person.straws.label', { n: i + 1 })
        : t(i === short ? 'pick-a-person.straws.label.short' : 'pick-a-person.straws.label.long', { n: i + 1 }));
    });
  }

  function draw(i) {
    if (over || lock || drawn.includes(i)) return;
    const hadFocus = document.activeElement === row.children[i];
    drawn.push(i);
    if (i === short) {
      over = true;
      render();
      if (hadFocus) mainBtn.focus();
      ctx.result(t('pick-a-person.straws.short'), t('pick-a-person.straws.shortSub'));
      ctx.buzz([80, 60, 160]);
      confetti(ctx.stage, 40);
      return;
    }
    // A long straw: the straws wait a moment so the same person can't tap
    // twice, while the phone goes to the next person.
    lock = setTimeout(() => {
      lock = 0;
      render();
      if (hadFocus) row.querySelector('.pp-straw:not(:disabled)')?.focus();
    }, reduced() ? 0 : PASS_MS);
    render();
    ctx.buzz(15);
    ctx.say(t('pick-a-person.straws.long', { n: count - drawn.length }));
  }

  return {
    stage,
    actions: [mainBtn],
    options: null,
    enter() { newRound(false); },
    leave() { clearTimeout(lock); lock = 0; render(); },
    skip() {},
    playersChanged() { newRound(false); },
  };
}
