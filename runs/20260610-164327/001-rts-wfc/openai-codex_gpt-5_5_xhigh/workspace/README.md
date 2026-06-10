# Warband

Warband is a complete in-browser Canvas 2D real-time strategy game inspired by Warcraft 2. It uses TypeScript, Vite, Vitest, and ESLint, with no runtime dependencies and no external art assets.

## Run

```bash
npm install
npm run dev
```

Open the Vite URL. Add `?seed=<number>` to reproduce a campaign exactly, for example:

```text
http://127.0.0.1:5173/?seed=424242
```

Checks:

```bash
npm run build
npm test
npm run lint
```

## Controls

- Left-click: select own unit or building.
- Left-drag: box-select own units; if no units are inside the box, selects buildings.
- Shift + left-click/drag: add to or remove from the current selection.
- Right-click: context order.
  - Enemy: attack.
  - Ground: move.
  - Gold mine / forest with workers selected: harvest.
  - Damaged allied entity with workers selected: repair.
  - Building placement preview: confirm construction.
- Build buttons: select a worker, click a building button, then right-click a valid map tile.
- Train buttons: select a Town Hall or Barracks and click a unit button.
- `A`: arm attack-move, then right-click a destination.
- `Space`: pause/resume.
- `T`: toggle 1x/2x simulation speed.
- Arrow keys or mouse at the viewport edge: scroll camera.
- Minimap click/drag: move camera.
- `Ctrl+1`..`Ctrl+9`: assign control groups.
- `1`..`9`: recall control groups.
- `Esc`: cancel pending command; after victory/defeat, return to level select.

## Game systems

- Factions: Humans and Orcs share mirrored mechanics with distinct names, colors, and silhouettes.
- Resources: gold, wood, and supply. Town Halls and Farms provide supply; queued units reserve supply.
- Buildings: Town Hall, Farm, Barracks, Lumber Mill, Guard Tower. Workers construct foundations on-site and repair damaged allied entities.
- Units: Worker, melee infantry, ranged unit, heavy melee unit. Stats live in a single data-driven table.
- Combat: armor-reduced damage with a minimum of 1, auto-acquisition in sight, attack orders, attack-move, tower fire, visible ranged projectiles, and fading corpses.
- Movement: 8-direction A* over the tile grid with no diagonal corner cutting. Group move orders assign formation offsets; local separation keeps units from settling on top of each other.
- Fog of war: unexplored, explored, and visible tile states. Explored terrain stays dimmed and last-seen buildings remain as snapshots.
- AI: scripted economy, build order, continuous army production, defensive pulls, rebuilding, and escalating attack waves. Difficulty 1-5 scales starting resources, harvest bonus, and wave cadence/size.
- Campaign: five deterministic levels with increasing map size and terrain constraints. Victories unlock later levels in local storage.

## Architecture

- `src/main.ts`: application state, fixed-timestep loop, input mapping, control groups, campaign menu.
- `src/simulation.ts`: deterministic game simulation, entity orders, resource economy, combat, AI, fog, victory/defeat.
- `src/renderer.ts`: Canvas 2D rendering of terrain, sprites, fog, HUD, minimap, level select, and placement previews.
- `src/wfc.ts`: genuine Wave Function Collapse map generation using weighted tiles, minimal-entropy cell selection, adjacency propagation, deterministic retries, and a deterministic playability repair pass.
- `src/pathfinding.ts`: A* pathfinding and nearest-passable search.
- `src/mechanics.ts`: pure combat/resource/supply helpers covered by tests.
- `src/random.ts`: the single seeded PRNG. Gameplay and map generation do not use `Math.random`.

The simulation runs at a fixed 60 Hz step and rendering is decoupled via `requestAnimationFrame`.

## Spec decisions

- Gold mines are represented as gold-mine tiles rather than separate neutral building entities.
- Workers harvest from adjacent resource tiles, carry 10 resources, then automatically return to the nearest valid drop-off.
- Repair consumes wood in proportion to restored HP.
- Lumber Mill unlocks ranged and heavy units; heavy units still train from Barracks and therefore require both Barracks and Lumber Mill.
- The WFC playability pass may carve deterministic dirt corridors and clear base/resource pockets after a valid collapse, preserving deterministic output from the campaign seed.
- Placeholder art is generated entirely in Canvas code with colored geometric silhouettes.
