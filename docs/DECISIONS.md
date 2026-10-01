# Project Decisions

Living record of decisions for **sloppify**, a local-first hub of tools and games. Update this file whenever a decision changes. Status: **hub built (first version)**. Tool and game design language comes next.

The name is deliberate: the site is openly AI-generated and says so up front.

## Purpose

A collection of web pages with utilities, games and similar tools people commonly use. Open source, no data ever leaves the browser, nothing is being sold. Plain, factual wording throughout; no marketing language.

Starter tools: **Sudoku** and **Interest rate calculator**.

Games:

- **mines** (`tools/mines/`): the classic hidden-mines grid game under a generic name, since the familiar name is a trademark. Three board sizes (9×9/10, 16×16/40, 16×30/99), first move always opens an area, flags by right-click, long-press, flag mode or the F key, opening a number with all its flags placed opens its neighbours. Violet gem-like tiles over a warm cream field (deep plum in dark mode), gold flags, its own mine icon. Openings ripple outwards from the cell played, flags drop in and wave, a loss shakes the board and rings the mine that went off, a win sends a wave across the board plus confetti; all CSS and SVG, all off under reduced motion. On narrow screens it fills the screen like an app (`initPage({ app: true })`): counters on top, the board in the middle, Flag mode / New game / Options at the bottom, and an options sheet with board size, record, help and the footer's text and source link; the site menu stays as a floating button. A wide board is shown turned on its side. Saves the game in progress, plus wins and best time per size.
- **sudoku** (`tools/sudoku/`): the 9 × 9 number puzzle. Kept under the name "sudoku": it is the common generic name for the puzzle almost everywhere, and the registered mark is a Japanese one for publications; we use the word only as the puzzle's name, with our own puzzles, design and text. Puzzles are generated in the browser in a Web Worker (`worker.js`, falling back to the main thread if a module worker can't start): a random full grid thinned in symmetric pairs while it keeps exactly one solution. Easy (at least 38 givens) and medium (at least 30) must be solvable with naked and hidden singles alone; hard goes down to 22 givens and retries until it needs more than singles. Pick a cell, then a digit from the pad or keyboard; picking the digit a cell holds clears it. Notes mode (or Shift with a digit) pencils in candidates, and placing a digit removes it from the notes around it. Repeats in a row, column or box are hatched and shake; no checking against the answer, so mistakes are found by the rules, not revealed. Undo (this visit only), and hints that fill the selected cell or the one with fewest candidates and lock it; best times only count games without hints. Deep teal lines over cream and mint boxes with a marigold selection; givens are bold, hinted digits underlined. Digits pop in, givens ripple out on a new game, a finished row, column or box glows in a wave, a solved board cheers with confetti; all off under reduced motion. Same app layout as mines on narrow screens: counters on top, the board, then tools, a row of nine digits, and New game / Options. Saves the game in progress (including notes), plus solved count and best time per difficulty.

## Core principles

1. **No data is sent anywhere.** Zero external requests: no CDNs, no remote fonts, no analytics, no telemetry. System fonts and self-hosted assets only.
2. **All data is stored locally** in the visitor's browser.
3. **Everything can be exported, imported and reset**, across all tools at once.
4. **Open about AI.** The site states clearly that it was made with AI and that it never shares data.
5. **Every page links to its source code** on GitHub.
6. **Mobile and desktop are both first-class.** Every page has a deliberate mobile layout and desktop layout, not just a stacked fallback. Smooth and responsive.
7. **Accessible:** WCAG 2.2 AA, full keyboard and screen reader support.

## Architecture

