import { Rng } from '../core/rng';
import { GameMap, generateMap, idx, inBounds } from '../map/gamemap';
import { LEVELS, levelSeed, mapGenConfigFor } from '../map/levels';
import { isBuildable, isWalkable, Tile } from '../map/tiles';
import {
  BUILDING_STATS,
  BuildingType,
  Faction,
  STARTING_GOLD,
  STARTING_WOOD,
  STARTING_WORKERS,
  SUPPLY_CAP_MAX,
  TRAIN_QUEUE_MAX,
  TRAINED_AT,
  UNIT_RADIUS,
  UNIT_REQUIREMENTS,
  UNIT_STATS,
  UnitType,
} from './data';
import { findPath } from './path';
import {
  Building,
  buildBlockedGrid,
  distToBuilding,

  GameState,
  playerOf,
  PlayerState,
  Unit,
  UnitOrder,
} from './state';

/** AI bonus resources per difficulty level (difficulty 1 gets none). */
export const AI_BONUS_GOLD_PER_DIFFICULTY = 300;
export const AI_BONUS_WOOD_PER_DIFFICULTY = 200;

export function createGame(level: number, campaignSeed: number, playerFaction: Faction): GameState {
  const def = LEVELS[level - 1];
  if (!def) throw new Error(`No such level: ${level}`);
  const seed = levelSeed(campaignSeed, level);
  const map = generateMap(mapGenConfigFor(def), seed);
  const aiFaction = playerFaction === Faction.Humans ? Faction.Orcs : Faction.Humans;

  const mkPlayer = (faction: Faction, gold: number, wood: number, harvestBonus: number): PlayerState => ({
    faction,
    gold,
    wood,
    supplyUsed: 0,
    supplyCap: 0,
    harvestBonus,
    fog: new Uint8Array(map.width * map.height),
    seenTiles: new Uint8Array(map.width * map.height),
    buildingMemory: new Map(),
  });

  const bonus = def.difficulty - 1;
  const state: GameState = {
    map,
    rng: new Rng(seed ^ 0x5eed),
    seed: campaignSeed,
    level,
    difficulty: def.difficulty,
    tick: 0,
    time: 0,
    units: [],
    buildings: [],
    projectiles: [],
    corpses: [],
    players: [
      mkPlayer(playerFaction, STARTING_GOLD, STARTING_WOOD, 1),
      mkPlayer(
        aiFaction,
        STARTING_GOLD + bonus * AI_BONUS_GOLD_PER_DIFFICULTY,
        STARTING_WOOD + bonus * AI_BONUS_WOOD_PER_DIFFICULTY,
        1 + 0.1 * bonus,
      ),
    ],
    playerFaction,
    result: 'playing',
    nextId: 1,
    blocked: new Uint8Array(map.width * map.height),
  };
  buildBlockedGrid(state);

  for (let p = 0; p < 2; p++) {
    const faction = state.players[p].faction;
    const start = map.starts[p];
    const hall = BUILDING_STATS[BuildingType.TownHall];
    const tx = start.x - Math.floor(hall.width / 2);
    const ty = start.y - Math.floor(hall.height / 2);
    spawnBuilding(state, faction, BuildingType.TownHall, tx, ty, true);
    for (let i = 0; i < STARTING_WORKERS; i++) {
      const spot = findFreeSpotNear(state, start.x + 0.5, start.y + 2.5);
      spawnUnit(state, faction, UnitType.Worker, spot.x, spot.y);
    }
  }
  return state;
}

export function spawnUnit(state: GameState, faction: Faction, type: UnitType, x: number, y: number): Unit {
  const u: Unit = {
    id: state.nextId++,
    faction,
    type,
    x,
    y,
    hp: UNIT_STATS[type].hp,
    cooldown: 0,
    order: { kind: 'idle' },
    path: null,
    pathStep: 0,
    autoTargetId: null,
    carrying: null,
    harvestTimer: 0,
    settled: true,
    repathCooldown: 0,
    stuckTime: 0,
    prevX: x,
    prevY: y,
    lastGoalX: null,
    lastGoalY: null,
  };
  state.units.push(u);
  return u;
}

export function spawnBuilding(
  state: GameState,
  faction: Faction,
  type: BuildingType,
  tx: number,
  ty: number,
  constructed: boolean,
): Building {
  const stats = BUILDING_STATS[type];
  const b: Building = {
    id: state.nextId++,
    faction,
    type,
    tx,
    ty,
    hp: constructed ? stats.hp : Math.max(1, Math.round(stats.hp * 0.1)),
    constructed,
    buildProgress: constructed ? stats.buildTime : 0,
    builderId: null,
    trainQueue: [],
    cooldown: 0,
  };
  state.buildings.push(b);
  for (let y = ty; y < ty + stats.height; y++) {
    for (let x = tx; x < tx + stats.width; x++) {
      state.blocked[idx(state.map, x, y)] = 1;
    }
  }
  return b;
}

