// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Records any request that leaves the site's origin. Must stay empty.
export function trackExternalRequests(page, baseURL) {
  const origin = new URL(baseURL).origin;
  const external = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (['data:', 'blob:'].includes(url.protocol)) return;
    if (url.origin !== origin) external.push(req.url());
  });
  return external;
}

// Skip the first-visit notice by marking it as seen before the page loads.
export async function markNoticeSeen(page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('sloppify:hub:noticeSeen')) localStorage.setItem('sloppify:hub:noticeSeen', 'true');
  });
}

// Accessibility checks run in Chromium only (desktop and mobile). What axe
// checks (contrast, names, roles, structure) comes from the page, not the
// engine, and it's the slowest part of the suite. Other browsers still run
// every step around it.
export async function expectAccessible(page, label) {
  if (page.context().browser()?.browserType().name() !== 'chromium') return;
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations, `${label}: ${results.violations.map((v) => v.id).join(', ')}`).toEqual([]);
}
