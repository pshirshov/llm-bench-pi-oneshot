# Warband — Real-Time Strategy Game

A complete, playable RTS in the spirit of Warcraft 2, delivered as a web application.

## Quick Start

```bash
npm install
npm run dev        # Start dev server
npm run verify     # Run all checks (typecheck + lint + test + build)
```

## Controls

| Action | Control |
|--------|---------|
| Select unit | Left-click |
| Box select | Left-drag |
| Add to selection | Shift+click |
| Context order (move/attack/harvest/repair) | Right-click |
| Control groups | Ctrl+1..9 / 1..9 |
| Pause | Space |
| Speed toggle | Click speed button |
| Cancel/Esc | Escape |
| Scroll viewport | Arrow keys / edge scroll / minimap click |

## Architecture

### Simulation / Rendering / Input Separation

The game is architected in three layers:

1. **Simulation Core** (`src/sim/`, `src/core/`, `src/gen/`, `src/ai/`) — Pure logic, no DOM dependencies. All game state, pathfinding, combat, economy, and AI run headlessly. This is the layer that tests exercise.

2. **Rendering** (`src/render/`) — Canvas 2D renderer that reads game state and draws tiles, entities, fog, and HUD. Uses programmatic placeholder art (colored shapes).

3. **Input/UI** (`src/ui/`) — DOM event handling with hit-test-based UI layout. The layout is computed as pure rectangle data (`computeLayout`), shared by both the renderer and the hit-test function. Input events are translated into simulation orders through this layer.

### Headless Simulation

The simulation core imports nothing from the DOM or Canvas. It can be constructed and stepped headlessly in Node:

```typescript
import { initGame, gameTick } from './src/sim/game';

const state = initGame({ seed: 42, level: 0, playerFaction: 'humans', difficulty: 1 });
for (let i = 0; i < 1000; i++) gameTick(state);
```

This enables the behavioral test suite to verify game logic without a browser.

### Fixed Timestep

The simulation runs at a fixed 20 ticks per second (`TICK_RATE`), decoupled from rendering which targets 60 FPS. The game loop accumulates real time and steps the simulation at fixed intervals.

### Seeded PRNG

All randomness flows through a single Mulberry32 PRNG (`src/core/prng.ts`). The seed is displayed in the UI and can be set via `?seed=<number>` URL parameter for reproducible games.

## Game Features

### Factions
- **Humans**: Town Hall, Farm, Barracks, Lumber Mill, Guard Tower
- **Orcs**: Great Hall, Pig Farm, Barracks, War Mill, Watch Tower

### Units (per faction)
- **Worker** (Peasant/Peon) — Harvests, builds, repairs
- **Melee Infantry** (Footman/Grunt) — Standard combat
- **Ranged** (Archer/Spearthrower) — Ranged attacks, requires Lumber Mill
- **Heavy** (Knight/Ogre) — High HP/damage, requires Barracks + Lumber Mill

### Resources
- **Gold** — Harvested from gold mines
- **Wood** — Harvested from forest tiles (depletes them)
- **Food/Supply** — Capacity from Town Hall and Farms

### Map Generation
Maps are generated using Wave Function Collapse (WFC) with adjacency constraints. Five campaign levels of increasing difficulty (32x32 to 96x96 maps).

### AI Opponent
Scripted-strategy AI that:
- Maintains worker saturation on resources
- Follows a build order (supply, barracks, lumber mill, towers)
- Trains a mixed army
- Sends escalating attack waves
- Defends its base against threats
- Rebuilds destroyed buildings

## Spec Decisions

- **Tile size**: 16px (for rendering)
- **Forest blocks movement**: Yes (walkable=false), but workers can harvest adjacent tiles
- **Gold mine depletion**: Transforms to dirt tile (walkable=true)
- **Worker carry capacity**: 10 gold/wood per trip
- **Harvest duration**: 2 seconds (40 ticks)
- **Attack cooldown**: Varies by unit (16-24 ticks)
- **Diagonal movement**: Allowed (8-directional), no corner cutting through blocked diagonals
- **Building placement**: Rejects water, rock, forest, gold mines, existing buildings, and units

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Typecheck + production build |
| `npm run preview` | Preview production build |
| `npm run test` | Run Vitest test suite |
| `npm run lint` | Run ESLint (0 warnings allowed) |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run verify` | Run all checks (typecheck + lint + test + build) |
