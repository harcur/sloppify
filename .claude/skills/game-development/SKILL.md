---
name: game-development
description: Patterns, pitfalls and test recipes for building or changing a game on sloppify (tools with category "game", such as mines and sudoku). Use when adding a new game, changing a game's board, layout, palette, animation, saving or tests, or when copying code from an existing game.
---

# Building a game on sloppify

Lessons from `tools/mines/` and `tools/sudoku/`. Rules live in `docs/TOOL-GUIDELINES.md` (4.6 for games) and `docs/DECISIONS.md`; this file is the *how*. Read both games before starting: the second game was built by copying the first, and most of what's below is what carried over or had to change.

## Files

| File | Holds |
|---|---|
| `logic.js` | Rules, generator, solver, `serialize`/`deserialize`. **No DOM**, so Node tests and a Worker can import it. Accept a `rand` argument (default `Math.random`) so tests can seed it. |
| `worker.js` | Only if something can take over ~50 ms on a slow phone (generators, solvers, search). Measure in Node and multiply by 5–10 for phones; sudoku's hard generator is ~10 ms median, ~45 ms worst on a desktop, so it went in a Worker. |
| `app.js` | The page, in sections: setup and store, elements, layout placement, board, render, timer, actions, animation, input, start. |
| `strings.js` | Every visible string *and* every `aria-label`, cell description and live-region message. Use separate keys for singular/plural (`hintedOne` / `hinted`) and whole sentences with `{placeholders}` instead of joining fragments. |
| `style.css` | Palette tokens first, then layout, board, controls, side panel, animation, reduced motion, narrow layout. |

Also: `tool.json` with `"category": "game"`, `npm run tools`, a paragraph per game under "Games:" in `docs/DECISIONS.md`, and `tests/unit/<id>.test.js` plus `tests/e2e/<id>.spec.js`.

## Worker

```js
worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
```

The CSP allows it (`worker-src 'self'`) and the service worker caches it on first use. Wrap the constructor in `try` and handle the `error` event (call `e.preventDefault()`) by falling back to calling the same `logic.js` function on the main thread, so older browsers still work. Match replies to requests with an id. Show a "Making a puzzle…" status only after a short delay (200 ms) so it doesn't flash.

## State and saving

- `const store = openStore(id, { version: 1 }); const saving = await guardStore(store, name);` Guard every `store.set` with `saving`; when it's false the game still runs, it just doesn't remember.
- Keys used by both games: `level`, `game` (in progress), `stats` (per level). Write the game after every move and on `visibilitychange` to hidden and `pagehide`.
- `serialize` writes plain JSON with cell arrays as digit strings (`'0102…'`). `deserialize` **validates everything** and returns `null` for anything off: lengths, allowed characters, level and state names, cross-field consistency (sudoku checks that the solution really solves the puzzle). A `null` means "start a fresh game", never a crash. Save files come back from imports and old versions.
- Read stats through a sanitising helper (`record(level)`) that returns numbers or defaults, never the raw stored object.
- Ask before throwing away progress (`confirmDialog`), but not when the game is finished or untouched.

## Timer

Run it only while the game is in play **and** `document.visibilityState === 'visible'`. Keep `g.elapsed` plus a `runStart` from `performance.now()`, and one `syncTimer()` that starts or stops a 1 s `setInterval` and folds the running time into `elapsed` when stopping. Call it after every state change and on `visibilitychange`. Save the time with `Math.round(elapsed())`.

## Board: accessible grid

- `role="grid"` with an `aria-label` that gives the size, rows as `role="row"`, cells as `<button type="button" role="gridcell">`.
- Roving tabindex: only the active cell has `tabindex="0"`. Arrow keys move; Home/End go to the row's ends; Ctrl+Home/End to the corners. Call `preventDefault()` only for keys you handle.
- Each cell's `aria-label` is a full sentence from strings: `row {row}, column {col}: {state}`. Tests locate cells by exactly this name, so it is also the test API.
- Two announcers: `role="status"` for the game's result line (visible), and a `.sr-only` `aria-live="polite"` paragraph for per-move messages (`say()`). One message per move, not one per cell changed.
- Keep "selected" separate from "focused". A `select(i)` that moves the selection, and moves focus only if focus is already on the board; `focusCell(i)` for clicks and arrows. Otherwise pressing a pad or Hint button yanks focus back onto the board.
- Buttons that are temporarily inert get `aria-disabled="true"` and a guard in the handler (not `disabled`, which drops them out of the tab order mid-game).
- Let one listener on the board handle `click` and `keydown` and find the cell with `e.target.closest('.<id>-cell')`. Store the index in `data-i`.

## Sizing the board

Set a `--cell` custom property from JS (`board.style.setProperty('--cell', …)`, which the CSP allows; `style` attributes in HTML are blocked). Compute it from the board area's `clientWidth` (and `clientHeight` on narrow screens), minus every pixel of frame, gaps and padding. Clamp to a minimum of 32 px on `(pointer: coarse)` and ~24–28 px otherwise, and to a maximum. Recompute from a `ResizeObserver` on the board area and on media-query changes. Size fonts with `calc(var(--cell) * 0.56)`.

Below the minimum the board scrolls inside its area (`overflow: auto`) rather than shrinking. Mines also turns a wide board on its side on narrow screens (`transposed`, with `toIndex`/`toDisplay` helpers) so it scrolls down instead of sideways.

## Narrow-screen app layout (`initPage({ app: true })`)

Below 720 px the header shrinks to a floating menu button and the footer is hidden; the game has to fill the screen itself:

