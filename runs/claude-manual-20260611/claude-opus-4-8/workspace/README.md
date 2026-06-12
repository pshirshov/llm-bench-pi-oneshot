# Warband

An in-browser Warcraft-2-style real-time strategy game built with TypeScript, Canvas 2D, and WFC-generated maps.

---

## How to run

```
npm install
npm run dev        # Vite dev server — open the printed URL in a browser to play
```

Other commands:

| Command | Purpose |
|---|---|
| `npm run build` | Type-check (`tsc --noEmit`) then Vite production build |
| `npm run preview` | Serve the production build locally |
| `npm run test` | Vitest unit-test suite |
| `npm run lint` | ESLint |
| `npm run check` | lint + type-check + tests + build (full CI gate) |

**Reproducible maps.** Append `?seed=<integer>` to the URL (e.g. `http://localhost:5173/?seed=42`) to pin the map seed. The active seed is displayed in the HUD resource bar; copy it to share a map.

---

## Gameplay overview

### Factions

Two fully mirrored factions. Numeric stats are identical; only names and colors differ.

| Role | Human | Orc |
|---|---|---|
| Faction identity | Humans | Orcs |

The player chooses a faction in the campaign/level-select screen; the AI controls the opposing faction.

### Resources

| Resource | Source | Notes |
|---|---|---|
| **Gold** | Gold-mine tiles | Workers harvest and carry back to Town Hall |
| **Wood** | Forest tiles | Workers chop and carry back to Town Hall or Lumber Mill; forest depletes |
| **Supply** | Town Hall + Farms | Training is blocked when `supplyUsed >= supplyCap` |

### Buildings (5 per faction)

| Building | Human name | Orc name | HP | Gold | Wood | Footprint | Supply | Notes |
|---|---|---|---|---|---|---|---|---|
| Town Hall | Town Hall | Great Hall | 900 | 0 | 0 | 4×4 | +5 | Resource drop-off; trains Workers |
| Farm | Farm | Pig Farm | 250 | 0 | 250 | 2×2 | +4 | Supply provider |
| Barracks | Barracks | Barracks | 600 | 700 | 450 | 3×3 | 0 | Trains infantry, ranged, heavy |
| Lumber Mill | Lumber Mill | Lumber Mill | 500 | 500 | 450 | 3×3 | 0 | Wood drop-off; unlocks ranged + heavy |
| Guard Tower | Guard Tower | Watch Tower | 400 | 550 | 200 | 2×2 | 0 | Static ranged defense |

Town Hall and Farm have no building prerequisites. Barracks requires Town Hall. Lumber Mill and Guard Tower each require Barracks.

### Units (4 per faction)

| Role | Human name | Orc name | HP | Armor | Damage | Range | Speed | Gold | Wood | Supply |
|---|---|---|---|---|---|---|---|---|---|---|
| Worker | Peasant | Peon | 40 | 0 | 5 | 1 | 3.0 | 75 | 0 | 1 |
| Infantry | Footman | Grunt | 60 | 2 | 10 | 1 | 3.5 | 100 | 0 | 1 |
| Ranged | Archer | Spearthrower | 40 | 0 | 9 | 5 | 3.0 | 100 | 50 | 1 |
| Heavy | Knight | Ogre | 120 | 4 | 18 | 1 | 2.5 | 200 | 100 | 2 |

Workers are trained at the Town Hall. Infantry, ranged, and heavy units are trained at the Barracks.

**Prerequisites:** Worker — none. Infantry — Barracks. Ranged — Barracks + Lumber Mill. Heavy — Barracks + Lumber Mill.

**Combat formula:** `damage dealt = max(1, attacker.damage − defender.armor)`.

### Win/lose

A side loses when all its buildings are destroyed. On victory the next campaign level is unlocked and a victory screen is shown. On defeat a defeat screen is shown.

---

## Controls reference

