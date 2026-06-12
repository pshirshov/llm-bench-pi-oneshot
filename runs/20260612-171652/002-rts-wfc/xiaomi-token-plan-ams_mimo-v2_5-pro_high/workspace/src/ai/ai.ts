/**
 * AI opponent: scripted-strategy AI for the opposing faction.
 * Maintains worker saturation, follows build order, trains army,
 * sends attack waves, defends base, rebuilds destroyed buildings.
 */

import type { GameState, Faction, BuildingType } from '../core/types';
import {
  difficultyWaveSizeMult, difficultyWaveCadenceTicks, TICK_RATE,
} from '../core/types';
import { FACTION_STATS, TECH_REQUIREMENTS } from '../core/stats';
import { getTownHall, hasTechRequirements } from '../sim/entities';
import { enqueueTraining, placeBuilding, isValidPlacement } from '../sim/orders';
import { findPath } from '../core/pathfinding';
import { vecDist } from '../core/types';

/** AI state per faction */
interface AIState {
  readonly faction: Faction;
  readonly difficulty: number;
  lastWaveTick: number;
  waveNumber: number;
  buildQueue: BuildingType[];
  nextBuildCheck: number;
}

/** Create AI state for a faction */
export function createAIState(faction: Faction, difficulty: number): AIState {
  return {
    faction,
    difficulty,
    lastWaveTick: 0,
    waveNumber: 0,
    buildQueue: ['farm', 'barracks', 'lumberMill', 'farm', 'guardTower'],
    nextBuildCheck: 0,
  };
}

/**
 * Process AI logic for one tick.
 */
export function processAI(state: GameState, ai: AIState): void {
  if (state.winner) return;

  // Apply difficulty bonuses
  applyDifficultyBonuses(state, ai);

  // Manage workers
  manageWorkers(state, ai);

  // Build structures
  processBuildOrder(state, ai);

  // Train military units
  trainMilitary(state, ai);

  // Send attack waves
  processAttackWaves(state, ai);

  // Defend base
  defendBase(state, ai);

  // Rebuild destroyed buildings
  rebuildBuildings(state, ai);
}

/**
 * Apply difficulty-based bonuses.
 */
function applyDifficultyBonuses(state: GameState, ai: AIState): void {
  // Harvest rate bonus (give extra resources periodically)
  if (state.tick % (TICK_RATE * 10) === 0) {
    const bonus = (ai.difficulty - 1) * 20;
    state.resources[ai.faction].gold += bonus;
    state.resources[ai.faction].wood += bonus;
  }
}

/**
 * Manage workers: ensure saturation on gold and wood.
 */
function manageWorkers(state: GameState, ai: AIState): void {
  const workers = state.entities.filter(e =>
    e.alive && e.faction === ai.faction && e.entityType === 'unit' && e.unitType === 'worker',
  );

  const idleWorkers = workers.filter(e => e.order.type === 'idle');

  // Find gold mines and forests
  const goldMines = state.entities.filter(e =>
    e.alive && e.entityType === 'building' && e.buildingType === 'goldMine',
  );
  const forests = state.entities.filter(e =>
    e.alive && e.entityType === 'building' &&
    state.map.tiles[Math.floor(e.y) * state.map.width + Math.floor(e.x)] === 'forest',
  );

  // Assign idle workers to resources
  for (let i = 0; i < idleWorkers.length; i++) {
    const worker = idleWorkers[i];
    if (goldMines.length > 0) {
      const mineIdx = i % goldMines.length;
      const mine = goldMines[mineIdx];
      if (mine) {
        worker.order = { type: 'harvest', targetId: mine.id };
        worker.harvestTarget = mine.id;
      }
    } else if (forests.length > 0) {
      const forestIdx = i % forests.length;
      const forest = forests[forestIdx];
      if (forest) {
        worker.order = { type: 'harvest', targetId: forest.id };
        worker.harvestTarget = forest.id;
      }
    }
  }

  // Train more workers if needed
  const townHall = getTownHall(state, ai.faction);
  if (townHall && workers.length < 8) {
    const stats = FACTION_STATS[ai.faction].units.worker;
    if (state.resources[ai.faction].gold >= stats.goldCost &&
        state.supplyUsed[ai.faction] + stats.supplyCost <= state.supplyCap[ai.faction]) {
      enqueueTraining(state, townHall, 'worker');
    }
  }
}

/**
 * Process the build order: construct buildings in sequence.
 */
function processBuildOrder(state: GameState, ai: AIState): void {
  if (state.tick < ai.nextBuildCheck) return;
  ai.nextBuildCheck = state.tick + TICK_RATE * 5; // Check every 5 seconds

  if (ai.buildQueue.length === 0) return;

  const buildingType = ai.buildQueue[0];
  const stats = FACTION_STATS[ai.faction].buildings[buildingType];

  // Check if we can afford it
  if (state.resources[ai.faction].gold < stats.goldCost ||
      state.resources[ai.faction].wood < stats.woodCost) {
    return;
  }

  // Find a worker to build
  const workers = state.entities.filter(e =>
    e.alive && e.faction === ai.faction && e.entityType === 'unit' &&
    e.unitType === 'worker' && e.order.type === 'idle',
  );

  if (workers.length === 0) return;

  // Find placement near town hall
  const townHall = getTownHall(state, ai.faction);
  if (!townHall) return;

  const placement = findPlacement(state, townHall.x, townHall.y, stats.width, stats.height);
  if (!placement) return;

  // Place building
  const building = placeBuilding(state, ai.faction, buildingType, placement.x, placement.y);
  if (building) {
    ai.buildQueue.shift();
    // Assign worker to build
    const worker = workers[0];
    if (worker) {
      worker.order = { type: 'build', targetId: building.id };
      worker.buildTarget = building.id;
    }
  }
}

