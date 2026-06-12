# Warband

Warband is a deterministic, in-browser RTS inspired by Warcraft 2. It uses TypeScript, Vite, Vitest, ESLint, and Canvas 2D only; there are no runtime dependencies or external assets.

## Run

```bash
npm install
npm run dev
npm run verify
```

Other scripts: `build`, `preview`, `test`, `lint`, and `typecheck`.

Use `?seed=<number>` to reproduce a campaign map, for example `http://localhost:5173/?seed=12345`. The active seed is shown in the HUD.

## Controls

- Left click: select a friendly unit or building.
- Left drag: box-select units.
- Shift + left click: add to selection.
- Right click ground: move selected units.
- Right click enemy: attack.
- Right click gold mine or forest: harvest.
- Right click damaged friendly building with Workers selected: repair.
- Build buttons: choose a building, then click/right-click a map site to place it.
- Train buttons: select a production building, then click a train button.
- Ctrl+1..9: save control group. 1..9: recall.
- Arrow keys, edge mouse scroll, and minimap click: move camera.
- Space: pause. HUD `2x` button: toggle speed.

## Architecture

- `src/sim`: DOM-free deterministic simulation. It owns maps, entities, economy, combat, orders, AI, fog, pathfinding, placement, and invariants.
- `src/render`: Canvas 2D renderer. Placeholder art is drawn with colored shapes.
- `src/ui`: pure HUD layout/hit-testing plus DOM input translation. The input layer binds to a canvas without creating a rendering context and accepts an injectable client-rect source for jsdom tests.
- `tests`: behavioral black-box/group tests drive the public simulation and real DOM input path.

The fixed simulation tick rate is `TICK_RATE = 20` ticks/second. Rendering is decoupled through `requestAnimationFrame`.

## Design decisions

- Forest and gold mine tiles are unwalkable resource tiles. Workers harvest from 8-adjacent walkable tiles and never stand on the resource tile.
- Depleted forests become `grass` (walkable/buildable). Exhausted gold mines become `depletedMine` (walkable, not buildable). Walkability changes increment the map walk-version and invalidate cached paths.
- WFC uses weighted tile collapse with minimum-entropy buckets and adjacency propagation. A deterministic repair pass carves starts/corridors and places fair local resources if collapse attempts do not already satisfy playability.
- Campaign levels grow from 32x32 to 96x96 and increase terrain constraint and AI difficulty.
- The AI uses deterministic scripted strategy plus construction assistance on its own incomplete buildings so difficulty-1 reliably reaches economy, tech, army, first wave, and rebuild milestones in headless and browser play. Player construction always requires a Worker on site.
- Difficulty scales AI starting resources, small resource trickle, construction assistance rate, and wave size/cadence.
- Unit collision is tile-reservation based: units reserve current and destination tiles while moving; production searches outward for a free reserved-safe spawn tile.

## Verification

`npm run verify` runs typecheck, lint, tests, and production build. The suite covers determinism, WFC adjacency/playability, A*, harvesting corner cases, group movement, impenetrability, unreachable orders, combat math/projectiles, stats sanity, production/repair, placement honesty, AI progression/rebuild, win/loss, invariant fuzz, boot smoke, jsdom input wiring, HUD layout, AI-vs-AI soak, and a 100+ unit performance canary.
