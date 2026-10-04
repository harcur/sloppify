// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Small helpers shared by the modes: SVG elements, player colours,
// confetti, vibration and reduced motion.

import { h } from '../../shared/dom.js';

const NS = 'http://www.w3.org/2000/svg';

export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
}

// Player colours, used in this order. Dark text reads on all of them
// (≥ 4.5:1) and all stand out from the dark stages (≥ 3:1).
export const COLOURS = 10;
export const colour = (i) => `var(--pp-c${i % COLOURS})`;
// Teams also get a letter, so colour is never the only signal.
export const teamLetter = (i) => String.fromCharCode(65 + i);

export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
export const reduced = () => reducedMotion.matches;

let vibrateOn = true;
export function setVibrate(on) { vibrateOn = on; }
export function buzz(pattern) {
  if (vibrateOn && !reduced() && navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch { /* not allowed */ }
  }
}

// Paper confetti thrown from the middle of `host`.
export function confetti(host, n = 70, size = Math.max(host.clientWidth, host.clientHeight)) {
  if (reduced()) return;
  const box = h('div', { class: 'pp-confetti', 'aria-hidden': 'true' });
  const rnd = (a, b) => a + Math.random() * (b - a);
  for (let k = 0; k < n; k++) {
    const p = h('span');
    const angle = rnd(0, Math.PI * 2);
    const dist = rnd(0.25, 0.7) * size;
    p.style.setProperty('--c', colour(k));
    p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    p.style.setProperty('--dy', `${Math.sin(angle) * dist * 0.7 + rnd(80, 220)}px`);
    p.style.setProperty('--rot', `${rnd(-900, 900)}deg`);
    p.style.setProperty('--t', `${rnd(1100, 1900)}ms`);
    if (k % 3 === 0) p.className = 'wide';
    box.append(p);
  }
  host.append(box);
  setTimeout(() => box.remove(), 2200);
}

// Waits ms, unless skipped. Returns a promise and a skip() that ends it at once.
export function delay(ms) {
  let done;
  let timer;
  const p = new Promise((resolve) => { done = resolve; timer = setTimeout(resolve, ms); });
  return { p, skip: () => { clearTimeout(timer); done(); } };
}

// Turns something from one angle to another over `ms`, easing out, calling
// onFrame(angle) each frame. Only runs while it moves. skip() jumps to the end.
export const easeOut = (t) => 1 - (1 - t) ** 4;
export function animateAngle({ from, to, ms, ease = easeOut, onFrame, onDone }) {
  let raf = 0;
  let start = 0;
  let over = false;
  const end = () => {
    if (over) return;
    over = true;
    cancelAnimationFrame(raf);
    onFrame(to, 1);
    onDone?.();
  };
  const step = (now) => {
    start ||= now;
    const p = Math.min(1, (now - start) / ms);
    if (p >= 1) return end();
    onFrame(from + (to - from) * ease(p), p);
    raf = requestAnimationFrame(step);
  };
  if (ms <= 0 || reduced()) queueMicrotask(end); // after the caller has the handle
  else raf = requestAnimationFrame(step);
  return { skip: end, cancel: () => { over = true; cancelAnimationFrame(raf); } };
}
