// ─── Game state, simulation, and all game systems ───

import {
  Faction, UnitType, BuildingType, FogState, UnitState, BuildingState,
  GameMap, TileType, Unit, Building, Projectile, Vec2,
  Resources, SupplyInfo, ControlGroup, GameScreen,
} from './types';
import {
  UNIT_STATS, BUILDING_STATS, TICK_DURATION, WORKER_CARRY_AMOUNT,
  WORKER_HARVEST_RATE, WORKER_BUILD_RATE, WORKER_REPAIR_RATE,
  GUARD_ACQUIRE_RADIUS_ADD,
  PROJECTILE_SPEED,
  getUnitPrerequisites, getTrainingBuilding,
  WALKABLE_TILES,
} from './constants';
import { PRNG } from './prng';
import { generateMap } from './wfc';
import { findPath } from './astar';

export interface GameState {
  screen: GameScreen;
  map: GameMap;
  units: Map<number, Unit>;
  buildings: Map<number, Building>;
  projectiles: Map<number, Projectile>;
  nextId: number;
  resources: Record<Faction, Resources>;
  fog: FogState[][]; // per-player fog
  time: number;
  paused: boolean;
  speed: number;
  playerFaction: Faction;
  aiFaction: Faction;
  seed: number;
  rng: PRNG;
  // UI state
  selectedUnitIds: number[];
  selectedBuildingId: number | null;
  camera: Vec2;
  controlGroups: Map<number, ControlGroup>;
  // Build placement mode
  buildMode: BuildingType | null;
  buildValid: boolean;
  // Campaign
  campaignSeed: number;
  currentLevel: number;
  levelResults: Map<number, boolean>;
  // Level info
  levelWidth: number;
  levelHeight: number;
  aiDifficulty: number;
  // Start locations
  playerStart: Vec2;
  aiStart: Vec2;
  // Corpse fade
  corpses: { x: number; y: number; faction: Faction; type: string; fadeTimer: number }[];
}

function makeId(state: GameState): number {
  return state.nextId++;
}

// ─── Map generation and start ───

export function createGameState(
  seed: number,
  playerFaction: Faction,
  level: number = 1,
): GameState {
  const rng = new PRNG(seed);
  const campaignSeed = seed;

  // Level configuration
  const mapSizes = [
    { w: 32, h: 32 },
    { w: 48, h: 48 },
    { w: 64, h: 64 },
    { w: 80, h: 80 },
    { w: 96, h: 96 },
  ];
  const levelIdx = Math.min(level - 1, 4);
  const { w, h } = mapSizes[levelIdx];
  const aiDifficulty = level;

  const mapSeed = rng.nextInt(0, 0x7fffffff);
  const map = generateMap(w, h, mapSeed);

  // Find start locations
  const starts = findStartLocations(map);
  const playerStart = starts[0];
  const aiStart = starts[1];

  const state: GameState = {
    screen: GameScreen.Playing,
    map,
    units: new Map(),
    buildings: new Map(),
    projectiles: new Map(),
    nextId: 1,
    resources: {
      [Faction.Human]: { gold: 400, wood: 200 },
      [Faction.Orc]: { gold: 400 + (aiDifficulty - 1) * 100, wood: 200 + (aiDifficulty - 1) * 50 },
    },
    fog: createFog(w, h),
    time: 0,
    paused: false,
    speed: 1,
    playerFaction,
    aiFaction: playerFaction === Faction.Human ? Faction.Orc : Faction.Human,
    seed,
    rng,
    selectedUnitIds: [],
    selectedBuildingId: null,
    camera: { x: playerStart.x - 10, y: playerStart.y - 8 },
    controlGroups: new Map(),
    buildMode: null,
    buildValid: false,
    campaignSeed,
    currentLevel: level,
    levelResults: new Map(),
    levelWidth: w,
    levelHeight: h,
    aiDifficulty,
    playerStart,
    aiStart,
    corpses: [],
  };

  // Place starting buildings and units for both factions
  placeStartingEntities(state, Faction.Human, playerStart, playerFaction === Faction.Human);
  placeStartingEntities(state, Faction.Orc, aiStart, playerFaction === Faction.Orc);

  return state;
}

function createFog(w: number, h: number): FogState[][] {
  const fog: FogState[][] = [];
  for (let y = 0; y < h; y++) {
    fog[y] = new Array(w).fill(FogState.Unexplored);
  }
  return fog;
}

