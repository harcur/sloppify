// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Draws overlays off the main thread, so the editor stays responsive.

import { render } from './art.js';

self.onmessage = async ({ data: { id, design, scale, png } }) => {
  try {
    const { back, front } = render(design, scale, (w, h) => new OffscreenCanvas(w, h));
    if (png) {
      const type = { type: 'image/png' };
      const [b, f] = await Promise.all([back.convertToBlob(type), front.convertToBlob(type)]);
      self.postMessage({ id, back: b, front: f });
    } else {
      const b = back.transferToImageBitmap();
      const f = front.transferToImageBitmap();
      self.postMessage({ id, back: b, front: f }, [b, f]);
    }
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
