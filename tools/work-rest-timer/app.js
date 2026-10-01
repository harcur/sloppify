// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { initPage, guardStore } from '../../shared/page.js';
import { extendStrings, t } from '../../shared/i18n.js';
import { h } from '../../shared/dom.js';
import { openStore } from '../../shared/storage.js';
import { strings } from './strings.js';
import {
  LIMITS, PRESETS, SOUNDS, cleanSettings, presetOf, newTimer, advance, remainingMs, progress,
  start, pause, resetPhase, cleanTimer, formatTime, sandLevels, dayKey,
} from './logic.js';
import { playSound, unlockAudio } from './sounds.js';

extendStrings(strings);

const TOOL_ID = 'work-rest-timer';
const name = t(`${TOOL_ID}.name`);
const T = (key, vars) => t(`${TOOL_ID}.${key}`, vars);
const baseTitle = document.title;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

const { main } = initPage({ toolId: TOOL_ID, toolName: name, license: 'MIT', sourcePath: 'tools/work-rest-timer/' });

// Saved: settings, the timer (a running one carries on after a reload),
// work sessions done today, and whether the minimal view is on.
const store = openStore(TOOL_ID, { version: 1 });
const saving = await guardStore(store, name);
const load = (key, fallback) => (saving ? store.get(key, fallback) : fallback);
const save = (key, value) => { if (saving) store.set(key, value); };

let settings = cleanSettings(load('settings', null));
let timer = cleanTimer(load('timer', null), settings);
let today = load('today', null);
if (!today || today.day !== dayKey(new Date()) || !Number.isInteger(today.n)) today = { day: dayKey(new Date()), n: 0 };
let minimal = load('minimal', false) === true;

const phaseName = (p) => T(`phase.${p}`);

// Hourglass ------------------------------------------------------------
// Static, trusted markup. The sand groups are moved with CSS transforms so
// the browser can glide them between the once-a-second updates.

const SAND_TOP = { neck: 108, height: 62 };
const SAND_BOTTOM = { base: 212, height: 72 };
const GLASS = `
<svg class="wrt-svg" viewBox="0 0 140 220" aria-hidden="true" focusable="false">
  <defs>
    <clipPath id="wrt-clip-top"><path d="M32 18H108C108 66 73 93 71.5 108H68.5C67 93 32 66 32 18Z"/></clipPath>
    <clipPath id="wrt-clip-bottom"><path d="M68.5 112H71.5C73 127 108 154 108 202H32C32 154 67 127 68.5 112Z"/></clipPath>
    <pattern id="wrt-grain" width="5" height="5" patternUnits="userSpaceOnUse">
      <circle class="wrt-grain" cx="1.2" cy="1.4" r="0.55"/><circle class="wrt-grain" cx="3.7" cy="3.6" r="0.45"/>
    </pattern>
  </defs>
  <path class="wrt-glass" d="M30 16H110C110 66 74 94 73 110C74 126 110 154 110 204H30C30 154 66 126 67 110C66 94 30 66 30 16Z"/>
  <g clip-path="url(#wrt-clip-top)">
    <g class="wrt-sand wrt-sand-top">
      <rect class="wrt-sand-fill" x="0" y="0" width="140" height="120"/>
      <rect fill="url(#wrt-grain)" x="0" y="0" width="140" height="120"/>
    </g>
  </g>
  <g clip-path="url(#wrt-clip-bottom)">
    <line class="wrt-stream" x1="70" y1="104" x2="70" y2="204"/>
    <g class="wrt-sand wrt-sand-bottom">
      <path class="wrt-sand-fill" d="M0 1C38 1 54-9 70-9S102 1 140 1V90H0Z"/>
      <path fill="url(#wrt-grain)" d="M0 1C38 1 54-9 70-9S102 1 140 1V90H0Z"/>
    </g>
  </g>
  <path class="wrt-outline" d="M30 16H110C110 66 74 94 73 110C74 126 110 154 110 204H30C30 154 66 126 67 110C66 94 30 66 30 16Z"/>
  <path class="wrt-shine" d="M39 27C41 55 53 76 63 92M39 194C41 168 52 147 62 131"/>
  <rect class="wrt-cap" x="12" y="4" width="116" height="10"/>
  <rect class="wrt-cap" x="12" y="206" width="116" height="10"/>
  <path class="wrt-post" d="M19 14V206M121 14V206"/>
</svg>`;
const tpl = document.createElement('template');
tpl.innerHTML = GLASS.trim();
const svg = tpl.content.firstElementChild;
const sandTop = svg.querySelector('.wrt-sand-top');
const sandBottom = svg.querySelector('.wrt-sand-bottom');

