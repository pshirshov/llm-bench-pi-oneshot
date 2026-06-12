# Task: build "Warband" — a complete in-browser real-time strategy game

Build a complete, playable RTS in the spirit of Warcraft 2, delivered as a web
application in the **current (empty) working directory**. Work autonomously until the
game is complete; do not stop to ask questions. Where this spec leaves a detail open,
make a sensible genre-conventional choice and document it in the README.

You are graded on three things, in order: (1) every quality gate below passes,
(2) a human can play the game start to finish without hitting a defect, (3) the
simulation is provably robust — the corner cases in **Robustness** are exactly where
RTS implementations rot, and each one has a mandated test. A feature that exists in
code but breaks under play is worth less than no feature at all.

## Technical constraints

- The environment already provides Node.js (LTS), npm, npx, and git on PATH, with npm
  registry access. Do not install or switch toolchains (no nvm/volta/system package
  managers) and do not create Nix or direnv files — scaffold the project with npm only.
- TypeScript with `"strict": true`. Vite for dev/build. Vitest for tests. ESLint for lint.
- Rendering: Canvas 2D. Programmatic placeholder art (colored shapes/sprites drawn in
  code) is expected — no external assets, no asset downloads.
- **No runtime dependencies.** `package.json` `dependencies` must be empty or absent;
  game engines and frameworks (Phaser, PixiJS, React, etc.) are forbidden. Dev
  dependencies (vite, typescript, vitest, eslint, jsdom for input tests) are allowed.
- All randomness must flow through one seeded PRNG (e.g. mulberry32). The active seed
  is displayed in the UI and can be set via the `?seed=<number>` URL parameter, so any
  map — and any full match given the same seed and the same order stream — can be
  reproduced exactly (replay recording is not required). `Math.random` may appear only
  inside the PRNG module (as the documented fallback for generating a fresh seed when
  `?seed=` is absent), nowhere else.
- A fixed-timestep simulation loop decoupled from rendering; the tick rate is a named,
  documented constant, and every sim-time figure in this spec is defined in terms of
  it. Target 60 FPS with 100+ units alive on a 64x64 map; use spatial partitioning for
  range queries if needed.
- No console errors or unhandled rejections during normal play.

### Build, lint, and verification gates

The code must compile and lint — by construction, not by accident:

- npm scripts: `dev`, `build`, `preview`, `test`, `lint`, `typecheck`, `verify`.
  - `typecheck` runs `tsc --noEmit`.
  - `build` must include typechecking (`tsc --noEmit && vite build`). A bare
    `vite build` is not acceptable: esbuild transpiles without typechecking, so type
    errors would ship silently.
  - `lint` runs ESLint with `--max-warnings 0`. Warnings are failures.
  - `verify` chains `typecheck`, `lint`, `test`, `build`. **`npm run verify` exiting 0
    is the operational definition of "done". Run it after every substantial change and
    leave it green.**
- ESLint must enforce, as errors: no `any` (`@typescript-eslint/no-explicit-any`), no
  non-null assertions (`@typescript-eslint/no-non-null-assertion`), no `Math.random`
  outside the PRNG module (`no-restricted-properties`, with a file-scoped override for
  the PRNG module in the ESLint config itself), and a maximum source-file length of
  500 lines (`max-lines`, blank lines and comments excluded) — split modules by
  concern instead of growing god files. These rules apply to test files too: split
  test suites by scenario rather than exempting them.
- Suppression directives are forbidden everywhere (src and tests): no `@ts-ignore`,
  no `@ts-expect-error`, no inline `eslint-disable` of any form. Where you would
  reach for a non-null assertion (e.g. `map.get(id)` after a presence check), use a
  small typed helper that narrows or throws instead.
- Weakening a gate — deleting a failing test, relaxing a lint rule, lowering a
  threshold, loosening tsconfig — counts as failing that gate. Fix the cause.

## Game specification

**Factions.** Two playable factions, Humans and Orcs, with mirrored mechanics but
distinct names, colors, and unit/building appearance. The player picks a faction; the
AI plays the other. Each side starts with one Town Hall and the same small number of
Workers (3–5; a stats-table constant) at its start location.

**Resources.** Three: **gold** (harvested from gold-mine tiles), **wood** (harvested
by chopping forest tiles, which depletes them), and **food/supply** (capacity granted
by Town Hall and Farms; training is blocked at the supply cap). Each gold mine holds a
finite amount of gold (stats table); an exhausted mine visibly changes to a depleted
tile. Workers carry a fixed amount per trip (stats table) and drop off at the nearest
eligible drop-off building. Document the post-depletion tile type and its walkability;
any tile walkability change must invalidate affected cached paths.