function findStartLocations(map: GameMap): Vec2[] {
  // Find two far-apart buildable areas in opposite quadrants
  const w = map.width;
  const h = map.height;

  const findCenter = (xMin: number, xMax: number, yMin: number, yMax: number): Vec2 => {
    let best: Vec2 | null = null;
    let bestScore = -1;
    for (let y = yMin; y < yMax; y++) {
      for (let x = xMin; x < xMax; x++) {
        if (WALKABLE_TILES.has(map.tiles[y][x].type)) {
          const score = countWalkableAround(map, x, y, 5);
          if (score > bestScore) {
            bestScore = score;
            best = { x, y };
          }
        }
      }
    }
    return best ?? { x: Math.floor((xMin + xMax) / 2), y: Math.floor((yMin + yMax) / 2) };
  };

  const p1 = findCenter(4, Math.floor(w / 2), 4, Math.floor(h / 2));
  const p2 = findCenter(Math.floor(w / 2), w - 4, Math.floor(h / 2), h - 4);

  return [p1, p2];
}

function countWalkableAround(map: GameMap, cx: number, cy: number, r: number): number {
  let count = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || x >= map.width || y < 0 || y >= map.height) continue;
      if (WALKABLE_TILES.has(map.tiles[y][x].type)) count++;
    }
  }
  return count;
}

function placeStartingEntities(state: GameState, faction: Faction, start: Vec2, _isPlayer: boolean): void {
  // Place Town Hall
  const hall = createBuilding(state, BuildingType.TownHall, faction, start.x - 1, start.y - 1);
  hall.state = BuildingState.Complete;
  hall.buildProgress = 1;
  hall.hp = hall.maxHp;

  // Place 3 Workers near the Town Hall
  for (let i = 0; i < 3; i++) {
    const wx = start.x + i - 1;
    const wy = start.y + 2;
    createUnit(state, UnitType.Worker, faction, wx, wy);
  }
}

// ─── Entity creation ───

export function createUnit(state: GameState, type: UnitType, faction: Faction, x: number, y: number): Unit {
  const stats = UNIT_STATS[type];
  const unit: Unit = {
    id: makeId(state),
    type,
    faction,
    x,
    y,
    hp: stats.hp,
    maxHp: stats.hp,
    armor: stats.armor,
    attackDamage: stats.attackDamage,
    attackRange: stats.attackRange,
    attackCooldown: stats.attackCooldown,
    cooldownRemaining: 0,
    moveSpeed: stats.moveSpeed,
    sightRadius: stats.sightRadius,
    state: UnitState.Idle,
    targetId: null,
    targetPos: null,
    path: [],
    carryingType: null,
    carryingAmount: 0,
    rallyPoint: null,
    goldCost: stats.goldCost,
    woodCost: stats.woodCost,
    supplyCost: stats.supplyCost,
  };
  state.units.set(unit.id, unit);
  return unit;
}

export function createBuilding(state: GameState, type: BuildingType, faction: Faction, tileX: number, tileY: number): Building {
  const stats = BUILDING_STATS[type];
  const building: Building = {
    id: makeId(state),
    type,
    faction,
    tileX,
    tileY,
    hp: Math.ceil(stats.hp * 0.1), // starts at 10% HP when constructing
    maxHp: stats.hp,
    state: BuildingState.Constructing,
    buildProgress: 0,
    trainingQueue: [],
    rallyPoint: null,
    attackDamage: stats.attackDamage,
    attackRange: stats.attackRange,
    attackCooldown: stats.attackCooldown,
    cooldownRemaining: 0,
    sightRadius: stats.sightRadius,
  };

  // Place building on map tiles
  for (let dy = 0; dy < stats.footprintH; dy++) {
    for (let dx = 0; dx < stats.footprintW; dx++) {
      const tx = tileX + dx;
      const ty = tileY + dy;
      if (tx >= 0 && tx < state.map.width && ty >= 0 && ty < state.map.height) {
        state.map.tiles[ty][tx].buildingId = building.id;
      }
    }
  }

  state.buildings.set(building.id, building);
  return building;
}

// ─── Simulation tick ───

export function simulateTick(state: GameState): void {
  if (state.paused || state.screen !== GameScreen.Playing) return;

  const dt = TICK_DURATION * state.speed;

  // Update units
  for (const unit of state.units.values()) {
    if (unit.state === UnitState.Dead) continue;
    updateUnit(state, unit, dt);
  }

  // Remove dead units
  for (const [id, unit] of state.units) {
    if (unit.state === UnitState.Dead) {
      state.corpses.push({
        x: unit.x,
        y: unit.y,
        faction: unit.faction,
        type: unit.type,
        fadeTimer: 3,
      });
      state.units.delete(id);
    }
  }

  // Update buildings
  for (const building of state.buildings.values()) {
    if (building.state === BuildingState.Destroyed) continue;
    updateBuilding(state, building, dt);
  }

  // Update projectiles
  updateProjectiles(state, dt);

  // Update corpses
  for (let i = state.corpses.length - 1; i >= 0; i--) {
    state.corpses[i].fadeTimer -= dt;
    if (state.corpses[i].fadeTimer <= 0) {
      state.corpses.splice(i, 1);
    }
  }

  // Remove destroyed buildings from map
  for (const [id, building] of state.buildings) {
    if (building.state === BuildingState.Destroyed) {
      const stats = BUILDING_STATS[building.type];
      for (let dy = 0; dy < stats.footprintH; dy++) {
        for (let dx = 0; dx < stats.footprintW; dx++) {
          const tx = building.tileX + dx;
          const ty = building.tileY + dy;
          if (tx >= 0 && tx < state.map.width && ty >= 0 && ty < state.map.height) {
            if (state.map.tiles[ty][tx].buildingId === id) {
              state.map.tiles[ty][tx].buildingId = null;
            }
          }
        }
      }
      state.buildings.delete(id);
    }
  }

  // Update fog of war
  updateFog(state);

  // Check win/lose conditions
  checkWinLose(state);

  // Update time
  state.time += dt;
}

