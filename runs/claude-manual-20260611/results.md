# Results — claude-manual-20260611 (001-rts-wfc, out-of-matrix)

cq-flow (investigate/plan/implement) multi-agent orchestrated build of the
"Warband" RTS over multiple sequential sessions (T1–T20 + T21 this entry).
NOT a single autonomous pi run. Duration (28000 s) represents approximately
8 hours of wall-clock orchestration time and is not comparable to the
single-agent pi-run cells; it is recorded here for completeness.

Validated by claude-sonnet-4-6 (this task) with the same methodology used
for the 20260610 manual run: automated battery results sourced from the gate
task T20, code-review items graded from source with file:line evidence.

## Scores

| Item | claude-opus-4-8 |
|---|---|
| A1–A8 automated | 8/8 |
| R1 WFC authenticity | 2 |
| R2 playability pass | 2 |
| R3 pathfinding | 2 |
| R4 architecture | 2 |
| R5 AI structure | 2 |
| R6 type discipline | 2 |
| R7 smells | 1 |
| **Total /22** | **21** |

## Automated detail (A1–A8, all PASS)

- **A1** `npm install` exit 0.
- **A2** `dependencies` absent from package.json; `npm ls --prod` empty tree.
  No game engine/framework in the dependency tree.
- **A3** `npm run build` exit 0; `dist/` produced.
- **A4** `tsconfig.json` `"strict": true`; `npx tsc --noEmit` exit 0.
- **A5** `npm run lint` exit 0.
- **A6** 275 test assertions across 20 files, covering:
  - WFC propagation/determinism: wfc 13, mapgen_scarcity 7
  - A\*: astar 12
  - Combat: combat 21
  - Supply/economy: economy 17 + 1
  - Sim/determinism: sim 11, movement 25
- **A7** `npm run preview` HTTP 200 on `/`; HTML references built bundle.
- **A8** `Math.random` appears only in `src/core/rng.ts:134` (documented
  fallback in seed generation: mixes `Date.now()` and `Math.random()` when
  no `?seed=` is present). `seedFromUrl` parses `?seed=` from `window.location`.
  `hud.ts` renders the active seed in the HUD.

## Code-review detail (R1–R7)

### R1 WFC authenticity — 2/2 (genuine)

Full WFC solver in `src/wfc/wfc.ts`:
- Shannon entropy with precomputed `weightLog` arrays (`wfc.ts:56–74`).
- Reservoir tie-break for minimal-entropy cell selection (`wfc.ts:163–188`).
- Weighted collapse via `weightedPick` (`wfc.ts:80–98`).
- Stack-based constraint propagation to a fixpoint via `supportMask` union
  over allowed-neighbour bitmasks (`wfc.ts:106–158`).
- Bounded restart on contradiction with deterministically forked RNG per
  attempt (`wfc.ts:252–263`).
- Explicit symmetric adjacency table in `src/wfc/tiles.ts`
  (referenced as `ADJACENCY_MASKS`).

### R2 playability pass — 2/2 (genuine)

Engineered pass in `src/wfc/mapgen.ts`:
- Flood-fill largest land component labelling (`mapgen.ts:165–203`); requires
  ≥ 25% of cells (`MIN_COMPONENT_FRACTION = 0.25`, `mapgen.ts:69`).
- Double-BFS diameter-endpoint start selection for maximal separation
  (`mapgen.ts:613–633`); minimum separation fraction 0.45 (`mapgen.ts:66`).
- Bresenham corridor carving when components or starts are not adequately
  connected (`mapgen.ts:301–326`, `carveCorridor`).
- Buildable clearing of radius 2 stamped around each start (`mapgen.ts:362–374`).
- Gold mine + forest guaranteed within `RESOURCE_REACH = 10` land steps
  (`mapgen.ts:496–516`, `ensureResourcesNear`).
- Clamped fairness score (gold cap 3, forest cap 6) with tolerance 2
  (`mapgen.ts:551–596`, `balanceResources`).
- All randomness on deterministically forked per-level RNG streams
  (`mapgen.ts:656–658`, `levelRng`); report object emitted (`mapgen.ts:812–826`).

### R3 pathfinding — 2/2 (genuine)

Full A* in `src/sim/astar.ts`:
- Binary min-heap open set (`astar.ts:79–135`).
- Octile admissible heuristic: `DIAGONAL_COST * lo + CARDINAL_COST * (hi - lo)`
  (`astar.ts:61–68`).
- No-corner-cutting: diagonal step blocked if either shared cardinal cell is
  blocked (`astar.ts:235–238`).
- `stopAdjacent` mode for harvesting/attacking blocked targets (`astar.ts:48–55`).
- Expansion budget (`astar.ts:41–46`, `opts.budget`).
- Movement integration in `src/sim/movement.ts` calls `astar` for path planning;
  pairwise separation in the same module resolves unit overlap (`movement.ts:1–41`).

### R4 architecture — 2/2 (genuine)

- Fixed timestep at `SIM_HZ = 30` Hz in `src/sim/tick.ts:20`; accumulated in
  `GameSession.frame(realDtMs)` (`src/game/session.ts`).
- Clear phase ordering in `SIM_PHASES`: ai → orders → movement → combat →
  economy → fog → cleanup (`src/sim/simulation.ts:6–27`).
- Render fully separated: `src/render/renderer.ts` is a pure read of
  `World + FogMap`, no mutation, no `Math.random`.
- Input fully separated: `src/input/input.ts` mutates only the `InputContext`;
  never calls `stepWorld` or `Math.random`.
