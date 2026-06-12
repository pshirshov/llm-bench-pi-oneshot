/**
 * Order processing: training units, building construction, repair.
 */

import type { Entity, GameState, Faction, UnitType, BuildingType } from '../core/types';
import { FACTION_STATS, TECH_REQUIREMENTS } from '../core/stats';
import {
  createUnit, createBuilding, hasTechRequirements, getEntity,
} from './entities';
import { WORKER_REPAIR_RATE, WORKER_REPAIR_COST_GOLD, WORKER_REPAIR_COST_WOOD } from '../core/types';
import { findPath } from '../core/pathfinding';
import { vecDist } from '../core/types';

/**
 * Process training queues for buildings.
 */
export function processTraining(state: GameState): void {
  for (const entity of state.entities) {
    if (!entity.alive || entity.entityType !== 'building') continue;
    if (entity.order.type !== 'train') continue;

    entity.progressTicks++;
    if (entity.progressTicks >= entity.progressTotal) {
      // Training complete — spawn unit
      completeTraining(state, entity);
    }
  }
}

/**
 * Process building construction.
 */
export function processConstruction(state: GameState): void {
  for (const entity of state.entities) {
    if (!entity.alive || entity.entityType !== 'building') continue;
    if (entity.progressTotal <= 0) continue; // Not under construction
    if (entity.progressTicks >= entity.progressTotal) continue; // Already complete

    entity.progressTicks++;
    // Scale HP based on progress
    const progress = entity.progressTicks / entity.progressTotal;
    const bt = entity.buildingType;
    if (!bt) continue;
    const targetHp = FACTION_STATS[entity.faction].buildings[bt].hp;
    entity.hp = Math.max(1, Math.floor(targetHp * progress));

    if (entity.progressTicks >= entity.progressTotal) {
      entity.hp = targetHp;
      // Mark tiles as walkable=false for the building footprint
      const map = state.map;
      for (let dy = 0; dy < entity.height; dy++) {
        for (let dx = 0; dx < entity.width; dx++) {
          const tx = entity.x + dx;
          const ty = entity.y + dy;
          if (tx >= 0 && tx < map.width && ty >= 0 && ty < map.height) {
            map.walkable[ty * map.width + tx] = false;
          }
        }
      }
    }
  }
}

/**
 * Process repair orders.
 */
export function processRepair(state: GameState): void {
  for (const entity of state.entities) {
    if (!entity.alive || entity.entityType !== 'unit') continue;
    if (entity.order.type !== 'repair') continue;
    if (entity.unitType !== 'worker') continue;

    const targetId = entity.order.targetId;
    if (targetId === undefined) {
      entity.order = { type: 'idle' };
      continue;
    }

    const target = getEntity(state, targetId);
    if (!target || !target.alive || target.entityType !== 'building') {
      entity.order = { type: 'idle' };
      continue;
    }

    // Check if building needs repair
    const bt = target.buildingType;
    if (!bt) {
      entity.order = { type: 'idle' };
      continue;
    }
    const buildingStats = FACTION_STATS[target.faction].buildings[bt];
    if (target.hp >= buildingStats.hp) {
      entity.order = { type: 'idle' };
      continue;
    }

    const dist = vecDist(entity, target);
    if (dist < 2) {
      // In range — repair
      const goldCost = WORKER_REPAIR_COST_GOLD;
      const woodCost = WORKER_REPAIR_COST_WOOD;
      if (state.resources[entity.faction].gold >= goldCost &&
          state.resources[entity.faction].wood >= woodCost) {
        const repairAmount = Math.min(WORKER_REPAIR_RATE, buildingStats.hp - target.hp);
        state.resources[entity.faction].gold -= goldCost * repairAmount;
        state.resources[entity.faction].wood -= woodCost * repairAmount;
        target.hp = Math.min(buildingStats.hp, target.hp + repairAmount);
      } else {
        entity.order = { type: 'idle' };
      }
    } else {
      // Move to building
      if (entity.path.length === 0 || entity.pathIndex >= entity.path.length) {
        const path = findPath(state.map, Math.floor(entity.x), Math.floor(entity.y),
          Math.floor(target.x), Math.floor(target.y));
        entity.path = path ?? [];
        entity.pathIndex = 0;
      }
    }
  }
}

/**
 * Enqueue a unit training order at a building.
 */
export function enqueueTraining(
  state: GameState,
  building: Entity,
  unitType: UnitType,
): boolean {
  if (building.entityType !== 'building' || !building.buildingType) return false;
  if (building.buildingType !== 'barracks' && building.buildingType !== 'townHall') return false;

  const faction = building.faction;
  const stats = FACTION_STATS[faction].units[unitType];

  // Check tech requirements
  const reqs = TECH_REQUIREMENTS[unitType] ?? [];
  if (!hasTechRequirements(state, faction, reqs)) return false;

  // Check supply
  if (state.supplyUsed[faction] + stats.supplyCost > state.supplyCap[faction]) return false;

  // Check resources
  if (state.resources[faction].gold < stats.goldCost) return false;
  if (state.resources[faction].wood < stats.woodCost) return false;

  // Deduct resources
  state.resources[faction].gold -= stats.goldCost;
  state.resources[faction].wood -= stats.woodCost;
  state.supplyUsed[faction] += stats.supplyCost;

  // Set building to training
  building.order = { type: 'train' };
  building.progressTicks = 0;
  building.progressTotal = stats.trainTime;

  return true;
}

