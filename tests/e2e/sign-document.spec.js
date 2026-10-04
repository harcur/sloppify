// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { trackExternalRequests, markNoticeSeen, expectAccessible } from './helpers.js';
import { PdfDoc, latin1 } from '../../tools/sign-document/pdf.js';
import { readFields } from '../../tools/sign-document/forms.js';

let external;
test.beforeEach(async ({ page, baseURL }) => {
  external = trackExternalRequests(page, baseURL);
  await markNoticeSeen(page);
  await page.goto('./tools/sign-document/');
});
test.afterEach(() => { expect(external, 'requests outside the site').toEqual([]); });

// A two-page PDF with some text and a line, built here so the bytes are known.
function samplePdf() {
  const content = 'BT /F1 24 Tf 72 720 Td (Rental agreement) Tj ET 72 200 m 300 200 l S';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 /MediaBox [0 0 612 792] /Resources << /Font << /F1 6 0 R >> >> >>',
    '<< /Type /Page /Parent 2 0 R /Contents 5 0 R >>',
    '<< /Type /Page /Parent 2 0 R /Contents 5 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offs = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// A one-page form: a text field and a checkbox.
function formPdf() {
  const on = '0 0 20 20 re f';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [4 0 R 5 0 R] /DA (/Helv 0 Tf 0 g) >> >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Annots [4 0 R 5 0 R] >>',
    '<< /Type /Annot /Subtype /Widget /FT /Tx /T (name) /TU (Full name) /Rect [100 700 400 730] >>',
    '<< /Type /Annot /Subtype /Widget /FT /Btn /T (agree) /TU (I agree) /Rect [100 600 130 630] /V /Off /AS /Off /AP << /N << /Yes 6 0 R >> >> >>',
    `<< /Type /XObject /Subtype /Form /BBox [0 0 20 20] /Length ${on.length} >>\nstream\n${on}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offs = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// A small grey PNG, 40 by 60 pixels.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACgAAAA8CAAAAAAx0qc8AAAAJElEQVR42mM8wUAcYGIYVTiqcFThqMJRhaMKRxWOKhxVSGOFAMvLAUD2KMqqAAAAAElFTkSuQmCC', 'base64');

const openPdf = (page) => page.locator('#sd-file').setInputFiles({ name: 'lease.pdf', mimeType: 'application/pdf', buffer: samplePdf() });

async function waitForPages(page) {
  await expect(page.getByRole('group', { name: 'Page 1 of 2' })).toBeVisible();
  await expect(page.locator('.sd-page').first().locator('.sd-loading')).toHaveCount(0, { timeout: 15000 });
}

// On narrow screens the signatures open as a sheet from the bottom bar.
async function showSignatures(page) {
  const toggle = page.getByRole('button', { name: 'Sign', exact: true });
  if (await toggle.isVisible() && (await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

// On narrow screens the document's other actions are in the options sheet.
async function inOptions(page) {
  const more = page.getByRole('button', { name: 'Options' });
  if (await more.isVisible()) await more.click();
}

async function typeSignature(page, name = 'Alice Example') {
  await showSignatures(page);
  await page.getByRole('button', { name: 'New signature' }).click();
  await page.getByRole('button', { name: 'Typing' }).click();
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Save signature' }).click();
}

const items = (page) => page.locator('.sd-overlay .sd-item');

test('signs a PDF and saves it as an update to the original', async ({ page }) => {
  await openPdf(page);
  await waitForPages(page);
  await typeSignature(page);
  await expect(items(page)).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Signature 1, page 1/ })).toBeFocused();

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /^Save( signed PDF)?$/ }).first().click()]);
  expect(download.suggestedFilename()).toBe('lease-signed.pdf');
  const out = readFileSync(await download.path());
  const src = samplePdf();
  expect(out.subarray(0, src.length).equals(src)).toBe(true);
  const doc = await PdfDoc.open(out);
  expect(doc.pages).toHaveLength(2);
  expect(Object.keys(doc.pages[0].resources.XObject)).toEqual(['SlpSig1']);
  expect(latin1(out)).toContain('/SMask');
});

test('keyboard moves, resizes, removes and undo brings back', async ({ page }) => {
  await openPdf(page);
  await waitForPages(page);
  await typeSignature(page);
  const sig = page.getByRole('button', { name: /^Signature 1, page 1/ });
  await expect(sig).toBeFocused();
  const before = await sig.getAttribute('transform');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(sig).not.toHaveAttribute('transform', before);
  const moved = await sig.getAttribute('transform');
  await page.keyboard.press('+');
  await expect(sig).not.toHaveAttribute('transform', moved);
  await page.keyboard.press('Delete');
  await expect(items(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(items(page)).toHaveCount(1);
});

test('a signature can be put on every page', async ({ page }) => {
  await openPdf(page);
  await waitForPages(page);
  await typeSignature(page);
  await page.getByRole('button', { name: 'Put on every page' }).click();
  await expect(page.getByRole('status')).toHaveText('Copied to the other page');
  await expect(page.getByRole('button', { name: /^Signature 1, page 2/ })).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(items(page)).toHaveCount(1);
});

test('ticks and crosses go on the page in view and are saved', async ({ page }) => {
  await openPdf(page);
  await waitForPages(page);
  await showSignatures(page);
  await page.getByRole('button', { name: 'Tick', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Tick 1, page 1/ })).toBeFocused();
  await showSignatures(page);
  await page.getByRole('button', { name: 'Cross', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Cross 2, page 1/ })).toBeFocused();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save signed PDF' }).filter({ visible: true }).click()]);
  const doc = await PdfDoc.open(readFileSync(await download.path()));
  expect(Object.keys(doc.pages[0].resources.XObject)).toEqual(['SlpSig1']);
});

test('zoom makes the pages wider and back', async ({ page }) => {
  await openPdf(page);
  await waitForPages(page);
  const first = page.locator('.sd-page').first();
  const before = (await first.boundingBox()).width;
  await inOptions(page);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.locator('.sd-zoom-level')).toHaveText('200%');
  await expect.poll(async () => (await first.boundingBox()).width).toBeGreaterThan(before * 1.9);
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await expect(page.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
  await expect.poll(async () => Math.round((await first.boundingBox()).width)).toBe(Math.round(before));
});

test('go to page jumps to a page', async ({ page }) => {
  await openPdf(page);
  await waitForPages(page);
  await inOptions(page);
  await page.getByLabel('Go to page').selectOption('2');
  await expect(page.getByRole('group', { name: 'Page 2 of 2' })).toBeInViewport();
});

test('the PDF\u2019s own form fields can be filled in and are saved', async ({ page }) => {
  await page.locator('#sd-file').setInputFiles({ name: 'form.pdf', mimeType: 'application/pdf', buffer: formPdf() });
  await page.getByRole('textbox', { name: 'Full name' }).fill('Alice Example');
  await page.getByRole('checkbox', { name: 'I agree' }).check();
  await expectAccessible(page, 'form fields');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save signed PDF' }).filter({ visible: true }).click()]);
  const [name, agree] = readFields(await PdfDoc.open(readFileSync(await download.path())));
  expect(name.value).toBe('Alice Example');
  expect(agree.value).toBe(true);
});

test('the pen draws and text starts as a date that can be edited', async ({ page }) => {
  await openPdf(page);
  await waitForPages(page);
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  const box = await page.locator('.sd-page').first().boundingBox();
  await page.mouse.move(box.x + 40, box.y + 60);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 40 + i * 8, box.y + 60 + (i % 2) * 10);
  await page.mouse.up();
  await expect(page.getByRole('button', { name: /^Drawing 1, page 1/ })).toHaveCount(1);

  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 3);
  const field = page.getByLabel('Text', { exact: true });
  await expect(field).toBeFocused();
  await field.fill('Signed in Oslo');
  await expect(page.locator('.sd-overlay text')).toHaveText('Signed in Oslo');
  await expect(items(page)).toHaveCount(2);
});

test('the Text and Date tools add items from the keyboard too', async ({ page }) => {
  await openPdf(page);
  await waitForPages(page);
  await page.getByRole('button', { name: 'Text', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Text', { exact: true })).toBeFocused();
  await page.keyboard.type('Oslo');
  await expect(page.getByRole('button', { name: /^Text 1, page 1: Oslo/ })).toHaveCount(1);
  await page.getByRole('button', { name: 'Date', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Date', { exact: true })).toBeFocused();
  await expect(items(page)).toHaveCount(2);
});

test.describe('in a German browser', () => {
  test.use({ locale: 'de-DE' });

  test('the date is written the local way and can be changed', async ({ page }) => {
    await openPdf(page);
    await waitForPages(page);
    await page.getByRole('button', { name: 'Date', exact: true }).click();
    const box = await page.locator('.sd-page').first().boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 4);
    const date = page.getByLabel('Date', { exact: true });
    const iso = await date.inputValue();
    const [y, m, d] = iso.split('-').map(Number);
    const long = new Intl.DateTimeFormat('de-DE', { dateStyle: 'long' }).format(new Date(y, m - 1, d));
    await expect(page.locator('.sd-overlay text')).toHaveText(long);
    await date.fill('2026-01-31');
    await expect(page.locator('.sd-overlay text')).toHaveText('31. Januar 2026');
    await page.getByLabel('Written as').selectOption('iso');
    await expect(page.locator('.sd-overlay text')).toHaveText('2026-01-31');
    expect(await page.evaluate(() => localStorage.getItem('sloppify:sign-document:dateFormat'))).toBe('"iso"');
  });
});

test('a drawn signature is remembered and can be removed', async ({ page }) => {
  await page.getByRole('button', { name: 'New signature' }).click();
  await page.getByRole('button', { name: 'Save signature' }).click();
  await expect(page.getByRole('status')).toHaveText('The signature is empty.');
  const pad = await page.locator('.sd-pad').boundingBox();
  await page.mouse.move(pad.x + 20, pad.y + pad.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(pad.x + 20 + i * 20, pad.y + pad.height / 2 + (i % 2) * 20);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Save signature' }).click();
  await expect(page.getByRole('button', { name: 'Place signature 1' })).toBeDisabled();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Place signature 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove signature 1' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByRole('button', { name: 'Place signature 1' })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('sloppify:sign-document:signatures'))).toBe('[]');
});

test('signs a picture and saves it as a picture or a PDF', async ({ page }) => {
  await typeSignature(page);
  await page.locator('#sd-file').setInputFiles({ name: 'scan.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('.sd-doc-name, .sd-state').filter({ hasText: 'scan.png', visible: true })).toHaveCount(1);
  await showSignatures(page);
  await page.getByRole('button', { name: 'Place signature 1' }).click();
  await expect(items(page)).toHaveCount(1);
  const [png] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /^Save( signed picture)?$/ }).first().click()]);
  expect(png.suggestedFilename()).toBe('scan-signed.png');
  expect(readFileSync(await png.path()).subarray(1, 4).toString()).toBe('PNG');
  await inOptions(page);
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save as PDF' }).click()]);
  expect(pdf.suggestedFilename()).toBe('scan-signed.pdf');
  expect((await PdfDoc.open(readFileSync(await pdf.path()))).pages).toHaveLength(1);
});

test('files that aren’t PDFs are refused with a message', async ({ page }) => {
  await page.locator('#sd-file').setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a pdf') });
  await expect(page.getByRole('dialog')).toContainText('couldn’t be read as a PDF');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('button', { name: 'Open a document' })).toBeVisible();
});

test('accessible in light and dark, empty and with a document', async ({ page }) => {
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `start ${scheme}`);
  }
  await page.getByRole('button', { name: 'New signature' }).click();
  await expectAccessible(page, 'editor');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await openPdf(page);
  await waitForPages(page);
  await typeSignature(page);
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `document ${scheme}`);
  }
});
