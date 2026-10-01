// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Offline support. The hub and shared files are cached on install. Each tool
// page is cached the first time it's opened, so nothing is loaded up front.
// Network first, so updates apply silently; the cache is used when offline
// or when the network takes longer than 3 seconds. Requests revalidate with
// the server instead of using the browser's HTTP cache, because GitHub Pages
// lets browsers keep files for 10 minutes, which would hide a fresh deploy.

const VERSION = 2; // bump when SHELL changes
const CACHE = `sloppify-v${VERSION}`;
const SHELL = [
  './', 'index.html', 'hub.js', 'hub.css', 'hub-order.js', 'tools.json', 'manifest.webmanifest', 'icon.svg',
  'shared/base.css', 'shared/theme-boot.js', 'shared/config.js', 'shared/strings.js', 'shared/i18n.js',
  'shared/dom.js', 'shared/icons.js', 'shared/storage.js', 'shared/toast.js', 'shared/backup.js',
  'shared/dialog.js', 'shared/page.js',
];
const TIMEOUT_MS = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('sloppify-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  // A navigation request can't be copied with new options, so fetch its URL.
  const network = fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then((res) => {
    if (res.ok && res.type === 'basic') cache.put(req, res.clone());
    return res;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, TIMEOUT_MS, 'timeout'));
  const first = await Promise.race([network.catch(() => 'error'), timeout]);
  if (first instanceof Response) return first;

  const cached = await cache.match(req);
  if (cached) return cached;
  if (first === 'timeout') {
    try { return await network; } catch { /* fall through */ }
  }
  if (req.mode === 'navigate') {
    return new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Offline</title><p style="font-family:system-ui,sans-serif;padding:16px">You\u2019re offline, and this page hasn\u2019t been opened on this device before. It will work offline after you open it once with a connection.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
  return Response.error();
}