/** Free walkable spot near (x, y) not overlapping other units. */
export function findFreeSpotNear(state: GameState, x: number, y: number): { x: number; y: number } {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  for (let r = 0; r < 12; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = cx + dx;
        const ty = cy + dy;
        if (!inBounds(state.map, tx, ty)) continue;
        if (state.blocked[idx(state.map, tx, ty)]) continue;
        const px = tx + 0.5;
        const py = ty + 0.5;
        const occupied = state.units.some(
          (u) => Math.abs(u.x - px) < UNIT_RADIUS * 2 && Math.abs(u.y - py) < UNIT_RADIUS * 2,
        );
        if (!occupied) return { x: px, y: py };
      }
    }
  }
  return { x: cx + 0.5, y: cy + 0.5 };
}

// ---------------------------------------------------------------------------
// Placement

export function canPlaceBuilding(
  state: GameState,
  type: BuildingType,
  tx: number,
  ty: number,
): boolean {
  const stats = BUILDING_STATS[type];
  for (let y = ty; y < ty + stats.height; y++) {
    for (let x = tx; x < tx + stats.width; x++) {
      if (!inBounds(state.map, x, y)) return false;
      if (!isBuildable(state.map.tiles[idx(state.map, x, y)] as Tile)) return false;
      if (state.blocked[idx(state.map, x, y)]) return false;
    }
  }
  // Reject placement over units standing in the footprint.
  for (const u of state.units) {
    if (
      u.x + UNIT_RADIUS > tx &&
      u.x - UNIT_RADIUS < tx + stats.width &&
      u.y + UNIT_RADIUS > ty &&
      u.y - UNIT_RADIUS < ty + stats.height
    ) {
      return false;
    }
  }
  return true;
}

export function canAfford(player: PlayerState, gold: number, wood: number): boolean {
  return player.gold >= gold && player.wood >= wood;
}

/**
 * Place a construction site and send the worker to build it.
 * Returns the building, or null if the placement/cost check fails.
 */
export function placeBuilding(
  state: GameState,
  worker: Unit,
  type: BuildingType,
  tx: number,
  ty: number,
): Building | null {
  if (worker.type !== UnitType.Worker) return null;
  const player = playerOf(state, worker.faction);
  const stats = BUILDING_STATS[type];
  if (!canAfford(player, stats.goldCost, stats.woodCost)) return null;
  if (!canPlaceBuilding(state, type, tx, ty)) return null;
  player.gold -= stats.goldCost;
  player.wood -= stats.woodCost;
  const b = spawnBuilding(state, worker.faction, type, tx, ty, false);
  b.builderId = worker.id;
  issueOrder(state, worker, { kind: 'build', buildingId: b.id });
  return b;
}

// ---------------------------------------------------------------------------
// Training

export function canTrain(state: GameState, building: Building, unit: UnitType): boolean {
  if (!building.constructed) return false;
  if (TRAINED_AT[unit] !== building.type) return false;
  if (building.trainQueue.length >= TRAIN_QUEUE_MAX) return false;
  const player = playerOf(state, building.faction);
  const stats = UNIT_STATS[unit];
  if (!canAfford(player, stats.goldCost, stats.woodCost)) return false;
  if (player.supplyUsed + stats.supplyCost > player.supplyCap) return false;
  for (const req of UNIT_REQUIREMENTS[unit]) {
    const has = state.buildings.some(
      (b) => b.faction === building.faction && b.type === req && b.constructed,
    );
    if (!has) return false;
  }
  return true;
}

export function trainUnit(state: GameState, building: Building, unit: UnitType): boolean {
  if (!canTrain(state, building, unit)) return false;
  const player = playerOf(state, building.faction);
  const stats = UNIT_STATS[unit];
  player.gold -= stats.goldCost;
  player.wood -= stats.woodCost;
  building.trainQueue.push({ unit, remaining: stats.trainTime, total: stats.trainTime });
  return true;
}

// ---------------------------------------------------------------------------
// Orders

export function issueOrder(_state: GameState, unit: Unit, order: UnitOrder): void {
  unit.order = order;
  unit.autoTargetId = null;
  unit.settled = false;
  unit.harvestTimer = 0;
  unit.stuckTime = 0;
  unit.lastGoalX = null;
  unit.lastGoalY = null;
  unit.path = null;
  unit.pathStep = 0;
  unit.repathCooldown = 0;
  if (order.kind === 'idle') unit.settled = true;
}

export function tileIndexAt(map: GameMap, x: number, y: number): number {
  return idx(map, Math.floor(x), Math.floor(y));
}

/**
 * Context-sensitive right-click: returns the order it issued (for UI feedback).
 */