All bindings correspond directly to handlers in `src/input/input.ts`.

| Input | Action |
|---|---|
| **Left-click** on own unit | Select that unit (deselects previous selection) |
| **Left-click** on own building | Select that building |
| **Left-click** on empty ground | Deselect all |
| **Shift + left-click** on own unit | Add unit to / remove unit from current selection |
| **Left-drag** on canvas | Box-select: selects all own units inside the rubber-band rect |
| **Shift + left-drag** | Box-select and add results to current selection |
| **Right-click** on hostile visible entity | Attack order to all selected units |
| **Right-click** on damaged friendly building | Repair order to all selected units |
| **Right-click** on gold-mine or forest tile | Harvest order to all selected units (workers) |
| **Right-click** on empty tile | Move order to all selected units |
| **Right-click** during placement mode | Cancel building placement |
| **A then left-click** | Attack-move: selected units move to the clicked tile and auto-engage enemies en route |
| **Ctrl + 1–9** | Bind current selection to control group |
| **1–9** | Recall control group (replaces current selection) |
| **Arrow keys** | Scroll camera (16 px per keydown) |
| **Screen-edge mouse** | Auto-scroll camera when cursor is within 12 px of canvas edge |
| **Left-click on minimap** | Center viewport on that map point |
| **Space** | Toggle pause |
| **+ or =** | Set simulation speed to 2× |
| **-** | Set simulation speed to 1× |
| **Esc** | Cancel placement mode; or cancel attack-move mode; or issue Stop order to selected units |
| **Left-click on HUD build button** | Enter building-placement mode for that building kind |
| **Left-click on HUD train button** | Queue one unit for training at the selected production building |
| **Left-click on canvas in placement mode** | Confirm building placement at valid tile; no-op on invalid tile |

---

## Architecture overview

### Simulation / rendering / input separation

The codebase enforces a strict layering discipline:

- **`src/sim/`** — headless, deterministic simulation. `stepWorld(world)` advances the world by one tick. It never reads the DOM, never calls `Math.random`, and never renders anything. All phases (AI, movement, A\*, combat, economy, fog, spatial) operate on the `World` data structure.
- **`src/render/`** — read-only renderer. `src/render/renderer.ts` reads `World` state and draws to a Canvas 2D context. It never mutates `World`.
- **`src/input/input.ts`** — translates raw DOM events into selection-state changes and unit orders on `World`. It never calls `stepWorld` and never renders.
- **`src/game/session.ts`** — `GameSession` owns a `World`, a `Camera`, and one `InputContextWithDrag`. It exposes `frame(realDtMs)` and win/lose detection; it performs no rendering or DOM access itself.
- **`src/main.ts`** — the thin app shell: attaches the `rAF` render loop, constructs a `GameSession`, calls `frame()` on each animation frame, and delegates all rendering to the renderer.

### Fixed-timestep loop

`GameSession.frame(realDtMs)` accumulates wall-clock time scaled by the speed multiplier (`1×` or `2×`) and drains it in whole simulation steps of `1000 / SIM_HZ` ms each, clamped against spiral-of-death. The renderer fires every `rAF` tick regardless of how many simulation steps ran, so rendering is decoupled from simulation rate.

`SIM_HZ = 30` — 30 simulation ticks per second. All tick-derived constants (train times, attack cooldowns, harvest durations) are expressed in ticks and annotated with their wall-clock equivalents in comments.

### Spatial partitioning

`src/sim/spatial.ts` implements a uniform-grid spatial hash (`SpatialHash`). Entity positions are hashed into fixed-size cells; range queries only visit cells overlapping the query radius, giving O(k) per query rather than O(n) brute-force. Results are returned in ascending EntityId order for deterministic combat auto-acquire and separation passes.

### Seeded PRNG

