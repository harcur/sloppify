// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS, PRESETS, migrate, cleanSettings, presetOf, newTimer, nextPhase, advance, remainingMs, progress,
  start, pause, resetPhase, cleanTimer, formatTime, sandLevels, dayKey,
} from '../../tools/work-rest-timer/logic.js';

const s = cleanSettings({});

test('settings fall back to defaults and are clamped', () => {
  assert.deepEqual(cleanSettings(null), DEFAULTS);
  const c = cleanSettings({ work: 0, short: 999, long: '12', rounds: 2.6, workVolume: 3, restVolume: -1, workSound: 'nope', glow: 'yes' });
  assert.equal(c.work, 1);
  assert.equal(c.short, 60);
  assert.equal(c.long, 12);
  assert.equal(c.rounds, 3);
  assert.equal(c.workVolume, 1);
  assert.equal(c.restVolume, 0);
  assert.equal(c.workSound, DEFAULTS.workSound);
  assert.equal(c.glow, DEFAULTS.glow);
  assert.equal(cleanSettings({ sound: false }).sound, false);
  assert.equal(cleanSettings({ sound: 0 }).sound, true);
});

test('saved data from version 1 gets a volume per sound', () => {
  const data = migrate({ settings: { work: 30, volume: 0.3 }, today: { day: '2026-10-01', n: 2 } }, 1, 2);
  assert.deepEqual(data.settings, { work: 30, workVolume: 0.3, restVolume: 0.3 });
  assert.deepEqual(data.today, { day: '2026-10-01', n: 2 });
  assert.deepEqual(migrate({}, 1, 2), {});
  const c = cleanSettings(data.settings);
  assert.equal(c.workVolume, 0.3);
  assert.equal(c.restVolume, 0.3);
});

test('presets are recognised', () => {
  assert.equal(presetOf(s), 'classic');
  assert.equal(presetOf(cleanSettings(PRESETS.deep)), 'deep');
  assert.equal(presetOf(cleanSettings({ ...PRESETS.classic, work: 30 })), 'custom');
});

test('phases cycle work, short rest, ..., long rest, then a new cycle', () => {
  const seq = [];
  let p = { phase: 'work', round: 1 };
  for (let i = 0; i < 9; i++) { seq.push(`${p.phase}${p.round}`); p = nextPhase(p, s); }
  assert.deepEqual(seq, ['work1', 'short1', 'work2', 'short2', 'work3', 'short3', 'work4', 'long4', 'work1']);
});

test('start, pause and resume keep the remaining time', () => {
  let t = newTimer(s);
  assert.equal(remainingMs(t, 0), 25 * 60_000);
  t = start(t, 1000);
  assert.equal(remainingMs(t, 61_000), 24 * 60_000);
  t = pause(t, 61_000);
  assert.equal(remainingMs(t, 999_999), 24 * 60_000);
  t = start(t, 100_000);
  assert.equal(t.endAt, 100_000 + 24 * 60_000);
  assert.ok(Math.abs(progress(t, 100_000) - 1 / 25) < 1e-12);
  assert.equal(remainingMs(t, t.endAt + 5000), 0);
});

test('advance and reset', () => {
  const t = advance(start(newTimer(s), 0), s, 10, true);
  assert.equal(t.phase, 'short');
  assert.equal(t.endAt, 10 + 5 * 60_000);
  const r = resetPhase(t, s);
  assert.equal(r.running, false);
  assert.equal(r.remaining, 5 * 60_000);
});

test('saved timers are checked', () => {
  assert.deepEqual(cleanTimer(null, s), newTimer(s));
  assert.deepEqual(cleanTimer({ phase: 'party' }, s), newTimer(s));
  const t = cleanTimer({ phase: 'short', round: 9, running: true, endAt: 5000, total: 300_000, remaining: 300_000 }, s);
  assert.equal(t.round, 4);
  assert.equal(t.running, true);
  assert.equal(t.endAt, 5000);
});

test('time formatting rounds up', () => {
  assert.equal(formatTime(25 * 60_000), '25:00');
  assert.equal(formatTime(4001), '0:05');
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(-5), '0:00');
  assert.equal(formatTime(90 * 60_000), '1:30:00');
});

test('sand levels move slowly at first and always add up', () => {
  assert.deepEqual(sandLevels(0), { top: 1, bottom: 0 });
  assert.deepEqual(sandLevels(1), { top: 0, bottom: 1 });
  const early = sandLevels(0.1);
  assert.ok(1 - early.top < 0.1);
  for (const p of [0.2, 0.5, 0.9]) {
    const l = sandLevels(p);
    assert.ok(Math.abs(l.top + l.bottom - 1) < 1e-12);
  }
});

test('day key uses the local date', () => {
  assert.equal(dayKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});
