/**
 * Entity management: creation, lookup, and basic operations.
 */

import type {
  Entity, Faction, UnitType, BuildingType, GameState, Vec2,
} from '../core/types';
import { FACTION_STATS, TOWER_ATTACK_DAMAGE, TOWER_ATTACK_RANGE, TOWER_ATTACK_COOLDOWN } from '../core/stats';

/** Create a unit entity */
export function createUnit(
  state: GameState,
  faction: Faction,
  unitType: UnitType,
  x: number,
  y: number,
): Entity {
  const stats = FACTION_STATS[faction].units[unitType];
  const entity: Entity = {
    id: state.nextEntityId++,
    faction,
    entityType: 'unit',
    unitType,
    x,
    y,
    hp: stats.hp,
    maxHp: stats.hp,
    armor: stats.armor,
    damage: stats.damage,
    attackRange: stats.attackRange,
    attackCooldown: stats.attackCooldown,
    attackCooldownTimer: 0,
    moveSpeed: stats.moveSpeed,
    sightRadius: stats.sightRadius,
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

  // Update supply used
  const unitStats = FACTION_STATS[faction].units[unitType];
  state.supplyUsed[faction] += unitStats.supplyCost;

  return entity;
}

/** Create a building entity */
export function createBuilding(
  state: GameState,
  faction: Faction,
  buildingType: BuildingType,
  x: number,
  y: number,
  isConstruction: boolean = false,
): Entity {
  const stats = FACTION_STATS[faction].buildings[buildingType];
  const entity: Entity = {
    id: state.nextEntityId++,
    faction,
    entityType: 'building',
    buildingType,
    x,
    y,
    hp: isConstruction ? 1 : stats.hp,
    maxHp: stats.hp,
    armor: stats.armor,
    damage: buildingType === 'guardTower' ? TOWER_ATTACK_DAMAGE : 0,
    attackRange: buildingType === 'guardTower' ? TOWER_ATTACK_RANGE : 0,
    attackCooldown: buildingType === 'guardTower' ? TOWER_ATTACK_COOLDOWN : 0,
    attackCooldownTimer: 0,
    moveSpeed: 0,
    sightRadius: stats.sightRadius,
    order: { type: 'idle' },
    path: [],
    pathIndex: 0,
    cargoGold: 0,
    cargoWood: 0,
    progressTicks: 0,
    progressTotal: isConstruction ? stats.buildTime : 0,
    width: stats.width,
    height: stats.height,
    alive: true,
  };
  state.entities.push(entity);

  // Update supply cap
  if (stats.supplyProvided > 0) {
    state.supplyCap[faction] += stats.supplyProvided;
  }

  // Update walkable
  if (!isConstruction) {
    markBuildingTiles(state, entity, false);
  }

  return entity;
}

/** Mark building footprint tiles as walkable/unwalkable */
function markBuildingTiles(state: GameState, building: Entity, walkable: boolean): void {
  const map = state.map;
  for (let dy = 0; dy < building.height; dy++) {
    for (let dx = 0; dx < building.width; dx++) {
      const tx = building.x + dx;
      const ty = building.y + dy;
      if (tx >= 0 && tx < map.width && ty >= 0 && ty < map.height) {
        map.walkable[ty * map.width + tx] = walkable;
      }
    }
  }
}

/** Get entity by ID */
export function getEntity(state: GameState, id: number): Entity | undefined {
  return state.entities.find(e => e.id === id && e.alive);
}

/** Get all entities of a faction */
export function getFactionEntities(state: GameState, faction: Faction): Entity[] {
  return state.entities.filter(e => e.faction === faction && e.alive);
}

/** Get entities within a radius of a point */
export function getEntitiesInRange(
  state: GameState,
  center: Vec2,
  radius: number,
  faction?: Faction,
): Entity[] {
  const r2 = radius * radius;
  return state.entities.filter(e => {
    if (!e.alive) return false;
    if (faction !== undefined && e.faction !== faction) return false;
    const dx = e.x - center.x;
    const dy = e.y - center.y;
    return dx * dx + dy * dy <= r2;
  });
}

/** Get the center of a building (for pathfinding targets) */
export function buildingCenter(e: Entity): Vec2 {
  return {
    x: e.x + e.width / 2 - 0.5,
    y: e.y + e.height / 2 - 0.5,
  };
}

/** Get building footprint as an array of tile positions */
export function buildingFootprint(e: Entity): Vec2[] {
  const tiles: Vec2[] = [];
  for (let dy = 0; dy < e.height; dy++) {
    for (let dx = 0; dx < e.width; dx++) {
      tiles.push({ x: e.x + dx, y: e.y + dy });
    }
  }
  return tiles;
}

/** Check if a point is inside a building's footprint */
export function pointInBuilding(e: Entity, px: number, py: number): boolean {
  return px >= e.x && px < e.x + e.width && py >= e.y && py < e.y + e.height;
}

/** Kill an entity and handle side effects */
export function killEntity(state: GameState, entity: Entity): void {
  entity.alive = false;

  if (entity.entityType === 'building' && entity.buildingType) {
    const stats = FACTION_STATS[entity.faction].buildings[entity.buildingType];
    if (stats.supplyProvided > 0) {
      state.supplyCap[entity.faction] -= stats.supplyProvided;
      // Ensure supply cap doesn't go below used
      if (state.supplyCap[entity.faction] < state.supplyUsed[entity.faction]) {
        // Supply can temporarily exceed cap — new training is blocked
      }
    }
    // Mark tiles as walkable again
    markBuildingTiles(state, entity, true);
  }
}

/** Get all buildings of a faction that are drop-off points for a resource */
export function getDropOffs(state: GameState, faction: Faction, resource: 'gold' | 'wood'): Entity[] {
  return state.entities.filter(e => {
    if (!e.alive || e.faction !== faction || e.entityType !== 'building') return false;
    if (e.entityType === 'building' && e.buildingType) {
      if (resource === 'gold') return e.buildingType === 'townHall';
      if (resource === 'wood') return e.buildingType === 'townHall' || e.buildingType === 'lumberMill';
    }
    return false;
  });
}

/** Get the nearest reachable drop-off for a worker */
export function findNearestDropOff(
  state: GameState,
  faction: Faction,
  resource: 'gold' | 'wood',
  fromX: number,
  fromY: number,
): Entity | null {
  const dropoffs = getDropOffs(state, faction, resource);
  if (dropoffs.length === 0) return null;

  let bestDist = Infinity;
  let best: Entity | null = null;
  for (const d of dropoffs) {
    const center = buildingCenter(d);
    const dist = Math.abs(center.x - fromX) + Math.abs(center.y - fromY);
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best;
}

/** Check if a faction has any buildings left */
export function hasBuildings(state: GameState, faction: Faction): boolean {
  return state.entities.some(e =>
    e.alive && e.faction === faction && e.entityType === 'building',
  );
}

/** Check if the player has the tech requirements for a unit or building */
export function hasTechRequirements(state: GameState, faction: Faction, reqs: BuildingType[]): boolean {
  for (const req of reqs) {
    const has = state.entities.some(e =>
      e.alive && e.faction === faction && e.entityType === 'building' &&
      e.buildingType === req,
    );
    if (!has) return false;
  }
  return true;
}

/** Get the town hall of a faction */
export function getTownHall(state: GameState, faction: Faction): Entity | undefined {
  return state.entities.find(e =>
    e.alive && e.faction === faction && e.entityType === 'building' &&
    e.buildingType === 'townHall',
  );
}
