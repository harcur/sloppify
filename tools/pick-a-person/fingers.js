// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Everyone puts a finger on the screen. Once they hold still, a short
// countdown runs and the result shows under the fingers: one person, teams,
// or an order. Without a touch screen it runs the same way with the players
// placed in a circle.

import { h } from '../../shared/dom.js';
import { t } from '../../shared/i18n.js';
import { randomInt, shuffle, splitTeams, range, clampInt } from './pick.js';
import { colour, teamLetter, confetti, delay, reduced } from './fx.js';

const SETTLE_MS = 900; // no new or lifted fingers for this long, then count down
const COUNT_MS = 2000;
const KINDS = ['one', 'teams', 'order'];

export function createFingers(ctx) {
  const set = ctx.settings('fingers');
  if (!KINDS.includes(set.kind)) set.kind = 'one';
  set.teams = clampInt(set.teams, 2, 6, 2);

  const touch = new Map(); // touch identifier -> marker
  let markers = []; // in the order they arrived
  let phase = 'idle'; // idle | waiting | counting | done
  let settle = 0;
  let count = null;
  let simulated = false;

  const hint = h('p', { class: 'pp-touch-hint' });
  const area = h('div', { class: 'pp-touch' }, hint);
  const coarse = matchMedia('(any-pointer: coarse)');

  const simBtn = h('button', { type: 'button', class: 'btn pp-go', onclick: () => simulate() });

  // Options: what to pick, and how many teams.
  const kindBtns = KINDS.map((k) => h('button', {
    type: 'button', class: 'seg-btn', 'data-k': k,
    onclick: () => { set.kind = k; ctx.saveSettings(); renderOptions(); reset(); },
  }, t(`pick-a-person.fingers.kind.${k}`)));
  const teamsSelect = h('select', {
    id: 'pp-finger-teams', class: 'pp-select',
    onchange: (e) => { set.teams = clampInt(e.target.value, 2, 6); ctx.saveSettings(); reset(); },
  }, [2, 3, 4, 5, 6].map((n) => h('option', { value: n }, String(n))));
  const teamsRow = h('p', { class: 'pp-field' }, h('label', { for: 'pp-finger-teams', class: 'pp-label' }, t('pick-a-person.teams.count')), teamsSelect);
  const options = h('div', {},
    h('p', { class: 'pp-label', id: 'pp-kind-label' }, t('pick-a-person.fingers.kind')),
    h('div', { class: 'seg pp-seg', role: 'group', 'aria-labelledby': 'pp-kind-label' }, kindBtns),
    teamsRow,
  );

  function renderOptions() {
    for (const b of kindBtns) b.setAttribute('aria-pressed', String(b.dataset.k === set.kind));
    teamsSelect.value = String(set.teams);
    teamsRow.hidden = set.kind !== 'teams';
    const p = ctx.players();
    simBtn.textContent = t('pick-a-person.fingers.simulate', { n: p.count });
  }

  function setHint() {
    const key = phase === 'counting' ? 'hold'
      : phase === 'done' ? (simulated ? null : touch.size ? 'lift' : 'again')
        : markers.length === 1 ? 'more'
          : coarse.matches ? 'touch' : 'noTouch';
    hint.textContent = !key || (phase === 'waiting' && markers.length > 1) ? '' : t(`pick-a-person.fingers.hint.${key}`);
    area.dataset.phase = phase;
  }

  function addMarker(x, y, label) {
    const used = new Set(markers.map((m) => m.c));
    let c = 0;
    while (used.has(c)) c++;
    const el = h('div', { class: 'pp-finger', 'aria-hidden': 'true' },
      h('span', { class: 'pp-finger-ring' }), h('span', { class: 'pp-finger-gem' }), h('span', { class: 'pp-finger-tag' }, label ?? String(c + 1)));
    el.style.setProperty('--c', colour(c));
    const m = { el, c, x, y };
    place(m, x, y);
    area.append(el);
    markers.push(m);
    return m;
  }

  function place(m, x, y) {
    m.x = x;
    m.y = y;
    m.el.style.transform = `translate(${x}px, ${y}px)`;
  }

  function removeMarker(m) {
    markers = markers.filter((x) => x !== m);
    m.el.classList.add('is-gone');
    setTimeout(() => m.el.remove(), reduced() ? 0 : 250);
  }

  function clearAll() {
    for (const m of markers) m.el.remove();
    markers = [];
    touch.clear();
  }

  function reset() {
    cancel();
    clearAll();
    simulated = false;
    phase = 'idle';
    area.classList.remove('is-one', 'is-teams', 'is-order', 'is-crowded');
    ctx.result(null);
    setHint();
  }

  function cancel() {
    clearTimeout(settle);
    count?.skip();
    count = null;
    area.classList.remove('is-counting');
  }

  // Any change to the fingers restarts the wait.
  function changed() {
    cancel();
    phase = markers.length ? 'waiting' : 'idle';
    setHint();
    if (markers.length >= 2) settle = setTimeout(countDown, SETTLE_MS);
  }

  async function countDown() {
    phase = 'counting';
    setHint();
    area.classList.add('is-counting');
    ctx.say(t('pick-a-person.fingers.hint.hold'));
    ctx.buzz(20);
    const c = delay(reduced() ? 0 : COUNT_MS);
    count = c;
    await c.p;
    if (count !== c) return; // cancelled
    count = null;
    area.classList.remove('is-counting');
    reveal();
  }

  function reveal() {
    phase = 'done';
    const n = markers.length;
    const name = (i) => markers[i].el.lastChild.textContent;
    area.classList.add(`is-${set.kind}`);
    if (set.kind === 'one') {
      const w = randomInt(n);
      markers.forEach((m, i) => m.el.classList.add(i === w ? 'is-win' : 'is-out'));
      ctx.say(t('pick-a-person.fingers.said.one', { name: name(w) }));
      burst(markers[w]);
    } else if (set.kind === 'teams') {
      const teams = splitTeams(n, { teams: Math.min(set.teams, n) });
      teams.forEach((team, k) => team.forEach((i) => {
        const m = markers[i];
        m.el.style.setProperty('--c', colour(k));
        m.el.lastChild.textContent = teamLetter(k);
        m.el.classList.add('is-team');
        m.el.style.setProperty('--d', `${randomInt(6) * 60}ms`);
        m.team = k;
      }));
      ctx.say(teams.map((team, k) => t('pick-a-person.teams.said', { team: teamLetter(k), names: team.map(name).join(', ') })).join('. '));
    } else {
      const order = shuffle(range(n));
      const said = [];
      order.forEach((i, place) => {
        const m = markers[i];
        said.push(t('pick-a-person.fingers.said.place', { place: place + 1, name: name(i) }));
        m.el.lastChild.textContent = String(place + 1);
        m.el.classList.add('is-ordered');
        m.el.style.setProperty('--d', `${place * 180}ms`);
        if (place === 0) m.el.classList.add('is-first');
      });
      ctx.say(said.join(', '));
    }
    ctx.buzz([60, 40, 140]);
    setHint();
  }

  function burst(m) {
    const spot = h('div', { class: 'pp-burst-spot' });
    spot.style.left = `${m.x}px`;
    spot.style.top = `${m.y}px`;
    area.append(spot);
    confetti(spot, 40, 360);
    setTimeout(() => spot.remove(), 2300);
  }

  // Touch input ---------------------------------------------------------

  // Touch events give the full list of fingers on the screen each time, so
  // the markers are rebuilt from that list. A missed lift can't leave a
  // finger stuck, which pointer events allow when many fingers are down.
  function sync(e) {
    e.preventDefault(); // no scrolling, zooming or system gestures
    const r = area.getBoundingClientRect();
    const live = new Map([...e.touches].filter((tc) => area.contains(tc.target)).map((tc) => [tc.identifier, [tc.clientX - r.left, tc.clientY - r.top]]));
    let lifted = 0;
    for (const id of [...touch.keys()]) {
      if (live.has(id)) continue;
      lifted += 1;
      const m = touch.get(id);
      touch.delete(id);
      if (phase !== 'done') removeMarker(m); // after a result the markers stay
    }
    const fresh = [...live.keys()].filter((id) => !touch.has(id));
    if (phase === 'done') {
      // A new round starts with the first touch after everyone has let go.
      if (!fresh.length || touch.size) return setHint();
      reset();
    } else if (simulated && fresh.length) reset();
    for (const [id, [x, y]] of live) {
      if (touch.has(id)) place(touch.get(id), x, y);
      else touch.set(id, addMarker(x, y));
    }
    if (fresh.length) ctx.buzz(10);
    if (fresh.length || lifted) changed(); // any new or lifted finger restarts the wait
  }
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
    area.addEventListener(type, sync, { passive: false });
  }
  area.addEventListener('gesturestart', (e) => e.preventDefault()); // Safari pinch
  area.addEventListener('contextmenu', (e) => e.preventDefault());

  // Without touch: the players stand in a circle and the same countdown runs.
  function simulate() {
    reset();
    simulated = true;
    const p = ctx.players();
    const w = area.clientWidth;
    const hgt = area.clientHeight;
    const r = Math.min(w, hgt) * 0.36;
    p.labels.forEach((label, i) => {
      const a = (i / p.count) * 2 * Math.PI;
      addMarker(w / 2 + r * Math.sin(a), hgt / 2 - r * Math.cos(a), label);
    });
    area.classList.toggle('is-crowded', p.count > 6 || Math.min(w, hgt) < 420);
    countDown();
  }

  return {
    stage: area,
    actions: [simBtn],
    options,
    enter() { renderOptions(); reset(); },
    leave() { reset(); },
    skip: () => count?.skip(),
    playersChanged() { renderOptions(); if (simulated) reset(); },
  };
}
