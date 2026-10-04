// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { PdfDoc, PdfError, Lexer, Name, Ref, Str, Op, latin1, bytes, viewport, mul } from '../../tools/sign-document/pdf.js';
import { signPdf, imagePdf, ser, placement } from '../../tools/sign-document/write.js';
import { parseCMap, glyphChar, winAnsi } from '../../tools/sign-document/fonts.js';
import { Gfx } from '../../tools/sign-document/render.js';
import { trimBox, inkFromPhoto, smoothPath, pointsBox, itemsBox, keepOnPage, resize, isSignatureList, INKS, formatDate, todayIso, isIsoDate, copyToPage } from '../../tools/sign-document/sig.js';

// Builds a PDF with a classic cross-reference table from [num, body] pairs.
function classicPdf(objs, trailer = '/Root 1 0 R') {
  let out = '%PDF-1.4\n';
  const offs = [];
  for (const [num, body] of objs) { offs[num] = out.length; out += `${num} 0 obj\n${body}\nendobj\n`; }
  const size = Math.max(...objs.map(([n]) => n)) + 1;
  const xref = out.length;
  out += `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let n = 1; n < size; n++) out += offs[n] != null ? `${String(offs[n]).padStart(10, '0')} 00000 n \n` : '0000000000 65535 f \n';
  out += `trailer\n<< /Size ${size} ${trailer} >>\nstartxref\n${xref}\n%%EOF\n`;
  return bytes(out);
}

const content = 'BT /F1 12 Tf 72 700 Td (Hello) Tj ET 3 Tr BT /F1 12 Tf 72 680 Td (Hidden) Tj ET 72 650 200 1 re f';
const basic = () => classicPdf([
  [1, '<< /Type /Catalog /Pages 2 0 R >>'],
  [2, '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 /MediaBox [0 0 612 792] /Resources << /Font << /F1 6 0 R >> >> >>'],
  [3, '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>'],
  [4, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`],
  [5, '<< /Type /Page /Parent 2 0 R /Rotate 90 /CropBox [10 20 310 420] /Contents 4 0 R >>'],
  [6, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'],
]);

test('lexer reads strings, names, numbers and references', () => {
  const lx = new Lexer(bytes('<< /A (a\\(b\\)\\101\\n) /B <48 65> /C#20D -1.5 /E [1 0 R true null] >>'));
  const d = lx.object();
  assert.equal(latin1(d.A.b), 'a(b)A\n');
  assert.equal(latin1(d.B.b), 'He');
  assert.equal(d['C D'], -1.5);
  assert.ok(d.E[0] instanceof Ref && d.E[0].num === 1);
  assert.deepEqual(d.E.slice(1), [true, null]);
});

test('serialised objects read back the same', () => {
  const v = { Type: new Name('A B'), N: [1, 2.5, -0.125], S: new Str(bytes('x)y')), R: new Ref(4, 0), D: { X: true } };
  const back = new Lexer(bytes(ser(v))).object();
  assert.equal(back.Type.n, 'A B');
  assert.deepEqual(back.N, [1, 2.5, -0.125]);
  assert.equal(latin1(back.S.b), 'x)y');
  assert.equal(back.R.num, 4);
  assert.equal(back.D.X, true);
});

test('pages inherit boxes and resources, and rotation swaps the size', async () => {
  const doc = await PdfDoc.open(basic());
  assert.equal(doc.pages.length, 2);
  assert.deepEqual([doc.pages[0].width, doc.pages[0].height, doc.pages[0].rotate], [612, 792, 0]);
  assert.deepEqual([doc.pages[1].width, doc.pages[1].height, doc.pages[1].rotate], [400, 300, 90]);
  assert.ok(doc.pages[1].resources.Font.F1);
});

test('the viewport puts the top-left corner of the page at the origin for every rotation', () => {
  for (const rotate of [0, 90, 180, 270]) {
    const page = { view: [0, 0, 100, 200], rotate };
    const m = viewport(page, 2);
    const pt = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    const corners = [[0, 0], [100, 0], [0, 200], [100, 200]].map(([x, y]) => pt(x, y));
    const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
    assert.deepEqual([Math.min(...xs), Math.min(...ys)], [0, 0], `rotate ${rotate}`);
    assert.deepEqual([Math.max(...xs), Math.max(...ys)], rotate % 180 ? [400, 200] : [200, 400], `rotate ${rotate}`);
  }
});