// ─── Unit update ───

function updateUnit(state: GameState, unit: Unit, dt: number): void {
  // Reduce cooldown
  if (unit.cooldownRemaining > 0) {
    unit.cooldownRemaining = Math.max(0, unit.cooldownRemaining - dt);
  }

  switch (unit.state) {
    case UnitState.Idle:
      updateIdleUnit(state, unit, dt);
      break;
    case UnitState.Moving:
      updateMovingUnit(state, unit, dt);
      break;
    case UnitState.Attacking:
      updateAttackingUnit(state, unit, dt);
      break;
    case UnitState.Harvesting:
      updateHarvestingUnit(state, unit, dt);
      break;
    case UnitState.Returning:
      updateReturningUnit(state, unit, dt);
      break;
    case UnitState.Building:
      updateBuildingUnit(state, unit, dt);
      break;
    case UnitState.Repairing:
      updateRepairingUnit(state, unit, dt);
      break;
  }
}

function updateIdleUnit(state: GameState, unit: Unit, _dt: number): void {
  // Auto-acquire nearby enemies
  if (unit.attackDamage > 0) {
    const target = findNearestEnemy(state, unit, unit.sightRadius + GUARD_ACQUIRE_RADIUS_ADD);
    if (target) {
      unit.targetId = target.id;
      unit.state = UnitState.Attacking;
    }
  }
}

function updateMovingUnit(state: GameState, unit: Unit, dt: number): void {
  if (unit.path.length === 0 && unit.targetPos) {
    // Recalculate path
    unit.path = findPath(state.map, Math.round(unit.x), Math.round(unit.y),
      unit.targetPos.x, unit.targetPos.y);
    if (unit.path.length === 0) {
      unit.state = UnitState.Idle;
      unit.targetPos = null;
      return;
    }
  }

  if (unit.path.length === 0) {
    unit.state = UnitState.Idle;
    unit.targetPos = null;
    return;
  }

  // Move along path
  const speed = unit.moveSpeed * dt;
  let remaining = speed;

  while (remaining > 0 && unit.path.length > 0) {
    const next = unit.path[0];
    const dx = next.x - unit.x;
    const dy = next.y - unit.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 0.05) {
      unit.x = next.x;
      unit.y = next.y;
      unit.path.shift();
      continue;
    }

    if (dist <= remaining) {
      unit.x = next.x;
      unit.y = next.y;
      remaining -= dist;
      unit.path.shift();
    } else {
      unit.x += (dx / dist) * remaining;
      unit.y += (dy / dist) * remaining;
      remaining = 0;
    }
  }

  // Check if arrived at destination
  if (unit.path.length === 0) {
    if (unit.targetPos) {
      unit.x = Math.round(unit.x);
      unit.y = Math.round(unit.y);
    }
    unit.state = UnitState.Idle;
    unit.targetPos = null;
  }
}

function updateAttackingUnit(state: GameState, unit: Unit, _dt: number): void {
  // If we have a target, verify it still exists and is in range
  if (unit.targetId !== null) {
    const target = getEntity(state, unit.targetId);
    if (!target || (isUnit(target) && target.state === UnitState.Dead) ||
      (isBuilding(target) && target.state === BuildingState.Destroyed)) {
      unit.targetId = null;
      unit.state = UnitState.Idle;
      return;
    }

    const targetPos = getEntityPosition(target);
    const dist = distance(unit.x, unit.y, targetPos.x, targetPos.y);

    if (dist > unit.attackRange + 0.5) {
      // Move toward target
      if (unit.path.length === 0 || unit.targetPos?.x !== Math.round(targetPos.x) ||
        unit.targetPos?.y !== Math.round(targetPos.y)) {
        unit.targetPos = { x: Math.round(targetPos.x), y: Math.round(targetPos.y) };
        unit.path = findPath(state.map, Math.round(unit.x), Math.round(unit.y),
          Math.round(targetPos.x), Math.round(targetPos.y));
      }
      unit.state = UnitState.Moving;
      return;
    }

    // In range — attack
    if (unit.cooldownRemaining <= 0) {
      performAttack(state, unit, target);
      unit.cooldownRemaining = unit.attackCooldown;
    }
  } else {
    // No target — try to find one
    const target = findNearestEnemy(state, unit, unit.sightRadius);
    if (target) {
      unit.targetId = target.id;
    } else {
      unit.state = UnitState.Idle;
    }
  }
}

