// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Draw straws. One straw per player stands in a cup, all showing the same
// length; one is short. The phone goes round and each person taps one
// straw, until someone pulls out the short one. No names or turns needed:
// whoever is holding the phone drew it.

import { h } from '../../shared/dom.js';
import { t } from '../../shared/i18n.js';
import { randomInt, strawFan } from './pick.js';
import { colour, confetti, reduced } from './fx.js';

const PASS_MS = 900; // after a long straw, a moment to pass the phone on

export function createStraws(ctx) {
  let count = 0;
  let short = 0;
  let drawn = [];
  let over = false;
  let lock = 0;

  const row = h('div', { class: 'pp-straw-row' });
  const turn = h('p', { class: 'pp-turn' });
  const cup = h('div', { class: 'pp-cup', 'aria-hidden': 'true' }, h('span', { class: 'pp-cup-body' }), h('span', { class: 'pp-cup-rim' }));
  const area = h('div', { class: 'pp-straws' }, row, cup);
  const stage = h('div', { class: 'pp-straws-stage' }, turn, area);
  let laid = '';
  new ResizeObserver(() => { if (`${area.clientWidth}x${area.clientHeight}` !== laid) layout(); }).observe(area);
  const mainBtn = h('button', { type: 'button', class: 'btn pp-go', onclick: () => newRound(true) }, t('pick-a-person.straws.again'));
  // Draws a random straw for whoever holds the phone: the same as tapping
  // one, since nobody can tell them apart, and easier when they are thin.
  const pickBtn = h('button', { type: 'button', class: 'btn pp-secondary', onclick: drawAny }, t('pick-a-person.straws.pick'));

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
    layout();
    render();
    if (announce) ctx.say(t('pick-a-person.straws.ready', { n: count }));
  }

  function layout() {
    const w = area.clientWidth;
    const hgt = area.clientHeight;
    laid = `${w}x${hgt}`;
    if (!w || !hgt || !count) return; // hidden: the observer lays out once it shows
    const fan = strawFan(count, w, hgt);
    const px = (v) => `${v}px`;
    area.style.setProperty('--px', px(fan.pivot.x));
    area.style.setProperty('--py', px(fan.pivot.y));
    area.style.setProperty('--len', px(fan.length));
    area.style.setProperty('--thick', px(fan.thick));
    area.style.setProperty('--hit', px(fan.hit));
    area.style.setProperty('--rim', px(fan.rim));
    area.style.setProperty('--cup-w', px(fan.cupW));
    [...row.children].forEach((b, i) => {
      const { angle, sink, pull } = fan.straws[i];
      b.style.setProperty('--a', `${angle}deg`);
      b.style.setProperty('--sink', px(sink));
      b.style.setProperty('--pull', px(pull));
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
    pickBtn.disabled = over || !!lock;
    stage.classList.toggle('is-over', over);
  }

  function drawAny() {
    const left = [...Array(count).keys()].filter((i) => !drawn.includes(i));
    if (left.length) draw(left[randomInt(left.length)]);
  }

  function draw(i) {
    if (over || lock || drawn.includes(i)) return;
    const fromPick = document.activeElement === pickBtn;
    const hadFocus = fromPick || document.activeElement === row.children[i];
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
      if (fromPick) pickBtn.focus();
      else if (hadFocus) row.querySelector('.pp-straw:not(:disabled)')?.focus();
    }, reduced() ? 0 : PASS_MS);
    render();
    ctx.buzz(15);
    ctx.say(t('pick-a-person.straws.long', { n: count - drawn.length }));
  }

  return {
    stage,
    actions: [mainBtn, pickBtn],
    options: null,
    enter() { newRound(false); },
    leave() { clearTimeout(lock); lock = 0; render(); },
    skip() {},
    playersChanged() { newRound(false); },
  };
}
