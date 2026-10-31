// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Every sound is generated with the Web Audio API, so no audio files are shipped.
// Three calm ones (chime, bowl, rise) and two that are harder to miss (beeps, alarm).

let ctx = null;

// Browsers only allow audio after a tap or key press, so call this from one
// (the start button does) and later sounds can play when the timer ends.
export function unlockAudio() {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return false;
  ctx ??= new AC();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return true;
}

// One voice: an oscillator with a quick attack and an exponential decay.
function voice(out, { freq, at, dur, type = 'sine', peak = 0.3, attack = 0.008, detune = 0 }) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  o.detune.value = detune;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + dur + 0.05);
}

// A struck bell: inharmonic partials that die away at different speeds.
function bell(out, freq, at, len = 2.4, peak = 0.22) {
  [[1, 1], [2.76, 0.45], [5.4, 0.22], [8.93, 0.1]].forEach(([ratio, amp], i) => {
    voice(out, { freq: freq * ratio, at, dur: len / (1 + i * 0.8), peak: peak * amp, attack: 0.004 });
  });
}

const RECIPES = {
  // Two soft bell strikes, a fifth apart.
  chime(out, t) {
    bell(out, 659.25, t);
    bell(out, 987.77, t + 0.45, 2.8);
  },
  // A low singing bowl: two slightly detuned partials beat slowly as it rings out.
  bowl(out, t) {
    for (const [ratio, amp] of [[1, 0.28], [2.71, 0.12], [5.1, 0.05]]) {
      voice(out, { freq: 196 * ratio, at: t, dur: 5, peak: amp, attack: 0.02 });
      voice(out, { freq: 196 * ratio, at: t, dur: 5, peak: amp * 0.7, attack: 0.02, detune: 6 });
    }
  },
  // A gentle rising arpeggio, like a small wooden keyboard.
  rise(out, t) {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      voice(out, { freq: f, at: t + i * 0.16, dur: 0.9, peak: 0.25 });
      voice(out, { freq: f * 4, at: t + i * 0.16, dur: 0.12, peak: 0.04 });
    });
  },
  // Three pairs of short, clear beeps. Harder to miss.
  beeps(out, t) {
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 2; j++) {
        voice(out, { freq: 1046.5, at: t + i * 0.7 + j * 0.18, dur: 0.12, type: 'square', peak: 0.12, attack: 0.004 });
      }
    }
  },
  // Two alternating tones for about three seconds. The most insistent one.
  alarm(out, t) {
    for (let i = 0; i < 12; i++) {
      voice(out, { freq: i % 2 ? 880 : 659.25, at: t + i * 0.25, dur: 0.22, type: 'triangle', peak: 0.35, attack: 0.01 });
    }
  },
  none() {},
};

export function playSound(name, volume = 0.6) {
  if (!RECIPES[name] || name === 'none' || volume <= 0 || !unlockAudio()) return;
  const out = ctx.createGain();
  out.gain.value = volume;
  // Soften the square and triangle waves a little.
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 4200;
  tone.connect(out).connect(ctx.destination);
  RECIPES[name](tone, ctx.currentTime + 0.05);
  setTimeout(() => out.disconnect(), 6000);
}