function updateHarvestingUnit(state: GameState, unit: Unit, dt: number): void {
  const tx = Math.round(unit.x);
  const ty = Math.round(unit.y);

  if (tx < 0 || tx >= state.map.width || ty < 0 || ty >= state.map.height) {
    unit.state = UnitState.Idle;
    return;
  }

  const tile = state.map.tiles[ty][tx];

  if (unit.carryingAmount >= WORKER_CARRY_AMOUNT) {
    // Full — return to drop-off
    unit.state = UnitState.Returning;
    return;
  }

  if (tile.type === TileType.GoldMine && tile.resourceAmount > 0) {
    // Harvest gold
    const amount = Math.min(WORKER_HARVEST_RATE * dt, tile.resourceAmount, WORKER_CARRY_AMOUNT - unit.carryingAmount);
    tile.resourceAmount -= amount;
    unit.carryingType = 'gold';
    unit.carryingAmount += amount;

    if (unit.carryingAmount >= WORKER_CARRY_AMOUNT || tile.resourceAmount <= 0) {
      if (tile.resourceAmount <= 0) {
        // Depleted gold mine — convert to dirt
        tile.type = TileType.Dirt;
        tile.resourceAmount = 0;
      }
      unit.state = UnitState.Returning;
    }
  } else if (tile.type === TileType.Forest && tile.resourceAmount > 0) {
    // Harvest wood
    const amount = Math.min(WORKER_HARVEST_RATE * dt, tile.resourceAmount, WORKER_CARRY_AMOUNT - unit.carryingAmount);
    tile.resourceAmount -= amount;
    unit.carryingType = 'wood';
    unit.carryingAmount += amount;

    if (unit.carryingAmount >= WORKER_CARRY_AMOUNT || tile.resourceAmount <= 0) {
      if (tile.resourceAmount <= 0) {
        // Depleted forest — convert to grass
        tile.type = TileType.Grass;
        tile.resourceAmount = 0;
      }
      unit.state = UnitState.Returning;
    }
  } else {
    // Not on a resource tile — move to target
    if (unit.targetPos) {
      unit.state = UnitState.Moving;
    } else {
      unit.state = UnitState.Idle;
    }
  }
}

function updateReturningUnit(state: GameState, unit: Unit, dt: number): void {
  // Find nearest drop-off building (Town Hall or Lumber Mill)
  const dropOff = findNearestDropoff(state, unit);
  if (!dropOff) {
    unit.state = UnitState.Idle;
    return;
  }

  const dropPos = getEntityPosition(dropOff);
  const dist = distance(unit.x, unit.y, dropPos.x, dropPos.y);

  if (dist > 2) {
    // Move toward drop-off
    if (unit.path.length === 0 || !unit.targetPos ||
      unit.targetPos.x !== Math.round(dropPos.x) ||
      unit.targetPos.y !== Math.round(dropPos.y)) {
      unit.targetPos = { x: Math.round(dropPos.x), y: Math.round(dropPos.y) };
      unit.path = findPath(state.map, Math.round(unit.x), Math.round(unit.y),
        Math.round(dropPos.x), Math.round(dropPos.y));
    }
    // Stay in returning state but move
    const speed = unit.moveSpeed * dt;
    if (unit.path.length > 0) {
      const next = unit.path[0];
      const dx = next.x - unit.x;
      const dy = next.y - unit.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= speed) {
        unit.x = next.x;
        unit.y = next.y;
        unit.path.shift();
      } else {
        unit.x += (dx / d) * speed;
        unit.y += (dy / d) * speed;
      }
    }
    return;
  }

  // Deposit resources
  if (unit.carryingType === 'gold') {
    state.resources[unit.faction].gold += unit.carryingAmount;
  } else if (unit.carryingType === 'wood') {
    state.resources[unit.faction].wood += unit.carryingAmount;
  }
  unit.carryingAmount = 0;
  unit.carryingType = null;

  // Go back to harvesting if there's a resource target
  if (unit.targetPos) {
    unit.state = UnitState.Moving;
  } else {
    unit.state = UnitState.Idle;
  }
}

