# sloppify

Small tools and games that run entirely in your browser.

Not hand-coded at all, just generated with AI by a dev with no greed behind it. No ads, no tracking, and no server. Everything is stored locally in your browser, and you can export, import or reset all of it from the menu on any page.

## How it works

- Plain HTML, CSS and JavaScript. No build step and no runtime dependencies: the files in this repo are exactly what runs.
- Every page sets a Content Security Policy that blocks requests to anything outside the site.
- Each tool is its own page in `tools/<id>/` and loads on its own. The hub only reads `tools.json`.
- A service worker caches the hub on first visit and each tool the first time you open it, so pages you've used work offline.
- All data lives in `localStorage` under keys starting with `sloppify:`, through `shared/storage.js`.

## Layout

```
index.html, hub.js, hub.css, hub-order.js   The hub
tools.json                                   The list of tools
sw.js                                        Offline caching
shared/                                      Header, menu, footer, notice, storage, theme, strings
tools/<id>/                                  One folder per tool
tools/_template/                             Copy this to start a new tool
tests/                                       Unit and browser tests (not deployed)
docs/DECISIONS.md                            Every design and architecture decision
```

## Running locally

```sh
python3 -m http.server 4173
```

Then open http://localhost:4173. Any static file server works.

## Tests

```sh
npm install
npx playwright install
npm test
```

Unit tests use Node's built-in test runner. Browser tests use Playwright on mobile and desktop viewports in Chromium, Firefox and WebKit, check every page with axe-core for WCAG AA issues in light and dark mode, and fail if any page makes a request outside the site.

## Before launch

- Replace the generic source icon in `shared/icons.js` with GitHub's `mark-github` from Octicons (MIT).
- Add PNG app icons (192 and 512 px, plus an `apple-touch-icon`) for install on iOS and older Android.
- In the repo settings, set Pages to deploy from GitHub Actions.

## License

MIT, except folders that contain their own `LICENSE` file. See [CONTRIBUTING.md](CONTRIBUTING.md) for adding a tool.