`src/core/rng.ts` implements mulberry32, a 32-bit PRNG with forkable substreams. `createRng(seed).fork(label)` derives a child stream via `fmix32` (MurmurHash3 finalizer) without advancing the parent state. All randomness in the game — WFC tile collapse, clearings, AI jitter — flows through `World.rng` or forks derived from it. `Math.random` is used exactly once: as a one-time fallback when no `?seed=` parameter is present.

---

## Level generation

### WFC implementation

`src/wfc/wfc.ts` implements genuine Wave Function Collapse: minimum-entropy cell selection (using the tile-weight entropy formula), weighted random tile choice from collapsed superpositions, and constraint propagation via arc-consistency over an explicit adjacency-rule table. The tile set is: `grass`, `dirt`, `forest`, `water`, `rock`, `goldMine`. Each tile type has a defined adjacency table and per-type weight. The `scarcity` knob (see below) scales the weights, raising constrained-terrain frequency and lowering free-resource frequency.

### Playability and repair pass

Raw WFC output satisfies adjacency rules but not playability. `src/wfc/mapgen.ts` wraps the solver with a deterministic repair pass that guarantees:

1. **Full land connectivity.** All disconnected land components are connected by Bresenham corridors (widened by 1 tile), so any two land cells are 4-connected reachable.
2. **Two well-separated starts.** Selected as graph-diameter endpoints of the largest land component via double-BFS. Starts separated by less than 45% of `max(width, height)` trigger a direct corridor and re-selection.
3. **Buildable clearings.** A 2-tile Chebyshev clearing (grass/dirt) is stamped around each start.
4. **Resources within reach.** Each start must have a gold mine and a forest within 10 land steps (BFS). Missing resources are placed on the nearest qualifying plain-ground cell.
5. **Approximate resource fairness.** A clamped fairness score (`min(gold, 3) + min(forest, 6)` within a 12-tile Chebyshev radius) is balanced between the two starts within a tolerance of 2. Clamping is intentional: WFC can produce resource-dense pockets (40 trees vs 18 trees) that are both effectively unlimited in practice; the metric rewards having *enough* rather than requiring identical raw tile counts.

Up to 12 collapse/repair attempts are made per map. The final attempt always succeeds (forced corridor carving), so `generateMap` never throws.

### Per-level seeds

Each level's map is derived from `(campaignSeed, levelIndex)` via `createRng(campaignSeed).fork("campaign-level").fork(levelIndex)`. Identical arguments reproduce the same grid bit-for-bit.

### 5-level campaign

| Level | Name | Size | AI Difficulty | Scarcity | Terrain feel |
|---|---|---|---|---|---|
| 0 | Greenfields | 32×32 | 1 | 0.00 | Open rolling grassland; few obstacles, generous resources |
| 1 | Riverbend | 48×48 | 2 | 0.20 | Rivers and lakes split the field; resources still plentiful |
| 2 | Stonewatch | 64×64 | 3 | 0.45 | Rocky highlands with mountain ridges and tighter passes |
| 3 | The Narrows | 80×80 | 4 | 0.65 | Water and rock force narrow chokepoints; resources scarcer |
| 4 | Ironhold | 96×96 | 5 | 0.85 | Cramped, heavily obstructed terrain; the scarcest resources |

Scarcity 0 leaves the WFC weights unchanged (level 0 is bit-identical to the pre-scarcity generator). The playability/repair pass runs identically at every scarcity level, so the hard guarantees (reachable starts, gold + forest within reach) hold even at scarcity 0.85.

Level progress is persisted in `localStorage` under key `warband.campaign.progress.v1` and is monotonic (winning an early level never relocks later ones).

---

## AI opponent

The AI is a scripted-strategy controller (`src/sim/ai.ts`). It runs on a think interval of 30 ticks (~1 s) and controls the non-player faction by issuing the same orders available to a human player.

### Behavior

