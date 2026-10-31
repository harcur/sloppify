# work and rest timer

Alternates work and rest intervals: a work session, a short rest, and a long rest after a set number of rounds. Generic name on purpose; the best-known name for this method is a trademark.

- `logic.js`: phases, settings, time formatting and sand levels. No DOM, unit tested in `tests/unit/work-rest-timer.test.js`.
- `sounds.js`: every sound is generated with the Web Audio API, so no audio files ship. Calm: chime, singing bowl, rising notes. Harder to miss: beeps, alarm. Each moment (work ends, rest ends) has its own sound and volume.
- `app.js`: the page. One timeout at a time (each whole second while visible, straight to the end while hidden); the hourglass sand glides between updates with CSS transitions.

Alerts when a phase ends, each one switchable on or off: sound, a soft glow around the screen edges (a 2 s fade, low contrast, never a flash; a still tint with reduced motion), vibration on phones, and a system notification when the page is in the background.

A minimal view shows only the hourglass and one button, with no ticking numbers and no falling grains. While the timer runs, the screen can be kept on with the Screen Wake Lock API (where the browser supports it; the setting is hidden otherwise).

Saves settings, the timer (a running timer carries on after a reload), work sessions done today and the minimal view.
