# pick a person

Random picks for a group around one screen, in five modes: spin the bottle, everyone touches the screen, wheel of names, draw straws and team splitter. Players are a number or a saved list of names. Every result is decided before its animation starts, using the browser's secure random numbers.

- `pick.js`: the random parts and the spin geometry, with no DOM access (unit tested in `tests/unit/pick-a-person.test.js`)
- `app.js`: the page, the players panel and the mode switcher
- `bottle.js`, `fingers.js`, `wheel.js`, `straws.js`, `teams.js`: one file per mode
- `fx.js`: SVG helper, player colours, confetti, vibration and the spin animation
