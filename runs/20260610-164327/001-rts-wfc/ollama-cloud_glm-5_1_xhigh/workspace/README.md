# Warband — In-Browser RTS Game

A complete real-time strategy game inspired by Warcraft 2, built entirely in TypeScript with Canvas 2D rendering. No external game engines or runtime dependencies.

## Quick Start

```bash
npm install
npm run dev      # Start dev server
npm run build    # Production build
npm run preview  # Preview production build
npm test         # Run unit tests
npm run lint     # Lint check
```

Open the dev server URL in a browser to play.

## Controls Reference

### Mouse
| Action | Effect |
|--------|--------|
| Left-click | Select unit/building |
| Left-drag | Box select multiple units |
| Shift+left-click | Add to selection |
| Right-click | Context command (move/attack/harvest/repair) |
| Right-click resource tile | Harvest (workers) |
| Right-click enemy | Attack |
| Right-click own damaged building | Repair (workers) |
| Click minimap | Move viewport |

### Keyboard
| Key | Effect |
|-----|--------|
| Arrow keys | Scroll viewport |
| Space | Pause/unpause |
| +/- | Toggle 1x/2x speed |
| Ctrl+1–9 | Save control group |
| 1–9 | Load control group |
| A + right-click | Attack-move |
| S | Stop selected units |
| B | Build Barracks (worker selected) |
| F | Build Farm (worker selected) |
| L | Build Lumber Mill (worker selected) |
| G | Build Guard Tower (worker selected) |
| T | Build Town Hall (worker selected) |
| W | Train Worker (Town Hall selected) |
| I | Train Infantry (Barracks selected) |
| R | Train Ranged (Barracks + Lumber Mill) |
| H | Train Heavy (Barracks + Lumber Mill) |
| Escape | Cancel build mode / deselect |
| Enter | Continue on victory/defeat screen |

### Seed Parameter
Append `?seed=12345` to the URL to set the random seed for map generation. Maps are fully deterministic for a given seed.

## Architecture

### Separation of Concerns

The codebase is structured around a strict simulation/rendering/input separation:

- **Simulation** (`game.ts`, `ai.ts`): All game logic runs in a fixed-timestep loop at 60 Hz. The `simulateTick()` function processes unit orders, movement, combat, resource harvesting, building construction, fog of war, and win/lose checks. The AI controller issues commands independently. No rendering or DOM code touches the simulation state.

- **Rendering** (`renderer.ts`): A pure `Canvas 2D` renderer reads the `GameState` and draws terrain, entities, fog overlay, UI panels, and the minimap. It has no side effects on game state.

- **Input** (`input.ts`): Translates mouse and keyboard events into game commands (move, attack, build, train). Maintains its own UI state (selection rectangle, minimap drag) but delegates command issuance to `game.ts` functions.

### Key Modules

| Module | Responsibility |
|--------|---------------|
| `prng.ts` | Mulberry32 seeded PRNG — all randomness flows through this |
| `types.ts` | All type definitions: enums, interfaces, type aliases |
| `constants.ts` | Data-driven stats tables, tile colors, game constants |
| `wfc.ts` | Wave Function Collapse map generator with adjacency constraints |
| `astar.ts` | A* pathfinding (8-directional, no corner cutting) |
| `game.ts` | Game state, simulation tick, entity creation, all game systems |
| `ai.ts` | Scripted-strategy AI opponent |
| `renderer.ts` | Canvas 2D rendering |
| `input.ts` | Mouse/keyboard input → game commands |
| `main.ts` | Entry point, game loop, initialization |

### Determinism

All randomness (map generation, AI decisions) uses the seeded PRNG. A given seed produces the exact same map every time. The seed is displayed in the HUD and can be set via `?seed=N` URL parameter.

### Fixed Timestep

The simulation runs at 60 ticks/second with a fixed `TICK_DURATION = 1/60s`. The main loop accumulates real time and runs simulation ticks accordingly, decoupled from the rendering frame rate.

## Game Mechanics

### Factions
- **Humans** (blue): Peasant, Footman, Archer, Knight
- **Orcs** (red): Peon, Grunt, Spearthrower, Ogre

Both factions have mirrored mechanics with distinct names and colors.

### Resources
- **Gold**: Harvested from gold mine tiles; carried back to Town Hall
- **Wood**: Harvested from forest tiles (which deplete); carried to Town Hall or Lumber Mill
- **Supply**: Granted by Farms; each unit costs supply; training blocked at cap