**Harvest cycle.** A single harvest order establishes a permanent loop: walk to a
walkable tile 8-adjacent to the source (workers never occupy the resource tile
itself), gather for the stats-table duration, carry to the nearest reachable drop-off
(Town Hall for gold, Town Hall or Lumber Mill for wood), return, repeat — with no
further player input, until the order is replaced, the source is exhausted, or no
valid target remains (see Robustness C5 for the required fallbacks).

**Buildings** (5 per faction, mirrored): Town Hall (resource drop-off, trains Workers),
Farm (+supply), Barracks (trains military units), Lumber Mill (wood drop-off, unlocks
ranged unit), Guard Tower (static ranged defense). Buildings have cost, build time
(constructed on-site by a Worker), hit points, and a grid footprint; placement shows a
validity preview and rejects blocked/occupied tiles (terrain and units alike).

**Units** (4 per faction, mirrored): Worker (harvests, builds, repairs), a melee
infantry (Footman / Grunt), a ranged unit (Archer / Spearthrower; requires Lumber
Mill), and a heavy melee unit (Knight / Ogre; requires both Barracks and Lumber Mill).
Each unit has HP, armor, attack damage, attack range, attack cooldown, move speed,
sight radius, gold/wood cost, supply cost, and training time. Use a single data-driven
stats table; no combat/economy magic numbers outside it.

**Stat sanity.** Unit classes must have genre-sane characteristics, enforced by the
stats-sanity test below. Per faction: HP ordering heavy > melee infantry > ranged >
Worker, and every building out-HPs every unit; damage ordering heavy ≥ melee
infantry > Worker; attack range 1 (adjacent) for melee and Worker, ≥ 4 tiles for the
ranged unit, and Guard Tower range ≥ the ranged unit's; sight radius ≥ attack range
for every combatant; all unit move speeds within a 1.5x band (fastest ≤ 1.5x the
slowest) and each unit crosses one tile in 0.3–1.2 s at 1x game speed; mirror-match
decisiveness — a unit kills its own mirror in no fewer than 4 and no more than 30
attacks (no one-shots, no endless poking); gold+wood cost and training time increase
with unit power (heavy strictly the most expensive).

**Combat.** Attack orders and attack-move; idle/guarding units auto-acquire hostile
targets entering sight; ranged attacks spawn visible projectiles; damage = attacker
damage minus defender armor (minimum 1); dead entities are removed and corpses fade.

**Movement.** A* pathfinding on the tile grid (8-directional, no corner cutting
through blocked diagonals). Units are solid: they never overlap, pass through, or
displace one another — a moving unit routes around occupied space or waits, and an
idle unit's position changes only when it executes its own order, never because
another unit shoved it. A group ordered to one point must arrive and settle without
permanent mutual blocking or oscillation.

**Fog of war.** Three states per tile: unexplored (black), explored (dimmed, shows
last-seen terrain/buildings), visible (live). Enemy units are only drawn when visible.
The minimap respects fog.

**Controls & UI.** Left-click select, left-drag box select, Shift-click to add to
selection; right-click issues the context-sensitive order (move / attack / harvest /
repair / build-placement confirm). Control groups via Ctrl+1..9 / 1..9. Viewport
scrolling by arrow keys, edge-of-screen mouse, and minimap click/drag. HUD: top
resource bar (gold, wood, supply used/cap, seed), minimap with fog + viewport
rectangle, selection panel (portraits/stats; build & train buttons with costs and
progress bars). Pause (Space) and 1x/2x speed toggle.

The UI must be testable without a browser: compute the HUD layout (minimap, resource
bar, selection panel, every button) as plain rectangle data — a pure function of the
viewport size — with a hit-test function mapping a screen point to the element under
it. The renderer must draw every HUD element from the same layout rects the hit-test
uses (a single source of truth; hard-coded HUD draw coordinates are a defect). The
input layer consumes ordinary DOM events on the canvas and translates them into
simulation orders via that hit-test plus camera transform; it must contain no game
logic of its own, so synthetic `MouseEvent`/`KeyboardEvent` dispatch exercises the
real control path end to end. Two constraints make this work under jsdom, which
performs no layout and has no 2D context: the input layer must be bindable to a
canvas element without creating a rendering context, and it must obtain its
client→canvas coordinate transform from an injectable source (defaulting to
`getBoundingClientRect`) so tests can supply a non-trivial rect.