- **One site, one origin.** Required so one export/import/reset covers every tool (browser storage is per origin).
- **Plain HTML/CSS/JS, no build step.** The source in the repo is exactly what runs, so code links show real, readable code. ES modules for sharing code between pages.
- **Each tool is its own page** in its own folder.
- **Offline via service worker.** The hub and shared files are cached on first visit; each tool page is cached when first opened. The site is installable (web app manifest).
- **Hosting: GitHub Pages** at `harcur.github.io/sloppify/` (no custom domain). Code hosted on **GitHub**.
- **Deployment:** after all checks pass on `main`, GitHub Actions collects only the site files (dev tooling, tests and docs never ship) and publishes them both ways, so either Pages setting works: it pushes them to the `gh-pages` branch and asks GitHub to build it (for "Deploy from a branch", `gh-pages`, `/ (root)`), and it deploys them directly (for "GitHub Actions"). Pushes made by the workflow's own token don't start a branch build by themselves, hence the explicit build request.
- **All internal links and asset paths are relative**, so the site works both at a project subpath (`user.github.io/sloppify/`) and on a custom domain.
- **Content Security Policy via `<meta>` tag** on every page (`default-src 'self'`), since GitHub Pages can't set custom headers. This makes the browser itself block any external request, enforcing the zero-requests rule.

### Repo layout

```
/
├── index.html, hub.js, hub.css   Hub page
├── hub-order.js                  Hub ordering logic (pure, unit tested)
├── tools.json                    Tool list for the hub, generated
├── sw.js                         Service worker
├── manifest.webmanifest, icon.svg
├── shared/
│   ├── config.js                 Repo URL, branch, language
│   ├── page.js                   Page shell: header, menu, footer, notice, recents, favourites
│   ├── storage.js                Namespaced storage, migrations, export/import/reset
│   ├── backup.js                 Export download
│   ├── dialog.js                 Accessible modal dialogs
│   ├── toast.js                  Status messages
│   ├── strings.js, i18n.js       Shared strings and lookup
│   ├── dom.js, icons.js          DOM helper and inline icons
│   ├── theme-boot.js             Applies the saved theme before first paint
│   └── base.css                  Tokens and shared components
├── tools/<id>/                   One folder per tool: tool.json, index.html, app.js, strings.js, style.css, README.md
├── tools/categories.json         Hub categories
├── scripts/tools-index.mjs       Generates tools.json from every tool.json (dev only)
├── tools/_template/              Starting point for new tools (not deployed)
├── tests/unit/, tests/e2e/       Dev only, never deployed
├── .github/workflows/ci.yml      Tests, license check, deploy
├── LICENSE, LICENSES/, REUSE.toml
└── docs/DECISIONS.md
```

### Offline caching

- On install, the service worker caches only the hub and the shared files. Each tool page is cached the first time it's opened, so nothing is loaded up front no matter how many tools exist.
- Network first, falling back to the cache when offline or when the network takes over 3 seconds. This is what makes updates silent.
- An unvisited page opened offline shows a short explanation.

### Data migrations

- Each tool declares a schema version and a `migrate` function when it opens its store. Migration runs on the tool's own page, so the hub never loads tool code, and an imported backup is upgraded the next time each tool is opened.
- If migration fails, or the data is from a newer version, the tool's data is left untouched and the page offers to export it and reset that tool. This is the only case where users see an update notice.

## Tool manifest

Each tool describes itself in `tools/<id>/tool.json` (name, description, category, tags, license); the folder name is its id and path. Categories live in `tools/categories.json`. GitHub Pages can't list folders, so the hub can't discover tools at runtime: `scripts/tools-index.mjs` (`npm run tools`) generates `tools.json` from the per-tool files. CI fails if the committed file is out of date or a config is invalid, and the deploy regenerates it before publishing. Folders starting with `_` are skipped.

`tools.json` lists every tool with: id, name, description, tags, category, license, path. It is used by:

- the hub, to render cards and power search
- the service worker, to know what can be cached
- code links, to build each tool's GitHub folder URL

Designed so advanced search (filters, fuzzy matching, sorting) can be added later without restructuring.

## Hub page

