/**
 * Main game simulation: initialization, tick processing, win/lose.
 */

import type { GameState, GameConfig, Faction, UnitType, BuildingType } from '../core/types';
import { TICK_RATE, PROGRESS_WATCHDOG_TICKS } from '../core/types';
import { generateMap } from '../gen/mapgen';
import { createUnit, createBuilding, hasBuildings } from './entities';
import { processMovement } from './movement';
import { processCombat } from './combat';
import { processHarvesting, createForestEntity } from './economy';
import { processTraining, processConstruction, processRepair } from './orders';
import { updateFog } from './fog';

/**
 * Initialize a new game state.
 */
export function initGame(config: GameConfig): GameState {
  const map = generateMap(config.seed, config.level);

  const state: GameState = {
    map,
    entities: [],
    nextEntityId: 1,
    resources: { humans: { gold: 500, wood: 500 }, orcs: { gold: 500, wood: 500 } },
    supplyUsed: { humans: 0, orcs: 0 },
    supplyCap: { humans: 0, orcs: 0 },
    tick: 0,
    winner: null,
    speed: 1,
    paused: false,
    seed: config.seed,
  };

  // Create starting buildings and units
  createStartingEntities(state, config);

  // Create forest entities for harvesting
  createForestEntities(state);

  // Initial fog update
  updateFog(state, 'humans');
  updateFog(state, 'orcs');

  return state;
}

/**
 * Create starting buildings and units for both factions.
 */
function createStartingEntities(state: GameState, config: GameConfig): void {
  // Player starting entities
  createStartingFaction(state, config.playerFaction, config.difficulty);
  // AI starting entities
  const aiFaction: Faction = config.playerFaction === 'humans' ? 'orcs' : 'humans';
  createStartingFaction(state, aiFaction, config.difficulty);
}

/**
 * Create starting entities for a faction.
 */
function createStartingFaction(state: GameState, faction: Faction, difficulty: number): void {
  const start = state.map.startLocations[faction];
  createBuilding(state, faction, 'townHall', start.x, start.y);

  // Starting workers (3-5 based on difficulty)
  const workerCount = 3 + Math.min(2, difficulty - 1);
  for (let i = 0; i < workerCount; i++) {
    const angle = (i / workerCount) * Math.PI * 2;
    const wx = start.x + 2 + Math.cos(angle) * 2;
    const wy = start.y + 2 + Math.sin(angle) * 2;
    createUnit(state, faction, 'worker', wx, wy);
  }
}

/**
 * Create forest entities for all forest tiles.
 */
function createForestEntities(state: GameState): void {
  for (let y = 0; y < state.map.height; y++) {
    for (let x = 0; x < state.map.width; x++) {
      if (state.map.tiles[y * state.map.width + x] === 'forest') {
        createForestEntity(state, x, y);
      }
    }
  }
}

/**
 * Process one simulation tick.
 */
export function gameTick(state: GameState): void {
  if (state.paused || state.winner) return;

  state.tick++;

  // Process all systems
  processMovement(state);
  processCombat(state);
  processHarvesting(state);
  processTraining(state);
  processConstruction(state);
  processRepair(state);

  // Update fog for both factions
  updateFog(state, 'humans');
  updateFog(state, 'orcs');

  // Clean up dead entities
  cleanupDeadEntities(state);

  // Check win/lose conditions
  checkWinLose(state);

  // Progress watchdog: cancel stuck orders
  processWatchdog(state);
}

/**
 * Clean up dead entities from the entity list.
 */
function cleanupDeadEntities(state: GameState): void {
  state.entities = state.entities.filter(e => e.alive);
}

/**
 * Check win/lose conditions: a side loses when all its buildings are destroyed.
 */
function checkWinLose(state: GameState): void {
  if (state.winner) return;

  const humansAlive = hasBuildings(state, 'humans');
  const orcsAlive = hasBuildings(state, 'orcs');

  if (!humansAlive && !orcsAlive) {
    // Draw — shouldn't happen normally
    state.winner = 'humans'; // Default
  } else if (!humansAlive) {
    state.winner = 'orcs';
  } else if (!orcsAlive) {
    state.winner = 'humans';
  }
}

/**
 * Progress watchdog (I3): cancel orders that haven't made progress.
 */
function processWatchdog(state: GameState): void {
  for (const entity of state.entities) {
    if (!entity.alive || entity.entityType !== 'unit') continue;
    if (entity.order.type === 'idle') continue;

    entity.progressTicks++;
    if (entity.progressTicks > PROGRESS_WATCHDOG_TICKS) {
      // No progress — cancel order
      entity.order = { type: 'idle' };
      entity.path = [];
      entity.progressTicks = 0;
    }
  }
}

/**
 * Get the game speed.
 */
export function getGameSpeed(state: GameState): number {
  return state.speed;
}

/**
 * Set the game speed.
 */
export function setGameSpeed(state: GameState, speed: number): void {
  state.speed = Math.max(0.5, Math.min(3, speed));
}

/**
 * Toggle pause.
 */
export function togglePause(state: GameState): void {
  state.paused = !state.paused;
}

/**
 * Spawn entities for testing.
 */
export function spawnTestUnit(
  state: GameState,
  faction: Faction,
  unitType: UnitType,
  x: number,
  y: number,
) {
  return createUnit(state, faction, unitType, x, y);
}

/**
 * Spawn a building for testing.
 */
export function spawnTestBuilding(
  state: GameState,
  faction: Faction,
  buildingType: BuildingType,
  x: number,
  y: number,
) {
  return createBuilding(state, faction, buildingType, x, y);
}

/**
 * Set resources for testing.
 */
export function setResources(state: GameState, faction: Faction, gold: number, wood: number): void {
  state.resources[faction] = { gold, wood };
}

/**
 * Destroy an entity immediately (for testing).
 */
export function destroyEntity(_state: GameState, entity: { alive: boolean }): void {
  entity.alive = false;
}

/**
 * Serialize game state for determinism testing.
 */
export function serializeState(state: GameState): string {
  return JSON.stringify({
    tick: state.tick,
    resources: state.resources,
    supplyUsed: state.supplyUsed,
    supplyCap: state.supplyCap,
    entities: state.entities.map(e => ({
      id: e.id,
      faction: e.faction,
      x: Math.round(e.x * 100) / 100,
      y: Math.round(e.y * 100) / 100,
      hp: e.hp,
      order: e.order.type,
      alive: e.alive,
    })),
  });
}

/**
 * Get the simulation tick rate.
 */
export function getTickRate(): number {
  return TICK_RATE;
}