**AI opponent.** A scripted-strategy AI for the opposing faction that: maintains
Worker saturation on gold and wood; follows a build order (supply ahead of demand,
Barracks, Lumber Mill, defensive towers); trains a mixed army continuously; sends
escalating attack waves at the player's base (first wave within ~4 minutes of game
start at difficulty 1); defends its base by pulling military units to threats; and
**rebuilds destroyed buildings** (a razed Barracks or Town Hall must not end the AI's
development). Difficulty (1-5) scales AI starting resources, harvest-rate bonus, and
wave size/cadence. Difficulty 1 must be beatable by an average player in ~15 minutes.

**Win/lose.** A side loses when all its buildings are destroyed. Show a victory/defeat
screen; victory unlocks and advances to the next level.

## Robustness — mandatory corner-case handling

These are the classic RTS failure modes. Each must be handled in the simulation and
each has a mandated test in the **Tests** section.

Hard invariants — must hold at **every** simulation tick, on every level, for any seed:

- **I1 — no tunneling.** No unit's position is ever inside a tile your design defines
  as unwalkable (at minimum: water, rock, building footprints, gold mines; document
  whether forest blocks movement), and no movement step passes through one — including
  diagonal corner cutting.
- **I2 — bookkeeping sanity.** Gold, wood, supply used, and HP are never negative;
  training is rejected whenever used + cost would exceed the cap (supply used may
  transiently exceed the cap after a supply building is destroyed — no new training
  until back under it); no simulation quantity is ever NaN or non-finite.
- **I3 — order liveness.** Every order reaches a terminal state (completed, replaced,
  or cancelled-to-idle with a defined reason). No unit repaths forever against an
  impossible goal (livelock) and no group wedges permanently (deadlock).
  Operationalize this with a progress watchdog usable from tests: a unit with an
  active order must make observable progress (position, order phase, cargo, or
  cooldown change) within a bounded tick window, or transition to idle.
- **I4 — unit impenetrability.** No two units' centers ever come within 0.5
  tile-widths of each other, no movement step passes one unit through another, and a
  unit's position changes only by executing its own movement — units are never
  displaced ("shoved") by other units' motion. Congestion is resolved by waiting and
  rerouting, not by pushing.

Corner cases — must be handled, not avoided by luck. Where this spec states a numeric
threshold you may tighten it, never loosen it:

- **C1 — starts too close.** The two start locations must be far apart: land-path
  distance between them (8-directional, diagonal cost √2, in tile units) at least 60%
  of the map's larger dimension, and straight-line distance at least 40% of it.
  Enforced by the playability pass on every level/seed.
- **C2 — group deadlock.** A group of 12+ units ordered through a narrow chokepoint
  to one destination: every unit arrives near the destination and settles. No pair of
  units blocks each other permanently — and per I4, the jam must dissolve through
  waiting/rerouting, never by units displacing each other.
- **C3 — pathfinding livelock.** Settled means settled: once a group has arrived,
  units stop moving — no endless position churn, oscillation between tiles, or
  perpetual repathing. No two idle units' centers rest within 0.5 tile-widths of
  each other (i.e. settled units are not stacked).
- **C4 — unreachable destination.** An order to an unreachable tile (island, enclosed
  area, inside a building) moves the unit to the nearest reachable point toward it,
  then stops cleanly. Bounded repath attempts; never an infinite retry loop.
- **C5 — harvest completion.** Workers must always finish or gracefully abandon
  harvest work; a worker frozen mid-task is a defect. Required behaviors:
  - Forest tile depleted mid-chop or before arrival → automatically retarget the
    nearest reachable forest tile and continue the loop.
  - Gold mine exhausted → retarget the nearest reachable mine if any, else go idle
    near the drop-off.
  - Drop-off destroyed while a worker is carrying → reroute to the nearest surviving
    eligible drop-off; if none exists, go idle without losing the carried cargo.
  - Source temporarily crowded or path temporarily blocked by other units → wait or
    reroute; never permanently stuck, never an infinite repath loop.
- **C6 — surrounded production.** A unit finishing training while all tiles adjacent
  to the building are occupied spawns at the nearest free walkable tile instead of
  being lost, stacking, or blocking the queue.