test('placement maps the display rectangle back to page space', () => {
  const page = { view: [0, 0, 612, 792], rotate: 90 };
  const m = placement(page, { x: 10, y: 20, w: 100, h: 50 });
  const back = mul(m, viewport(page, 1)); // image unit square to display points
  const pt = (x, y) => [back[0] * x + back[2] * y + back[4], back[1] * x + back[3] * y + back[5]].map((v) => Math.round(v * 1000) / 1000);
  assert.deepEqual(pt(0, 1), [10, 20]); // image top-left
  assert.deepEqual(pt(1, 0), [110, 70]); // image bottom-right
});

test('cross-reference streams, predictors and object streams are read', async () => {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] >>'];
  let header = '', body = '';
  objs.forEach((o, i) => { header += `${i + 1} ${body.length} `; body += `${o}\n`; });
  const stm = deflateSync(Buffer.from(header + body));
  let out = '%PDF-1.5\n';
  const off4 = out.length;
  out += `4 0 obj\n<< /Type /ObjStm /N 3 /First ${header.length} /Filter /FlateDecode /Length ${stm.length} >>\nstream\n`;
  const parts = [Buffer.from(out), stm];
  let tail = '\nendstream\nendobj\n';
  const off5 = parts.reduce((s, p) => s + p.length, 0) + tail.length;
  // Rows: type (1 byte), field 2 (2 bytes), index (1 byte), PNG "up" predictor.
  const rows = [[0, 0, 0, 0], [2, 0, 4, 0], [2, 0, 4, 1], [2, 0, 4, 2], [1, off4 >> 8, off4 & 255, 0], [1, off5 >> 8, off5 & 255, 0]];
  const raw = [];
  rows.forEach((r, i) => raw.push(2, ...r.map((v, k) => (v - (i ? rows[i - 1][k] : 0)) & 255)));
  const xs = deflateSync(Buffer.from(raw));
  tail += `5 0 obj\n<< /Type /XRef /Size 6 /W [1 2 1] /Root 1 0 R /Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 4 >> /Length ${xs.length} >>\nstream\n`;
  parts.push(Buffer.from(tail), xs, Buffer.from(`\nendstream\nendobj\nstartxref\n${off5}\n%%EOF\n`));
  const doc = await PdfDoc.open(Buffer.concat(parts));
  assert.equal(doc.xrefStream, true);
  assert.equal(doc.pages.length, 1);
  assert.deepEqual([doc.pages[0].width, doc.pages[0].height], [200, 100]);
});

test('a broken cross-reference table is rebuilt by scanning', async () => {
  const b = latin1(basic()).replace(/startxref\n\d+/, 'startxref\n99999');
  const doc = await PdfDoc.open(bytes(b));
  assert.equal(doc.pages.length, 2);
  assert.equal(doc.startxref, 0);
});

test('encrypted and non-PDF files are refused', async () => {
  const enc = classicPdf([[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, '<< /Type /Pages /Kids [] /Count 0 >>'], [3, '<< /Filter /Standard >>']], '/Root 1 0 R /Encrypt 3 0 R');
  await assert.rejects(PdfDoc.open(enc), (e) => e instanceof PdfError && e.code === 'encrypted');
  await assert.rejects(PdfDoc.open(bytes('hello')), (e) => e.code === 'invalid');
});

const overlay = (page) => {
  const rgba = new Uint8Array(4 * 4 * 4);
  rgba.fill(255);
  return { page, rect: { x: 10, y: 10, w: 40, h: 40 }, width: 4, height: 4, rgba };
};