- **Card grid with simple text search** for now (matches name, description, tags).
- Search placeholder: "Find a tool or game".
- More advanced search will be added as the number of tools grows.
- **Favourites and recents only change the order of the cards.** One grid, split by thin labeled separators (a mono label followed by a 1px line): `favourites` (ordered by most recent use), `recent` (last 4 used that aren't favourites), `everything else` (alphabetical). Separators only appear when there's more than one group; a first-time visitor sees one plain grid.
- **Searching** replaces the groups with one flat list of matches.
- **Favouriting:** an outline star button on each hub card (filled when active, labeled e.g. "Add sudoku to favourites"), plus a favourite option in the menu on each tool page.
- **Recents** are recorded by the shared page script whenever a tool page opens.
- **Remembers between visits:** the search text and scroll position, stored under `sloppify:hub:*` and included in export/reset like everything else.
- Each card shows its category as a colored top edge **and** a written label, so color is never the only signal.
- **Mobile:** single header row, search below it, two-column card grid (one column on very narrow screens).
- **Desktop:** content centered with a max width (~1100px), header and search pinned at the top while scrolling, grid adds columns as width allows (cards ~240px minimum). A category sidebar can be added later when there are enough tools to justify it. To be tested.

## Data storage

- Every key starts with a site prefix, `sloppify:`, then is namespaced per tool: `sloppify:sudoku:*`, `sloppify:interest-calculator:*`. Site-wide settings use `sloppify:hub:*` (theme, notice seen, etc.).
- Export, import and reset only ever touch keys with the `sloppify:` prefix. This matters on GitHub Pages, where all of an account's project sites share one origin and therefore one storage space.
- All storage access goes through `shared/storage.js`, never directly from tools. If a tool needs IndexedDB for larger data, the shared layer must still include it in export, import and reset.

### Export format

One JSON file for the whole site:

```json
{
  "format": "sloppify-backup",
  "formatVersion": 1,
  "exportedAt": "2026-10-01T12:00:00Z",
  "tools": {
    "hub":    { "schemaVersion": 1, "data": { } },
    "sudoku": { "schemaVersion": 1, "data": { } }
  }
}
```

Each tool owns its schema version and provides migrations so older backups can be imported.

### Import

- **Replaces all existing data.**
- Always shows a confirmation first, with a one-tap option to export current data before replacing.
- Validates the file before touching existing data; an invalid file changes nothing.

### Reset

- Clears all site data after confirmation, with the same "export first" option.
- A full reset also clears the "notice seen" flag, so the first-visit notice shows again.

## Data menu

- A small menu on **every page** containing: back to hub and add/remove favourite (tool pages only), theme toggle (system / light / dark), Export, Import and Reset everything.
- Implemented once in `shared/page.js` so all pages behave identically.
- **App pages** (games, `initPage({ app: true })`): on narrow screens the header shrinks to the menu button alone, floating top right, so the game can fill the screen. The footer is hidden there and its text and source link move into the game's own options sheet.

## AI and privacy disclosure

Tone: personal, plain and honest, in the developer's own voice. No marketing phrasing (e.g. avoid "Made with AI").

- **First-visit notice**, shown as a **modal dialog that must be dismissed** (native `<dialog>` with `showModal()`, focus moved into it and returned afterward, closable with its button or Escape; both count as dismissed). Remembered locally:

  > Not hand-coded at all, just generated with AI by a dev with no greed behind it. No ads, no tracking, and no server, so I couldn't collect your data even if I wanted to. Everything here is free to copy.

- **Footer on every page**:

  > AI-generated, no greed involved. No ads, no tracking, your data stays in this browser.

  Followed by the page's license and a source link with the GitHub icon (official `mark-github` from GitHub's Octicons, MIT, vendored as inline SVG; a generic code icon is used until then).

## Updates

- **Mostly silent.** New versions install in the background and apply on the next visit.
- A notice is shown **only** when an update is incompatible with the visitor's stored data and cannot be migrated automatically. The notice offers an export before continuing.
- Breaking data changes should be avoided; migrations are the default.

## Testing