function updateBuildingUnit(state: GameState, unit: Unit, dt: number): void {
  // Find the building we're constructing
  if (unit.targetId === null) {
    unit.state = UnitState.Idle;
    return;
  }

  const building = state.buildings.get(unit.targetId);
  if (!building || building.state === BuildingState.Destroyed) {
    unit.state = UnitState.Idle;
    unit.targetId = null;
    return;
  }

  const dist = distance(unit.x, unit.y, building.tileX + 0.5, building.tileY + 0.5);

  if (dist > 3) {
    // Move to building
    unit.targetPos = { x: building.tileX, y: building.tileY };
    if (unit.path.length === 0) {
      unit.path = findPath(state.map, Math.round(unit.x), Math.round(unit.y),
        building.tileX, building.tileY);
    }
    const speed = unit.moveSpeed * dt;
    moveAlongPath(unit, speed);
    return;
  }

  // Construct
  const buildRate = WORKER_BUILD_RATE;
  building.buildProgress += buildRate * dt;
  building.hp = Math.ceil(building.maxHp * building.buildProgress);

  if (building.buildProgress >= 1) {
    building.buildProgress = 1;
    building.hp = building.maxHp;
    building.state = BuildingState.Complete;
    unit.state = UnitState.Idle;
    unit.targetId = null;
  }
}

function updateRepairingUnit(state: GameState, unit: Unit, dt: number): void {
  if (unit.targetId === null) {
    unit.state = UnitState.Idle;
    return;
  }

  const building = state.buildings.get(unit.targetId);
  if (!building || building.state === BuildingState.Destroyed) {
    unit.state = UnitState.Idle;
    unit.targetId = null;
    return;
  }

  const dist = distance(unit.x, unit.y, building.tileX + 0.5, building.tileY + 0.5);
  if (dist > 3) {
    unit.targetPos = { x: building.tileX, y: building.tileY };
    if (unit.path.length === 0) {
      unit.path = findPath(state.map, Math.round(unit.x), Math.round(unit.y),
        building.tileX, building.tileY);
    }
    const speed = unit.moveSpeed * dt;
    moveAlongPath(unit, speed);
    return;
  }

  // Repair
  building.hp = Math.min(building.maxHp, building.hp + WORKER_REPAIR_RATE * dt);
  if (building.hp >= building.maxHp) {
    unit.state = UnitState.Idle;
    unit.targetId = null;
  }
}

// ─── Building update ───

function updateBuilding(state: GameState, building: Building, dt: number): void {
  // Guard tower attacks
  if (building.type === BuildingType.GuardTower && building.state === BuildingState.Complete) {
    if (building.attackDamage > 0 && building.attackRange > 0) {
      updateTowerAttack(state, building, dt);
    }
  }

  // Training
  if (building.trainingQueue.length > 0 && building.state === BuildingState.Complete) {
    const item = building.trainingQueue[0];
    item.progress += dt / item.totalTime;

    if (item.progress >= 1) {
      // Unit trained — spawn it
      spawnTrainedUnit(state, building, item.unitType);
      building.trainingQueue.shift();
    }
  }
}

function updateTowerAttack(state: GameState, tower: Building, dt: number): void {
  if (tower.cooldownRemaining > 0) {
    tower.cooldownRemaining -= dt;
    return;
  }

  // Find nearest enemy in range
  const cx = tower.tileX + 0.5;
  const cy = tower.tileY + 0.5;

  let nearestEnemy: Unit | null = null;
  let nearestDist = Infinity;

  for (const unit of state.units.values()) {
    if (unit.faction === tower.faction || unit.state === UnitState.Dead) continue;
    const dist = distance(cx, cy, unit.x, unit.y);
    if (dist <= tower.attackRange && dist < nearestDist) {
      nearestDist = dist;
      nearestEnemy = unit;
    }
  }

  if (nearestEnemy) {
    // Fire projectile
    const projectile: Projectile = {
      id: makeId(state),
      x: cx,
      y: cy,
      targetId: nearestEnemy.id,
      damage: tower.attackDamage,
      speed: PROJECTILE_SPEED,
      faction: tower.faction,
      sourceId: tower.id,
    };
    state.projectiles.set(projectile.id, projectile);
    tower.cooldownRemaining = tower.attackCooldown;
  }
}

function spawnTrainedUnit(state: GameState, building: Building, unitType: UnitType): void {
  // Find a walkable tile near the building to spawn the unit
  const spawnPos = findSpawnPosition(state, building);
  if (!spawnPos) return;

  const unit = createUnit(state, unitType, building.faction, spawnPos.x, spawnPos.y);

  // If rally point set, move there
  if (building.rallyPoint) {
    unit.targetPos = { ...building.rallyPoint };
    unit.path = findPath(state.map, spawnPos.x, spawnPos.y,
      building.rallyPoint.x, building.rallyPoint.y);
    if (unit.path.length > 0) {
      unit.state = UnitState.Moving;
    }
  }
}

