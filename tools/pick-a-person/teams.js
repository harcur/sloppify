// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Team splitter: random teams whose sizes differ by at most one, by number
// of teams or by players per team.

import { h } from '../../shared/dom.js';
import { t } from '../../shared/i18n.js';
import { toast } from '../../shared/toast.js';
import { splitTeams, clampInt } from './pick.js';
import { colour, teamLetter, confetti, reduced } from './fx.js';

export function createTeams(ctx) {
  const set = ctx.settings('teams');
  set.by = set.by === 'size' ? 'size' : 'teams';
  set.n = clampInt(set.n, 2, 15, 2);
  let p = ctx.players();
  let teams = null;

  const board = h('div', { class: 'pp-team-board' });
  const empty = h('p', { class: 'pp-touch-hint' });
  const stage = h('div', { class: 'pp-teams-stage' }, empty, board);
  const goBtn = h('button', { type: 'button', class: 'btn pp-go', onclick: () => make() });
  const copyBtn = h('button', { type: 'button', class: 'btn pp-secondary', onclick: () => copy() }, t('pick-a-person.teams.copy'));

  const byBtns = ['teams', 'size'].map((v) => h('button', {
    type: 'button', class: 'seg-btn', 'data-v': v,
    onclick: () => { set.by = v; ctx.saveSettings(); renderOptions(); },
  }, t(`pick-a-person.teams.by.${v}`)));
  const nSelect = h('select', {
    id: 'pp-team-n', class: 'pp-select',
    onchange: (e) => { set.n = clampInt(e.target.value, 2, 15); ctx.saveSettings(); renderOptions(); },
  });
  const nLabel = h('label', { for: 'pp-team-n', class: 'pp-label' });
  const options = h('div', {},
    h('p', { class: 'pp-label', id: 'pp-by-label' }, t('pick-a-person.teams.by')),
    h('div', { class: 'seg pp-seg', role: 'group', 'aria-labelledby': 'pp-by-label' }, byBtns),
    h('p', { class: 'pp-field' }, nLabel, nSelect),
  );

  function renderOptions() {
    const max = Math.max(2, set.by === 'teams' ? Math.min(8, p.count) : Math.floor(p.count / 2));
    const n = Math.min(set.n, max);
    for (const b of byBtns) b.setAttribute('aria-pressed', String(b.dataset.v === set.by));
    nLabel.textContent = t(set.by === 'teams' ? 'pick-a-person.teams.count' : 'pick-a-person.teams.size');
    nSelect.replaceChildren(...Array.from({ length: max - 1 }, (_, i) => h('option', { value: i + 2 }, String(i + 2))));
    nSelect.value = String(n);
    goBtn.textContent = t(teams ? 'pick-a-person.teams.again' : 'pick-a-person.teams.make');
  }

  function render() {
    copyBtn.hidden = !teams;
    empty.hidden = !!teams;
    empty.textContent = t('pick-a-person.teams.hint', { n: p.count });
    board.replaceChildren(...(teams ?? []).map((team, k) => {
      const card = h('section', { class: 'pp-team' },
        h('h2', { class: 'pp-team-name' }, h('span', { class: 'pp-team-letter', 'aria-hidden': 'true' }, teamLetter(k)), t('pick-a-person.teams.team', { team: teamLetter(k) })),
        h('ul', { class: 'pp-team-list' }, team.map((i, j) => {
          const li = h('li', {}, ctx.who(p, i));
          li.style.setProperty('--d', `${(k + j * teams.length) * 70}ms`);
          return li;
        })),
      );
      card.style.setProperty('--c', colour(k));
      card.style.setProperty('--d', `${k * 90}ms`);
      return card;
    }));
    board.dataset.n = String(teams?.length ?? 0);
  }

  function make() {
    const n = Number(nSelect.value);
    teams = splitTeams(p.count, set.by === 'teams' ? { teams: n } : { size: n });
    renderOptions();
    render();
    ctx.say(said());
    ctx.buzz([30, 40, 60]);
    if (!reduced()) setTimeout(() => confetti(ctx.stage, 40), Math.min(1600, p.count * 70));
  }

  const said = () => teams.map((team, k) => t('pick-a-person.teams.said', { team: teamLetter(k), names: team.map((i) => ctx.who(p, i)).join(', ') })).join('. ');

  async function copy() {
    const text = teams.map((team, k) => `${t('pick-a-person.teams.team', { team: teamLetter(k) })}: ${team.map((i) => ctx.who(p, i)).join(', ')}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast(t('pick-a-person.teams.copied'));
    } catch {
      toast(t('pick-a-person.teams.copyFailed'));
    }
  }

  function reset() {
    p = ctx.players();
    teams = null;
    renderOptions();
    render();
  }

  return {
    stage,
    actions: [goBtn, copyBtn],
    options,
    enter: reset,
    leave() {},
    skip() {},
    playersChanged: reset,
  };
}