The site itself has no build step and no dependencies. Test tooling is dev-only and runs in CI; none of it is deployed.

- **Unit tests** for shared code (storage, export/import/reset, migrations, i18n) with Node's built-in test runner (`node:test`), no extra dependencies.
- **Browser tests** with Playwright on mobile and desktop viewports, in Chromium, Firefox and WebKit.
- **Accessibility checks** with axe-core on every page, in light and dark mode. Any WCAG AA violation fails the build.
- **No-external-requests check:** browser tests fail if any page makes a request outside the site's origin.
- **License check:** REUSE lint.
- Every new tool must come with tests.

## What tools belong

`docs/TOOL-GUIDELINES.md` collects every rule a tool follows, from this file and elsewhere, into one guide with a checklist. Decisions it adds: self-contained with nothing that goes stale (no live data such as exchange rates or weather), a common everyday use, low stakes, no trademarks or one-to-one copies of existing games or apps, and per-page size budgets enforced by `tests/unit/budget.test.js`.

## Contributions

Open to contributions, with guidelines in `CONTRIBUTING.md`. A new tool must:

- live in its own folder with a `tool.json` describing it (the hub list is generated from it)
- use the shared storage, menu, notice, theme and i18n code
- keep all visible text in its strings file
- make no external requests
- have designed mobile and desktop layouts
- meet WCAG 2.2 AA
- carry SPDX license headers
- include tests and pass CI

## Licensing

- Project license: **MIT**.
- A tool may use a different license (e.g. GPL) when it depends on a copyleft library. Such tools are self-contained in their own folder with their own `LICENSE` file and vendored library.
- Shared code is MIT, which is GPL-compatible, so copyleft tools can use it.
- Follow the **REUSE** convention (reuse.software): SPDX headers on every file, checked automatically.
- Each page's footer shows its license.

## Code links

- Each page links to **its folder** in the GitHub repo.
- Built from one base repo URL in `shared/config.js` plus the tool's path, so renaming the repo is a one-line change. Placeholder until the repo exists.

## Languages

- **English only for now, structured for translation.** Every visible string lives in a strings file keyed by language. Adding a language means adding strings, not changing page code.

## Visual design

- **Theme:** follows the system light/dark setting, with a manual toggle (stored in `hub:*`).
- **Style:** minimal and plain, with a distinct identity.
- **Shape:** sharp corners (no border radius), thin 1px lines, no shadows.
- **Typography (system fonts only):** monospace for headings (`ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`), sans-serif for text (`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`). Headings will vary slightly by OS; accepted as the cost of zero font downloads.
- **Color by zone:**
  - Shared chrome (header, data menu, footer): neutral grays only, identical on every page.
  - Hub: neutral, with one hue per category for wayfinding (tools = blue, games = orange).
  - Tools: monochrome; color only carries meaning (focus, errors, chart series, main result).
  - Games: colourful and good-looking rather than utilitarian, with their own palette, textures and short vector animations (CSS and SVG only) inside the play area; chrome around it stays neutral. Details in `docs/TOOL-GUIDELINES.md` 4.6.
- **Starting palette** (all text ≥ 4.5:1, UI edges ≥ 3:1):

  | Token | Light | Dark |
  |---|---|---|
  | Background | `#F6F6F4` | `#111111` |
  | Surface | `#FFFFFF` | `#1A1A1A` |
  | Text | `#161616` | `#ECECEC` |
  | Muted text | `#5A5A5A` | `#A3A3A3` |
  | Line | `#CFCFCB` | `#343434` |
  | Tools accent | `#2F5D8A` | `#82AEDB` |
  | Games accent | `#B34A24` | `#EE8A62` |

- Every page has a designed mobile variant and desktop variant.

## Open questions

- GitHub repo URL (placeholder in `shared/config.js`)
- PNG app icons for iOS and older Android
- How contributions fit with the "not hand-coded" disclosure (deferred)
- Design language for tools and games (after the hub)
