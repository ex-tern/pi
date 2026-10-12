# Self-hosted front-end libraries

Optional. The app loads Chart.js from a CDN and falls back to this directory
if that fails.

## Why this exists

CDN fetches fail for reasons the server cannot see: privacy extensions,
corporate proxies, filtered networks, or being offline. When that happened the
Pidyne Forecast rendered as an empty box, and the failure looked like a backend
problem — it was reported as one, and time was spent looking at an API that was
returning correct data the whole time.

The app now degrades in three stages: try a second CDN, then this local copy,
then render the forecast as a table. Populating this directory removes the
dependency on someone else's network entirely.

## To self-host

Run from the repository root:

    curl -Lo "frontend/vendor/chart.umd.min.js" \
      https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js

Then commit it. Pin the same version the CDN tag in `index.html` uses (4.4.4),
so behaviour does not change depending on which source won the race.

Mermaid (architecture diagrams) can be vendored the same way if needed:

    curl -Lo "frontend/vendor/mermaid.min.js" \
      https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js

## three.js (the superellipse look's graphics engine)

`vendor/three/` holds three.js r185 (0.185.1, MIT, see `vendor/three/LICENSE`): `three.module.min.js` and
`three.core.min.js`, copied unchanged from the `build/` folder of https://github.com/mrdoob/three.js at tag
`r185`. `frontend/super/engine.js` imports it to draw every super, wire, port and the glass light with WebGL.
To update, copy the same two files from a newer tag and bump `?v=` on `super/engine.js` in `index.html`.