- **C7 — placement honesty.** The build-placement preview rejects any footprint
  overlapping unwalkable terrain, buildings, resource tiles, or units; an accepted
  placement is always actually constructible.

## Level generation — Wave Function Collapse

Maps are generated by a genuine WFC implementation — minimal-entropy cell selection
with adjacency-constraint propagation over a weighted tile set — **not** plain noise or
uniform random scatter.

- Tile set (at least): grass, dirt, forest, water, rock/mountain, gold mine. Define an
  explicit adjacency-rule table (e.g. water borders water/dirt only; gold mines sit in
  grass/dirt clearings) and per-tile weights.
- Post-generation playability pass: exactly two start locations, each on a contiguous
  buildable area of at least 5x5 tiles, mutually reachable by land and separated per
  **C1**; each start has a gold mine and a forest tile within 15 land-path tiles;
  resource availability near the two starts is fair to within ~30%. If a generated
  map fails these constraints: a bounded number of deterministic re-collapse attempts
  (derived sub-seeds), then a deterministic repair step that always succeeds (e.g.
  carving land corridors and placing missing resources) — generation must terminate
  for every seed.
- **Campaign:** 5 levels of progressively increasing complexity — map size grows
  (e.g. 32x32 up to 96x96), terrain gets more constrained (more water/mountains,
  natural chokepoints, scarcer resources), and AI difficulty rises (1 through 5).
  Include a level-select screen showing locked/unlocked state; each level's map derives
  deterministically from (campaign seed, level number).

## Tests — if it can be tested, it must be tested

Testability is an architectural requirement: the simulation core (world state, orders,
movement, combat, economy, AI, map generation) must import nothing from the DOM or
Canvas and must be constructible and steppable headlessly in Node from
(map or seed, faction setup). Rendering and input are thin layers over it.

**Principle: every behavior observable through the simulation's public API must have a
test — especially unit behaviors.** Behavioral tests drive the real simulation through
the same public order API the UI uses (spawn entities, issue orders, step N ticks,
assert on observable state). Do not mock or stub the simulation; do not reach into
private internals to force outcomes. The sim API may expose explicit test-setup
affordances (spawn entity, deal damage / destroy entity, set stockpile) — using these
to *arrange* a scenario is fine; using them to force the *asserted outcome* is not.

Several failure classes are invisible to code review and only surface during play:
broken control wiring, misaligned or unreachable UI elements, units stalling mid-task,
groups deadlocking, oscillating, or drifting through obstacles. You will not have a
browser to play-test in, so the suite below is how the game plays itself — the input
wiring, UI layout, soak, and invariant tests exist precisely to catch what reading the
source cannot.

Mandated suite — each scenario below must exist as one or more clearly identifiable
tests:

1. **Determinism.** Two simulations created from the same seed, fed the same orders,
   stepped 1000+ ticks → identical serialized state. Different seeds → different maps.
2. **WFC.** Adjacency-constraint propagation correctness; every generated map contains
   no adjacent tile pair violating the adjacency table; generation is deterministic
   for a fixed seed.
3. **Playability pass.** Across at least 20 (seed, level) combinations covering all
   5 levels: both starts exist, are mutually land-reachable, satisfy the C1 separation
   thresholds, and have a gold mine and forest within the 15-tile reach. The whole
   suite should complete in well under 30 s — bound your generation retries.
4. **A\*.** Shortest-path length on known grids; no corner cutting through blocked
   diagonals; unreachable targets reported as such (not an infinite search).
5. **Worker gold loop.** A worker ordered to harvest gold completes at least 3 full
   round trips unattended; the stockpile increases by exactly the expected amount.
6. **Worker wood loop + depletion.** Chopping depletes the forest tile; the worker
   automatically retargets the nearest forest tile and keeps delivering (C5).
7. **Drop-off loss.** Destroying the drop-off mid-carry reroutes the worker to a
   surviving drop-off; with no drop-off left, the worker goes idle, cargo intact (C5).
8. **Mine exhaustion.** A mine running out mid-loop → worker retargets another mine
   or goes idle; never frozen mid-task (C5).
9. **Group movement.** 12+ units ordered through a 2-tile chokepoint: all arrive
   within 60 sim-seconds, then settle — positions stable thereafter, no two idle
   units stacked per C3 (C2, C3). Assert invariants I1 and I4 on every tick of this
   test.