function setSand(p, ms) {
  const { top, bottom } = sandLevels(p);
  for (const el of [sandTop, sandBottom]) el.style.transitionDuration = `${ms}ms`;
  sandTop.style.transform = `translateY(${SAND_TOP.neck - SAND_TOP.height * top}px)`;
  sandBottom.style.transform = `translateY(${SAND_BOTTOM.base - SAND_BOTTOM.height * bottom}px)`;
}

// Elements -------------------------------------------------------------

const phaseLabel = h('p', { class: 'wrt-phase' });
const roundLabel = h('span', { class: 'wrt-round-text' });
const roundMarks = h('span', { class: 'wrt-marks', 'aria-hidden': 'true' });
const glass = h('div', { class: 'wrt-glass-wrap', role: 'img' }, svg);
const timeEl = h('p', { class: 'wrt-time', role: 'timer', 'aria-label': T('timer') });
const timeText = h('span', {});
timeEl.append(timeText);
const status = h('p', { class: 'wrt-status', role: 'status' });
const startBtn = h('button', { type: 'button', class: 'btn btn-primary wrt-start', onclick: () => toggle() });
const resetBtn = h('button', { type: 'button', class: 'btn', onclick: () => doReset() }, T('reset'));
const skipBtn = h('button', { type: 'button', class: 'btn', onclick: () => doSkip() }, T('skip'));
const minimalBtn = h('button', { type: 'button', class: 'btn', 'aria-pressed': 'false', onclick: () => setMinimal(true) }, T('minimal'));
const exitBtn = h('button', { type: 'button', class: 'btn wrt-exit', onclick: () => setMinimal(false) }, T('exitMinimal'));
const todayEl = h('p', { class: 'wrt-today' });
const glow = h('div', { class: 'wrt-glow', 'aria-hidden': 'true' });

const stage = h('section', { class: 'wrt-stage', 'aria-label': name },
  exitBtn,
  h('div', { class: 'wrt-head' }, phaseLabel, h('p', { class: 'wrt-round' }, roundMarks, roundLabel)),
  glass,
  timeEl,
  h('div', { class: 'wrt-controls' }, startBtn, resetBtn, skipBtn, minimalBtn),
  status,
  todayEl,
);

// Settings -------------------------------------------------------------

let uid = 0;
const id = (s) => `wrt-${s}-${++uid}`;

const presetBtns = [...Object.keys(PRESETS), 'custom'].map((p) => h('button', {
  type: 'button', class: 'seg-btn', 'data-preset': p, 'aria-label': T(`preset.${p}Label`),
  onclick: () => {
    if (p === 'custom') { numberInputs.work.focus(); return; }
    updateSettings(PRESETS[p]);
  },
}, T(`preset.${p}`)));

const numberInputs = {};
const numberField = (key) => {
  const inputId = id(key);
  const [min, max] = LIMITS[key];
  const input = h('input', { id: inputId, type: 'number', inputmode: 'numeric', min, max, step: 1, class: 'wrt-number' });
  input.addEventListener('change', () => updateSettings({ [key]: input.value }));
  numberInputs[key] = input;
  return h('div', { class: 'wrt-field' },
    h('label', { for: inputId }, T(`field.${key}`)),
    h('span', { class: 'wrt-number-wrap' }, input, key === 'rounds' ? null : h('span', { class: 'wrt-unit', 'aria-hidden': 'true' }, T('min'))),
  );
};

