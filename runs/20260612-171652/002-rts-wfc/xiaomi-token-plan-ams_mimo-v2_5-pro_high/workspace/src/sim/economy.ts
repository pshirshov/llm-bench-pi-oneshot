/**
 * Economy system: harvesting gold and wood, resource management.
 */

import type { Entity, GameState } from '../core/types';
import {
  WORKER_CARRY_GOLD, WORKER_CARRY_WOOD, WORKER_HARVEST_TICKS,
} from '../core/types';
import { TILE_DEFS } from '../core/tiles';
import { findNearestDropOff } from './entities';
import { findPath } from '../core/pathfinding';
import { vecDist } from '../core/types';

/**
 * Process harvesting for all workers with harvest orders.
 * Handles the full harvest cycle: walk to resource, gather, carry to drop-off, return.
 */
export function processHarvesting(state: GameState): void {
  for (const entity of state.entities) {
    if (!entity.alive || entity.entityType !== 'unit') continue;
    if (entity.order.type !== 'harvest') continue;
    if (entity.unitType !== 'worker') continue;

    processWorkerHarvest(state, entity);
  }
}

/**
 * Process a single worker's harvest cycle.
 * The worker alternates between: walking to resource, gathering, walking to drop-off, delivering.
 */
function processWorkerHarvest(state: GameState, worker: Entity): void {
  const targetId = worker.order.targetId;
  if (targetId === undefined) {
    worker.order = { type: 'idle' };
    return;
  }

  // Find the target resource (could be a building like gold mine, or a tile like forest)
  const target = state.entities.find(e => e.id === targetId && e.alive);

  if (worker.cargoGold > 0 || worker.cargoWood > 0) {
    // Worker is carrying — deliver to drop-off
    processDeliver(state, worker);
    return;
  }

  if (!target) {
    // Target is gone — find another resource
    findNewResource(state, worker);
    return;
  }

  // Check if we're at the resource
  const dist = vecDist(worker, target.entityType === 'building' ?
    { x: target.x + target.width / 2, y: target.y + target.height / 2 } : target);

  if (dist < 2) {
    // At resource — gather
    worker.progressTicks++;
    if (worker.progressTicks >= WORKER_HARVEST_TICKS) {
      // Gathered!
      worker.progressTicks = 0;
      // Check if target is on a gold mine tile
      const targetTx = Math.floor(target.x);
      const targetTy = Math.floor(target.y);
      const targetTile = state.map.tiles[targetTy * state.map.width + targetTx];
      if (targetTile === 'goldMine') {
        worker.cargoGold = Math.min(WORKER_CARRY_GOLD, target.hp);
        // Reduce mine amount (using HP as a proxy for remaining gold)
        target.hp -= worker.cargoGold;
        if (target.hp <= 0) {
          // Mine depleted — transform to depleted tile
          state.map.tiles[targetTy * state.map.width + targetTx] = 'goldMineDepleted';
          state.map.walkable[targetTy * state.map.width + targetTx] = TILE_DEFS.goldMineDepleted.walkable;
          target.alive = false;
        }
      } else {
        // Wood harvesting
        worker.cargoWood = WORKER_CARRY_WOOD;
        // Forest tile depletion — reduce HP
        target.hp -= 10;
        if (target.hp <= 0) {
          // Tile depleted — transform to dirt
          state.map.tiles[targetTy * state.map.width + targetTx] = 'dirt';
          state.map.walkable[targetTy * state.map.width + targetTx] = TILE_DEFS.dirt.walkable;
          target.alive = false;
        }
      }
      // Set state to delivering
      worker.harvestTarget = targetId;
    }
  } else {
    // Move to resource
    if (worker.path.length === 0 || worker.pathIndex >= worker.path.length) {
      const tx = Math.floor(target.x);
      const ty = Math.floor(target.y);
      const path = findPath(state.map, Math.floor(worker.x), Math.floor(worker.y), tx, ty);
      if (path && path.length > 0) {
        worker.path = path;
        worker.pathIndex = 0;
      } else {
        // Can't reach resource — find another
        findNewResource(state, worker);
      }
    }
  }
}

