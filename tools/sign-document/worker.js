// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Reads, draws and writes PDFs off the main thread, so large files never freeze the page.

import { PdfDoc } from './pdf.js';
import { renderPage } from './render.js';
import { signPdf, imagePdf } from './write.js';

let doc = null;

self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === 'open') {
      doc = await PdfDoc.open(m.buffer); // a file that fails to open leaves the current one in place
      self.postMessage({ id: m.id, pages: doc.pages.map((p) => ({ w: p.width, h: p.height })) });
    } else if (m.type === 'render') {
      const p = doc.pages[m.page];
      if (typeof OffscreenCanvas === 'undefined') throw Object.assign(new Error(), { code: 'unsupported' });
      const canvas = new OffscreenCanvas(Math.max(1, Math.round(p.width * m.scale)), Math.max(1, Math.round(p.height * m.scale)));
      const { missing } = await renderPage(doc, p, canvas.getContext('2d'), m.scale);
      const bitmap = canvas.transferToImageBitmap();
      self.postMessage({ id: m.id, bitmap, missing }, [bitmap]);
    } else if (m.type === 'save' || m.type === 'imagePdf') {
      const out = m.type === 'save' ? await signPdf(doc, m.overlays) : imagePdf(new Uint8Array(m.jpeg), m.width, m.height);
      self.postMessage({ id: m.id, bytes: out.buffer }, [out.buffer]);
    }
  } catch (e) {
    self.postMessage({ id: m.id, error: e?.code || 'failed' });
  }
};