const check = (key, label, hint) => {
  const inputId = id(key);
  const input = h('input', { id: inputId, type: 'checkbox', class: 'wrt-check' });
  input.addEventListener('change', () => onCheck(key, input));
  return { input, el: h('div', { class: 'wrt-check-row' }, input, h('label', { for: inputId }, label), hint) };
};

const soundRow = (key, when) => {
  const selectId = id(key);
  const select = h('select', { id: selectId, class: 'wrt-select' }, SOUNDS.map((s) => h('option', { value: s }, T(`sound.${s}`))));
  select.addEventListener('change', () => { updateSettings({ [key]: select.value }); playSound(select.value, settings.volume); });
  const play = h('button', { type: 'button', class: 'btn', 'aria-label': T('testLabel', { when: T(`when.${when}`) }), onclick: () => playSound(settings[key], settings.volume) }, T('test'));
  return { select, el: h('div', { class: 'wrt-field wrt-sound-row' }, h('label', { for: selectId }, T(key)), h('span', { class: 'wrt-inline' }, select, play)) };
};

const workSound = soundRow('workSound', 'work');
const restSound = soundRow('restSound', 'rest');
const volumeId = id('volume');
const volume = h('input', { id: volumeId, type: 'range', min: 0, max: 100, step: 5, class: 'wrt-range' });
volume.addEventListener('change', () => { updateSettings({ volume: volume.value / 100 }); playSound('chime', settings.volume); });
volume.addEventListener('input', () => volume.setAttribute('aria-valuetext', `${volume.value}%`));

const autoStart = check('autoStart', T('autoStart'));
const notifyHint = h('p', { class: 'wrt-hint', id: id('notify-hint') });
const glowCheck = check('glow', T('glow'), h('p', { class: 'wrt-hint' }, T('glowHint')));
const notifyCheck = check('notify', T('notify'), notifyHint);
const vibrateCheck = check('vibrate', T('vibrate'));
const canVibrate = typeof navigator.vibrate === 'function';

const section = (key, ...children) => {
  const headId = id(key);
  return h('section', { class: 'wrt-section', 'aria-labelledby': headId }, h('h2', { class: 'wrt-h2', id: headId }, T(key)), children);
};

const settingsEl = h('div', { class: 'wrt-settings' },
  section('intervals',
    h('div', { class: 'seg wrt-presets', role: 'group', 'aria-label': T('preset') }, presetBtns),
    h('div', { class: 'wrt-grid' }, numberField('work'), numberField('short'), numberField('long'), numberField('rounds')),
    autoStart.el,
  ),
  section('sound',
    workSound.el,
    restSound.el,
    h('div', { class: 'wrt-field' }, h('label', { for: volumeId }, T('volume')), volume),
  ),
  section('alerts',
    glowCheck.el,
    notifyCheck.el,
    canVibrate ? vibrateCheck.el : null,
    h('button', { type: 'button', class: 'btn wrt-try', onclick: () => alertAll('work', true) }, T('testAlerts')),
  ),
  h('p', { class: 'wrt-hint wrt-keys' }, T('keys')),
);

const root = h('div', { class: 'wrt' }, stage, settingsEl);
main.append(h('h1', { class: 'tool-title' }, name), root);
document.body.append(glow);

function syncSettings() {
  const preset = presetOf(settings);
  for (const b of presetBtns) b.setAttribute('aria-pressed', String(b.dataset.preset === preset));
  for (const [k, input] of Object.entries(numberInputs)) input.value = settings[k];
  workSound.select.value = settings.workSound;
  restSound.select.value = settings.restSound;
  volume.value = Math.round(settings.volume * 100);
  volume.setAttribute('aria-valuetext', `${volume.value}%`);
  autoStart.input.checked = settings.autoStart;
  glowCheck.input.checked = settings.glow;
  notifyCheck.input.checked = settings.notify;
  vibrateCheck.input.checked = settings.vibrate;
  syncNotifyHint();
}

