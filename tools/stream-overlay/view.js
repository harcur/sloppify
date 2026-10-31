// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// view.html#back.<design> or view.html#front.<design>: draws one layer at
// full size on a transparent page. No page shell, notice or storage, so it
// works as a browser source in streaming software.

import { extendStrings, t } from '../../shared/i18n.js';
import { strings } from './strings.js';
import { decode } from './design.js';
import { renderLayers } from './renderer.js';

extendStrings(strings);

const canvas = document.getElementById('layer');
const msg = document.getElementById('msg');

async function show() {
  const [layer, data] = location.hash.slice(1).split('.');
  const design = decode(data);
  const valid = design && (layer === 'back' || layer === 'front');
  canvas.hidden = !valid;
  msg.hidden = valid;
  if (!valid) {
    msg.textContent = t('stream-overlay.view.invalid');
    return;
  }
  const out = await renderLayers(design, 1);
  canvas.width = design.w;
  canvas.height = design.h;
  const c = canvas.getContext('2d');
  c.clearRect(0, 0, design.w, design.h);
  c.drawImage(out[layer], 0, 0);
  canvas.setAttribute('aria-label', t('stream-overlay.view.label', { layer: t(`stream-overlay.layer.${layer}`), w: design.w, h: design.h }));
  document.documentElement.dataset.ready = layer;
}

addEventListener('hashchange', show);
show();