test('signing appends an update and keeps the original bytes', async () => {
  const src = basic();
  const doc = await PdfDoc.open(src);
  const out = await signPdf(doc, [overlay(1)]);
  assert.deepEqual(out.subarray(0, src.length), src);
  const again = await PdfDoc.open(out);
  assert.equal(again.pages.length, 2);
  const page = again.pages[1];
  assert.equal(page.rotate, 90);
  const contents = again.get(page.dict.Contents);
  assert.equal(contents.length, 3);
  const img = again.get(page.resources.XObject.SlpSig1);
  assert.equal(img.dict.Width, 4);
  assert.ok(again.get(img.dict.SMask));
  assert.match(latin1(await again.decode(again.get(contents[2]))), /cm \/SlpSig1 Do Q/);
  assert.equal(again.get(again.pages[0].dict.Contents).dict.Length, content.length); // first page untouched
  // A second round signs on top of the first.
  const third = await PdfDoc.open(await signPdf(again, [overlay(1)]));
  assert.deepEqual(Object.keys(third.pages[1].resources.XObject), ['SlpSig1', 'SlpSig2']);
});

test('a rebuilt file is written out again in full', async () => {
  const doc = await PdfDoc.open(bytes(latin1(basic()).replace(/startxref\n\d+/, 'startxref\n99999')));
  const out = await signPdf(doc, [overlay(0)]);
  const again = await PdfDoc.open(out);
  assert.ok(again.startxref > 0);
  assert.equal(again.pages.length, 2);
  assert.ok(again.pages[0].resources.XObject.SlpSig1);
});

test('a picture becomes a one-page PDF the width of A4', async () => {
  const doc = await PdfDoc.open(imagePdf(bytes('\xFF\xD8fake jpeg\xFF\xD9'), 300, 600));
  assert.equal(doc.pages.length, 1);
  assert.equal(doc.pages[0].width, 595.28);
  assert.equal(doc.pages[0].height, 1190.56);
});

test('ToUnicode maps read single codes and ranges', () => {
  const { map, n } = parseCMap('begincodespacerange <0000> <FFFF> endcodespacerange 2 beginbfchar <0003> <0020> <0010> <00660069> endbfchar 2 beginbfrange <004F> <0051> <006C> <0060> <0061> [<0041> <0042>] endbfrange');
  assert.equal(n, 2);
  assert.equal(map.get(3), ' ');
  assert.equal(map.get(0x10), 'fi');
  assert.deepEqual([map.get(0x4F), map.get(0x50), map.get(0x51)], ['l', 'm', 'n']);
  assert.deepEqual([map.get(0x60), map.get(0x61)], ['A', 'B']);
});

test('glyph names and WinAnsi codes become characters', () => {
  assert.equal(glyphChar('a'), 'a');
  assert.equal(glyphChar('comma'), ',');
  assert.equal(glyphChar('eacute'), 'é');
  assert.equal(glyphChar('uni20AC'), '€');
  assert.equal(glyphChar('quoteright'), '’');
  assert.equal(glyphChar('g123'), '');
  assert.equal(winAnsi(0x80), '€');
  assert.equal(winAnsi(0xE9), 'é');
  assert.equal(winAnsi(0x81), '');
});

// A canvas context stand-in that records what was drawn.
function recorder() {
  const calls = [];
  const target = { canvas: { width: 100, height: 100 }, measureText: (s) => ({ width: 50 * s.length }) };
  return {
    calls,
    ctx: new Proxy(target, {
      get: (o, k) => (k in o ? o[k] : (...args) => { calls.push([k, ...args]); }),
      set: (o, k, v) => { o[k] = v; return true; },
    }),
  };
}

test('text is drawn character by character, except invisible text', async () => {
  const doc = await PdfDoc.open(basic());
  const { ctx, calls } = recorder();
  const g = new Gfx(doc, ctx, viewport(doc.pages[0], 1));
  await g.run(await doc.contents(doc.pages[0]), doc.pages[0].resources, 0);
  const text = calls.filter((c) => c[0] === 'fillText').map((c) => c[1]).join('');
  assert.equal(text, 'Hello');
  assert.match(ctx.font, /bold/);
  assert.ok(calls.some((c) => c[0] === 'rect') && calls.some((c) => c[0] === 'fill'));
  assert.equal(g.missing, false);
});

