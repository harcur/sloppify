# solitaire

The traditional patience card game also known as Klondike: build the four suits from ace to king on the foundations, using seven tableau piles and a stock. Only winnable deals. Turn over one or three cards at a time, unlimited passes through the stock, unlimited undo. Games and records saved locally.

Every deal is one a solver has played through to a win first, so no game is hopeless. Hint asks the same solver for the next move from where you are.

- `logic.js`: the rules, with no DOM access (unit tested in `tests/unit/solitaire.test.js`)
- `solver.js`: finds a winning line for a deal; deals are tried until it finds one (unit tested in `tests/unit/solitaire-solver.test.js`, which plays every solution through `logic.js`)
- `worker.js`: runs the solver off the main thread, for deals and hints
- `app.js`: the page

## Legal notes

Checked before building (see `docs/DECISIONS.md`):

- The game is a traditional 19th-century patience, so its rules are free to use. "Solitaire" and "Klondike" are its common names.
- The cards are our own drawing: plain square cards with our own suit shapes, letters on the court cards instead of figure art, and our own back pattern. Nothing is taken from a commercial deck or a computer version of the game.
- No product's scoring system, card backs, sounds or win animation. The game counts moves and time only, and a win ends in our own suit-shaped confetti.
