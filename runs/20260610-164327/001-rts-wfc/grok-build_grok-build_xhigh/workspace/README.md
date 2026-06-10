# Warband

A complete browser-based real-time strategy game in the spirit of Warcraft 2.

- **Pure Canvas 2D**, no external assets or runtime frameworks.
- **Seeded deterministic simulation** (mulberry32 PRNG). URL `?seed=12345` reproduces any map and playthrough.
- **Wave Function Collapse** map generator with explicit adjacency rules + post-processing for playability.
- Fixed-timestep simulation (60 Hz), decoupled from render.
- Full fog of war, A* pathfinding (8-dir, no corner cutting), projectiles, supply, AI opponent with build order + waves.
- Campaign of 5 progressively harder levels (32×32 → 80×80, increasing terrain constraints and AI difficulty 1–5).

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build
npm run preview
npm test
npm run lint
```

All scripts (`build`/`test`/`lint`) exit 0 on clean state.

## Controls

- **Left-click** — select unit/building  
- **Left-drag** — box select (add with Shift)  
- **Shift+click** — add to selection  
- **Right-click** — context-sensitive order (move / attack / harvest gold/wood / repair / confirm build site)  
- **Build hotkeys** (with worker selected): `B` Barracks, `F` Farm, `L` Lumber Mill, `T` Guard Tower  
- **Train hotkeys** (with production building selected or default): `W` Worker/Peasant, `I` Infantry/Footman, `R` Ranged/Archer, `H` Heavy/Knight  
- **Control groups**: `Ctrl+1..9` set, `1..9` recall (Shift adds)  
- **Camera**: Arrow keys, mouse at screen edges, minimap click/drag  
- **Space** — pause  
- **2** — toggle 1× / 2× speed  
- **Escape** — deselect / cancel build mode

Selection panel shows build/train buttons with approximate costs. Progress bars appear during construction/training.

## Architecture

- `src/rng.ts` — single seeded PRNG source for everything (mapgen, AI decisions, unit placement).
- `src/wfc.ts` — minimal-entropy WFC with 6-tile set and explicit 8-dir adjacency table. Weighted sampling. Multiple attempts + deterministic fallback.
- `src/mapgen.ts` — WFC wrapper + playability repair: two starts on large walkable areas, gold + forest proximity, mutual reachability (flood-fill + corridor carving), resource fairness.
- `src/pathfind.ts` — A* on walkability grid. Octile heuristic. Explicit corner-cut prevention (diagonal only if both cardinals free). Light smoothing.
- `src/sim.ts` — authoritative fixed-timestep state machine. Entity map + id generation. Orders, harvesting (trip-based), building (worker contribution), combat (melee instant + ranged projectiles), supply accounting, full fog-of-war, AI loop (worker saturation, build order, continuous production, wave timing scaled by difficulty).
- `src/render.ts` / `src/input.ts` — pure presentation + input. Camera, fog draw, minimap, HUD, drag-box, hotkey routing. Build preview ghost.
- `src/ui.ts` — side panel (dynamic from selection), win/lose overlays.
- `src/data.ts` — single source of truth for mirrored faction stats (no magic numbers in sim).
- `src/constants.ts` — tuning values (speeds, sight, timings, map sizes).
- `src/types.ts` — strict nominal types for all domain concepts.
- `tests/` — WFC determinism + constraint propagation, A* correctness (length, no corner cuts, unreachable), combat math + supply (create/kill/train/cap).

Simulation never reads DOM or canvas. Rendering never mutates game state. All randomness is injected via the state’s `rng`.

## Decisions & Open Details (per spec)

- **Faction asymmetry**: purely cosmetic (names, colors, building names, portrait flavor text). All mechanics, costs, timings identical.
- **Gold mines**: represented as special non-walkable-but-harvestable “buildings” (tile type `goldmine`). Workers move to center.
- **Wood harvesting**: targets forest tiles directly (virtual target ids < 0). Chopping does not alter tile permanently (depletion would require extra state not asked for; forests remain for replayability).
- **Pathing & group movement**: simple per-unit A* + local avoidance push. No formation steering; groups naturally spread on arrival. Replans periodically. Good enough for 100+ units.
- **AI strategy**: fixed build priority (farms for supply, barracks, lumbermill, defensive towers). Worker split heuristic (more on gold). Mixed unit training with bias to heavies later. Waves target player Town Hall / average position; defense pulls idle military near base.
- **First wave timing**: ~210 s (3.5 min) at difficulty 1, earlier and larger at higher difficulty.
- **Level progression**: map size 32/40/48/64/80. AI diff = level+1. WFC seed = `hash(campaignSeed, level)`. Starts deterministic per level.
- **Supply**: Town Hall 10 + each Farm 6. Training blocked exactly at cap (checked before spend). Supply refunded on death.
- **Damage**: attacker dmg − defender armor, clamped ≥ 1. Towers ignore some armor.
- **Corpses**: purely visual, fade after ~1.5 s. No resurrection.
- **No external dependencies**: deliberate. All geometry, collision, pathing handwritten.
- **Performance**: 64×64 map + 120+ entities runs well at 60 sim Hz in modern browsers (spatial queries not strictly needed yet; simple O(n) loops are fast enough).

Victory screen appears when the last enemy building is destroyed. Completing level N unlocks N+1. The campaign loops or can be restarted from the main menu.

Enjoy the micro.