- Data-driven stats: `src/sim/stats.ts` holds `UNIT_NUMERIC` and
  `BUILDING_NUMERIC` keyed by typed `UnitKind`/`BuildingKind` enums, with
  faction names overlaid — no magic numbers scattered through combat/economy
  (`stats.ts:85–186`).

### R5 AI structure — 2/2 (genuine)

Full scripted-strategy AI in `src/sim/ai.ts` (815 lines):
- Think-interval loop (`THINK_INTERVAL = SIM_HZ = 30` ticks, `ai.ts:56`).
- Worker saturation target per difficulty (`WORKER_TARGET`, `ai.ts:59`).
- Supply-aware build order: Farm → Barracks → Lumber Mill → Guard Towers,
  one order per think (`ai.ts:439–469`, `runBuildOrder`).
- Mixed-army composition ratios infantry:ranged:heavy = 3:2:1 (`ARMY_MIX`,
  `ai.ts:128`), chosen by under-representation ratio (`ai.ts:514–536`).
- Escalating attack waves with `FIRST_WAVE_TICK` per difficulty and
  `WAVE_ESCALATION_STEP = 2` per wave sent (`ai.ts:83–90`, `ai.ts:634–636`).
- Base defense: nearest-threat scan within `BASE_THREAT_RADIUS = 12` tiles;
  overrides march (`ai.ts:706–717`).
- Explicit Town Hall rebuild in `runRebuild` (`ai.ts:493–499`); Farm/Barracks/
  LumberMill/GuardTower rebuild via `hasBuildingAnyProgress` check in
  `runBuildOrder` (`ai.ts:450`, `ai.ts:456`, `ai.ts:461`).
- Difficulty 1–5 scaling: one-time start bonus, per-think harvest-rate bonus
  proportional to active harvesters (`ai.ts:602–627`).

### R6 type discipline — 2/2 (genuine)

- Zero `any` TypeScript type annotations in source (confirmed by grep).
- Only ~6 non-null assertions (`expr!`) across the whole ~11k-LOC codebase
  (`combat.ts` `world.units/buildings/projectiles.get(id)!` after a known-present
  id ×3, `wfc.ts` guarded `stack.pop()!`, `economy.ts` `unit.carrying!`/
  `building.order!` after presence checks) — all legitimate, and well below the
  20260610 opus-4-8 cell's 24. (An earlier self-grade mis-counted the 309
  boolean `!`/`!=`/`!==` occurrences as non-null assertions; corrected here after
  a rigorous postfix-`!` recount.) Strict-null discipline is strong under
  `"strict": true`.
- `src/render/renderer.ts:83,141` use `Record<string, string>` where a typed
  record keyed by `BuildingKind`/`UnitKind` would be marginally cleaner (trivial
  leaf-module nit, not score-affecting).

### R7 smells — 1/2 (minor issues present)

- Two files exceed the ~800-line threshold: `src/sim/movement.ts` (1114 lines)
  and `src/sim/economy.ts` (1028 lines). Both are focused single-concern modules
  (movement integration/separation and economy/harvesting/construction), so
  they are not god files in the cross-cutting-concern sense, but they do
  represent the top-end of comfortable reviewability.
- No detectable copy-paste blocks or dead code.
- No magic numbers in the stats/combat/economy domain — all quantities are
  named constants or stats-table entries.
- Score: 1/2 (the two over-long files are a mild smell, not a pervasive problem).

## Methodology note

This cell was built by the cq-flow multi-agent harness (investigate → plan →
implement tasks T1–T20), not by a single autonomous pi run. Wall-clock
orchestration spanned approximately 8 hours; `duration_seconds = 28000` is a
proxy for that and is not directly comparable to the single-agent pi cells.

**Defect found and fixed during the build:** a NaN `GATHER_TICKS` harvest
defect caused by a circular-import init-order hazard where `SIM_HZ` was read
as `undefined` at economy.ts module-init. Fixed in T12 by extracting `SIM_HZ`
into the leaf module `src/sim/tick.ts`, resolving the hazard without changing
any API.

**Reviewer-filed defects:** the adversarial review pass filed 6 defects during
the implement phase; all 6 were resolved before the T20 gate pass.

## Manual checklist (pending human verification)

Same M1–M10 as `prompts/001-rts-wfc/checklist.md`:

```
cd runs/claude-manual-20260611/claude-opus-4-8/workspace && npm run dev -- --host 0.0.0.0
```

- [ ] M1 loads & starts — level select appears, level 1 starts, seed visible, no console errors
- [ ] M2 economy loop — select Worker, harvest gold and wood, build Farm + Barracks, train units, supply cap enforced
- [ ] M3 control feel — box select, shift-add, control groups, right-click orders, minimap + edge scrolling all work
- [ ] M4 combat — attack-move engages, ranged projectiles visible, auto-acquire works, damage/armor plausible, corpses clear
- [ ] M5 pathfinding feel — a 12+ unit group ordered across the map arrives and settles; no permanent jams around chokepoints
- [ ] M6 fog of war — unexplored black, explored memory, enemies hidden until seen; minimap consistent
- [ ] M7 AI opponent — AI economy visibly develops; first attack wave arrives; AI defends and rebuilds; difficulty 1 is beatable
- [ ] M8 WFC maps — same seed reproduces the same map; different seeds differ; terrain looks locally coherent; both starts viable
- [ ] M9 campaign — winning advances; later levels are visibly larger/harder
- [ ] M10 performance — late-game battle (~100 units) stays smooth; speed toggle and pause work

All M1–M10 items are pending human verification.
