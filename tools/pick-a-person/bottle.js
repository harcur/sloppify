// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Spin the bottle. The phone lies in the middle of the group and the bottle
// points at someone. With names, they sit around the edge.

import { h } from '../../shared/dom.js';
import { t } from '../../shared/i18n.js';
import { randomInt, spinTo, clockHour, mod } from './pick.js';
import { s, colour, confetti, animateAngle } from './fx.js';

const BOTTLE = `
<defs>
  <linearGradient id="pp-glass" x1="0" x2="1">
    <stop offset="0" stop-color="var(--pp-glass-a)"/><stop offset="0.55" stop-color="var(--pp-glass-b)"/><stop offset="1" stop-color="var(--pp-glass-c)"/>
  </linearGradient>
</defs>
<path class="pp-glass" d="M-7 -92h14v10c0 10 2 18 7 26c8 12 16 20 16 38v100c0 9-6 14-15 14h-30c-9 0-15-5-15-14v-100c0-18 8-26 16-38c5-8 7-16 7-26z"/>
<rect class="pp-cap" x="-9" y="-98" width="18" height="10"/>
<rect class="pp-label-band" x="-26" y="10" width="52" height="46"/>
<path class="pp-shine" d="M-17 -16c-3 6-4 12-4 20v80"/>
<path class="pp-label-star" d="M0 21l4 9h10l-8 6l3 10l-9-6l-9 6l3-10l-8-6h10z"/>`;

export function createBottle(ctx) {
  let p = ctx.players();
  let angle = 0;
  let spin = null;
  let drag = null;

  const art = s('svg', { viewBox: '-40 -100 80 230', class: 'pp-bottle-svg', 'aria-hidden': 'true', focusable: 'false' });
  art.innerHTML = BOTTLE;
  const bottle = h('div', { class: 'pp-bottle' }, h('div', { class: 'pp-bottle-inner' }, art));
  const seats = h('div', { class: 'pp-seats', 'aria-hidden': 'true' });
  const table = h('div', { class: 'pp-table' }, seats, bottle);
  const stage = h('div', { class: 'pp-bottle-stage' }, table);
  const spinBtn = h('button', { type: 'button', class: 'btn pp-go', onclick: () => go(1, 0) }, t('pick-a-person.bottle.spin'));

  const turn = (a) => { angle = a; bottle.style.transform = `rotate(${a}deg)`; };

  function drawSeats() {
    seats.replaceChildren(...(p.names ? p.labels.map((label, i) => {
      const a = (i / p.count) * 2 * Math.PI;
      const seat = h('span', { class: 'pp-seat', 'data-i': i }, label);
      seat.style.left = `${50 + 43 * Math.sin(a)}%`;
      seat.style.top = `${50 - 43 * Math.cos(a)}%`;
      seat.style.setProperty('--c', colour(i));
      return seat;
    }) : []));
    table.classList.toggle('has-names', p.names);
  }

  // dir: 1 clockwise, -1 anticlockwise. speed (degrees a second) from a flick
  // adds turns; the place it stops is picked first and doesn't depend on it.
  function go(dir, speed) {
    if (spin) return spin.skip();
    let target;
    let winner = null;
    if (p.names) {
      winner = randomInt(p.count);
      const seg = 360 / p.count;
      target = winner * seg + (Math.random() - 0.5) * seg * 0.5;
    } else {
      target = randomInt(3600) / 10;
    }
    const turns = Math.min(9, 3 + Math.floor(speed / 500) + randomInt(2));
    const to = spinTo(angle, mod(target), turns, dir);
    table.classList.remove('is-done');
    table.classList.add('is-spinning');
    for (const seat of seats.children) seat.classList.remove('is-win');
    ctx.result(null);
    spinBtn.textContent = t('pick-a-person.skip');
    ctx.say(t('pick-a-person.bottle.spinning'));
    spin = animateAngle({
      from: angle, to, ms: 3200 + turns * 260, ease: (x) => 1 - (1 - x) ** 3,
      onFrame: turn,
      onDone: () => {
        spin = null;
        turn(mod(angle));
        table.classList.remove('is-spinning');
        table.classList.add('is-done');
        spinBtn.textContent = t('pick-a-person.bottle.again');
        ctx.buzz([30, 50, 90]);
        if (winner == null) {
          ctx.say(t('pick-a-person.bottle.points', { hour: clockHour(angle) }));
          return;
        }
        seats.children[winner].classList.add('is-win');
        ctx.result(p.labels[winner], t('pick-a-person.bottle.picked'));
        confetti(ctx.stage, 50);
      },
    });
  }

  // Dragging turns the bottle with the finger; letting go fast flicks it.
  const centre = () => {
    const r = table.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  };
  const pointerAngle = (e) => {
    const [cx, cy] = centre();
    return Math.atan2(e.clientX - cx, cy - e.clientY) * 180 / Math.PI;
  };
  table.addEventListener('pointerdown', (e) => {
    if (spin || e.button > 0) return;
    try { table.setPointerCapture(e.pointerId); } catch { /* not a live pointer */ }
    const a = pointerAngle(e);
    drag = { id: e.pointerId, last: a, moved: 0, samples: [[e.timeStamp, angle]] };
  });
  table.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const a = pointerAngle(e);
    const step = mod(a - drag.last + 180) - 180; // shortest way round
    drag.last = a;
    drag.moved += Math.abs(step);
    turn(angle + step);
    drag.samples.push([e.timeStamp, angle]);
    if (drag.samples.length > 6) drag.samples.shift();
  });
  const release = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const [t0, a0] = drag.samples[0];
    const [t1, a1] = drag.samples.at(-1);
    const speed = t1 > t0 ? ((a1 - a0) / (t1 - t0)) * 1000 : 0;
    const moved = drag.moved;
    drag = null;
    if (e.type === 'pointercancel') return;
    if (Math.abs(speed) > 150) go(Math.sign(speed), Math.abs(speed));
    else if (moved < 8) go(1, 0); // a tap
  };
  table.addEventListener('pointerup', release);
  table.addEventListener('pointercancel', release);

  function stop() {
    spin?.cancel();
    spin = null;
    table.classList.remove('is-spinning');
    spinBtn.textContent = t('pick-a-person.bottle.spin');
  }

  return {
    stage,
    actions: [spinBtn],
    options: null,
    enter() { p = ctx.players(); drawSeats(); turn(angle); },
    leave: stop,
    skip: () => spin?.skip(),
    playersChanged() { stop(); p = ctx.players(); drawSeats(); table.classList.remove('is-done'); ctx.result(null); },
  };
}
