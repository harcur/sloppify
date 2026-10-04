# Project Decisions

Living record of decisions for **sloppify**, a local-first hub of tools and games. Update this file whenever a decision changes. Status: **hub built (first version)**. Tool and game design language comes next.

The name is deliberate: the site is openly AI-generated and says so up front.

## Purpose

A collection of web pages with utilities, games and similar tools people commonly use. Open source, no data ever leaves the browser, nothing is being sold. Plain, factual wording throughout; no marketing language.

Starter tools: **Sudoku** and **Interest rate calculator**.

Tools:

- **sign document** (`tools/sign-document/`): open a PDF or a picture of a document (PNG, JPEG, WebP), place a saved signature, draw with a pen, add text, or add a date, and save a signed copy. Dates start as today and are written the way the browser's own language and region write them (through `Intl`, not the site's language setting), in long, medium, short or ISO style; the date and style can be changed, and the style is remembered. Text and Date add where the page is tapped, or, from the keyboard, in the middle of the page in view. Signatures are made by drawing, by typing a name (shown in the device's handwriting-style font) or from a photo of a signature on paper (the paper is made transparent and the strokes take the ink colour); up to six are saved locally as small PNGs, in black or blue ink. Documents are never stored. Items are moved by dragging or with the arrow keys and resized with the corner square, buttons or plus and minus; undo covers every change. On phones it's an app screen (`initPage({ app: true })`): the file name and page count on top, the pages scrolling in the middle, Save (or Open) as the full-width button at the bottom with the tools in a row under it, and the document's details, Save as PDF, Open another and Close document in the options sheet; signatures and the selected item open above the tools. It says plainly that it adds a picture of a signature, not a certified digital signature.
  - **No PDF library.** pdf.js is over 1 MB, so the tool has its own small reader, preview renderer and writer, run in a Web Worker that only loads when a PDF is opened. The preview approximates text with similar system fonts and skips shadings, patterns and JPEG 2000, CCITT and JBIG2 images, saying so on the page; the saved file always keeps the original content.
  - **Saving** adds everything placed on a page as one transparent image, appended as an incremental update, so the original bytes are untouched (a cross-reference stream is written when the file uses one). Damaged files without a usable cross-reference table are written out again in full. Encrypted PDFs are refused. Pictures are saved as PNG or JPEG (matching the original), or as a one-page PDF.
  - **Size budget exception:** 110 KB instead of 100 KB, for the PDF code. The page itself is about 50 KB; the PDF half (about 50 KB) loads only in the worker.

Games:

- **mines** (`tools/mines/`): the classic hidden-mines grid game under a generic name, since the familiar name is a trademark. Three board sizes (9×9/10, 16×16/40, 16×30/99), plus a mine density slider per size from 8% to 30% of the cells (default the size's own count); a change applies at once before the first move, otherwise from the next game, and records are kept per size and mine count (the default count keeps the plain size key, so older records still count). First move always opens an area, flags by right-click, long-press, flag mode or the F key, opening a number with all its flags placed opens its neighbours. Violet gem-like tiles over a warm cream field (deep plum in dark mode), gold flags, its own mine icon. Openings ripple outwards from the cell played, flags drop in and wave, a loss shakes the board and rings the mine that went off, a win sends a wave across the board plus confetti; all CSS and SVG, all off under reduced motion. On narrow screens it fills the screen like an app (`initPage({ app: true })`): counters on top, the board in the middle, Flag mode / New game / Options at the bottom, and an options sheet with board size, record, help and the footer's text and source link; the site menu stays as a floating button. A wide board is shown turned on its side. Saves the game in progress, the chosen mine count per size, plus wins and best time per size and mine count.
- **sudoku** (`tools/sudoku/`): the 9 × 9 number puzzle. Kept under the name "sudoku": it is the common generic name for the puzzle almost everywhere, and the registered mark is a Japanese one for publications; we use the word only as the puzzle's name, with our own puzzles, design and text. Puzzles are generated in the browser in a Web Worker (`worker.js`, falling back to the main thread if a module worker can't start): a random full grid thinned in symmetric pairs while it keeps exactly one solution. Easy (at least 38 givens) and medium (at least 30) must be solvable with naked and hidden singles alone; hard goes down to 22 givens and retries until it needs more than singles. Pick a cell, then a digit from the pad or keyboard; picking the digit a cell holds clears it. Notes mode (or Shift with a digit) pencils in candidates, and placing a digit removes it from the notes around it. Repeats in a row, column or box are hatched and shake; no checking against the answer, so mistakes are found by the rules, not revealed. Undo (this visit only), and hints that fill the selected cell or the one with fewest candidates and lock it; best times only count games without hints. A calm "garden notebook" look: warm paper cells, faint sage boxes, hairline cell lines with slightly heavier sage box lines, an apricot selection with a thin terracotta ring, ink digits; givens are bold, hinted digits dotted-underlined, repeats hatched. Each pad button shows nine pips that fill as that digit is placed. Motion is quiet and never blocks input: digits settle in like ink, givens fade in outwards on a new game, highlights glide, a repeat gives a small shiver, a finished row, column or box catches a soft wash of light, and a solved board ripples once with confetti; all off under reduced motion. Same app layout as mines on narrow screens: counters on top, the board, then tools, a row of nine digits, and New game / Options. Saves the game in progress (including notes), plus solved count and best time per difficulty.

Tools:

- **interest calculator** (`tools/interest-calculator/`): four situations behind one switch. **Loan** (amount, rate, time in years or months, equal payments or equal principal, optional extra monthly payment): monthly payment, total interest, a table of the payment at the rate ±2 points, and what the extra payment saves. **Savings** (starting amount, monthly deposit, rate, time, interest added daily/monthly/yearly or never for simple interest, optional inflation): end amount, interest earned, value in today's money. **Pay off debt** (balance, rate, monthly payment): time to clear it and the month it's done, a table of larger payments, and a clear message when the payment never covers the interest. **Find the rate** (amount, payment, time, fees at the start and per month): the real yearly cost (effective rate, fees included) and the nominal rate. Sizes are made easy to grasp: a to-scale bar of principal against interest with shares, large amounts also in words ("about 188 thousand"), an "in perspective" list of plain comparisons (pay back 1.75 for every 1, years of payments that go to interest, interest per day, doubling time), and a yearly stacked bar chart (an image with a written summary, plus a year-by-year table). Every situation shows its formula and a not-financial-advice line. Everything runs month by month in `logic.js` (unit tested); payments and deposits fall at the end of each month. Numbers are typed and shown in the browser's locale; the parser accepts `250 000`, `250,000`, `1.234,5`, `4,5`, `250k`. On phones the main result stays pinned under the header while it's scrolled out of view. Saves the chosen situation and what was typed in each, as typed.

Tools:

- **work and rest timer** (`tools/work-rest-timer/`): alternating work and rest intervals under a generic name, since the best-known name for the method is a trademark. Presets 25/5, 50/10, 90/20 or custom lengths, a long rest after a set number of rounds, optional auto-start. An SVG hourglass whose sand drains with the time (levels follow the square root of time left, like a real glass) and turns over when a phase ends; sand colour marks the phase (warm for work, cool for rest), always next to the written phase name. Sounds are generated with the Web Audio API, no audio files: three calm (chime, singing bowl, rising notes) and two harder to miss (beeps, alarm), chosen separately for the end of work and the end of a rest, each with its own volume slider; changing either plays the sound, so there are no play buttons (saved data schema 2 split the old single volume). Every alert can be switched on or off on its own, sound included (the sound choices are kept but greyed out while it's off). Alerts: a soft glow from the screen edges (2.4 s fade, low contrast, never a flash; a still tint under reduced motion), vibration, and a system notification when the page is in the background. On phones it fills the screen like an app: phase and round on top, the glass and time in the middle, Start/Pause full width at the bottom with Reset, Skip, Minimal and Settings under it; the settings live in the options sheet. A minimal view shows only the glass and one button, with no ticking numbers and no falling grains, since running motion can be distracting; the sand levels alone show time passing. The screen stays on while the timer runs (Screen Wake Lock API, switchable, on by default, hidden where unsupported). Saves settings, the timer (a running timer carries on after a reload), work sessions today and the minimal view.

Tools:

- **random numbers** (`tools/random-numbers/`): whole numbers in a range (From/To, typed; a backwards range is swapped), how many (1 to 100, stepper or typed), no repeats, sort. Up to four numbers show as large tiles in the tool colour, more as a numbered list that scrolls inside the result area, with their sum. A new pick flickers in grey for about half a second, then the numbers pop in and the result frame flashes, so a fresh pick is visible even when the number is the same; off under reduced motion. Copy puts the numbers on the clipboard. On phones Pick and Copy are pinned to the bottom of the screen. Uses `crypto.getRandomValues`. Saves the settings and the last 20 picks. No preset ranges (dropped after the mockup). Picking people or items from a list, dice, a wheel and similar will be separate tools rather than modes of this one.

Party:

- **pick a person** (`tools/pick-a-person/`, category `party`): five ways to pick from a group around one screen. **Bottle**: the phone lies in the middle of the group; tap, press Spin or flick the bottle, and it stops pointing at someone (with names, they sit around the edge in list order). **Fingers**: everyone holds a finger on the screen; read with touch events, which list every finger on the screen each time, so a missed lift can't leave a finger stuck; once they hold still a two-second countdown runs and the result shows under the fingers (one person, teams with a letter each, or an order); a lifted or added finger restarts it, and without a touch screen the players stand in a circle instead. **Wheel**: one segment per player, optionally taking each winner off for the next spin. **Straws**: one straw per player in a paper cup; the straws fan out from one point low in the cup like a hand of cards, thicker the fewer there are, and the cup is cut to fit the fan; a fan that stays on screen leaves 30 straws too thin to tap reliably, so **Draw for me** draws a random straw for whoever holds the phone (the same as tapping one, since nobody can tell them apart, and the large target the small ones lack); the phone goes round and each person taps one straw until someone pulls out the short one. No names or turns: whoever holds the phone drew it, and after a long straw the straws wait a moment so nobody taps twice. **Teams**: by number of teams or players per team, sizes differ by at most one, copyable. Players are a number (2–30) or a saved list of names; modes that need names fall back to numbers. Every result is picked with `crypto.getRandomValues` (rejection sampling, Fisher–Yates) before its animation starts, and every reveal can be skipped. Each mode has its own deep stage colour; players share ten bright colours with dark text, and teams also get a letter. Optional vibration, no sound. The finger mode is a well-known party mechanic with many independent apps; we don't use any app's name or copy its look (we use square gems and dashed rings on a striped stage, not glowing circles on black).

## Core principles

1. **No data is sent anywhere.** Zero external requests: no CDNs, no remote fonts, no analytics, no telemetry. System fonts and self-hosted assets only.
2. **All data is stored locally** in the visitor's browser.
3. **Everything can be exported, imported and reset**, across all tools at once.
4. **Open about AI.** The site states clearly that it was made with AI and that it never shares data.
5. **Every page links to its source code** on GitHub.
6. **Mobile and desktop are both first-class.** Every page has a deliberate mobile layout and desktop layout, not just a stacked fallback. On phones every tool and game feels like an app: it fills the screen, with its main actions at the bottom within thumb reach. Smooth and responsive.
7. **Accessible:** WCAG 2.2 AA, full keyboard and screen reader support.

## Architecture

- **One site, one origin.** Required so one export/import/reset covers every tool (browser storage is per origin).
- **Plain HTML/CSS/JS, no build step.** The source in the repo is exactly what runs, so code links show real, readable code. ES modules for sharing code between pages.
- **Each tool is its own page** in its own folder.
- **Offline via service worker.** The hub and shared files are cached on first visit; each tool page is cached when first opened. The site is installable (web app manifest).
- **Hosting: GitHub Pages** at `harcur.github.io/sloppify/` (no custom domain). Code hosted on **GitHub**.
- **Deployment:** on every push to `main`, right away and without waiting for any test (for quick iteration), GitHub Actions collects only the site files (dev tooling, tests and docs never ship) and publishes them both ways, so either Pages setting works: it pushes them to the `gh-pages` branch and asks GitHub to build it (for "Deploy from a branch", `gh-pages`, `/ (root)`), and it deploys them directly (for "GitHub Actions"). Pushes made by the workflow's own token don't start a branch build by themselves, hence the explicit build request.
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
│   ├── sheet.js                  Options sheet for app pages on phones
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
- **App pages** (every tool and game, `initPage({ app: true })`; only the hub is a plain page): on narrow screens the header shrinks to the menu button alone, floating top right, so the game can fill the screen. The footer is hidden there and its text and source link move into the page's options sheet (`shared/sheet.js`), which also holds the page's settings and help. Layout on phones: state on top, the main thing in the middle, the primary action full width at the bottom with secondary actions under it. Details in `docs/TOOL-GUIDELINES.md` 4.1.

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
- **Browser tests** with Playwright on mobile and desktop viewports, in Chromium, Firefox and WebKit. In CI each of the five browser setups is its own job, running in parallel and installing only its own browser.
- **Browser tests are deferred, for quick iteration.** Pull requests run only the unit tests and the licence check (seconds). Browser tests run in full on `main`, alongside the deploy, which doesn't wait for them; a failure shows on that commit and is fixed in the next change. They can also be run by hand (workflow_dispatch). Locally, `npm run test:changed` uses `scripts/affected-tests.mjs` to run only the specs a change touches: a tool's folder maps to `tests/e2e/<id>.spec.js`, hub files to the hub spec, docs to nothing, and anything shared or unknown to everything. A single `test` check sums up the unit tests and all browser jobs, so the check name stays stable.
- **Accessibility checks** with axe-core on every page, in light and dark mode, in Chromium (desktop and mobile) only: axe checks what the page says, not how an engine draws it, and it's the slowest step. Any WCAG AA violation fails the build.
- **No-external-requests check:** browser tests fail if any page makes a request outside the site's origin.
- **License check:** REUSE lint.
- Every new tool must come with tests.

## What tools belong

`docs/TOOL-GUIDELINES.md` collects every rule a tool follows, from this file and elsewhere, into one guide with a checklist. Decisions it adds: self-contained with nothing that goes stale (no live data such as exchange rates or weather), a common everyday use, low stakes, no trademarks or one-to-one copies of existing games or apps, and per-page size budgets enforced by `tests/unit/budget.test.js`. The per-tool budget started at 60 KB and was raised to 100 KB once tools grew richer (pick a person, a party tool with five modes, is about 75 KB): games and party tools carry their own art and animation, and 100 KB is still small for a page that loads once and is then cached.

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
  - Hub: neutral, with one hue per category for wayfinding (tools = blue, games = orange, party = magenta).
  - Tools: monochrome; color only carries meaning (focus, errors, chart series, main result).
  - Games: colourful and good-looking rather than utilitarian, with their own palette, textures and short vector animations (CSS and SVG only) inside the play area; chrome around it stays neutral. Details in `docs/TOOL-GUIDELINES.md` 4.6.
  - Party (things a group uses together on one screen): the game rules plus very large results, one big main button and reveals of a few seconds that can be skipped. A third category rather than tags or a mix of styles, to keep one category per tool. Tools always stay utilitarian. Details in `docs/TOOL-GUIDELINES.md` 4.7.
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
  | Party accent | `#8E3A9E` | `#DDA2EC` |

- Every page has a designed mobile variant and desktop variant. On phones, tools and games use the app layout (see Data menu, App pages).

## Open questions

- GitHub repo URL (placeholder in `shared/config.js`)
- PNG app icons for iOS and older Android
- How contributions fit with the "not hand-coded" disclosure (deferred)
- Design language for tools and games (after the hub)
