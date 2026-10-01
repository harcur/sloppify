// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Timer rules without the DOM, so they can be unit tested.

export const PHASES = ['work', 'short', 'long'];
export const SOUNDS = ['chime', 'bowl', 'rise', 'beeps', 'alarm', 'none'];

// Minutes, except rounds (work sessions before a long rest).
export const LIMITS = { work: [1, 180], short: [1, 60], long: [1, 90], rounds: [1, 12] };

export const PRESETS = {
  classic: { work: 25, short: 5, long: 15, rounds: 4 },
  long: { work: 50, short: 10, long: 30, rounds: 3 },
  deep: { work: 90, short: 20, long: 30, rounds: 2 },
};

export const DEFAULTS = {
  ...PRESETS.classic,
  autoStart: false,
  sound: true,
  workSound: 'chime', // played when work ends
  restSound: 'rise',  // played when a rest ends
  volume: 0.6,
  glow: true,
  notify: false,
  vibrate: true,
};

const clampInt = (v, [lo, hi], fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

export function cleanSettings(s) {
  const src = s && typeof s === 'object' ? s : {};
  const out = { ...DEFAULTS };
  for (const k of Object.keys(LIMITS)) out[k] = clampInt(src[k], LIMITS[k], DEFAULTS[k]);
  for (const k of ['autoStart', 'sound', 'glow', 'notify', 'vibrate']) if (typeof src[k] === 'boolean') out[k] = src[k];
  for (const k of ['workSound', 'restSound']) if (SOUNDS.includes(src[k])) out[k] = src[k];
  const vol = Number(src.volume);
  if (Number.isFinite(vol)) out.volume = Math.min(1, Math.max(0, vol));
  return out;
}

// Which preset the settings match, or 'custom'.
export function presetOf(s) {
  for (const [id, p] of Object.entries(PRESETS)) {
    if (Object.keys(p).every((k) => p[k] === s[k])) return id;
  }
  return 'custom';
}

export const phaseMs = (settings, phase) => settings[phase] * 60_000;

// A fresh timer at the start of a cycle, paused.
export function newTimer(settings) {
  return { phase: 'work', round: 1, running: false, endAt: 0, remaining: phaseMs(settings, 'work'), total: phaseMs(settings, 'work') };
}

// The phase after the current one. Work leads to a short rest, or a long one
// after the last round; any rest leads to work, starting a new cycle after a long one.
export function nextPhase({ phase, round }, settings) {
  if (phase === 'work') return round >= settings.rounds ? { phase: 'long', round } : { phase: 'short', round };
  if (phase === 'long') return { phase: 'work', round: 1 };
  return { phase: 'work', round: Math.min(round + 1, settings.rounds) };
}

export function advance(timer, settings, now, running) {
  const next = nextPhase(timer, settings);
  const total = phaseMs(settings, next.phase);
  return { ...next, running, total, remaining: total, endAt: running ? now + total : 0 };
}

export function remainingMs(timer, now) {
  return Math.max(0, timer.running ? timer.endAt - now : timer.remaining);
}

// 0 when the phase starts, 1 when it ends.
export function progress(timer, now) {
  if (!timer.total) return 0;
  return Math.min(1, Math.max(0, 1 - remainingMs(timer, now) / timer.total));
}

export function start(timer, now) {
  if (timer.running) return timer;
  return { ...timer, running: true, endAt: now + timer.remaining };
}

export function pause(timer, now) {
  if (!timer.running) return timer;
  return { ...timer, running: false, remaining: remainingMs(timer, now), endAt: 0 };
}

// Restart the current phase, paused.
export function resetPhase(timer, settings) {
  const total = phaseMs(settings, timer.phase);
  return { ...timer, running: false, endAt: 0, total, remaining: total };
}

// A saved timer, checked. A running one keeps running (the end time is absolute),
// so a reload carries on; one whose end passed shows as finished at zero.
export function cleanTimer(t, settings) {
  if (!t || typeof t !== 'object' || !PHASES.includes(t.phase)) return newTimer(settings);
  const round = clampInt(t.round, [1, settings.rounds], 1);
  const total = Number(t.total) > 0 ? Number(t.total) : phaseMs(settings, t.phase);
  const running = t.running === true && Number.isFinite(t.endAt);
  const remaining = Number.isFinite(t.remaining) ? Math.min(total, Math.max(0, t.remaining)) : total;
  return { phase: t.phase, round, running, total, endAt: running ? t.endAt : 0, remaining };
}

// "4:05", "25:00", "1:30:00". Rounds up, so the display reaches 0:00 exactly at the end.
export function formatTime(ms) {
  const s = Math.ceil(Math.max(0, ms) / 1000);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

// Sand heights as a share of each bulb's sand height. The bulbs narrow towards
// the neck, so sand area grows with the square of its height: both levels move
// slowly at first and faster near the end, like a real glass.
export function sandLevels(p) {
  const r = Math.sqrt(1 - Math.min(1, Math.max(0, p)));
  return { top: r, bottom: 1 - r };
}

// Local date as YYYY-MM-DD, for the "done today" count.
export function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
