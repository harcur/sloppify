# stream overlay

Generative art overlays for streaming. Mark zones for the camera, chat, alerts, info panels and buttons; the zones stay invisible and only bend the art around them (raised blocks, pits, orbits, paint splashes, gravity piles, and for art streams tape, brush strokes, sketch lines and watercolour, plus vines and glitch), so the screen looks layered. Each zone's content sits either on top of the art or under its torn edges.

The result is two transparent layers: **back** goes under all sources, **front** goes over them and only holds art over the edges of zones placed under the art. Both download as PNGs, or load as browser sources from a link that holds the whole design after the `#`, so nothing is stored or sent anywhere.

- `design.js`: the design, presets, palettes and custom colours, saved colour profiles, limits and link encoding (no DOM, unit tested)
- `field.js`: noise, zone shapes (signed distance) and the shared height and flow field (no DOM, unit tested)
- `art.js`: draws the art styles (draped lines, flow lines, contours, wireframe mesh, halftone dots, stippling, tile mosaic, brush dashes, pen hatching) and zone effects, and composites the two layers (`compose` is unit tested)
- `worker.js`, `renderer.js`: draws in a worker on OffscreenCanvas, or on the page where that isn't supported
- `view.html`, `view.js`, `view.css`: one layer full size on a transparent page, for browser sources
- `app.js`: the editor: the stage with the selected zone's toolbar, edit and preview modes, full screen, undo, and the Zones, Art and Use it tabs (a tool row and options sheet on phones)