1. **Worker saturation.** Idle workers are sent harvesting (gold and wood). The Town Hall trains more workers until a difficulty-dependent saturation target (8–16 workers).
2. **Supply-aware build order.** A Farm is queued before supply headroom drops to the difficulty threshold (3–7 supply free), preventing supply stalls. Full build priority order: Farm (supply-ahead) → Barracks → Lumber Mill → Guard Towers (target: 2). At most one build order per think pass so not all workers are pulled off harvesting simultaneously.
3. **Continuous mixed army.** The Barracks trains infantry, ranged, and heavy units continuously at a 3:2:1 weight ratio, respecting prerequisites, resources, and supply. Army is capped at 40 supply-equivalent to keep matches winnable.
4. **Escalating attack waves.** The first wave launches no earlier than the difficulty's minimum tick (4:00 at d1, 3:00 at d2, 2:00 at d3, 1:30 at d4, 1:00 at d5). The threshold to launch a wave is `WAVE_BASE_THRESHOLD[difficulty] + wavesSent × 2` (base threshold: 6/6/8/8/10 for difficulties 1–5). Each wave commits the whole available army to an attack-move on the player's Town Hall.
5. **Base defense.** If any hostile unit is within 12 Chebyshev tiles of the AI's Town Hall, all free military units are recalled to engage it. Defense overrides wave marching until the threat clears.
6. **Rebuild.** The AI re-issues build orders for destroyed buildings when resources allow. The Town Hall (never re-built by the normal build order) gets its own rebuild check.

### Difficulty scaling

| Difficulty | Workers target | Start gold bonus | Start wood bonus | Harvest bonus / worker / think | First wave tick |
|---|---|---|---|---|---|
| 1 | 8 | +0 | +0 | +0 | 4:00 |
| 2 | 10 | +150 | +75 | +1 | 3:00 |
| 3 | 12 | +350 | +175 | +2 | 2:00 |
| 4 | 14 | +600 | +300 | +3 | 1:30 |
| 5 | 16 | +1000 | +500 | +5 | 1:00 |

The harvest-rate bonus is proportional to the number of workers actively harvesting that tick, so it acts as a rate multiplier on real harvesting effort rather than free income.

---

## Spec decisions

Where PROMPT.md left details open, the following choices were made:

- **SIM_HZ = 30.** 30 simulation ticks per second. The render loop runs at native rAF (up to 60 fps) decoupled from simulation steps.
- **Faction stat values.** Specific HP, armor, damage, speed, and cost values were chosen to be genre-conventional (heavier units cost more and hit harder but move slower; workers are cheap and fragile). All numeric stats are mirrored between factions; only names differ.
- **Clamped resource-fairness metric.** Fairness is judged on `min(gold, 3) + min(forest, 6)` within a 12-tile radius, tolerating a difference of up to 2 points. Raw tile counts are not equalised because WFC naturally produces resource-dense pockets that are both practically unlimited; the metric rewards sufficiency.
- **AI army composition ratio 3:2:1** (infantry:ranged:heavy). A simple weight-based ratio that produces a mixed force without over-investing in expensive heavies early.
- **Army soft cap at 40 supply.** Prevents the AI from training an unbounded swarm while keeping headless tests fast.
- **Per-level scarcity values** (0, 0.20, 0.45, 0.65, 0.85). Chosen to produce a noticeable step-up in terrain constraint and resource scarcity at each level while still generating playable maps within the 12-attempt budget.
- **Minimum start separation: 45% of max(width, height).** Ensures starts are not cramped together on any map size.
- **Speed toggle keys.** `+`/`=` sets 2× speed; `-` sets 1× speed. No 3× or above is implemented.
- **Building placement.** An invalid tile click in placement mode is silently ignored (placement stays active); right-click or Esc cancels.
- **No auto-save mid-match.** Campaign progress (which levels are unlocked) persists via `localStorage`; in-match state is not persisted across page reloads.
- **Programmatic art.** All sprites and tile graphics are drawn with Canvas 2D geometric primitives; no image assets are loaded.
