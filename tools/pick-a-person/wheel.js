// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Wheel of names: one segment per player, a pointer at the top.

import { h } from '../../shared/dom.js';
import { t } from '../../shared/i18n.js';
import { randomInt, wheelTarget, segmentAt, range } from './pick.js';
import { s, colour, confetti, animateAngle } from './fx.js';

const R = 96; // wheel radius in SVG units; the view box is 200 wide

export function createWheel(ctx) {
  const set = ctx.settings('wheel');
  let p = ctx.players();
  let left = range(p.count); // players still on the wheel
  let lastWinner = null;
  let rotation = 0;
  let spin = null;

  const svg = s('svg', { viewBox: '-100 -100 200 200', class: 'pp-wheel-svg', 'aria-hidden': 'true', focusable: 'false' });
  // The centre piece sits on the turning part, so it turns with the wheel.
  const turner = h('div', { class: 'pp-wheel-turn' }, svg, h('div', { class: 'pp-wheel-hub', 'aria-hidden': 'true' }));
  const pointer = h('div', { class: 'pp-wheel-pointer', 'aria-hidden': 'true' });
  const wheel = h('div', { class: 'pp-wheel', onclick: () => go() }, turner, pointer);
  const info = h('p', { class: 'pp-stage-note' });
  const stage = h('div', { class: 'pp-wheel-stage' }, wheel, info);

  const spinBtn = h('button', { type: 'button', class: 'btn pp-go', onclick: () => go() }, t('pick-a-person.wheel.spin'));
  const resetBtn = h('button', { type: 'button', class: 'btn pp-secondary', onclick: () => restore(true) }, t('pick-a-person.wheel.reset'));

  const removeBox = h('input', {
    type: 'checkbox', checked: !!set.remove,
    onchange: (e) => { set.remove = e.target.checked; ctx.saveSettings(); if (!set.remove) restore(false); },
  });
  const options = h('label', { class: 'pp-check' }, removeBox, t('pick-a-person.wheel.remove'));

  function draw() {
    const n = left.length;
    const seg = 360 / n;
    const font = Math.max(5.5, Math.min(13, 260 / n));
    const max = n > 16 ? 9 : 13;
    const parts = left.map((player, k) => {
      const a0 = (k * seg - 90) * Math.PI / 180;
      const a1 = ((k + 1) * seg - 90) * Math.PI / 180;
      const large = seg > 180 ? 1 : 0;
      const d = n === 1
        ? `M0 ${-R}A${R} ${R} 0 1 1 0 ${R}A${R} ${R} 0 1 1 0 ${-R}Z`
        : `M0 0L${R * Math.cos(a0)} ${R * Math.sin(a0)}A${R} ${R} 0 ${large} 1 ${R * Math.cos(a1)} ${R * Math.sin(a1)}Z`;
      const mid = (k + 0.5) * seg;
      let label = p.labels[player];
      if (label.length > max) label = `${label.slice(0, max - 1)}…`;
      const text = s('text', {
        x: R - 8, y: 0, 'font-size': font, 'text-anchor': 'end', 'dominant-baseline': 'central',
        transform: `rotate(${mid - 90})`,
      }, label);
      return s('g', { class: 'pp-seg', 'data-p': player },
        s('path', { d, fill: colour(player) }), text);
    });
    svg.replaceChildren(...parts, s('circle', { r: R, class: 'pp-wheel-rim' }));
    turner.style.transform = `rotate(${rotation}deg)`;
    info.textContent = left.length < p.count ? t('pick-a-person.wheel.left', { n: left.length, of: p.count }) : '';
    resetBtn.hidden = left.length === p.count;
  }

  function restore(announce) {
    stop();
    left = range(p.count);
    lastWinner = null;
    wheel.classList.remove('is-done');
    ctx.result(null);
    draw();
    if (announce) ctx.say(t('pick-a-person.wheel.restored'));
  }

  function go() {
    if (spin) return spin.skip();
    if (set.remove && lastWinner != null) {
      left = left.filter((x) => x !== lastWinner);
      if (left.length < 2) left = range(p.count);
    }
    lastWinner = null;
    wheel.classList.remove('is-done');
    ctx.result(null);
    draw();
    const k = randomInt(left.length);
    const winner = left[k];
    const target = wheelTarget(rotation, k, left.length, 5 + randomInt(3), Math.random() - 0.5);
    let seg = segmentAt(rotation, left.length);
    spinBtn.textContent = t('pick-a-person.skip');
    wheel.classList.add('is-spinning');
    ctx.say(t('pick-a-person.wheel.spinning'));
    spin = animateAngle({
      from: rotation, to: target, ms: 5200,
      onFrame: (a) => {
        rotation = a;
        turner.style.transform = `rotate(${a}deg)`;
        const now = segmentAt(a, left.length);
        if (now !== seg) { // the pointer flicks as each segment passes
          seg = now;
          pointer.classList.remove('tick');
          void pointer.offsetWidth;
          pointer.classList.add('tick');
        }
      },
      onDone: () => {
        spin = null;
        rotation %= 360;
        turner.style.transform = `rotate(${rotation}deg)`;
        lastWinner = winner;
        spinBtn.textContent = t('pick-a-person.wheel.again');
        wheel.classList.remove('is-spinning');
        wheel.classList.add('is-done');
        for (const g of svg.querySelectorAll('.pp-seg')) g.classList.toggle('is-win', +g.dataset.p === winner);
        ctx.result(ctx.who(p, winner), t('pick-a-person.wheel.picked'));
        ctx.buzz([40, 60, 120]);
        confetti(ctx.stage);
      },
    });
  }

  function stop() {
    spin?.cancel();
    spin = null;
    wheel.classList.remove('is-spinning');
    spinBtn.textContent = t('pick-a-person.wheel.spin');
  }

  return {
    stage,
    actions: [spinBtn, resetBtn],
    options,
    enter() { p = ctx.players(); restore(false); },
    leave: stop,
    skip: () => spin?.skip(),
    playersChanged() { p = ctx.players(); restore(false); },
  };
}