function updateSettings(patch) {
  settings = cleanSettings({ ...settings, ...patch });
  save('settings', settings);
  // A phase that hasn't started yet takes the new length; one in progress keeps its own.
  if (!timer.running && timer.remaining === timer.total) {
    timer = resetPhase({ ...timer, round: Math.min(timer.round, settings.rounds) }, settings);
    save('timer', timer);
  }
  syncSettings();
  render();
}

async function onCheck(key, input) {
  if (key === 'notify' && input.checked) {
    if (!('Notification' in window)) input.checked = false;
    else if (Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch { /* old callback-only API */ }
    }
    if (!('Notification' in window) || Notification.permission !== 'granted') input.checked = false;
  }
  updateSettings({ [key]: input.checked });
}

function syncNotifyHint() {
  let text = '';
  if (!('Notification' in window)) text = T('notifyUnsupported');
  else if (Notification.permission === 'denied') text = T('notifyDenied');
  notifyHint.textContent = text;
  notifyHint.hidden = !text;
  notifyCheck.input.disabled = !('Notification' in window) || Notification.permission === 'denied';
}

// Timer ---------------------------------------------------------------
// One timeout at a time: on the next whole second while the page is visible,
// or straight to the end of the phase while it's hidden.

let timeout = 0;

function schedule() {
  clearTimeout(timeout);
  const now = Date.now();
  if (!timer.running) { setSand(progress(timer, now), 0); return; }
  const left = timer.endAt - now;
  if (left <= 0) { finishPhase(); return; }
  const wait = document.hidden ? left : Math.min(left, (left % 1000 || 1000) + 15);
  if (!document.hidden) setSand(progress(timer, now + wait), wait);
  timeout = setTimeout(tick, wait);
}

function tick() {
  if (timer.running && Date.now() >= timer.endAt) finishPhase();
  else { render(); schedule(); }
}

function toggle() {
  unlockAudio();
  const now = Date.now();
  if (timer.running) {
    timer = pause(timer, now);
    announce(T('paused', { time: formatTime(timer.remaining) }));
  } else {
    timer = start(timer, now);
    announce(T('started', { phase: phaseName(timer.phase), time: formatTime(timer.remaining) }));
  }
  save('timer', timer);
  render();
  schedule();
}

function doReset() {
  timer = resetPhase(timer, settings);
  save('timer', timer);
  announce(T('wasReset', { phase: phaseName(timer.phase) }));
  render();
  schedule();
}

function doSkip() {
  unlockAudio();
  timer = advance(timer, settings, Date.now(), timer.running);
  save('timer', timer);
  announce(T('skipped', { phase: phaseName(timer.phase) }));
  flip();
  render();
  schedule();
}

function finishPhase() {
  const now = Date.now();
  const ended = timer.phase;
  // Only carry straight on if the phase ended just now, not while the page was closed.
  const fresh = now - timer.endAt < 60_000;
  if (ended === 'work') {
    if (today.day !== dayKey(new Date(now))) today = { day: dayKey(new Date(now)), n: 0 };
    today = { ...today, n: today.n + 1 };
    save('today', today);
  }
  timer = advance(timer, settings, now, settings.autoStart && fresh);
  save('timer', timer);
  const message = ended === 'work' ? T('ended.work', { next: phaseName(timer.phase) }) : T(`ended.${ended}`);
  announce(message);
  if (fresh) alertAll(ended, false, message);
  flip();
  render();
  schedule();
}

// Alerts ----------------------------------------------------------------

function alertAll(ended, test = false, message = T('ended.work', { next: phaseName('short') })) {
  const sound = ended === 'work' ? settings.workSound : settings.restSound;
  playSound(sound, settings.volume);
  if (settings.glow) pulse(ended === 'work' ? 'rest' : 'work');
  if (settings.vibrate && canVibrate) navigator.vibrate([200, 120, 200]);
  if (settings.notify) notify(T('notifyTitle', { phase: phaseName(ended) }), message, test);
}

