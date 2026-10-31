# sloppify — notes for Claude Code

Local-first hub of small tools and games, hosted on GitHub Pages at `harcur.github.io/sloppify/`. Read `docs/DECISIONS.md` before changing anything: it records every design and architecture decision. Read `docs/TOOL-GUIDELINES.md` before proposing or building a tool: it collects every rule a tool follows (what fits the site, size budgets, structure, storage, design, accessibility, tests) with a checklist.

## Hard rules

- No build step and no runtime dependencies. Plain HTML, CSS and ES modules. Dev tooling (tests) lives in `package.json` and is never deployed.
- Zero external requests. Every page has a CSP meta tag (`default-src 'self'`); never add CDNs, remote fonts, analytics or APIs. No inline scripts or `style` attributes (CSP blocks them).
- All paths relative, so the site works under the `/sloppify/` subpath.
- Storage only through `shared/storage.js` (`openStore`). Keys are `sloppify:<tool-id>:<key>`. Never touch keys without the `sloppify:` prefix.
- Every visible string goes in a `strings.js` file.
- Size budgets (`tests/unit/budget.test.js`): 1 MB per tool (a ceiling, not a target: don't waste it; most tools should stay well under 100 KB), 200 KB per tool `data/` folder, 50 KB `shared/`, 20 KB hub, 20 KB per image. Long work goes in a Web Worker.
- WCAG 2.2 AA, keyboard and screen reader support, designed mobile and desktop layouts.
- On phones every tool and game feels like an app: `initPage({ app: true })`, fills the screen, state on top, main thing in the middle, actions at the bottom, everything else in the options sheet (`shared/sheet.js`). See `docs/TOOL-GUIDELINES.md` 4.1.
- SPDX headers on every file (REUSE).
- Design: sharp corners, 1px lines, system monospace headings, system sans text, tokens in `shared/base.css`.

## Adding a tool

Check the idea against `docs/TOOL-GUIDELINES.md` first. For a game, also use the `game-development` skill (`.claude/skills/game-development/SKILL.md`): patterns, pitfalls and test recipes from mines and sudoku. Copy `tools/_template/`, follow its README, fill in its `tool.json`, run `npm run tools` (regenerates `tools.json`; never edit that by hand), add tests.

## Commands

- Serve: `python3 -m http.server 4173`
- Regenerate the hub's tool list: `npm run tools` (`--check` to verify)
- Unit tests: `npm run test:unit`
- Browser tests for what you changed (vs `origin/main`): `npm run test:changed` (add `-- --project=desktop-chromium` to narrow). CI skips browser tests on pull requests and runs them all on `main`, alongside the deploy; run this before merging anything risky.
- Browser + accessibility tests: `npm install && npx playwright install && npm run test:e2e` (passing in Chromium desktop and mobile; Firefox and WebKit not yet run locally, CI runs all five projects)

## Open items

- `interest-calculator` doesn't use the phone app layout yet (`app: true`, options sheet); `sudoku` has its own copy of the options sheet that should move to `shared/sheet.js`.
- Replace the generic source icon in `shared/icons.js` with Octicons `mark-github` (MIT).
- Add PNG app icons (192, 512, apple-touch-icon).
- Pages: CI publishes on every push to `main` right away, without waiting for tests, for either Pages source (GitHub Actions, or branch `gh-pages` `/ (root)`). The deploy job logs which source is set.