/**
 * Complete training: spawn the unit near the building.
 */
function completeTraining(state: GameState, building: Entity): void {
  if (!building.buildingType) return;

  const faction = building.faction;
  const unitType = getUnitTypeForBuilding(building.buildingType);
  if (!unitType) return;

  // Find spawn location
  const spawnPos = findSpawnPosition(state, building);
  if (!spawnPos) return;

  createUnit(state, faction, unitType, spawnPos.x, spawnPos.y);

  // Reset building
  building.order = { type: 'idle' };
  building.progressTicks = 0;
  building.progressTotal = 0;
}

/**
 * Get the unit type for a building's training queue.
 */
function getUnitTypeForBuilding(buildingType: BuildingType): UnitType | null {
  switch (buildingType) {
    case 'townHall': return 'worker';
    case 'barracks': return 'melee'; // Simplified — would track in queue
    default: return null;
  }
}

/**
 * Find a spawn position near a building that's not occupied.
 */
function findSpawnPosition(state: GameState, building: Entity): { x: number; y: number } | null {
  // Try positions adjacent to the building
  const positions: Array<{ x: number; y: number }> = [];

  for (let dx = -1; dx <= building.width; dx++) {
    positions.push({ x: building.x + dx, y: building.y - 1 });
    positions.push({ x: building.x + dx, y: building.y + building.height });
  }
  for (let dy = 0; dy < building.height; dy++) {
    positions.push({ x: building.x - 1, y: building.y + dy });
    positions.push({ x: building.x + building.width, y: building.y + dy });
  }

  // Sort by distance to building center
  const cx = building.x + building.width / 2;
  const cy = building.y + building.height / 2;
  positions.sort((a, b) => {
    const da = Math.sqrt((a.x - cx) ** 2 + (a.y - cy) ** 2);
    const db = Math.sqrt((b.x - cx) ** 2 + (b.y - cy) ** 2);
    return da - db;
  });

  for (const pos of positions) {
    if (pos.x < 0 || pos.x >= state.map.width || pos.y < 0 || pos.y >= state.map.height) continue;
    if (!state.map.walkable[pos.y * state.map.width + pos.x]) continue;

    // Check if position is occupied by another unit
    const occupied = state.entities.some(e =>
      e.alive && e.entityType === 'unit' &&
      Math.abs(e.x - pos.x) < 0.5 && Math.abs(e.y - pos.y) < 0.5,
    );

    if (!occupied) return pos;
  }

  // C6: find nearest free walkable tile
  for (let r = 2; r < 10; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const nx = building.x + building.width / 2 + dx;
        const ny = building.y + building.height / 2 + dy;
        if (nx < 0 || nx >= state.map.width || ny < 0 || ny >= state.map.height) continue;
        const tx = Math.floor(nx);
        const ty = Math.floor(ny);
        if (!state.map.walkable[ty * state.map.width + tx]) continue;
        const occupied = state.entities.some(e =>
          e.alive && e.entityType === 'unit' &&
          Math.abs(e.x - nx) < 0.5 && Math.abs(e.y - ny) < 0.5,
        );
        if (!occupied) return { x: nx, y: ny };
      }
    }
  }

  return null;
}

/**
 * Place a building: validate placement and start construction.
 */
export function placeBuilding(
  state: GameState,
  faction: Faction,
  buildingType: BuildingType,
  x: number,
  y: number,
): Entity | null {
  const stats = FACTION_STATS[faction].buildings[buildingType];

  // Check resources
  if (state.resources[faction].gold < stats.goldCost) return null;
  if (state.resources[faction].wood < stats.woodCost) return null;

  // Check tech requirements
  const reqs = TECH_REQUIREMENTS[buildingType] ?? [];
  if (!hasTechRequirements(state, faction, reqs)) return null;

  // Validate placement
  if (!isValidPlacement(state, x, y, stats.width, stats.height)) return null;

  // Deduct resources
  state.resources[faction].gold -= stats.goldCost;
  state.resources[faction].wood -= stats.woodCost;

  // Create building
  const building = createBuilding(state, faction, buildingType, x, y, true);
  return building;
}

/**
 * Check if a building placement is valid (C7).
 */
export function isValidPlacement(
  state: GameState,
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  // Check bounds
  if (x < 0 || x + width > state.map.width) return false;
  if (y < 0 || y + height > state.map.height) return false;

  // Check all tiles in footprint
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      const idx = ty * state.map.width + tx;

      // Check walkability
      if (!state.map.walkable[idx]) return false;

      // Check tile type (not water, rock, gold mine, forest)
      const tile = state.map.tiles[idx];
      if (tile === 'water' || tile === 'rock' || tile === 'goldMine' || tile === 'forest') {
        return false;
      }

      // Check for existing buildings
      for (const entity of state.entities) {
        if (!entity.alive || entity.entityType !== 'building') continue;
        if (tx >= entity.x && tx < entity.x + entity.width &&
            ty >= entity.y && ty < entity.y + entity.height) {
          return false;
        }
      }

      // Check for units on the tile
      for (const entity of state.entities) {
        if (!entity.alive || entity.entityType !== 'unit') continue;
        if (Math.floor(entity.x) === tx && Math.floor(entity.y) === ty) {
          return false;
        }
      }
    }
  }

  return true;
}