// A slow, soft fade of colour around the edges: one pulse every two seconds,
// a few times. Far below the three-flashes-a-second limit, and low contrast.
// With reduced motion it's a still tint that fades away instead.
// Tinted with the colour of the phase that starts next.
function pulse(next) {
  glow.dataset.phase = next;
  glow.classList.remove('on');
  void glow.offsetWidth; // restart the animation
  glow.classList.add('on');
}
glow.addEventListener('animationend', () => glow.classList.remove('on'));

async function notify(title, body, always) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (!always && document.visibilityState === 'visible' && document.hasFocus()) return;
  const options = { body, tag: TOOL_ID, icon: new URL('../../icon.svg', location.href).href };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) { await reg.showNotification(title, options); return; }
  } catch { /* fall back to a page notification */ }
  try { new Notification(title, options); } catch { /* not allowed here */ }
}

// The glass turns over when a phase ends: the full bottom becomes the new top.
function flip() {
  if (reduced.matches) return;
  glass.classList.remove('flip');
  void glass.offsetWidth;
  glass.classList.add('flip');
}
glass.addEventListener('animationend', () => glass.classList.remove('flip'));

function announce(text) {
  status.textContent = text;
}

// Minimal view ----------------------------------------------------------

function setMinimal(on) {
  minimal = on;
  save('minimal', on);
  document.documentElement.classList.toggle('wrt-minimal', on);
  minimalBtn.setAttribute('aria-pressed', String(on));
  if (on) { announce(T('minimalOn')); startBtn.focus(); } else minimalBtn.focus();
}

// Render ----------------------------------------------------------------

function render() {
  const now = Date.now();
  const left = remainingMs(timer, now);
  const phase = phaseName(timer.phase);
  const fresh = !timer.running && left === timer.total;
  root.dataset.phase = timer.phase === 'work' ? 'work' : 'rest';
  root.dataset.running = String(timer.running);
  phaseLabel.textContent = phase;
  roundLabel.textContent = T('round', { n: timer.round, total: settings.rounds });
  roundMarks.replaceChildren(...Array.from({ length: settings.rounds }, (_, i) => {
    const n = i + 1;
    const done = n < timer.round || (n === timer.round && timer.phase !== 'work');
    return h('span', { class: `wrt-mark${done ? ' done' : ''}${n === timer.round && timer.phase === 'work' ? ' now' : ''}` });
  }));
  timeText.textContent = formatTime(left);
  glass.setAttribute('aria-label', T('hourglass', { pct: Math.round(progress(timer, now) * 100), phase }));
  startBtn.textContent = timer.running ? T('pause') : fresh ? T('startPhase', { phase }) : T('resume');
  resetBtn.disabled = fresh;
  todayEl.textContent = T('today', { n: today.n });
  document.title = fresh ? baseTitle : T('pageTitle', { time: formatTime(left), phase });
}

// Keys --------------------------------------------------------------------

document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
  const el = e.target;
  const typing = el instanceof HTMLElement && el.matches('input, select, textarea, [contenteditable]');
  if (e.key === 'Escape' && minimal) { e.preventDefault(); setMinimal(false); return; }
  if (typing) return;
  const k = e.key.toLowerCase();
  if (e.key === ' ' && !(el instanceof HTMLElement && el.matches('button, a, summary'))) { e.preventDefault(); toggle(); }
  else if (k === 'r' && !resetBtn.disabled) doReset();
  else if (k === 's') doSkip();
  else if (k === 'm') setMinimal(!minimal);
});

document.addEventListener('visibilitychange', () => { render(); schedule(); });
reduced.addEventListener('change', () => schedule());

syncSettings();
if (minimal) { document.documentElement.classList.add('wrt-minimal'); minimalBtn.setAttribute('aria-pressed', 'true'); }
render();
schedule();
