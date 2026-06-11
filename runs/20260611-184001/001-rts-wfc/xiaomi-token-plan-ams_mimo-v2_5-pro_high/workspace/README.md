# Warband — Real-Time Strategy Game

A complete, playable in-browser RTS inspired by Warcraft 2, built with TypeScript, Canvas 2D, and zero runtime dependencies.

## Quick Start

```bash
npm install
npm run dev      # Start dev server (opens browser)
npm run build    # Production build
npm run test     # Run tests
npm run lint     # Lint code
```

## URL Parameters

- `?seed=<number>` — Set map seed for reproducible games
- `?faction=humans|orcs` — Pre-select faction
- `?level=<0-4>` — Skip to campaign level

## Controls

### Camera
- **Arrow keys** or **edge of screen mouse** — Scroll viewport
- **Minimap click/drag** — Jump to location

### Selection
- **Left click** — Select single unit/building
- **Left drag** — Box select multiple units
- **Shift + click/drag** — Add to selection
- **Ctrl+1..9** — Save control group
- **1..9** — Load control group

### Commands
- **Right click** — Context-sensitive command:
  - On ground: Move
  - On enemy: Attack
  - On resource (with worker): Harvest
  - On friendly building (with worker): Repair
- **Right click in build mode** — Confirm building placement
- **Escape** — Cancel build/deselect

### Game
- **Space** — Pause/Resume
- **+ (or =)** — Toggle 1x/2x speed

## Architecture

The game uses a clean separation between simulation, rendering, and input:

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Input      │────▶│  Simulation  │────▶│  Rendering  │
│  (UI/DOM)   │     │  (Fixed 60Hz)│     │  (Canvas 2D)│
└─────────────┘     └──────────────┘     └─────────────┘
                           │
                    ┌──────┴──────┐
                    │   Systems   │
                    ├────────────┤
                    │ Pathfinding │
                    │  Combat     │
                    │  Fog of War │
                    │  AI         │
                    │  Resources  │
                    └────────────┘
```

### Key Systems

**Game Loop** (`src/engine/simulation.ts`)
- Fixed-timestep simulation at 60Hz, decoupled from rendering
- Frame-rate independent movement and timers
- Accumulator pattern prevents spiral of death

**Pathfinding** (`src/pathfinding/astar.ts`)
- A* on tile grid (8-directional)
- No corner cutting through blocked diagonals
- Path simplification for smooth movement

**Map Generation** (`src/map/wfc.ts`)
- Wave Function Collapse with adjacency constraints
- Weighted tile selection with minimal-entropy cell picking
- Playability pass ensures two valid start locations with resources

**Combat** (`src/combat/combat.ts`)
- Damage = attacker.damage - defender.armor (minimum 1)
- Ranged attacks spawn visible projectiles
- Auto-attack for idle units in sight range

**Fog of War** (`src/fog/fog.ts`)
- Three states: unexplored (black), explored (dim), visible (live)
- Sight radius from all player entities
- Minimap respects fog state

**AI** (`src/ai/ai.ts`)
- Scripted build order (supply → barracks → lumber mill → towers)
- Worker saturation management (gold priority, then wood)
- Escalating attack waves with difficulty scaling
- Base defense: pulls military to threats

## Design Decisions

**Determinism**: All randomness flows through a seeded PRNG (mulberry32). The seed is displayed in UI and settable via URL parameter. Any map can be reproduced exactly.

**No Runtime Dependencies**: The game runs entirely on Canvas 2D with no external libraries. Dev dependencies (Vite, TypeScript, Vitest, ESLint) are for build/dev only.

**Campaign Progression**: 5 levels with increasing map size (32×32 to 96×96), terrain constraints, and AI difficulty (1-5). Level unlock state persisted in localStorage.

**Faction Symmetry**: Humans and Orcs have identical mechanics with different names/colors. This simplifies balance while maintaining thematic distinction.

**Spatial Partitioning**: For 100+ units, the sight-radius check uses simple distance calculations. A spatial hash could be added for larger unit counts.

**Supply System**: Town Hall provides 10 supply, Farms provide 6 each. Training is blocked at supply cap, forcing players to build farms proactively.

## Testing

29 tests covering:
- **WFC**: Determinism, adjacency constraints, tile type coverage
- **Pathfinding**: Shortest path, obstacle avoidance, corner cutting, unreachable handling
- **Combat**: Damage math, minimum damage, range checks
- **Supply**: Resource accounting, capacity management

## Project Structure

```
src/
├── engine/          # Core types, PRNG, simulation loop
├── entities/        # Entity stats, creation, management
├── map/             # WFC map generation
├── pathfinding/     # A* implementation
├── combat/          # Damage calculation, projectiles
├── fog/             # Fog of war system
├── ai/              # AI controller
├── ui/              # Renderer, HUD, input handling
└── main.ts          # Entry point, game loop, input setup

tests/               # Unit tests (vitest)
index.html           # Game shell with HUD elements
```