export function smartOrder(state: GameState, unit: Unit, x: number, y: number): UnitOrder {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  let order: UnitOrder = { kind: 'move', x, y };

  // Enemy unit under the cursor?
  const enemy = state.units.find(
    (u) => u.faction !== unit.faction && Math.hypot(u.x - x, u.y - y) < 0.6,
  );
  // Building under the cursor?
  const building = state.buildings.find(
    (b) => distToBuilding(b, x, y) === 0,
  );

  if (enemy) {
    order = { kind: 'attack', targetId: enemy.id };
  } else if (building && building.faction !== unit.faction) {
    order = { kind: 'attack', targetId: building.id };
  } else if (unit.type === UnitType.Worker && inBounds(state.map, tx, ty)) {
    const tile = state.map.tiles[idx(state.map, tx, ty)] as Tile;
    if (tile === Tile.GoldMine) {
      order = { kind: 'harvestGold', tile: idx(state.map, tx, ty) };
    } else if (tile === Tile.Forest) {
      order = { kind: 'harvestWood', tile: idx(state.map, tx, ty) };
    } else if (building && building.faction === unit.faction) {
      if (!building.constructed) order = { kind: 'build', buildingId: building.id };
      else if (building.hp < BUILDING_STATS[building.type].hp)
        order = { kind: 'repair', buildingId: building.id };
    }
  }
  issueOrder(state, unit, order);
  return order;
}

/** Path a unit toward a tile index; approach mode for blocked targets. */
export function requestPath(state: GameState, unit: Unit, targetTile: number, approach: boolean): boolean {
  const startTile = tileIndexAt(state.map, unit.x, unit.y);
  const grid = { width: state.map.width, height: state.map.height, blocked: state.blocked };
  const res = findPath(grid, startTile, targetTile, approach);
  if (!res) {
    unit.path = null;
    return false;
  }
  unit.path = res.path;
  unit.pathStep = 0;
  return true;
}

/** Nearest drop-off building for a resource kind. */
export function nearestDropOff(state: GameState, unit: Unit, kind: 'gold' | 'wood'): Building | null {
  let best: Building | null = null;
  let bestDist = Infinity;
  for (const b of state.buildings) {
    if (b.faction !== unit.faction || !b.constructed) continue;
    const ok =
      b.type === BuildingType.TownHall || (kind === 'wood' && b.type === BuildingType.LumberMill);
    if (!ok) continue;
    const d = distToBuilding(b, unit.x, unit.y);
    if (d < bestDist) {
      bestDist = d;
      best = b;
    }
  }
  return best;
}

/** Nearest tile of the given kind within `radius` of a point (Euclidean). */
export function nearestTileOfKind(
  state: GameState,
  x: number,
  y: number,
  kind: Tile,
  radius: number,
): number | null {
  const { map } = state;
  let best = -1;
  let bestDist = Infinity;
  const minX = Math.max(0, Math.floor(x - radius));
  const maxX = Math.min(map.width - 1, Math.ceil(x + radius));
  const minY = Math.max(0, Math.floor(y - radius));
  const maxY = Math.min(map.height - 1, Math.ceil(y + radius));
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      if ((map.tiles[idx(map, tx, ty)] as Tile) !== kind) continue;
      const d = Math.hypot(tx + 0.5 - x, ty + 0.5 - y);
      if (d <= radius && d < bestDist) {
        bestDist = d;
        best = idx(map, tx, ty);
      }
    }
  }
  return best >= 0 ? best : null;
}

/** Recompute supply (cap and usage) for both players from scratch. */
export function recomputeSupply(state: GameState): void {
  for (const player of state.players) {
    let cap = 0;
    let used = 0;
    for (const b of state.buildings) {
      if (b.faction !== player.faction || !b.constructed) continue;
      cap += BUILDING_STATS[b.type].supplyGranted;
      for (const item of b.trainQueue) used += UNIT_STATS[item.unit].supplyCost;
    }
    for (const u of state.units) {
      if (u.faction === player.faction) used += UNIT_STATS[u.type].supplyCost;
    }
    player.supplyCap = Math.min(cap, SUPPLY_CAP_MAX);
    player.supplyUsed = used;
  }
}

/** Remove a building from the world, freeing its footprint. */
export function destroyBuilding(state: GameState, building: Building): void {
  const i = state.buildings.indexOf(building);
  if (i < 0) return;
  state.buildings.splice(i, 1);
  const stats = BUILDING_STATS[building.type];
  for (let y = building.ty; y < building.ty + stats.height; y++) {
    for (let x = building.tx; x < building.tx + stats.width; x++) {
      // Re-derive from terrain (buildings cannot overlap each other).
      const t = state.map.tiles[idx(state.map, x, y)] as Tile;
      state.blocked[idx(state.map, x, y)] = isWalkable(t) ? 0 : 1;
    }
  }
}
