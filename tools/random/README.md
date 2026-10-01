# random

Random picks in seven modes:

- **wheel:** spin a wheel of your own entries, optionally removing each winner.
- **dice:** tabletop dice (d4, d6, d8, d10, d12, d20, d100) with a modifier, dice notation such as `2d6 + 3`, and advantage or disadvantage for d20s. Dice tumble as they roll.
- **numbers:** whole numbers in a range, with or without repeats.
- **straws:** everyone pulls a straw; the shortest loses.
- **coin:** flip a coin and keep a count.
- **shuffle:** put a list in random order.
- **teams:** split a list into even teams.

Every result comes from `crypto.getRandomValues`. The logic lives in `logic.js` (no DOM, tested in `tests/unit/random.test.js`); `app.js` draws the page. Saves the open mode, each mode's settings and lists, the coin count and the last 30 results.