- The play area is a grid at `height: 100dvh` (with `100vh` before it as a fallback): `auto auto minmax(0, 1fr) auto` for counters, status, board, controls. Pad it with `env(safe-area-inset-*)`. Give the counter row `padding-right: 52px` so the menu button doesn't cover it.
- Main buttons sit at the bottom within thumb reach; a bottom "Options" sheet (`<dialog class="dialog <id>-sheet">`) holds everything else: level, record, help, **plus the footer's AI text and source link** (`t('footer.text')`, `sourceUrl(SOURCE_PATH)`), because the page hides the footer there.
- Move DOM, not copies: one `placeParts()` that appends the side panel into the sheet body on narrow screens and back into the layout on wider ones (closing the sheet if open). Call it on the `matchMedia('(max-width: 719px)')` change event. Return focus to the Options button when the sheet closes.
- On wider screens use the width: the board on one side, controls and side panel (`level`, `your record`, `how to play`) on the other.

## Palette and contrast

- Prefix game tokens (`--m-*`, `--s-*`) and define them three times: `:root`, `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }`, and `:root[data-theme="dark"]`. Forgetting the third breaks the manual dark toggle.
- Check every text colour against **every** background it can sit on (cell, alternate cell, highlighted, selected, error), ≥ 4.5:1, and state differences ≥ 3:1. Do it with a script before writing CSS; a short WCAG luminance function in Python or Node takes a minute. Write the result in a comment above the palette.
- Colour is never the only signal: givens bold vs entries regular, hint underlined, conflicts hatched (`repeating-linear-gradient`), selection gets an inset ring as well as a fill, completed pad digits struck through and dashed.
- Chrome around the board (buttons, segmented control, sheet) uses the site's classes (`btn`, `btn-primary`, `seg`, `seg-btn`, `dialog`) and tokens; only pressed/active states take a game colour.

## Animation

- Render guard: store a key of what a cell shows (`b.dataset.key = \`${value}.${notes}\``) and only rebuild its children when the key changes. New child elements play their CSS entry animation; unchanged cells don't replay theirs on every re-render.
- Ripple: set a per-cell delay custom property from the distance to the cell played (`--d`, `--w`, `--u`), and use it as `animation-delay`. Use separate properties per effect so they don't leak into each other.
- To replay a one-shot effect on an element that may already have the class: remove it, read `el.offsetWidth`, add it, and remove it with `setTimeout` after the longest delay plus duration.
- Confetti: ~60 absolutely positioned `<span>`s with random `--dx --dy --rot --t --delay` in an `aria-hidden` box over the play area, removed after ~2.6 s, skipped entirely under reduced motion.
- `@media (prefers-reduced-motion: reduce)` sets `animation: none !important; transition: none !important` on the board, its cells, their children and pseudo-elements, hides overlay effects, and turns off the sheet's slide-in.

## Tests

**Unit** (`node:test`): a seeded LCG for repeatable generation; a helper that builds a known position; test the rules, the generator's guarantees over a dozen seeds, undo, win detection, the `serialize`→JSON→`deserialize` round trip, and a list of corrupted saves that must give `null`.

**Browser** (Playwright), following `tests/e2e/mines.spec.js` and `sudoku.spec.js`:

- Load a known board by writing the save before the page loads. Set the `__schema` key too, and skip if a game is already stored so `page.reload()` keeps what the test did:
  ```js
  await page.addInitScript((game) => {
    if (localStorage.getItem('sloppify:<id>:game')) return;
    localStorage.setItem('sloppify:<id>:__schema', '1');
    localStorage.setItem('sloppify:<id>:game', game);
  }, JSON.stringify(serialize(g)));
  ```
  Import `newGame`/`serialize` from the tool's `logic.js` to build it.
- Find cells by role and accessible name (`getByRole('gridcell', { name: 'row 1, column 2: empty', exact: true })`).
- `isNarrow(page)` (viewport < 720) for paths that differ; on narrow screens open "Options" before using anything in the side panel.
- Cover: first move, keyboard flow, win (status text, record, survives reload), progress survives reload, new game asks first, the narrow app layout (no page scroll, main buttons near the bottom, menu still reachable, source link in the sheet, focus returns), and `expectAccessible` in light and dark for in-progress, dialog, end state and the sheet. Wait for the sheet's animations (`el.getAnimations().map(a => a.finished)`) before running axe on it.
- `afterEach` asserts no external requests.

**Running locally:** if `npx playwright test` says the browser executable doesn't exist (the installed Playwright expects a different build than the one in `/opt/pw-browsers`), use a throwaway config and don't commit it:

```js
// pw.local.config.js
import base from './playwright.config.js';
export default { ...base, use: { ...base.use, launchOptions: { executablePath: '/opt/pw-browsers/chromium' } },
  projects: base.projects.filter((p) => p.name.endsWith('chromium')) };
```

To look at the page, start `python3 -m http.server 4173` and screenshot it with Playwright at desktop and `devices['Pixel 7']` sizes in both colour schemes; a script outside the repo has to import Playwright by absolute path (`/home/user/sloppify/node_modules/@playwright/test/index.mjs`).

## Shared code

The two games now duplicate the timer, confetti, ripple/restart helpers, the options sheet and its CSS. By the guidelines (2.2) that's the point where it may move to `shared/`, which still has to fit in its 50 KB budget and must not load on non-game pages. Do it as its own change, update both games, and keep the per-game look (palette, icons) in the game.

## Before you finish

- [ ] `npm run tools`, `npm run test:unit` (includes size budgets), browser tests on desktop and mobile
- [ ] Screenshots checked in light and dark, desktop and phone
- [ ] Paragraph under "Games:" in `docs/DECISIONS.md`, including any naming or trademark call
- [ ] Anything new you learned added here
