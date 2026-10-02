// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Draw straws. One straw per player stands in a cup, all showing the same
// length; one is short. Players take turns in list order, passing the phone,
// until someone pulls out the short one.

import { h } from '../../shared/dom.js';
import { t } from '../../shared/i18n.js';
import { randomInt, range } from './pick.js';
import { colour, confetti, reduced } from './fx.js';

export function createStraws(ctx) {
  let p = ctx.players();
  let short = 0;
  let drawnBy = []; // straw -> player index, or undefined
  let next = 0; // whose turn
  let over = false;
  let auto = 0;

  const row = h('div', { class: 'pp-straw-row' });
  const turn = h('p', { class: 'pp-turn' });
  const cup = h('div', { class: 'pp-cup', 'aria-hidden': 'true' });
  const stage = h('div', { class: 'pp-straws-stage' }, turn, h('div', { class: 'pp-straws' }, row, cup));
  const mainBtn = h('button', { type: 'button', class: 'btn pp-go', onclick: () => (over ? newRound(true) : drawRest()) });

  function newRound(announce) {
    clearTimeout(auto);
    p = ctx.players();
    short = randomInt(p.count);
    drawnBy = [];
    next = 0;
    over = false;
    ctx.result(null);
    stage.classList.remove('is-over');
    row.replaceChildren(...p.labels.map((_, i) => {
      const b = h('button', { type: 'button', class: 'pp-straw', 'data-i': i, onclick: () => draw(i) },
        h('span', { class: 'pp-straw-body' }), h('span', { class: 'pp-straw-who' }));
      b.style.setProperty('--c', colour(i));
      b.style.setProperty('--d', `${i * 30}ms`);
      return b;
    }));
    row.classList.toggle('is-many', p.count > 12);
    stage.style.setProperty('--n', String(p.count));
    render();
    if (announce) ctx.say(t('pick-a-person.straws.ready', { n: p.count }));
  }

  function render() {
    const name = ctx.who(p, next);
    turn.textContent = over ? '' : t('pick-a-person.straws.turn', { name });
    mainBtn.textContent = over ? t('pick-a-person.straws.again') : t('pick-a-person.straws.rest');
    [...row.children].forEach((b, i) => {
      const by = drawnBy[i];
      const drawn = by != null;
      b.disabled = drawn || over;
      b.classList.toggle('is-drawn', drawn);
      b.classList.toggle('is-short', drawn && i === short);
      b.classList.toggle('is-revealed', over && !drawn);
      b.lastChild.textContent = drawn ? ctx.who(p, by) : '';
      b.setAttribute('aria-label', drawn
        ? t(i === short ? 'pick-a-person.straws.label.short' : 'pick-a-person.straws.label.long', { n: i + 1, name: ctx.who(p, by) })
        : t('pick-a-person.straws.label', { n: i + 1 }));
    });
  }

  function draw(i) {
    if (over || drawnBy[i] != null) return;
    const who = next;
    const hadFocus = document.activeElement === row.children[i];
    drawnBy[i] = who;
    next += 1;
    if (i === short) {
      over = true;
      render();
      if (hadFocus) mainBtn.focus();
      ctx.result(ctx.who(p, who), t('pick-a-person.straws.short'));
      ctx.buzz([80, 60, 160]);
      confetti(ctx.stage, 40);
      return;
    }
    render();
    ctx.buzz(15);
    ctx.say(t('pick-a-person.straws.long', { name: ctx.who(p, who) }) + ' ' + turn.textContent);
    // The phone moves on; keep focus on the straws for the next player.
    if (hadFocus) row.querySelector('.pp-straw:not(:disabled)')?.focus();
  }

  // Everyone left draws in turn, quickly, from left to right.
  function drawRest() {
    if (over) return;
    const step = () => {
      const free = range(p.count).find((k) => drawnBy[k] == null);
      if (free == null || over) return;
      draw(free);
      if (!over) auto = setTimeout(step, reduced() ? 0 : 280);
    };
    step();
  }

  return {
    stage,
    actions: [mainBtn],
    options: null,
    enter() { newRound(false); },
    leave() { clearTimeout(auto); },
    skip() {},
    playersChanged() { newRound(false); },
  };
}
