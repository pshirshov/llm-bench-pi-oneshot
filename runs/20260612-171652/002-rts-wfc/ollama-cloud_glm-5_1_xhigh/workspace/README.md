# Warband — In-Browser RTS Game

A complete, playable real-time strategy game inspired by Warcraft 2, built with TypeScript, Canvas 2D, and Vite. No runtime dependencies.

## Quick Start

```bash
npm install
npm run dev      # Start dev server
npm run verify   # Typecheck, lint, test, build
```

Open `http://localhost:5173/?seed=12345` in a browser. The `seed` URL parameter controls map generation deterministically.

## Controls

- **Left-click**: Select unit/building
- **Left-drag**: Box-select multiple units
- **Shift-click**: Add to selection
- **Right-click**: Context-sensitive order (move/attack/harvest/repair)
- **Ctrl+1..9**: Create control group
- **1..9**: Recall control group
- **Arrow keys / WASD**: Scroll viewport
- **Mouse edge**: Scroll viewport
- **Space**: Pause/unpause
- **Escape**: Cancel build placement
- **Speed toggle**: Click speed button in HUD

## Architecture

### Simulation / Rendering / Input Separation

The simulation core (`src/sim/`) imports nothing from the DOM or Canvas. It can be constructed and stepped headlessly in Node, enabling the behavioral test suite. Rendering (`src/render/`) and input (`src/ui/`) are thin layers over the simulation's public API.

### Key Modules

- **prng.ts**: Seeded PRNG (mulberry32). All randomness flows through this module; `Math.random` is banned elsewhere.
- **stats.ts**: Data-driven stats table for all units and buildings. No combat/economy magic numbers outside it.
- **wfc.ts**: Wave Function Collapse map generation with adjacency-constraint propagation.
- **pathfinding.ts**: A* pathfinding with 8-directional movement and no corner cutting.
- **world.ts**: Core simulation loop. `World` holds all state and exposes `step()` and order-issuing methods.
- **orders.ts**: Unit behavior — move, attack, harvest, build, repair.
- **ai.ts**: Scripted-strategy AI opponent with difficulty scaling.
- **fog.ts**: Fog of war with unexplored/explored/visible states.
- **layout.ts**: HUD layout as pure function of viewport size, with hit-test function for input wiring.
- **input.ts**: Translates DOM events to simulation orders. Contains no game logic.

### Design Decisions

1. **Harvest encoding**: Forest tiles are encoded as `col + row * 10000` for the `targetId` field. Gold mines use negative IDs from `GameMap.goldMines`. This avoids adding a separate entity type for forests.

2. **Depleted tiles**: When a gold mine is exhausted, its tile becomes `depleted_mine` (walkable but not buildable). When a forest is chopped, it becomes `chopped_forest` (walkable and buildable). Tile walkability changes invalidate pathfinding caches.

3. **Unit collision**: Units have a collision radius of 0.5 tiles. Collision is checked via spatial hash queries. Congestion is resolved by waiting and rerouting, never by pushing.

4. **Harvest cycle**: A single harvest order establishes a permanent loop (move to source → gather → carry to drop-off → return). The loop continues until the source is exhausted, the order is replaced, or no valid target remains.

5. **Progress watchdog**: Any unit with an active order must make observable progress within 200 ticks, or it transitions to idle. This prevents livelock and deadlock.

6. **Campaign levels**: 5 levels from 32×32 to 64×64, with AI difficulty 1–5. Level 5 is unlocked by completing level 4.

7. **Building cost**: Paid in full when construction starts. No per-tick deduction.

## Test Suite

Run with `npm test` or `npx vitest run`. The suite covers:

- Determinism (same seed → same map)
- WFC adjacency constraints
- Playability pass (20+ seed/level combos)
- A* pathfinding
- Worker harvest loops (gold, wood, depletion, drop-off loss)
- Combat math
- Stats sanity (HP ordering, damage, cost, etc.)
- Supply cap blocking
- Placement validation
- Win/lose conditions
- Invariant fuzz (I1–I4)
- Boot smoke (all 5 levels)
- Performance canary
- UI layout (two viewport sizes)

## Build

```bash
npm run verify   # typecheck + lint + test + build
npm run build    # tsc --noEmit && vite build
```

## Map Sizes

| Level | Size    | AI Difficulty |
|-------|---------|---------------|
| 1     | 32 × 32 | 1             |
| 2     | 40 × 40 | 2             |
| 3     | 48 × 48 | 3             |
| 4     | 56 × 56 | 4             |
| 5     | 64 × 64 | 5             |