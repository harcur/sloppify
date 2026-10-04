# Tool guidelines

Everything a tool or game on sloppify has to follow: what belongs on the site, how heavy it may be, how it's built, how it looks, and how it's tested. It collects the decisions in `docs/DECISIONS.md` that apply to tools into one place. If the two ever disagree, `DECISIONS.md` wins and this file gets fixed.

The site in one line: small tools and games that run entirely in the browser, with no ads, no tracking and no server. Every visitor's data stays in their own browser and can be exported, imported and reset at any time. It's openly AI-generated, and every page links to its own source.

---

## Part 1: What belongs

### 1.1 Self-contained

A tool must work fully the day it ships and keep working unchanged for years, offline, with nothing but the files in its folder and `shared/`.

- **No outside information.** Nothing that needs data from a server, now or later: no APIs, no feeds, no scraping, no "check for latest". The page's Content Security Policy blocks these anyway.
- **No information that goes stale.** If the tool would be wrong next year without someone updating it, it doesn't belong here. The test: *could this page sit untouched for five years and still be correct?*
- **The user supplies anything that changes.** An interest calculator is fine because the user types the rate. A mortgage calculator with a built-in "current rate" is not.
- **Fixed facts are fine.** Mathematics, physical constants, unit definitions (an inch is exactly 25.4 mm), game rules, and calendar and time zone data the browser itself provides through `Intl`.

| Good fit | Bad fit (and why) |
|---|---|
| Sudoku, chess, checkers, solitaire, word and logic puzzles | Currency converter (rates change daily) |
| Interest, loan and savings calculators with user-entered rates | Weather, news, stock prices (live data) |
| Unit converter (length, weight, temperature, cooking) | Tax or benefit calculators (rules change yearly) |
| Timers, stopwatch, pomodoro, metronome | Sports fixtures, TV listings, public holidays by country |
| Password and passphrase generator, dice, random picker | Anything that looks up a product, place or person |
| Text tools: word count, case converter, diff, JSON formatter | Translation (needs large changing models or a service) |
| Colour picker and contrast checker, QR code generator | Medication dosage or structural load calculators (see 1.3) |

### 1.2 A good use case

Each tool should be something people commonly reach for, and better here than the usual alternative: no ads, no sign-up, instant, private and offline.

- **Common and quick.** Useful to many people in a few seconds or minutes. Niche professional tools are a poor fit.
- **Privacy is a real benefit.** Tools where people would rather not paste their data into a random website (text, passwords, finances, notes) are a strong fit.
- **Local storage adds value.** Saved games, history, presets or settings that persist and travel with export and import.
- **One tool per job.** Before adding a tool, check whether an existing one could grow a mode instead (one unit converter, not one per unit type).
- **Finishable.** Small enough to build, test and get right. A complete simple tool beats an ambitious half-working one.

### 1.3 Low stakes

The site is AI-generated and says so. Don't build tools where a wrong answer could hurt someone: medical dosing, structural or electrical safety, legal deadlines, anything presented as financial advice. Calculators show their formula or method so results can be checked.

### 1.4 Trademarks and copyright

Game rules and mechanics are generally free to use; names, artwork, text, level designs and the look of a specific product are not.

