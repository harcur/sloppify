// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// renderLayers(design, scale, png) -> { back, front } as ImageBitmaps, or as
// PNG blobs when png is true. Uses the worker where the browser can draw in
// one, and draws on the page otherwise.

import { render } from './art.js';

let worker = null;
let broken = typeof OffscreenCanvas === 'undefined' || typeof Worker === 'undefined';
let next = 0;
const waiting = new Map();

function fail() {
  broken = true;
  worker?.terminate();
  worker = null;
  for (const job of waiting.values()) job.local();
  waiting.clear();
}

function getWorker() {
  if (broken) return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('worker.js', import.meta.url), { type: 'module' });
    } catch {
      broken = true;
      return null;
    }
    worker.onmessage = ({ data }) => {
      const job = waiting.get(data.id);
      if (!job) return;
      if (data.error) { fail(); return; }
      waiting.delete(data.id);
      job.resolve(data);
    };
    worker.onerror = fail;
  }
  return worker;
}

const makeCanvas = (w, h) => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};
const toBlob = (c) => (c.convertToBlob ? c.convertToBlob({ type: 'image/png' }) : new Promise((done) => c.toBlob(done, 'image/png')));

async function local(design, scale, png) {
  const { back, front } = render(design, scale, makeCanvas);
  const out = png ? toBlob : (c) => createImageBitmap(c);
  return { back: await out(back), front: await out(front) };
}

export function renderLayers(design, scale, png = false) {
  const w = getWorker();
  if (!w) return local(design, scale, png);
  return new Promise((resolve, reject) => {
    const id = ++next;
    waiting.set(id, { resolve, local: () => local(design, scale, png).then(resolve, reject) });
    w.postMessage({ id, design, scale, png });
  });
}
