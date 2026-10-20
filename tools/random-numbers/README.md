# random numbers

Picks whole numbers in a range: how many (1 to 100), with or without repeats, sorted or not. Up to four numbers show as large tiles; more show as a numbered list. Each pick flickers briefly and then settles with a pop and a flash of the result area, so a new result is visible even when it's the same number; all motion is off under reduced motion. Copy puts the numbers on the clipboard.

Every number comes from `crypto.getRandomValues`. The logic lives in `logic.js` (no DOM, tested in `tests/unit/random-numbers.test.js`); `app.js` draws the page. Saves the settings and the last 20 picks.
