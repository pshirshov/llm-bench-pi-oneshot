# Warband

A complete, playable real-time strategy game in the spirit of Warcraft II, running
entirely in the browser on Canvas 2D. TypeScript (strict), Vite, Vitest, ESLint —
**zero runtime dependencies**; all art is drawn programmatically.

## Running

```sh
npm install
npm run dev       # development server (open the printed URL)
npm run build     # type-check + production build (dist/)
npm run preview   # serve the production build
npm test          # unit tests (Vitest)
npm run lint      # ESLint
```

Append `?seed=<number>` to the URL to replay an exact campaign; the active seed is
shown in the main menu and in the in-game top bar. Without the parameter a seed is
derived from the clock once at startup and then drives every random decision.

## How to play

Pick a faction (Humans or Orcs — mirrored mechanics, distinct names/looks), then a
campaign level. You win a level by destroying **every** enemy building; you lose when
all of yours are gone. Victory unlocks the next level (progress is stored in
`localStorage`).

- Harvest **gold** from gold mines and **wood** by chopping forest tiles (they
  deplete and turn to dirt). Workers carry 100 per trip to a drop-off (Town Hall for
  both; Lumber Mill also accepts wood).
- **Supply**: Town Hall grants 5, each Farm 4 (cap 50). Training is blocked at the cap.
- Buildings (per faction): Town Hall (trains workers, drop-off), Farm (+supply),
  Barracks (trains military), Lumber Mill (wood drop-off, unlocks the ranged unit),
  Guard/Watch Tower (static ranged defense).
- Units: Worker (harvest/build/repair), Footman/Grunt (melee), Archer/Spearthrower
  (ranged; needs Lumber Mill), Knight/Ogre (heavy; needs Barracks + Lumber Mill).

### Controls

| Input | Action |
| --- | --- |
| Left-click | Select unit/building (own units take precedence) |
| Left-drag | Box-select own units |
| Shift + click/drag | Add to selection |
| Right-click | Context order: move / attack / harvest / repair / resume construction; confirms building placement |
| Left-click (placement mode) | Also confirms building placement |
| `A` then left-click | Attack-move |
| `Ctrl+1..9` / `1..9` | Assign / recall control group |
| Arrow keys, mouse at screen edge | Scroll viewport |
| Minimap click / drag | Jump / pan viewport |
| `Space` | Pause |
| `F` | Toggle 1x / 2x game speed |
| `Esc` | Cancel placement / attack-move / clear selection |

HUD: top bar (gold, wood, supply, seed, level, clock, speed), minimap with fog and
viewport rectangle (bottom-left), selection panel with portraits, stats, build/train
buttons with costs, and construction/training progress bars (bottom).

## Architecture

```
src/
  core/rng.ts        mulberry32 PRNG — the single source of all randomness
  map/
    tiles.ts         tile kinds, explicit symmetric adjacency table, walkability
    wfc.ts           Wave Function Collapse: minimal-entropy selection (priority
                     queue with versioned entries), 4-neighbour constraint
                     propagation to fixpoint, weighted sampling, restart on
                     contradiction (seed-derived)
    gamemap.ts       playability pass: start clearings, guaranteed gold/forest near
                     each start, BFS reachability with deterministic corridor carving
    levels.ts        5-level campaign config; per-level seed = hash(campaign, level)
  game/
    data.ts          data-driven stats tables (units, buildings, factions, costs)
    state.ts         entity/state model (units, buildings, projectiles, fog, players)
    path.ts          A*, 8-directional, octile heuristic, no corner cutting,
                     "approach" mode for blocked targets
    spatial.ts       spatial hash for range queries (rebuilt per tick)
    sim.ts           fixed-timestep simulation: movement + local avoidance +
                     group settling, harvesting, construction, repair, combat,
                     projectiles, training, corpses, fog cadence, win/lose
    commands.ts      order issuing, placement validation, training, game setup
    fog.ts           per-tile unexplored/explored/visible + last-seen memory
    ai.ts            scripted-strategy opponent (think pass every second)
  render/
    render.ts        world renderer: terrain, fog, buildings, units, projectiles
    hud.ts           top bar, minimap (offscreen, fog-aware), selection panel
  app.ts             GameSession: game loop, camera, selection, input bindings
  main.ts            screens (menu, level select, victory/defeat), campaign state
tests/               WFC, A*, combat/supply, sim smoke tests, DOM-stub UI harness
```

**Simulation / rendering / input separation.** The simulation advances in fixed
30 Hz ticks, fully deterministic for a given seed and order stream; rendering runs
at display rate (requestAnimationFrame) and reads state without mutating it; input
translates screen events into orders/commands at the boundary. The 2x speed toggle
multiplies accumulated sim time, never the tick size; a per-frame tick cap sheds
load instead of spiraling.

**Performance.** A spatial hash answers all range queries (target acquisition,
separation, tower range). Headless benchmark: ~0.7 ms per tick with 158 units in
active combat on the 64×64 map — comfortably 60 FPS.

**WFC.** Cells hold tile-set bitmasks; the minimal-(Shannon)-entropy cell is picked
via a priority queue with versioned (stale-skipping) entries and deterministic tie
noise, collapsed by weighted sample, and constraints propagate through the explicit
adjacency table (e.g. water borders only water/dirt; gold mines only in grass/dirt
clearings) until fixpoint. Contradictions restart with a derived seed. A
post-generation pass guarantees: two start clearings on opposite corners of a
diagonal, a gold mine and ≥8 forest tiles within reach of each start (planted
deterministically when missing — same guarantee for both sides keeps resources
approximately fair), and land reachability between starts (a 2-tile-wide dirt
corridor is carved if the terrain separated them).

## Spec decisions (where the spec left room)

- **Default campaign seed** comes from the clock but is immediately displayed and
  URL-settable; everything downstream uses the seeded PRNG.
- **Melee range** is 1.15–1.2 tiles so diagonal attacks connect.
- **Group arrival**: a unit that stops making net progress (measured after
  collision resolution) settles when near its goal; each group-mate already
  settled on the same goal widens the acceptable arrival ring. This is what makes
  crowds pack instead of oscillating.
- **Repair** costs a gold trickle (5 g/s for 15 HP/s). Right-clicking an own
  unfinished building resumes construction; a damaged finished one starts repair.
- **Tower** has no tech requirement beyond a worker and resources.
- **Training queue** is capped at 5; costs and supply are committed when queued
  (no cancel button).
- **AI fog**: the scripted AI plays without fog-of-war (omniscient targeting for
  its build/defense logic); the *player's* fog is fully enforced for rendering,
  minimap, and selection. AI difficulty (1–5) scales starting resources (+300 g /
  +200 w per level), harvest rate (+10 %/level), wave size, and wave cadence; the
  first wave lands within ~4 minutes at difficulty 1 and sooner at higher levels.
- **Defeat check** counts construction sites as buildings (you are not dead while
  a hall is being rebuilt).
- **Depleted resources**: an exhausted mine or chopped forest tile becomes dirt
  (walkable); workers automatically retarget the nearest remaining mine/forest.
- Units spawn next to their training building; there are no rally points.
- Both confirm gestures place a building: the spec lists right-click as the
  placement confirm, the genre convention is left-click — both work; `Esc` cancels.