/**
 * Find a valid placement near a position.
 */
function findPlacement(
  state: GameState,
  nearX: number,
  nearY: number,
  width: number,
  height: number,
): { x: number; y: number } | null {
  for (let r = 3; r < 15; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = nearX + dx;
        const y = nearY + dy;
        if (isValidPlacement(state, x, y, width, height)) {
          return { x, y };
        }
      }
    }
  }
  return null;
}

/**
 * Train military units from barracks.
 */
function trainMilitary(state: GameState, ai: AIState): void {
  const barracks = state.entities.filter(e =>
    e.alive && e.faction === ai.faction && e.entityType === 'building' &&
    e.buildingType === 'barracks' && e.order.type === 'idle',
  );

  for (const barrack of barracks) {
    // Try to train the best unit we can afford
    const unitTypes = ['heavy', 'ranged', 'melee'] as const;
    for (const unitType of unitTypes) {
      const stats = FACTION_STATS[ai.faction].units[unitType];
      const reqs = TECH_REQUIREMENTS[unitType] ?? [];

      if (!hasTechRequirements(state, ai.faction, reqs)) continue;
      if (state.resources[ai.faction].gold < stats.goldCost) continue;
      if (state.resources[ai.faction].wood < stats.woodCost) continue;
      if (state.supplyUsed[ai.faction] + stats.supplyCost > state.supplyCap[ai.faction]) continue;

      enqueueTraining(state, barrack, unitType);
      break;
    }
  }
}

/**
 * Process attack waves.
 */
function processAttackWaves(state: GameState, ai: AIState): void {
  const cadence = difficultyWaveCadenceTicks(ai.difficulty);
  if (state.tick - ai.lastWaveTick < cadence) return;

  // Gather military units
  const military = state.entities.filter(e =>
    e.alive && e.faction === ai.faction && e.entityType === 'unit' &&
    e.unitType !== 'worker' && e.order.type === 'idle',
  );

  const waveSize = Math.floor(3 + ai.waveNumber * difficultyWaveSizeMult(ai.difficulty));
  const attackers = military.slice(0, waveSize);

  if (attackers.length < 2) return;

  // Find enemy base
  const enemyFaction: Faction = ai.faction === 'humans' ? 'orcs' : 'humans';
  const enemyTownHall = getTownHall(state, enemyFaction);
  if (!enemyTownHall) return;

  // Send attack wave
  for (const unit of attackers) {
    const path = findPath(state.map, Math.floor(unit.x), Math.floor(unit.y),
      Math.floor(enemyTownHall.x), Math.floor(enemyTownHall.y));
    unit.order = { type: 'attackMove', target: { x: enemyTownHall.x, y: enemyTownHall.y } };
    unit.path = path ?? [];
    unit.pathIndex = 0;
  }

  ai.lastWaveTick = state.tick;
  ai.waveNumber++;
}

/**
 * Defend base: pull military units to threats.
 */
function defendBase(state: GameState, ai: AIState): void {
  const townHall = getTownHall(state, ai.faction);
  if (!townHall) return;

  // Check for enemies near base
  const enemies = state.entities.filter(e =>
    e.alive && e.faction !== ai.faction && e.entityType === 'unit',
  );

  const baseCenter = { x: townHall.x + townHall.width / 2, y: townHall.y + townHall.height / 2 };
  const threats = enemies.filter(e => vecDist(e, baseCenter) < 15);

  if (threats.length === 0) return;

  // Pull idle military to defend
  const defenders = state.entities.filter(e =>
    e.alive && e.faction === ai.faction && e.entityType === 'unit' &&
    e.unitType !== 'worker' && e.order.type === 'idle',
  );

  for (const defender of defenders) {
    const nearestThreat = threats.reduce((nearest, threat) => {
      const d = vecDist(defender, threat);
      return d < vecDist(defender, nearest) ? threat : nearest;
    });

    if (nearestThreat) {
      defender.order = { type: 'attack', targetId: nearestThreat.id };
    }
  }
}

/**
 * Rebuild destroyed buildings.
 */
function rebuildBuildings(state: GameState, ai: AIState): void {
  // Check what buildings we're missing
  const buildings = state.entities.filter(e =>
    e.alive && e.faction === ai.faction && e.entityType === 'building',
  );

  const buildingTypes = new Set(buildings.map(e => e.buildingType));

  // If we're missing critical buildings, add to build queue
  if (!buildingTypes.has('barracks') && !ai.buildQueue.includes('barracks')) {
    ai.buildQueue.push('barracks');
  }
  if (!buildingTypes.has('lumberMill') && !ai.buildQueue.includes('lumberMill')) {
    ai.buildQueue.push('lumberMill');
  }
}
