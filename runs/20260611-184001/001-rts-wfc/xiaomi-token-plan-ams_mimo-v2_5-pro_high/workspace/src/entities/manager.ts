/**
 * Entity creation and management.
 */
import { Entity, EntityType, Faction, GameState, TILE_SIZE, BuildingType } from '../engine/types.js';
import { getStats } from './stats.js';

export function resetIdCounter(): void { /* Reset handled by GameState.nextEntityId */ }

export function createEntity(
  type: EntityType,
  faction: Faction,
  tileX: number,
  tileY: number,
  state: GameState
): Entity {
  const stats = getStats(type, faction);
  const px = tileX * TILE_SIZE + (stats.width * TILE_SIZE) / 2;
  const py = tileY * TILE_SIZE + (stats.height * TILE_SIZE) / 2;

  const entity: Entity = {
    id: state.nextEntityId++,
    type,
    faction,
    x: px,
    y: py,
    tileX,
    tileY,
    hp: stats.hp,
    maxHp: stats.maxHp,
    stats,
    state: 'idle',
    targetX: null,
    targetY: null,
    attackTarget: null,
    attackCooldownLeft: 0,
    path: [],
    pathIndex: 0,
    carrying: null,
    carryAmount: 0,
    harvestTileX: null,
    harvestTileY: null,
    buildingType: null,
    buildProgress: 0,
    trainQueue: [],
    deathTimer: 0,
    visible: true
  };

  state.entities.push(entity);

  // Add supply cap for buildings only (supply used is deducted via deductCost when training starts)
  if (!stats.isUnit && stats.supplyProvided > 0) {
    state.resources[faction][3] += stats.supplyProvided;
  }

  return entity;
}

/** Check if building placement is valid */
export function canPlaceBuilding(
  type: BuildingType,
  tileX: number,
  tileY: number,
  state: GameState,
  faction: Faction
): boolean {
  const stats = getStats(type, faction);
  const w = stats.width;
  const h = stats.height;

  // Check map bounds
  if (tileX < 0 || tileY < 0 || tileX + w > state.mapWidth || tileY + h > state.mapHeight) return false;

  // Check tiles are buildable
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const t = state.tiles[tileY + dy][tileX + dx].type;
      if (t !== 'grass' && t !== 'dirt') return false;
    }
  }

  // Check no overlapping entities
  for (const e of state.entities) {
    if (e.state === 'dead') continue;
    if (e.stats.isUnit) continue;
    const ew = e.stats.width;
    const eh = e.stats.height;
    if (tileX < e.tileX + ew && tileX + w > e.tileX &&
        tileY < e.tileY + eh && tileY + h > e.tileY) {
      return false;
    }
  }

  return true;
}

/** Check if player has all prerequisites for a unit/building */
export function hasPrerequisites(type: EntityType, faction: Faction, state: GameState): boolean {
  const stats = getStats(type, faction);
  if (stats.requires.length === 0) return true;

  return stats.requires.every(req => {
    return state.entities.some(e =>
      e.faction === faction && e.type === req && e.state !== 'dead'
    );
  });
}

/** Check if player can afford entity */
export function canAfford(type: EntityType, faction: Faction, state: GameState): boolean {
  const stats = getStats(type, faction);
  const [gold, wood, supplyUsed, supplyCap] = state.resources[faction];
  if (stats.goldCost > gold) return false;
  if (stats.woodCost > wood) return false;
  if (stats.isUnit && stats.supplyCost > 0 && supplyUsed + stats.supplyCost > supplyCap) return false;
  return true;
}

/** Deduct cost */
export function deductCost(type: EntityType, faction: Faction, state: GameState): void {
  const stats = getStats(type, faction);
  state.resources[faction][0] -= stats.goldCost;
  state.resources[faction][1] -= stats.woodCost;
  if (stats.isUnit && stats.supplyCost > 0) {
    state.resources[faction][2] += stats.supplyCost;
  }
}

/** Get entity at pixel position */
export function getEntityAtPixel(
  px: number,
  py: number,
  entities: Entity[],
  faction?: Faction
): Entity | null {
  for (const e of entities) {
    if (e.state === 'dead') continue;
    if (faction && e.faction !== faction) continue;
    const w = e.stats.width * TILE_SIZE;
    const h = e.stats.height * TILE_SIZE;
    const left = e.x - w / 2;
    const top = e.y - h / 2;
    if (px >= left && px <= left + w && py >= top && py <= top + h) return e;
  }
  return null;
}

/** Get entities in a screen rectangle */
export function getEntitiesInRect(
  x1: number, y1: number, x2: number, y2: number,
  entities: Entity[], faction: Faction
): Entity[] {
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);

  return entities.filter(e => {
    if (e.state === 'dead') return false;
    if (e.faction !== faction) return false;
    if (!e.stats.isUnit) return false; // Can't select buildings with box select
    return e.x >= left && e.x <= right && e.y >= top && e.y <= bottom;
  });
}