### Buildings (5 per faction)
| Building | Cost (G/W) | Footprint | Supply | Notes |
|----------|-----------|-----------|--------|-------|
| Town Hall | 0/0 | 3×3 | +5 | Starting building, trains Workers, gold drop-off |
| Farm | 100/50 | 2×2 | +6 | Supply cap |
| Barracks | 200/100 | 3×3 | 0 | Trains military units |
| Lumber Mill | 150/0 | 2×2 | 0 | Unlocks ranged + heavy units, wood drop-off |
| Guard Tower | 120/60 | 1×1 | 0 | Static ranged defense (ATK 10, RNG 6) |

### Units (4 per faction)
| Unit | Cost (G/W) | Supply | HP | ATK | ARM | RNG | SPD | Notes |
|------|-----------|--------|----|-----|-----|-----|-----|-------|
| Worker | 50/0 | 1 | 40 | 5 | 0 | 1 | 2.5 | Harvests, builds, repairs |
| Infantry | 100/0 | 1 | 60 | 8 | 2 | 1 | 2.8 | Basic melee |
| Ranged | 70/40 | 1 | 40 | 4 | 0 | 5 | 2.8 | Requires Lumber Mill |
| Heavy | 200/80 | 2 | 120 | 12 | 4 | 1 | 2.2 | Requires Barracks + Lumber Mill |

### Combat
- Attack-move: units move to destination and auto-acquire enemies in sight range
- Idle units auto-acquire enemies entering sight range + 2 tiles
- Damage = max(1, attacker ATK − defender ARM)
- Ranged attacks spawn visible projectiles
- Dead units leave fading corpses

### Fog of War
- **Unexplored** (black): Never seen
- **Explored** (dimmed): Seen before, shows last-known terrain
- **Visible** (full color): Currently in unit/building sight range
- Enemy units only visible in visible tiles
- Minimap respects fog states

### AI Opponent
- Maintains worker saturation on gold and wood
- Follows a build order: Farm → Barracks → Farm → Lumber Mill → Farm → Tower → Farm → Tower
- Trains mixed army continuously
- Sends escalating attack waves (first wave ~4 minutes at difficulty 1)
- Defends base by pulling military units to threats
- Difficulty (1–5) scales starting resources, harvest rate bonus, and wave size/cadence

### Win/Lose
- A side loses when all its buildings are destroyed
- Victory/defeat screen shown; Enter advances to level select

## Campaign

5 progressively harder levels:

| Level | Map Size | AI Difficulty | Notes |
|-------|----------|--------------|-------|
| 1 | 32×32 | 1 | Open terrain, abundant resources |
| 2 | 48×48 | 2 | More water features |
| 3 | 64×64 | 3 | Natural chokepoints, scarcer resources |
| 4 | 80×80 | 4 | Mountainous, constrained |
| 5 | 96×96 | 5 | Maximum challenge |

Each level's map is deterministically generated from `(campaign_seed + level * 1000)`.

## Wave Function Collapse Map Generation

Maps are generated using a genuine WFC implementation:
- **Tile set**: grass, dirt, forest, water, rock, gold mine
- **Adjacency constraints**: e.g., water only borders water/dirt; gold mines only in grass/dirt clearings
- **Weighted selection**: per-tile weights influence terrain distribution
- **Post-generation validation**: ensures two reachable start locations with nearby gold mines and forests; re-collapses if constraints fail
- **Deterministic**: same seed produces identical maps

## Tests

21 unit tests covering:
- WFC adjacency constraint symmetry and determinism
- A* correctness (shortest path, obstacle avoidance, corner cutting prevention)
- Combat damage math and supply accounting
- PRNG determinism and range

Run with `npm test`.

## Design Decisions

1. **Programmatic art**: All visuals are colored shapes/symbols drawn in code — no external assets.
2. **Single seeded PRNG**: All randomness (WFC, AI) flows through one `PRNG` instance per game for full determinism.
3. **Data-driven stats**: Unit and building stats live in `constants.ts` tables, not scattered in logic.
4. **No runtime dependencies**: Only dev dependencies (Vite, TypeScript, Vitest, ESLint).
5. **Fixed timestep**: 60 Hz simulation, decoupled from rendering.
6. **Spatial partitioning**: Not implemented yet; adequate for 100+ units on 64×64 maps at 60 FPS in testing.
7. **AI script strategy**: Hardcoded build order with difficulty scaling rather than search-based AI, for predictable and fun gameplay.