test('trimBox finds the drawn area', () => {
  const w = 10, h = 5, rgba = new Uint8Array(w * h * 4);
  rgba[(2 * w + 3) * 4 + 3] = 255;
  rgba[(3 * w + 6) * 4 + 3] = 255;
  assert.deepEqual(trimBox(rgba, w, h), { x: 3, y: 2, w: 4, h: 2 });
  assert.deepEqual(trimBox(rgba, w, h, 1), { x: 2, y: 1, w: 6, h: 4 });
  assert.equal(trimBox(new Uint8Array(16), 2, 2), null);
});

test('a photo of a signature keeps the strokes and drops the paper', () => {
  const px = (r, g, b) => [r, g, b, 255];
  const rgba = new Uint8ClampedArray([...px(200, 200, 195), ...px(205, 205, 200), ...px(210, 208, 200), ...px(30, 30, 40), ...px(198, 198, 190)]);
  inkFromPhoto(rgba, INKS.blue);
  assert.equal(rgba[3], 0);
  assert.equal(rgba[3 * 4 + 3], 255);
  assert.deepEqual([...rgba.subarray(12, 15)], INKS.blue);
});

test('stroke paths, boxes and item limits', () => {
  assert.equal(smoothPath([[0, 0]]), 'M0 0l0.01 0');
  assert.equal(smoothPath([[0, 0], [10, 0], [10, 10]]), 'M0 0Q10 0 10 5L10 10');
  assert.deepEqual(pointsBox([[10, 10], [20, 30]], 2), { x: 9, y: 9, w: 12, h: 22 });
  assert.deepEqual(itemsBox([{ x: 10, y: 10, w: 5, h: 5 }, { x: 90, y: 0, w: 20, h: 5 }], 100, 100, 2), { x: 8, y: 0, w: 92, h: 17 });
  assert.equal(itemsBox([], 100, 100), null);
  const it = keepOnPage({ x: -500, y: 900, w: 40, h: 20 }, 100, 100);
  assert.ok(it.x + it.w > 0 && it.y < 100);
  const r = resize({ x: 10, y: 10, w: 20, h: 10 }, 2, 100);
  assert.deepEqual(r, { x: 0, y: 5, w: 40, h: 20 });
});

test('saved signatures are validated', () => {
  assert.ok(isSignatureList([{ id: 'a', src: 'data:image/png;base64,AAAA', w: 1, h: 1 }]));
  assert.ok(!isSignatureList([{ id: 'a', src: 'javascript:alert(1)' }]));
  assert.ok(!isSignatureList({}));
});

test('operators come back as Op tokens', () => {
  const lx = new Lexer(bytes('q 1 0 0 1 0 0 cm Q'));
  const toks = [];
  for (let t = lx.token(); t !== undefined; t = lx.token()) toks.push(t);
  assert.ok(toks[0] instanceof Op && toks[0].o === 'q');
  assert.equal(toks.length, 9);
});

test('dates are written in the requested locale and style', () => {
  assert.equal(formatDate('2026-10-03', 'long', 'en-GB'), '3 October 2026');
  assert.equal(formatDate('2026-10-03', 'long', 'en-US'), 'October 3, 2026');
  assert.equal(formatDate('2026-10-03', 'medium', 'de-DE'), '03.10.2026');
  assert.equal(formatDate('2026-10-03', 'short', 'en-GB'), '03/10/2026');
  assert.equal(formatDate('2026-10-03', 'iso', 'en-US'), '2026-10-03');
  assert.equal(formatDate('2026-01-31', 'long', 'en-GB'), '31 January 2026'); // local date, no time zone shift
  assert.equal(todayIso(new Date(2026, 0, 5)), '2026-01-05');
  assert.ok(isIsoDate('2026-02-28'));
  assert.ok(!isIsoDate('') && !isIsoDate('28/02/2026'));
});

test('an item copied to another page keeps its relative spot and scales with the width', () => {
  const item = { type: 'sig', x: 100, y: 700, w: 150, h: 50, w0: 150, h0: 50 };
  assert.deepEqual(copyToPage(item, { w: 600, h: 800 }, { w: 300, h: 400 }), { ...item, x: 50, y: 350, w: 75, h: 25 });
  const off = copyToPage({ ...item, x: 550 }, { w: 600, h: 800 }, { w: 600, h: 400 });
  assert.ok(off.x < 600 && off.y + off.h > 0);
});
