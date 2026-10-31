# sudoku

Fill a 9 × 9 grid so every row, column and 3 × 3 box holds the digits 1 to 9. Three difficulties, puzzles generated in the browser with exactly one solution, notes, undo, hints, and games and records saved locally.

- `logic.js`: generator, solver and rules, with no DOM access (unit tested in `tests/unit/sudoku.test.js`)
- `worker.js`: makes puzzles in a Web Worker so the page never stalls
- `app.js`: the page

Difficulty: easy and medium puzzles are thinned to at least 38 and 30 givens and must be solvable with naked and hidden singles alone; hard puzzles go down to 22 givens and the generator retries until one needs more than singles.

License: MIT (see the repository root).