function findSpawnPosition(state: GameState, building: Building): Vec2 | null {
  const stats = BUILDING_STATS[building.type];
  // Try tiles around the building
  for (let dy = -1; dy <= stats.footprintH; dy++) {
    for (let dx = -1; dx <= stats.footprintW; dx++) {
      const x = building.tileX + dx;
      const y = building.tileY + dy;
      if (x < 0 || x >= state.map.width || y < 0 || y >= state.map.height) continue;
      const tile = state.map.tiles[y][x];
      if (WALKABLE_TILES.has(tile.type) && tile.buildingId === null) {
        // Check no unit occupies this tile
        let occupied = false;
        for (const u of state.units.values()) {
          if (Math.round(u.x) === x && Math.round(u.y) === y) {
            occupied = true;
            break;
          }
        }
        if (!occupied) return { x, y };
      }
    }
  }
  return null;
}

// ─── Combat ───

function performAttack(state: GameState, attacker: Unit, target: Unit | Building): void {
  if (attacker.attackRange > 1) {
    // Ranged attack — spawn projectile
    const proj: Projectile = {
      id: makeId(state),
      x: attacker.x,
      y: attacker.y,
      targetId: target.id,
      damage: attacker.attackDamage,
      speed: PROJECTILE_SPEED,
      faction: attacker.faction,
      sourceId: attacker.id,
    };
    state.projectiles.set(proj.id, proj);
  } else {
    // Melee attack — apply damage directly
    const armor = isUnit(target) ? (target as Unit).armor : 0;
    const damage = Math.max(1, attacker.attackDamage - armor);
    applyDamage(state, target, damage);
  }
}

function applyDamage(_state: GameState, target: Unit | Building, damage: number): void {
  if (isUnit(target)) {
    target.hp -= damage;
    if (target.hp <= 0) {
      target.hp = 0;
      target.state = UnitState.Dead;
    }
  } else {
    target.hp -= damage;
    if (target.hp <= 0) {
      target.hp = 0;
      target.state = BuildingState.Destroyed;
    }
  }
}

function updateProjectiles(state: GameState, dt: number): void {
  for (const [id, proj] of state.projectiles) {
    const target = getEntity(state, proj.targetId);
    if (!target) {
      state.projectiles.delete(id);
      continue;
    }

    const targetPos = getEntityPosition(target);
    const dx = targetPos.x - proj.x;
    const dy = targetPos.y - proj.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist <= proj.speed * dt) {
      // Hit
      const armor = isUnit(target) ? (target as Unit).armor : 0;
      const damage = Math.max(1, proj.damage - armor);
      applyDamage(state, target, damage);
      state.projectiles.delete(id);
    } else {
      // Move toward target
      proj.x += (dx / dist) * proj.speed * dt;
      proj.y += (dy / dist) * proj.speed * dt;
    }
  }
}

// ─── Fog of war ───

function updateFog(state: GameState): void {
  const w = state.map.width;
  const h = state.map.height;

  // Mark all visible as explored
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (state.fog[y][x] === FogState.Visible) {
        state.fog[y][x] = FogState.Explored;
      }
    }
  }

  // Mark tiles visible by player's units and buildings
  const markVisible = (cx: number, cy: number, radius: number) => {
    const r = Math.ceil(radius);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > radius * radius) continue;
        const x = Math.round(cx) + dx;
        const y = Math.round(cy) + dy;
        if (x < 0 || x >= w || y < 0 || y >= h) continue;
        state.fog[y][x] = FogState.Visible;
      }
    }
  };

  for (const unit of state.units.values()) {
    if (unit.faction === state.playerFaction && unit.state !== UnitState.Dead) {
      markVisible(unit.x, unit.y, unit.sightRadius);
    }
  }

  for (const building of state.buildings.values()) {
    if (building.faction === state.playerFaction && building.state !== BuildingState.Destroyed) {
      const stats = BUILDING_STATS[building.type];
      const cx = building.tileX + stats.footprintW / 2;
      const cy = building.tileY + stats.footprintH / 2;
      markVisible(cx, cy, building.sightRadius || stats.footprintW);
    }
  }
}

// ─── Win/Lose ───

function checkWinLose(state: GameState): void {
  const playerBuildings = [...state.buildings.values()].filter(b => b.faction === state.playerFaction && b.state !== BuildingState.Destroyed);
  const aiBuildings = [...state.buildings.values()].filter(b => b.faction === state.aiFaction && b.state !== BuildingState.Destroyed);

  if (playerBuildings.length === 0) {
    state.screen = GameScreen.Defeat;
  } else if (aiBuildings.length === 0) {
    state.screen = GameScreen.Victory;
    // Record level completion
    state.levelResults.set(state.currentLevel, true);
  }
}

// ─── Helper functions ───

