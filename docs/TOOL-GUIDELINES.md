# Tool guidelines

What belongs on sloppify, and the limits every tool and game is built within. Read this before proposing or building one. The technical rules (storage, strings, accessibility, licensing) are in `CONTRIBUTING.md` and `docs/DECISIONS.md`; this file covers *what* to build and *how heavy* it may be.

## 1. Self-contained

A tool must work fully the day it ships and keep working unchanged for years, offline, with nothing but the files in its folder and `shared/`.

- **No outside information.** Nothing that needs data from a server, now or later: no APIs, no feeds, no scraping, no "check for latest".
- **No information that goes stale.** If the tool would be wrong next year without someone updating it, it doesn't belong here. The test: *could this page sit untouched for five years and still be correct?*
- **The user supplies anything that changes.** An interest calculator is fine because the user types the rate. A mortgage calculator with a built-in "current rate" is not.
- **Fixed facts are fine.** Mathematics, physical constants, unit definitions (an inch is exactly 25.4 mm), game rules, calendars and time zone data the browser itself provides through `Intl`.

| Good fit | Bad fit (and why) |
|---|---|
| Sudoku, chess, checkers, solitaire, word and logic puzzles | Currency converter (rates change daily) |
| Interest, loan and savings calculators with user-entered rates | Weather, news, stock prices (live data) |
| Unit converter (length, weight, temperature, cooking) | Tax or benefit calculators (rules change yearly) |
| Timers, stopwatch, pomodoro, metronome | Sports fixtures, TV listings, public holidays by country |
| Password and passphrase generator, dice, random picker | Anything that "looks up" a product, place or person |
| Text tools: word count, case converter, diff, JSON formatter | Translation (needs large changing models or a service) |
| Colour picker and contrast checker, QR code generator | Medication dosage or structural load calculators (see §3) |

## 2. A good use case

Each tool should be something people commonly reach for, and better here than the usual alternative: no ads, no sign-up, instant, private and offline.

- **Common and quick.** Useful to many people in a few seconds or minutes. Niche professional tools are a poor fit.
- **Privacy is a real benefit.** Tools where people would rather not paste their data into a random website (text, passwords, finances, notes) are a strong fit.
- **Local storage adds value.** Saved games, history, presets or settings that persist and travel with export/import.
- **One tool per job.** Before adding a tool, check whether an existing one could grow a mode instead (one unit converter, not one per unit type).
- **Finishable.** Small enough to build, test and get right. A complete simple tool beats an ambitious half-working one.

## 3. Low stakes

The site is AI-generated and says so. Don't build tools where a wrong answer could hurt someone: medical dosing, structural or electrical safety, legal deadlines, anything sold as financial advice. Calculators show their formula or method so results can be checked.

## 4. Trademarks and copyright

Game rules and mechanics are generally free to use; names, artwork, text, level designs and the look of a specific product are not.

- **No trademarks** in names, descriptions, tags, strings or code identifiers. Use a plain descriptive name instead: "word guess", not a brand; "falling blocks", not a brand; "mines", not a brand; "property trading game", not a brand.
- **Traditional and public-domain games are fine** under their common names: chess, checkers/draughts, go, backgammon, mancala, dominoes, solitaire variants, nonograms, crosswords. If a common name is also someone's registered mark somewhere, prefer a fully generic name or record the decision in `docs/DECISIONS.md`.
- **No one-to-one copies.** Don't recreate a specific commercial game or app: its exact rule set and scoring, layout, colours, icons, sounds, puzzle sets, level layouts or wording. Make our own take: own visuals in the site's design language, own text, own generated or original content.
- **Content needs a licence.** Word lists, puzzle sets, fonts, sounds and images must be our own or under a licence compatible with the tool (MIT, CC0, public domain, or the tool's own copyleft licence), recorded with SPDX headers or in `REUSE.toml`. Puzzles should preferably be generated in the browser, not shipped.
- **When unsure, don't.** Pick the generic name or design, and note the question in the pull request.

## 5. Lightweight

Every byte is downloaded by every visitor of a page, counted against eventual hosting, and parsed on slow phones. Keep pages small and fast.

### Budgets

Sizes are uncompressed bytes on disk. `README.md` and `LICENSE` files don't count. Enforced by `tests/unit/budget.test.js`.

| What | Budget | Now |
|---|---|---|
| A tool's own files (everything in `tools/<id>/` except `data/`) | 60 KB | about 3 KB |
| A tool's `data/` folder (word lists, opening books, etc.) | 200 KB | none yet |
| Shared files (`shared/`) | 50 KB | about 33 KB |
| Hub (`index.html`, `hub*.js`, `hub.css`, `tools.json`) | 20 KB | about 11 KB |
| Any single image | 20 KB | none yet |

A tool that genuinely needs more (for example a vendored chess engine) adds an exception to the test with a one-line reason and records it in `docs/DECISIONS.md`.

### How to stay inside them

- **No frameworks or libraries** unless the tool can't exist without one. Plain DOM and the shared helpers are enough for almost everything.
- **Draw with CSS and inline SVG**, not images. No raster images for UI, no icon fonts, no web fonts. Sounds, if any, are short and optional.
- **Load data only when needed.** Large data lives in `data/` and is fetched (same origin) when the feature that uses it is first opened, not on page load.
- **Generate instead of ship.** Generate puzzles, boards and random content in code rather than shipping big tables.
- **Don't grow `shared/` for one tool.** Code moves into `shared/` only when at least two tools use it.

### Responsiveness

- Every tap or key press gets visible feedback within 100 ms.
- Work that can take longer than about 50 ms (solvers, chess search, large text processing) runs in a Web Worker so the page never freezes.
- No timers or animation loops running while nothing is changing; pause when the tab is hidden.
- Animations are short, use `transform` and `opacity`, and are turned off under `prefers-reduced-motion`.

## 6. Proposing a tool

Answer these in the pull request or issue:

1. What does it do, in one sentence, and who reaches for it?
2. Could it sit untouched for five years and still be correct?
3. Does any name, text, art or rule set copy a specific product?
4. What does it save locally, if anything?
5. Roughly how big will it be, and does anything need `data/` or a Worker?