- **No trademarks** in names, descriptions, tags, strings or code identifiers. Use a plain descriptive name instead: "word guess", "falling blocks", "mines", "property trading game", never the brand.
- **Traditional and public-domain games are fine** under their common names: chess, checkers/draughts, go, backgammon, mancala, dominoes, solitaire variants, nonograms, crosswords. If a common name is also someone's registered mark somewhere, prefer a fully generic name or record the decision in `docs/DECISIONS.md`.
- **No one-to-one copies.** Don't recreate a specific commercial game or app: its exact rule set and scoring, layout, colours, icons, sounds, puzzle sets, level layouts or wording. Make our own take, in the site's design language, with our own text and our own generated or original content.
- **Content needs a licence.** Word lists, puzzle sets, sounds and images must be our own or under a licence compatible with the tool (MIT, CC0, public domain, or the tool's own copyleft licence), marked with SPDX headers or in `REUSE.toml`. Puzzles should preferably be generated in the browser, not shipped.
- **When unsure, don't.** Pick the generic name or design, and raise the question in the pull request.

---

## Part 2: Lightweight and fast

Every byte is downloaded by every visitor of a page, counts against eventual hosting, and has to be parsed on slow phones.

### 2.1 Budgets

Sizes are uncompressed bytes on disk. `README.md` and `LICENSE` files don't count. Enforced by `tests/unit/budget.test.js`.

| What | Budget | Now |
|---|---|---|
| A tool's own files (everything in `tools/<id>/` except `data/`) | 1 MB | largest about 126 KB (sign document) |
| A tool's `data/` folder (word lists, opening books, etc.) | 200 KB | none yet |
| Shared files (`shared/`) | 50 KB | about 33 KB |
| Hub (`index.html`, `hub*.js`, `hub.css`, `tools.json`) | 20 KB | about 11 KB |
| Any single image | 20 KB | none yet |

**The 1 MB tool budget is a ceiling, not a target. Don't waste it.** It's there so a tool that genuinely needs real code (a PDF reader, a chess engine) doesn't need an exception, not so ordinary tools can grow. Every byte still costs every visitor download time, parsing on slow phones and hosting. Most tools should stay well under 100 KB. Before adding weight, check whether the feature earns it, whether the code can be smaller, and whether the heavy part can load only when it's used (a worker, `data/`, a module imported on demand). Mention the tool's size in its pull request when it passes 100 KB.

A tool that genuinely needs more than 1 MB adds an exception to the test with a one-line reason and records it in `docs/DECISIONS.md`.

### 2.2 Staying inside them

- **No build step and no runtime dependencies.** Plain HTML, CSS and ES modules; the files in the repo are exactly what runs. No frameworks, and libraries only when the tool can't exist without one.
- **No fonts at all.** System fonts only (see 4.3).
- **Draw with CSS and inline SVG**, not images. No raster images for UI, no icon fonts. Sounds, if any, are short and optional.
- **Animate with CSS and SVG.** Keyframes, transitions and small generated effects (such as confetti made of a few dozen elements) cost almost nothing. No video, GIFs, sprite sheets or animation libraries.
- **Load data only when needed.** Large data lives in `data/` and is fetched from the same origin when the feature that uses it is first opened, not on page load.
- **Generate instead of ship.** Generate puzzles, boards and random content in code rather than shipping big tables.
- **Don't grow `shared/` for one tool.** Code moves into `shared/` only when at least two tools use it.
- **Pages load on their own.** The hub only reads `tools.json` and never loads tool code, and the service worker caches a tool only when it's first opened. Keep it that way: nothing a tool adds may load on the hub or on other tools' pages.

### 2.3 Responsiveness

- Every tap or key press gets visible feedback within 100 ms.
- Work that can take longer than about 50 ms (solvers, chess search, large text processing) runs in a Web Worker (allowed by the CSP as `worker-src 'self'`) so the page never freezes.
- No timers or animation loops running while nothing is changing; pause when the tab is hidden.
- Animations are short, mostly use `transform`, `opacity` and `filter`, and are turned off under `prefers-reduced-motion`. They play in response to something happening (a move, a win), not on an endless loop.

---

## Part 3: How a tool is built

### 3.1 Folder and manifest

- One folder per tool: `tools/<id>/` with `index.html`, `app.js`, `strings.js`, `style.css` and `README.md`. Start by copying `tools/_template/` and following its README.
- The id is lowercase letters, digits and dashes. It's used for the folder, the storage namespace, string keys and `tools.json`.
- Every tool describes itself in its own `tool.json`: `name` and `description` (both keyed by language), `category` (one of those in `tools/categories.json`), `tags` and `license`. The folder name is the id and the path.
- The hub's list, `tools.json`, is generated from those files by `npm run tools` (`scripts/tools-index.mjs`); never edit it by hand. A static site can't list its own folders, so the list is built ahead of time: the tests fail if it's out of date or a config is invalid, and the deploy regenerates it before publishing. Folders starting with `_` are skipped.
- Names are lowercase and plain ("interest calculator", "sudoku"). Descriptions are one short factual line.

### 3.2 The page shell

- `index.html` is copied from the template: the CSP meta tag, `referrer` and `color-scheme` meta tags, `shared/base.css`, the tool's `style.css`, `shared/theme-boot.js` (applies the saved theme before first paint), the module `app.js`, a `<noscript>` line, and an empty `<main id="main">`.
- `app.js` calls `initPage({ toolId, toolName, license, sourcePath, app: true })` from `shared/page.js` once. That adds the shared header, menu, footer, first-visit notice, theme, recents, favourites and offline caching, and returns `{ main }` to render into. Tools never build their own header, menu or footer.
- Use the shared helpers instead of writing new ones: `h()` from `shared/dom.js` for elements, `confirmDialog`, `messageDialog` and `customDialog` from `shared/dialog.js` for modals, `toast()` from `shared/toast.js` for short status messages, `optionsSheet()` from `shared/sheet.js` for the phone options sheet, and `icon()` from `shared/icons.js`.
- All paths are relative (`../../shared/...`), so the site works under `/sloppify/` and on any other path or domain.

### 3.3 No requests, ever

- Every page has the CSP meta tag (`default-src 'self'`). Never loosen it.
- No CDNs, remote fonts, analytics, telemetry or APIs.
- No inline scripts, no inline event handlers and no `style` attributes; the CSP blocks them. Set styles through classes, or through `element.style` from JavaScript when a value is computed.
- Browser tests fail if any page makes a request outside the site.

### 3.4 Strings

- Every visible string goes in the tool's `strings.js`, keyed by language (`en` for now) and prefixed with the tool id (`sudoku.newGame`). This includes button labels, `aria-label`s, error messages and toasts.
- Register them with `extendStrings(strings)` and read them with `t(key, vars)` from `shared/i18n.js`. Adding a language must only mean adding strings, never changing page code.
- Wording is plain and factual. No marketing language, no exclamation marks, no "Made with AI"-style phrasing.

### 3.5 Saving data

- All storage goes through `openStore(id, { version, migrate })` from `shared/storage.js`. Never use `localStorage`, `sessionStorage` or IndexedDB directly. Keys become `sloppify:<tool-id>:<key>`; nothing ever touches keys without the `sloppify:` prefix.
- The store's API: `get(key, fallback)`, `set(key, value)` (returns `false` when storage is full or blocked), `remove(key)`, `keys()`, `getAll()` and `clear()`. Values are anything JSON can hold.
- Whatever a tool saves is automatically included in the site-wide export, import and reset. A tool doesn't add its own.
- **Migrations, not breaking changes.** Each store has a schema `version`. When the shape of saved data changes, bump the version and handle the old shape in `migrate(data, fromVersion, toVersion)`. It runs on the tool's own page, so an imported old backup is upgraded the next time the tool opens.
- After opening a store, call `await guardStore(store, name)` from `shared/page.js`. If the data can't be migrated, or comes from a newer version, it's left untouched and the visitor is offered an export and a reset of that tool. This is the only update notice anyone ever sees; updates are otherwise silent.
- Tools must still work when storage is unavailable (private browsing, blocked storage): they just don't remember anything.
- If a tool ever needs IndexedDB for larger data, it has to go through the shared layer so export, import and reset still cover it.

### 3.6 Licensing

- The project is MIT. A tool may use another licence (for example GPL) only when it depends on a copyleft library; it then vendors that library inside its own folder with its own `LICENSE`, and sets `license` in `tool.json` and in `initPage`. Shared code is MIT, so it's usable from copyleft tools.
- Every file carries SPDX headers (`SPDX-FileCopyrightText` and `SPDX-License-Identifier`), following REUSE. Files that can't hold a comment are covered in `REUSE.toml`. CI runs REUSE lint.
- Each page's footer shows its licence and links to its folder on GitHub; `initPage` does this from `license` and `sourcePath`.

---

## Part 4: Design

### 4.1 Layouts

- Every tool has a **designed mobile layout and a designed desktop layout**, not a stacked fallback. Think about thumb reach and on-screen keyboards on mobile, and use the width on desktop (side panels, larger boards) without stretching text lines.
- **On phones every tool and game feels like an app**, not a web page. Pass `app: true` to `initPage`: on narrow screens (under 720px) the site header shrinks to a floating menu button and the footer is hidden. The page then fills the viewport (`100dvh`, safe-area padding, no page scroll) with a fixed structure:
  - **top:** the current state in one or two short lines (phase, counters, score), with room on the right for the menu button;
  - **middle:** the main thing (board, result, timer), sized to the space that's left;
  - **bottom, within thumb reach:** the primary action as a full-width button, with secondary actions in one row under it, and an options button last.
  - Everything else (settings, help, records) goes in the **options sheet** from `shared/sheet.js` (`optionsSheet({ title, sourcePath, returnFocus })`). It slides up from the bottom and ends with the footer's AI note and source link, which the page hides on phones. On desktop the same content sits next to the main area instead; move it between the two with a `matchMedia('(max-width: 719px)')` listener.
  - Content that genuinely needs room (a long text, a big board) scrolls inside its own area, never the page.
- Content sits in `.wrap` (centred, max width 1100px, safe-area padding). The shared header is pinned at the top.
- Smooth and responsive on both; see 2.3.

### 4.2 Shape

- Sharp corners (no border radius), 1px lines, no shadows.
- Minimal and plain, with a distinct identity.

### 4.3 Typography

- Headings in the system monospace stack (`var(--mono)`), text in the system sans stack (`var(--sans)`). Headings vary slightly by OS; that's the accepted cost of downloading no fonts.

### 4.4 Colour

Use the tokens from `shared/base.css`, never raw colours for chrome or text: `--bg`, `--surface`, `--text`, `--muted`, `--line`, `--tool`, `--game`, `--party`, `--danger`. They switch automatically between light and dark.

| Token | Light | Dark |
|---|---|---|
| `--bg` | `#F6F6F4` | `#111111` |
| `--surface` | `#FFFFFF` | `#1A1A1A` |
| `--text` | `#161616` | `#ECECEC` |
| `--muted` | `#5A5A5A` | `#A3A3A3` |
| `--line` | `#CFCFCB` | `#343434` |
| `--tool` | `#2F5D8A` | `#82AEDB` |
| `--game` | `#B34A24` | `#EE8A62` |
| `--party` | `#8E3A9E` | `#DDA2EC` |
| `--danger` | `#A32D2D` | `#F09595` |

Colour by zone:

- **Shared chrome** (header, menu, footer): neutral greys only, identical on every page.
- **Tools:** monochrome. Colour only carries meaning: focus, errors, chart series, the main result.
- **Games:** colourful and good-looking, not utilitarian. Inside the play area a game has its own palette, textures and character; the chrome around it (header, menu, footer) stays neutral. See 4.6.
- **Party:** made for a group around one screen. Everything games may do, turned up a little for people watching from across a table. See 4.7.
- Colour is never the only signal. Pair it with text, shape or pattern.

### 4.5 Theme

- Pages follow the system light or dark setting, with a manual override in the menu. Every colour a tool adds needs a light and a dark value, defined the same way `base.css` does (`prefers-color-scheme` plus `[data-theme]`).

### 4.6 Games

How-to notes from the existing games (board accessibility, sizing, the narrow-screen layout, palette checks, animation, saving, tests) are in `.claude/skills/game-development/SKILL.md`.

Games should be fun to look at and satisfying to play. Tools stay calm; games get to show off.

- **Colour:** a bold palette of the game's own, in both light and dark. Not the site's greys, and not a copy of a known product's look (see 1.4).
- **Texture and character:** pieces, tiles and boards can use gradients, patterns, highlights and playful vector shapes. The site's sharp corners and 1px lines still apply to the page around the game, and should feel at home inside it too.
- **Motion that rewards play:** pieces that pop in, ripple outwards, settle or shake; a celebration on a win. Animations follow the action, last well under a second (a win celebration can run a little longer), and never block input.
- **Full screen on phones:** like every page (4.1): counters at the top, the board in the middle, main buttons at the bottom, everything else in the options sheet. Boards that can't fit at a 32px cell size scroll inside their area rather than shrinking below the touch target size.
- **Vectors only:** CSS and inline SVG, within the size budget (Part 2). No images, video or animation libraries.
- **Still accessible:** contrast rules apply to the game's own colours too (4.5:1 for text such as numbers, 3:1 between states that need telling apart and for pieces against their background), colour is never the only signal, and everything decorative is hidden from screen readers. Under `prefers-reduced-motion` the game is fully playable with all animation off.

### 4.7 Party

The `party` category is for things a group uses together on one screen: picking who goes first, splitting teams. It follows every rule in 4.6, plus:

- **Readable from across a table:** the result in very large type, and one big main button within thumb reach.
- **Suspense is the point:** a reveal (a spin, a countdown) may run a few seconds, but it's decided before it starts, never blocks the rest of the page, and can be skipped. Under `prefers-reduced-motion` the result shows at once.
- **Extras stay optional:** vibration where the browser supports it, and nothing that makes sound unless the visitor turns it on.

The base doesn't change: neutral chrome, sharp corners, 1px lines, system fonts, the tokens and the accessibility rules all still apply. Tools never take on this style; they stay utilitarian.

---

## Part 5: Accessibility

WCAG 2.2 AA on every page, checked automatically and by hand.

- **Keyboard:** everything works without a mouse, in a logical order, with a visible focus outline (the shared `:focus-visible` style). Game boards support arrow keys. No keyboard traps; Escape closes things.
- **Screen readers:** real buttons and inputs, labels on every control, headings in order (one `h1` per page). Changing results and game state are announced through a live region, without flooding it.
- **Contrast:** text at least 4.5:1, UI edges and focus indicators at least 3:1, in both light and dark.
- **Targets:** touch targets at least 24×24 CSS pixels, ideally 44×44 on mobile.
- **Motion:** respect `prefers-reduced-motion`: turn animations off, not just shorter. Nothing flashes more than three times a second.
- **Dialogs:** use the shared dialogs, which move focus in and return it afterwards.

---

## Part 6: Tests

Every tool comes with tests. Publishing doesn't wait for them (see `docs/DECISIONS.md`), so run them locally before merging, and fix any failure CI reports on `main` straight away. Test tooling is dev-only and never deployed.

- **Unit tests** (`tests/unit/<id>.test.js`, Node's built-in `node:test`) for the tool's logic: calculations, solvers, generators, rules and migrations. Keep that logic in plain modules without DOM access so it can be tested directly.
- **Browser tests** (`tests/e2e/<id>.spec.js`, Playwright) for the main flows, on mobile and desktop in Chromium, Firefox and WebKit. Use the helpers in `tests/e2e/helpers.js`: track external requests (must stay empty), skip the first-visit notice, and run `expectAccessible` with axe-core in both light and dark mode, including any dialogs and game states. The accessibility checks run in Chromium only (desktop and mobile); the other browsers run the same tests without them.
- **The spec's file name ties it to its tool.** `npm run test:changed` runs only the browser tests for the folders a change touches (`scripts/affected-tests.mjs`): a change in `tools/<id>/` runs `tests/e2e/<id>.spec.js`, hub files run `hub.spec.js`, and anything shared (`shared/`, `sw.js`, test helpers, config, CI) runs everything. So a tool's browser tests go in `tests/e2e/<id>.spec.js` and test only that tool. CI runs every browser test on `main`, alongside the deploy.
- **Size budgets** are checked automatically (2.1).
- **Licences** are checked by REUSE lint.

---

## Part 7: Checklist

### Proposing a tool

Answer these in the pull request or issue before building:

1. What does it do, in one sentence, and who reaches for it?
2. Could it sit untouched for five years and still be correct?
3. Does any name, text, art or rule set copy a specific product?
4. What does it save locally, if anything?
5. Roughly how big will it be, and does anything need `data/` or a Worker?

### Before merging

- [ ] Fits Part 1: self-contained, a common use, low stakes, no trademarks or copies
- [ ] Within its size budget and no bigger than it needs to be (size noted in the PR if over 100 KB); heavy work in a Worker
- [ ] Started from the template, `tool.json` filled in, `npm run tools` run, uses `initPage` and the shared helpers
- [ ] No external requests; CSP untouched; no inline scripts or styles; all paths relative
- [ ] Every visible string in `strings.js`
- [ ] Storage only through `openStore`, with `migrate` and `guardStore`
- [ ] Designed mobile and desktop layouts; on phones an app layout (`app: true`, state on top, main thing in the middle, actions at the bottom, the rest in the options sheet); tokens only; colour by zone; light and dark
- [ ] WCAG 2.2 AA: keyboard, screen reader, contrast, reduced motion
- [ ] SPDX headers on every file; licence set correctly
- [ ] Unit and browser tests, passing locally (`npm run test:unit`, `npm run test:changed`)