/**
 * Process delivering resources to a drop-off.
 */
function processDeliver(state: GameState, worker: Entity): void {
  const resource = worker.cargoGold > 0 ? 'gold' : 'wood';
  const dropoff = findNearestDropOff(state, worker.faction,
    resource,
    worker.x, worker.y);

  if (!dropoff) {
    // No drop-off — go idle
    worker.order = { type: 'idle' };
    worker.cargoGold = 0;
    worker.cargoWood = 0;
    return;
  }

  const center = { x: dropoff.x + dropoff.width / 2, y: dropoff.y + dropoff.height / 2 };
  const dist = vecDist(worker, center);

  if (dist < 2) {
    // At drop-off — deliver
    state.resources[worker.faction].gold += worker.cargoGold;
    state.resources[worker.faction].wood += worker.cargoWood;
    worker.cargoGold = 0;
    worker.cargoWood = 0;

    // Return to harvest
    if (worker.harvestTarget !== undefined) {
      const target = state.entities.find(e => e.id === worker.harvestTarget && e.alive);
      if (target) {
        worker.order = { type: 'harvest', targetId: worker.harvestTarget };
        worker.path = [];
        worker.pathIndex = 0;
        worker.progressTicks = 0;
        return;
      }
    }
    // Find new resource
    findNewResource(state, worker);
  } else {
    // Move to drop-off
    if (worker.path.length === 0 || worker.pathIndex >= worker.path.length) {
      const path = findPath(state.map, Math.floor(worker.x), Math.floor(worker.y),
        Math.floor(center.x), Math.floor(center.y));
      if (path && path.length > 0) {
        worker.path = path;
        worker.pathIndex = 0;
      } else {
        // Can't reach drop-off — try another
        worker.order = { type: 'idle' };
        worker.cargoGold = 0;
        worker.cargoWood = 0;
      }
    }
  }
}

/**
 * Find a new resource for a worker to harvest.
 */
function findNewResource(state: GameState, worker: Entity): void {
  // Look for nearest gold mine or forest tile
  let bestTarget: Entity | null = null;
  let bestDist = Infinity;

  for (const entity of state.entities) {
    if (!entity.alive || entity.faction !== worker.faction) continue;
    if (entity.entityType !== 'building' || entity.buildingType !== 'goldMine') continue;

    const dist = vecDist(worker, entity);
    if (dist < bestDist) {
      bestDist = dist;
      bestTarget = entity;
    }
  }

  if (bestTarget) {
    worker.order = { type: 'harvest', targetId: bestTarget.id };
    worker.harvestTarget = bestTarget.id;
    worker.path = [];
    worker.pathIndex = 0;
    worker.progressTicks = 0;
  } else {
    // No resources — go idle
    worker.order = { type: 'idle' };
  }
}

/**
 * Check if a tile has a forest resource.
 */
export function isForestTile(state: GameState, x: number, y: number): boolean {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx < 0 || tx >= state.map.width || ty < 0 || ty >= state.map.height) return false;
  return state.map.tiles[ty * state.map.width + tx] === 'forest';
}

/**
 * Create a forest entity for harvesting.
 */
export function createForestEntity(state: GameState, x: number, y: number): Entity {
  const entity: Entity = {
    id: state.nextEntityId++,
    faction: 'humans', // Forest is neutral but we need a faction
    entityType: 'building',
    buildingType: 'farm', // Using as placeholder
    x,
    y,
    hp: 200, // Forest health
    maxHp: 200,
    armor: 0,
    damage: 0,
    attackRange: 0,
    attackCooldown: 0,
    attackCooldownTimer: 0,
    moveSpeed: 0,
    sightRadius: 0,
    order: { type: 'idle' },
    path: [],
    pathIndex: 0,
    cargoGold: 0,
    cargoWood: 0,
    progressTicks: 0,
    progressTotal: 0,
    width: 1,
    height: 1,
    alive: true,
  };
  state.entities.push(entity);
  return entity;
}