function findNearestEnemy(state: GameState, unit: Unit, radius: number): Unit | Building | null {
  let nearest: Unit | Building | null = null;
  let nearestDist = Infinity;

  for (const other of state.units.values()) {
    if (other.faction === unit.faction || other.state === UnitState.Dead) continue;
    const dist = distance(unit.x, unit.y, other.x, other.y);
    if (dist <= radius && dist < nearestDist) {
      nearestDist = dist;
      nearest = other;
    }
  }

  // Also check enemy buildings (for attack-move)
  for (const building of state.buildings.values()) {
    if (building.faction === unit.faction || building.state === BuildingState.Destroyed) continue;
    const stats = BUILDING_STATS[building.type];
    const cx = building.tileX + stats.footprintW / 2;
    const cy = building.tileY + stats.footprintH / 2;
    const dist = distance(unit.x, unit.y, cx, cy);
    if (dist <= radius && dist < nearestDist) {
      nearestDist = dist;
      nearest = building;
    }
  }

  return nearest;
}

function findNearestDropoff(state: GameState, unit: Unit): Building | null {
  let nearest: Building | null = null;
  let nearestDist = Infinity;

  for (const building of state.buildings.values()) {
    if (building.faction !== unit.faction || building.state !== BuildingState.Complete) continue;
    if (building.type !== BuildingType.TownHall && building.type !== BuildingType.LumberMill) continue;

    // Only gold drop-off at Town Hall, wood at both
    if (unit.carryingType === 'gold' && building.type !== BuildingType.TownHall) continue;

    const stats = BUILDING_STATS[building.type];
    const cx = building.tileX + stats.footprintW / 2;
    const cy = building.tileY + stats.footprintH / 2;
    const dist = distance(unit.x, unit.y, cx, cy);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = building;
    }
  }

  return nearest;
}

function moveAlongPath(unit: Unit, speed: number): void {
  if (unit.path.length === 0) return;

  let remaining = speed;
  while (remaining > 0 && unit.path.length > 0) {
    const next = unit.path[0];
    const dx = next.x - unit.x;
    const dy = next.y - unit.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 0.05) {
      unit.x = next.x;
      unit.y = next.y;
      unit.path.shift();
      continue;
    }

    if (dist <= remaining) {
      unit.x = next.x;
      unit.y = next.y;
      remaining -= dist;
      unit.path.shift();
    } else {
      unit.x += (dx / dist) * remaining;
      unit.y += (dy / dist) * remaining;
      remaining = 0;
    }
  }
}

function getEntity(state: GameState, id: number): Unit | Building | null {
  return state.units.get(id) ?? state.buildings.get(id) ?? null;
}

function getEntityPosition(entity: Unit | Building): Vec2 {
  if (isUnit(entity)) {
    return { x: (entity as Unit).x, y: (entity as Unit).y };
  }
  const b = entity as Building;
  const stats = BUILDING_STATS[b.type];
  return { x: b.tileX + stats.footprintW / 2, y: b.tileY + stats.footprintH / 2 };
}

function isUnit(entity: Unit | Building): entity is Unit {
  return 'moveSpeed' in entity;
}

function isBuilding(entity: Unit | Building): entity is Building {
  return 'tileX' in entity;
}