10. **No pass-through, no shove.** Route a moving unit into conflict with both moving
    and idle units, including a head-on meeting in a 1-wide corridor: at every tick
    no two unit centers come within 0.5 tile-widths, and every idle unit's position
    stays exactly unchanged; conflicting movers resolve by waiting or rerouting, and
    the head-on meeting terminates per I3 instead of deadlocking forever (I4).
11. **Unreachable order.** A move order to an enclosed tile terminates per C4 within
    a bounded number of ticks.
12. **Combat math.** damage = max(1, attack − armor); deaths remove entities and
    release supply; ranged attacks produce a projectile that travels and applies
    damage on arrival.
13. **Stats sanity.** A test loads the stats table and asserts every ordering and
    band constraint from the **Stat sanity** paragraph, for both factions.
14. **Production & repair.** Supply cap blocks training and unblocks after a Farm
    completes; training completes after the stats-table duration; a unit trained
    while the building is fully surrounded spawns at the nearest free tile (C6).
    A Worker ordered to repair a damaged building restores it to full HP at the
    stats-table rate and cost, then goes idle.
15. **Placement.** Placement validation rejects every footprint overlapping
    unwalkable terrain, buildings, resource tiles, or units, and accepts a valid
    clear site; an accepted placement can actually be constructed there (C7).
16. **AI progression.** Headless run at difficulty 1: within 5 sim-minutes the AI has
    workers harvesting both resources, has built a Barracks, has trained military
    units, and has launched its first attack wave. After destroying an AI building,
    the AI rebuilds it.
17. **Win/lose.** Destroying all of a side's buildings triggers the correct
    victory/defeat outcome.
18. **Invariant fuzz.** For several seeds: step the full game (both AIs playing, or
    scripted random-but-valid orders drawn from the seeded PRNG) for 2000+ ticks;
    assert I1–I4 hold at every tick and no exception is thrown.
19. **Boot smoke.** Each of the 5 campaign levels can be created headlessly and
    stepped 600 ticks without exceptions.
20. **Input wiring** (jsdom). Dispatch synthetic `MouseEvent`/`KeyboardEvent`s on the
    canvas and assert through the public sim state: click selects the unit under the
    cursor; drag box-selects exactly the units in the rectangle; Shift-click adds to
    the selection; right-click on ground / enemy / resource issues move / attack /
    harvest; Ctrl+1 then 1 recalls the control group; a click on a HUD train button's
    rectangle enqueues training. Broken control wiring is invisible to code review —
    these tests are how it gets caught.
21. **UI layout.** For at least two viewport sizes (e.g. 1280x720 and 1920x1080):
    every interactive HUD element lies fully inside the viewport, no two sibling
    interactive rectangles overlap (a child contained within its parent panel is
    fine), the minimap and selection panel do not cover the resource bar, and
    hit-testing returns each element at its own center point.
22. **AI-vs-AI soak.** Run a full AI-vs-AI match headlessly on at least one level:
    the match reaches a victory/defeat outcome within a stated sim-time cap (e.g.
    30 sim-minutes — no stall into mutual passivity), with I1–I4 asserted at a
    sampling interval (e.g. every 10 ticks). This is the whole-game deadlock/livelock
    detector. Keep it under ~60 s wall-clock, and raise this test's vitest timeout
    explicitly — that is scenario configuration, not gate-weakening.
23. **Performance canary.** A scenario with 100+ units stepping 1000 ticks completes
    headlessly within a generous wall-clock bound (e.g. 10 s) — a regression canary
    against accidental O(n²) blowups, not a benchmark.

This list is the floor, not the ceiling — add unit tests for any non-trivial pure
logic (stats lookups, fog state transitions, supply accounting, placement validation).
Expect the final suite to land at 40+ test cases and 100+ assertions; a thin suite
that technically touches each bullet will be graded as superficial.

## Execution strategy & completion protocol

- Build a vertical slice first (generate map → render → select → move → harvest →
  train → fight → win), then broaden to the full spec. A playable core with every
  gate green beats a sprawling half-wired feature set.
- Keep `npm run verify` green as you go; never pile up type or lint debt.
- Before declaring completion: run `npm run verify` one final time from a clean state
  (`rm -rf node_modules dist && npm install && npm run verify` must succeed), and
  re-read this spec top to bottom checking each requirement against the code.
- `README.md`: how to run, full controls reference, architecture overview
  (simulation / rendering / input separation, and how the headless sim enables the
  behavioral tests), and every spec decision or deviation you made.