export function distance(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

// ─── Command processing ───

export function issueMoveCommand(state: GameState, unitIds: number[], x: number, y: number): void {
  for (const id of unitIds) {
    const unit = state.units.get(id);
    if (!unit || unit.state === UnitState.Dead) continue;
    unit.targetPos = { x: Math.round(x), y: Math.round(y) };
    unit.path = findPath(state.map, Math.round(unit.x), Math.round(unit.y), Math.round(x), Math.round(y));
    unit.state = UnitState.Moving;
    unit.targetId = null;
  }
}

export function issueAttackCommand(state: GameState, unitIds: number[], targetId: number): void {
  for (const id of unitIds) {
    const unit = state.units.get(id);
    if (!unit || unit.state === UnitState.Dead) continue;
    unit.targetId = targetId;
    unit.state = UnitState.Attacking;
    unit.targetPos = null;
    unit.path = [];
  }
}

export function issueAttackMoveCommand(state: GameState, unitIds: number[], x: number, y: number): void {
  for (const id of unitIds) {
    const unit = state.units.get(id);
    if (!unit || unit.state === UnitState.Dead) continue;
    unit.targetPos = { x: Math.round(x), y: Math.round(y) };
    unit.path = findPath(state.map, Math.round(unit.x), Math.round(unit.y), Math.round(x), Math.round(y));
    unit.state = UnitState.Moving;
    unit.targetId = null;
    // Attack-move: will auto-acquire enemies along the way
  }
}

export function issueHarvestCommand(state: GameState, unitIds: number[], tx: number, ty: number): void {
  for (const id of unitIds) {
    const unit = state.units.get(id);
    if (!unit || unit.state === UnitState.Dead || unit.type !== UnitType.Worker) continue;
    unit.targetPos = { x: Math.round(tx), y: Math.round(ty) };
    unit.path = findPath(state.map, Math.round(unit.x), Math.round(unit.y), Math.round(tx), Math.round(ty));
    unit.state = UnitState.Moving;
    unit.targetId = null;
    // After arriving, will switch to harvesting
  }
}

export function issueBuildCommand(state: GameState, unitId: number, buildingType: BuildingType, tileX: number, tileY: number): void {
  const unit = state.units.get(unitId);
  if (!unit || unit.type !== UnitType.Worker) return;

  const stats = BUILDING_STATS[buildingType];

  // Check resources
  const resources = state.resources[unit.faction];
  if (resources.gold < stats.goldCost || resources.wood < stats.woodCost) return;

  // Check supply for Town Hall (doesn't require supply)
  // Check placement validity
  if (!canPlaceBuilding(state, buildingType, tileX, tileY, unit.faction)) return;

  // Deduct resources
  resources.gold -= stats.goldCost;
  resources.wood -= stats.woodCost;

  // Create building
  const building = createBuilding(state, buildingType, unit.faction, tileX, tileY);

  // Order worker to build
  unit.targetId = building.id;
  unit.state = UnitState.Building;
  unit.targetPos = { x: tileX, y: tileY };
  unit.path = findPath(state.map, Math.round(unit.x), Math.round(unit.y), tileX, tileY);
}

export function issueTrainCommand(state: GameState, buildingId: number, unitType: UnitType): void {
  const building = state.buildings.get(buildingId);
  if (!building || building.state !== BuildingState.Complete) return;

  // Check prerequisites
  const prerequisites = getUnitPrerequisites(unitType);
  for (const prereq of prerequisites) {
    const hasPrereq = [...state.buildings.values()].some(
      b => b.faction === building.faction && b.type === prereq && b.state === BuildingState.Complete
    );
    if (!hasPrereq) return;
  }

  // Check it's the right building
  const requiredBuilding = getTrainingBuilding(unitType);
  if (building.type !== requiredBuilding) return;

  // Check resources
  const stats = UNIT_STATS[unitType];
  const resources = state.resources[building.faction];
  if (resources.gold < stats.goldCost || resources.wood < stats.woodCost) return;

  // Check supply
  const supply = getSupply(state, building.faction);
  if (supply.used + stats.supplyCost > supply.cap) return;

  // Deduct resources
  resources.gold -= stats.goldCost;
  resources.wood -= stats.woodCost;

  // Add to training queue
  building.trainingQueue.push({
    unitType,
    progress: 0,
    totalTime: stats.trainingTime,
  });
}

export function issueRepairCommand(state: GameState, unitIds: number[], targetId: number): void {
  for (const id of unitIds) {
    const unit = state.units.get(id);
    if (!unit || unit.type !== UnitType.Worker) continue;
    unit.targetId = targetId;
    unit.state = UnitState.Repairing;
    unit.targetPos = null;
    unit.path = [];
  }
}

export function canPlaceBuilding(state: GameState, type: BuildingType, tileX: number, tileY: number, _faction: Faction): boolean {
  const stats = BUILDING_STATS[type];

  // Check bounds
  if (tileX < 0 || tileY < 0 ||
    tileX + stats.footprintW > state.map.width ||
    tileY + stats.footprintH > state.map.height) {
    return false;
  }

  // Check all tiles are buildable and unoccupied
  for (let dy = 0; dy < stats.footprintH; dy++) {
    for (let dx = 0; dx < stats.footprintW; dx++) {
      const tile = state.map.tiles[tileY + dy][tileX + dx];
      if (!WALKABLE_TILES.has(tile.type) || tile.buildingId !== null) {
        return false;
      }
    }
  }

  return true;
}

// ─── Supply ───

export function getSupply(state: GameState, faction: Faction): SupplyInfo {
  let cap = 0;
  let used = 0;

  for (const building of state.buildings.values()) {
    if (building.faction === faction && building.state === BuildingState.Complete) {
      cap += BUILDING_STATS[building.type].supplyProvided;
    }
  }

  for (const unit of state.units.values()) {
    if (unit.faction === faction && unit.state !== UnitState.Dead) {
      used += unit.supplyCost;
    }
  }

  // Also count units in training
  for (const building of state.buildings.values()) {
    if (building.faction === faction) {
      for (const item of building.trainingQueue) {
        used += UNIT_STATS[item.unitType].supplyCost;
      }
    }
  }

  return { used, cap };
}

// ─── AI functions (exported for ai.ts) ───

export function getPlayerStartLocations(state: GameState): { player: Vec2; ai: Vec2 } {
  return { player: state.playerStart, ai: state.aiStart };
}

export function findNearestResource(state: GameState, from: Vec2, type: TileType): Vec2 | null {
  let best: Vec2 | null = null;
  let bestDist = Infinity;

  for (let y = 0; y < state.map.height; y++) {
    for (let x = 0; x < state.map.width; x++) {
      const tile = state.map.tiles[y][x];
      if (tile.type === type && tile.resourceAmount > 0) {
        const dist = distance(from.x, from.y, x, y);
        if (dist < bestDist) {
          bestDist = dist;
          best = { x, y };
        }
      }
    }
  }

  return best;
}