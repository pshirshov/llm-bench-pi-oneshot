import type {
  Entity, Building, Projectile, Corpse, GameState, PlayerOrder, Faction,
  UnitType, BuildingType, Tile, Point, TileVisibility, AIState
} from './types';
import {
  UNIT_DATA, BUILDING_DATA, FACTION_COLORS, TILE_WALKABLE, TILE_HARVESTABLE,
  AI_BUILD_ORDER
} from './data';
import { SUPPLY_TH, SUPPLY_FARM } from './constants';
import {
  TILE_PX, SIM_HZ, SIM_DT, HARVEST_GOLD_RATE, HARVEST_WOOD_RATE, HARVEST_TIME,
  RETURN_TIME, WORKER_BUILD_RATE, PATH_REPLAN_INTERVAL, STUCK_THRESHOLD,
  PROJECTILE_SPEED, CORPSE_FADE_TICKS, SIGHT_WORKER, SIGHT_INF, SIGHT_RANGED,
  SIGHT_HEAVY, TOWER_RANGE, TOWER_SIGHT, WAVE_BASE_SIZE, AI_FIRST_WAVE_DELAY_TICKS
} from './constants';
import { mulberry32, hashSeed } from './rng';
import { generateMap, isTileBuildable, markTiles } from './mapgen';
import { buildWalkGrid, findPath, smoothPath } from './pathfind';
import type { Grid } from './pathfind';

export function createInitialState(
  level: number,
  playerFaction: Faction,
  seed: number
): GameState {
  const mapSize = [32, 40, 48, 64, 80][Math.min(level, 4)];
  const difficulty = Math.min(5, Math.max(1, level + 1));

  const rng = mulberry32(seed);
  const mapData = generateMap(mapSize, mapSize, seed, rng);

  const tiles = mapData.tiles;
  const w = mapData.w;
  const h = mapData.h;

  const state: GameState = {
    tick: 0,
    seed,
    rng,
    mapW: w,
    mapH: h,
    tiles,
    vis: Array.from({ length: h }, () => Array(w).fill('unexplored' as TileVisibility)),
    exploredBuildings: new Map(),
    entities: new Map(),
    nextId: 1,
    projectiles: [],
    corpses: [],
    gold: { human: 0, orc: 0 },
    wood: { human: 0, orc: 0 },
    supplyUsed: { human: 0, orc: 0 },
    supplyCap: { human: 0, orc: 0 },
    playerFaction,
    selectedIds: new Set(),
    controlGroups: {},
    camX: 0,
    camY: 0,
    aiState: {
      lastWaveTick: -999999,
      nextWaveSize: WAVE_BASE_SIZE,
      workersOnGold: 0,
      workersOnWood: 0,
      plannedBarracks: false,
      plannedLumber: false,
      plannedTowers: 0,
      baseCenter: { x: 0, y: 0 },
      threats: [],
    },
    paused: false,
    speed: 1,
    gameOver: 'none',
    level,
    difficulty,
  };

  // Place starting buildings and workers
  const oppFaction: Faction = playerFaction === 'human' ? 'orc' : 'human';

  // Player start
  placeStartingBase(state, playerFaction, mapData.startA, rng);
  // AI start
  placeStartingBase(state, oppFaction, mapData.startB, rng);

  // Set initial resources + difficulty bonus
  const goldStart = 650 + (difficulty - 1) * 120;
  const woodStart = 320 + (difficulty - 1) * 70;
  state.gold[playerFaction] = goldStart;
  state.wood[playerFaction] = woodStart;
  state.gold[oppFaction] = goldStart + Math.floor((difficulty - 1) * 60);
  state.wood[oppFaction] = woodStart + Math.floor((difficulty - 1) * 40);

  // Initial visibility around starts
  updateFog(state, true);

  // Camera starts near player
  state.camX = Math.max(0, Math.min(w - 30, mapData.startA.x - 12));
  state.camY = Math.max(0, Math.min(h - 22, mapData.startA.y - 9));

  // AI base center
  state.aiState.baseCenter = { ...mapData.startB };

  return state;
}

function placeStartingBase(state: GameState, fac: Faction, start: Point, rng: () => number): void {
  const thStats = BUILDING_DATA[fac].th;

  // Town Hall
  const th = createBuilding(state, fac, 'th', Math.floor(start.x) - 1, Math.floor(start.y) - 1);
  th.isBuilt = true;
  th.buildProgress = thStats.buildTime;
  th.hp = th.maxHp;

  // One worker
  const worker = createUnit(state, fac, 'worker', start.x + 1.5 + (rng() - 0.5) * 0.8, start.y + 2.5 + (rng() - 0.5) * 0.8);
  worker.hp = worker.maxHp;

  // One farm near
  const farm = createBuilding(state, fac, 'farm', Math.floor(start.x) + 2, Math.floor(start.y) + 1);
  farm.isBuilt = true;
  farm.buildProgress = BUILDING_DATA[fac].farm.buildTime;
  farm.hp = farm.maxHp;

  // Initial supply
  state.supplyCap[fac] = SUPPLY_TH + SUPPLY_FARM;
  state.supplyUsed[fac] = 1; // the worker
}

export function createUnit(state: GameState, fac: Faction, ut: UnitType, x: number, y: number): Entity {
  const stats = UNIT_DATA[fac][ut];
  const id = state.nextId++;
  const size = ut === 'heavy' ? 0.65 : ut === 'worker' ? 0.55 : 0.58;
  const e: Entity = {
    id,
    faction: fac,
    kind: 'unit',
    type: ut,
    pos: { x, y },
    hp: stats.hp,
    maxHp: stats.hp,
    size,
    selected: false,
    order: 'idle',
    cooldown: 0,
    path: [],
    pathIndex: 0,
    stuckTicks: 0,
    facing: 0,
    animFrame: 0,
  };
  state.entities.set(id, e);
  state.supplyUsed[fac] += stats.supply;
  return e;
}

export function createBuilding(
  state: GameState,
  fac: Faction,
  bt: BuildingType,
  footX: number,
  footY: number
): Building {
  const stats = BUILDING_DATA[fac][bt];
  const id = state.nextId++;
  const centerX = footX + stats.footprintW / 2;
  const centerY = footY + stats.footprintH / 2;
  const size = Math.max(stats.footprintW, stats.footprintH) * 0.52;

  const b: Building = {
    id,
    faction: fac,
    kind: 'building',
    type: bt,
    pos: { x: centerX, y: centerY },
    hp: stats.hp * 0.15, // under construction starts low
    maxHp: stats.hp,
    size,
    selected: false,
    footX,
    footY,
    footW: stats.footprintW,
    footH: stats.footprintH,
    isBuilt: false,
    buildProgress: 0,
    cooldown: 0,
  };
  state.entities.set(id, b);
  // Supply granted only when built (handled on completion)
  return b;
}

export function canAfford(state: GameState, fac: Faction, gold: number, wood: number, supply: number): boolean {
  return state.gold[fac] >= gold &&
         state.wood[fac] >= wood &&
         (state.supplyUsed[fac] + supply) <= state.supplyCap[fac];
}

export function spend(state: GameState, fac: Faction, gold: number, wood: number): void {
  state.gold[fac] -= gold;
  state.wood[fac] -= wood;
}

export function getUnitSight(ut: UnitType): number {
  if (ut === 'worker') return SIGHT_WORKER;
  if (ut === 'inf') return SIGHT_INF;
  if (ut === 'ranged') return SIGHT_RANGED;
  return SIGHT_HEAVY;
}

export function getBuildingSight(bt: BuildingType): number {
  return bt === 'tower' ? TOWER_SIGHT : 5.5;
}

function updateFog(state: GameState, fullReset = false): void {
  const { mapW: w, mapH: h, entities, vis, playerFaction } = state;

  if (fullReset) {
    for (let y=0; y<h; y++) for (let x=0; x<w; x++) vis[y][x] = 'unexplored';
  }

  // Clear current visible
  for (let y=0; y<h; y++) {
    for (let x=0; x<w; x++) {
      if (vis[y][x] === 'visible') vis[y][x] = 'explored';
    }
  }

  // Reveal from player entities
  const sightSources: Array<{x:number, y:number, r:number}> = [];
  for (const e of entities.values()) {
    if (e.faction !== playerFaction) continue;
    const r = e.kind === 'unit' ? getUnitSight(e.type as UnitType) : getBuildingSight(e.type as BuildingType);
    sightSources.push({ x: e.pos.x, y: e.pos.y, r });
  }

  for (const src of sightSources) {
    const r2 = src.r * src.r + 0.5;
    const minX = Math.max(0, Math.floor(src.x - src.r - 1));
    const maxX = Math.min(w-1, Math.floor(src.x + src.r + 1));
    const minY = Math.max(0, Math.floor(src.y - src.r - 1));
    const maxY = Math.min(h-1, Math.floor(src.y + src.r + 1));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x + 0.5 - src.x;
        const dy = y + 0.5 - src.y;
        if (dx*dx + dy*dy <= r2) {
          vis[y][x] = 'visible';
        }
      }
    }
  }

  // Also mark tiles under visible player buildings as visible always
  for (const e of entities.values()) {
    if (e.faction !== playerFaction || e.kind !== 'building') continue;
    const b = e as Building;
    for (let dy=0; dy < b.footH; dy++) {
      for (let dx=0; dx < b.footW; dx++) {
        const tx = Math.floor(b.footX + dx);
        const ty = Math.floor(b.footY + dy);
        if (tx>=0 && ty>=0 && tx<w && ty<h) vis[ty][tx] = 'visible';
      }
    }
  }
}

function updateExploredBuildings(state: GameState): void {
  // Snapshot enemy buildings that were visible for fog-of-war minimap
  for (const e of state.entities.values()) {
    if (e.faction === state.playerFaction || e.kind !== 'building') continue;
    const b = e as Building;
    if (b.isBuilt) {
      state.exploredBuildings.set(b.id, JSON.parse(JSON.stringify(b))); // shallow ok for draw
    }
  }
}

function getEntitySightRadius(e: Entity): number {
  if (e.kind === 'unit') return getUnitSight(e.type as UnitType);
  return getBuildingSight(e.type as BuildingType);
}

function findNearestEnemy(state: GameState, e: Entity, maxDist: number): Entity | null {
  let best: Entity | null = null;
  let bestD = maxDist;
  const fac = e.faction;
  for (const other of state.entities.values()) {
    if (other.faction === fac || other.hp <= 0) continue;
    const d = Math.hypot(other.pos.x - e.pos.x, other.pos.y - e.pos.y);
    if (d < bestD) {
      bestD = d;
      best = other;
    }
  }
  return best;
}

function acquireTarget(state: GameState, e: Entity): void {
  if (e.kind !== 'unit') return;
  const sight = getEntitySightRadius(e) + 1.5;
  const target = findNearestEnemy(state, e, sight);
  if (target) {
    e.targetId = target.id;
    e.order = 'attack';
    e.targetPos = undefined;
  }
}

function distanceTo(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function moveToward(e: Entity, target: Point, dt: number): void {
  const dx = target.x - e.pos.x;
  const dy = target.y - e.pos.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.02) {
    e.vel = { x: 0, y: 0 };
    return;
  }
  const spd = e.kind === 'unit' ? UNIT_DATA[e.faction][e.type as UnitType].speed : 0;
  const step = Math.min(dist, spd * (dt / 1000) * SIM_HZ);
  const nx = e.pos.x + (dx / dist) * step;
  const ny = e.pos.y + (dy / dist) * step;
  e.pos.x = nx;
  e.pos.y = ny;
  e.facing = Math.atan2(dy, dx);
  e.vel = { x: (dx / dist) * spd * 0.6, y: (dy / dist) * spd * 0.6 };
}

function applyUnitMovement(state: GameState, e: Entity, dt: number, grid: Grid): void {
  if (e.kind !== 'unit' || !e.path || e.path.length === 0) return;
  const stats = UNIT_DATA[e.faction][e.type as UnitType];
  const speedTilesPerSec = stats.speed;

  // follow path
  let idx = e.pathIndex ?? 0;
  if (idx >= e.path.length) {
    e.path = [];
    e.order = e.order === 'move' ? 'idle' : e.order;
    return;
  }

  const goal = e.path[idx];
  const dx = goal.x - e.pos.x;
  const dy = goal.y - e.pos.y;
  const dist = Math.hypot(dx, dy);

  if (dist < 0.18) {
    e.pathIndex = idx + 1;
    if (e.pathIndex >= e.path.length) {
      e.path = [];
      e.vel = { x: 0, y: 0 };
      if (e.order === 'move') e.order = 'idle';
      return;
    }
    return;
  }

  const step = speedTilesPerSec * (dt / 1000);
  const nx = e.pos.x + (dx / dist) * Math.min(step, dist);
  const ny = e.pos.y + (dy / dist) * Math.min(step, dist);

  // simple avoidance: push away from nearby friendly units
  let ax = 0, ay = 0;
  for (const other of state.entities.values()) {
    if (other.id === e.id || other.faction !== e.faction || other.kind !== 'unit') continue;
    const ddx = e.pos.x - other.pos.x;
    const ddy = e.pos.y - other.pos.y;
    const dd = Math.hypot(ddx, ddy);
    if (dd > 0.01 && dd < 1.4) {
      const push = (1.4 - dd) / 1.4 * 0.35;
      ax += (ddx / dd) * push;
      ay += (ddy / dd) * push;
    }
  }
  const nax = nx + ax * 0.6;
  const nay = ny + ay * 0.6;

  // collision with map
  const tx = Math.floor(nax);
  const ty = Math.floor(nay);
  const walk = tx >= 0 && ty >= 0 && tx < state.mapW && ty < state.mapH && grid[ty] && grid[ty][tx];
  if (walk) {
    e.pos.x = nax;
    e.pos.y = nay;
  } else {
    // slide or stop
    e.pos.x = nx;
    e.pos.y = ny;
  }

  e.facing = Math.atan2(dy, dx);
  e.vel = { x: (dx / dist) * speedTilesPerSec * 0.7, y: (dy / dist) * speedTilesPerSec * 0.7 };

  // replan occasionally if path blocked
  if ((state.tick + e.id) % PATH_REPLAN_INTERVAL === 0 && e.path.length > 1) {
    const g = e.path[e.path.length - 1];
    const newPath = findPath(grid, e.pos, g, state.mapW, state.mapH);
    if (newPath) {
      e.path = smoothPath(newPath, grid, state.mapW, state.mapH);
      e.pathIndex = 0;
    }
  }
}

function handleHarvest(state: GameState, e: Entity, dt: number): void {
  if (e.kind !== 'unit' || e.type !== 'worker' || !e.targetId || !e.harvestResource) return;

  const target = state.entities.get(e.targetId);
  if (!target || target.hp <= 0) {
    e.order = 'idle';
    e.targetId = undefined;
    return;
  }

  const d = distanceTo(e.pos, target.pos);
  const loadDist = 1.35;

  if (e.harvestResource === 'gold' && d < loadDist) {
    // at mine: "harvest"
    if ((e.cooldown ?? 0) <= 0) {
      e.cooldown = HARVEST_TIME;
      // visual load flag via anim later
    }
    e.cooldown = Math.max(0, (e.cooldown ?? 0) - 1);
    if ((e.cooldown ?? 0) === 0 && e.targetPos) {
      // loaded, go return
      const drop = findNearestDropoff(state, e.faction, 'gold', e.pos);
      if (drop) {
        e.targetPos = drop;
        e.targetId = undefined;
        e.order = 'harvest'; // still harvest mode but returning
      }
    }
  } else if (e.harvestResource === 'wood' && d < loadDist) {
    if ((e.cooldown ?? 0) <= 0) {
      e.cooldown = HARVEST_TIME;
    }
    e.cooldown = Math.max(0, (e.cooldown ?? 0) - 1);
    if ((e.cooldown ?? 0) === 0 && e.targetPos) {
      const drop = findNearestDropoff(state, e.faction, 'wood', e.pos);
      if (drop) {
        e.targetPos = drop;
        e.targetId = undefined;
      }
    }
  } else {
    // move to target or dropoff
    if (e.targetPos) {
      const goal = e.targetPos;
      const gDist = distanceTo(e.pos, goal);
      if (gDist > 0.6) {
        moveToward(e, goal, dt);
      } else {
        // arrived at drop -> unload and go back for more
        if (e.harvestResource === 'gold') {
          state.gold[e.faction] += HARVEST_GOLD_RATE;
        } else {
          state.wood[e.faction] += HARVEST_WOOD_RATE;
        }
        // go back to a new resource target
        const resType = e.harvestResource;
        const newTarget = findNearestHarvestable(state, e.pos, resType, 12);
        if (newTarget) {
          e.targetId = newTarget.id;
          e.targetPos = newTarget.pos;
          e.cooldown = 0;
        } else {
          e.order = 'idle';
          e.targetId = undefined;
          e.targetPos = undefined;
        }
      }
    }
  }
}

function findNearestDropoff(state: GameState, fac: Faction, res: 'gold'|'wood', near: Point): Point | null {
  let best: Point | null = null;
  let bestD = Infinity;
  for (const e of state.entities.values()) {
    if (e.faction !== fac || e.kind !== 'building' || ! (e as Building).isBuilt) continue;
    const bt = e.type as BuildingType;
    const ok = (res === 'gold' && (bt === 'th')) || (res === 'wood' && (bt === 'th' || bt === 'lumbermill'));
    if (ok) {
      const d = distanceTo(near, e.pos);
      if (d < bestD) {
        bestD = d;
        best = { ...e.pos };
      }
    }
  }
  return best;
}

function findNearestHarvestable(state: GameState, near: Point, res: 'gold'|'wood', maxRange: number): {id: number, pos: Point} | null {
  let best: {id:number, pos:Point, d:number} | null = null;
  for (const e of state.entities.values()) {
    if (e.kind !== 'building' || e.type !== (res==='gold'?'goldmine': /* wood not entity */ 'lumbermill')) continue; // wood uses tile
    if (res === 'gold') {
      const d = distanceTo(near, e.pos);
      if (d < maxRange && (best === null || d < best.d)) {
        best = { id: e.id, pos: {...e.pos}, d };
      }
    }
  }
  if (res === 'wood') {
    // find forest tile near
    const tw = state.mapW, th = state.mapH;
    let bestTile: Point | null = null;
    let td = Infinity;
    const cx = Math.floor(near.x), cy = Math.floor(near.y);
    for (let y = Math.max(0, cy-8); y < Math.min(th, cy+9); y++) {
      for (let x = Math.max(0, cx-8); x < Math.min(tw, cx+9); x++) {
        if (state.tiles[y][x] === 'forest') {
          const d = Math.hypot(x+0.5 - near.x, y+0.5 - near.y);
          if (d < td) {
            td = d;
            bestTile = {x: x + 0.5, y: y + 0.5};
          }
        }
      }
    }
    if (bestTile && td < maxRange) {
      // create a virtual target id? use negative ids for tiles or special
      // For simplicity we will use a special marker - reuse targetPos and set targetId to -1
      return { id: -999, pos: bestTile };
    }
  }
  return best;
}

function handleBuild(state: GameState, e: Entity, dt: number): void {
  if (e.kind !== 'unit' || e.type !== 'worker' || !e.buildType || !e.targetPos) return;
  const bt = e.buildType;
  const targetPos = e.targetPos;
  const d = distanceTo(e.pos, targetPos);

  if (d > 1.8) {
    moveToward(e, targetPos, dt);
    return;
  }

  // at site: contribute progress
  // find the building we are building (or create it)
  let building: Building | undefined;
  for (const b of state.entities.values()) {
    if (b.kind === 'building' && b.faction === e.faction && b.type === bt &&
        Math.abs((b as Building).footX - Math.floor(targetPos.x)) < 0.5 &&
        Math.abs((b as Building).footY - Math.floor(targetPos.y)) < 0.5) {
      building = b as Building;
      break;
    }
  }
  if (!building) {
    const fx = Math.floor(targetPos.x);
    const fy = Math.floor(targetPos.y);
    const stats = BUILDING_DATA[e.faction][bt];
    // final placement check
    if (!isTileBuildable(state.tiles, fx, fy, stats.footprintW, stats.footprintH)) {
      e.order = 'idle';
      e.buildType = undefined;
      e.targetPos = undefined;
      return;
    }
    building = createBuilding(state, e.faction, bt, fx, fy);
  }

  const stats = BUILDING_DATA[e.faction][bt];
  building.buildProgress = (building.buildProgress || 0) + WORKER_BUILD_RATE;
  // repair / progress hp proportionally
  const progressRatio = Math.min(1, building.buildProgress / stats.buildTime);
  building.hp = Math.min(stats.hp, building.maxHp * (0.15 + progressRatio * 0.85));

  if (building.buildProgress >= stats.buildTime) {
    building.isBuilt = true;
    building.hp = building.maxHp;
    building.buildProgress = stats.buildTime;

    // grant supply
    if (bt === 'th' || bt === 'farm') {
      state.supplyCap[e.faction] += stats.supply;
    }
    // mark occupied tiles
    markTiles(state.tiles, building.footX, building.footY, building.footW, building.footH, 'dirt');

    e.order = 'idle';
    e.buildType = undefined;
    e.targetPos = undefined;
  }
}

function handleAttack(state: GameState, e: Entity, dt: number): void {
  if (!e.targetId) return;
  const tgt = state.entities.get(e.targetId);
  if (!tgt || tgt.hp <= 0) {
    e.targetId = undefined;
    e.order = 'idle';
    return;
  }

  const d = distanceTo(e.pos, tgt.pos);
  let attackRange = 0.9;
  let damage = 5;
  let cooldownTicks = 24;

  if (e.kind === 'unit') {
    const st = UNIT_DATA[e.faction][e.type as UnitType];
    attackRange = st.attackRange;
    damage = st.damage;
    cooldownTicks = st.attackCooldown;
  } else if (e.kind === 'building' && e.type === 'tower') {
    attackRange = TOWER_RANGE;
    damage = 11;
    cooldownTicks = 38;
  }

  if (d <= attackRange + 0.15) {
    if ((e.cooldown ?? 0) <= 0) {
      e.cooldown = cooldownTicks;
      e.lastAttackTick = state.tick;

      // spawn projectile for ranged / tower
      const isRanged = (e.kind === 'unit' && e.type === 'ranged') || e.type === 'tower';
      if (isRanged) {
        const projSpeed = PROJECTILE_SPEED;
        const dx = tgt.pos.x - e.pos.x;
        const dy = tgt.pos.y - e.pos.y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const life = Math.ceil(dist / projSpeed * SIM_HZ * 1.1);
        state.projectiles.push({
          id: state.nextId++,
          pos: { x: e.pos.x, y: e.pos.y },
          vel: { x: (dx / dist) * projSpeed, y: (dy / dist) * projSpeed },
          damage,
          ownerFaction: e.faction,
          targetId: tgt.id,
          life,
        });
      } else {
        // melee instant
        applyDamage(state, tgt, damage, e.faction);
      }
    }
    e.cooldown = Math.max(0, (e.cooldown ?? 0) - 1);
  } else {
    // move closer
    moveToward(e, tgt.pos, dt);
    e.cooldown = Math.max(0, (e.cooldown ?? 0) - 0.6);
  }
}

function applyDamage(state: GameState, target: Entity, rawDmg: number, attackerFac: Faction): void {
  let dmg = Math.max(1, rawDmg - (target.kind === 'unit' ? UNIT_DATA[target.faction][target.type as UnitType].armor : 1));
  if (target.kind === 'building') dmg = Math.max(1, rawDmg - 2);

  target.hp -= dmg;
  if (target.hp <= 0) {
    killEntity(state, target, attackerFac);
  }
}

function killEntity(state: GameState, e: Entity, killerFac?: Faction): void {
  if (e.hp > 0) e.hp = 0;

  // refund partial supply
  if (e.kind === 'unit') {
    const sup = UNIT_DATA[e.faction][e.type as UnitType].supply;
    state.supplyUsed[e.faction] = Math.max(0, state.supplyUsed[e.faction] - sup);
  }

  // corpses
  state.corpses.push({
    pos: { ...e.pos },
    faction: e.faction,
    kind: e.kind,
    size: e.size,
    fade: 1.0,
  });

  // If building, possibly free tiles
  if (e.kind === 'building') {
    const b = e as Building;
    // do not restore tile type - keep it "ruined" dirt-ish
  }

  state.entities.delete(e.id);

  // remove from selections
  state.selectedIds.delete(e.id);
  for (const g of Object.keys(state.controlGroups)) {
    const grp = state.controlGroups[Number(g)];
    state.controlGroups[Number(g)] = grp.filter(id => id !== e.id);
  }

  // game end check later
}

function processProjectiles(state: GameState): void {
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const p = state.projectiles[i];
    p.pos.x += p.vel.x / SIM_HZ;
    p.pos.y += p.vel.y / SIM_HZ;
    p.life -= 1;

    // hit check
    const tgt = state.entities.get(p.targetId);
    if (tgt && tgt.hp > 0) {
      const d = distanceTo(p.pos, tgt.pos);
      if (d < 0.55) {
        applyDamage(state, tgt, p.damage, p.ownerFaction);
        state.projectiles.splice(i, 1);
        continue;
      }
    }
    if (p.life <= 0) {
      state.projectiles.splice(i, 1);
    }
  }
}

function updateCorpses(state: GameState): void {
  for (let i = state.corpses.length - 1; i >= 0; i--) {
    const c = state.corpses[i];
    c.fade -= 1 / CORPSE_FADE_TICKS;
    if (c.fade <= 0) state.corpses.splice(i, 1);
  }
}

function updateAI(state: GameState): void {
  const aiFac: Faction = state.playerFaction === 'human' ? 'orc' : 'human';
  const ai = state.aiState;
  const difficulty = state.difficulty;

  // count workers and military
  let workerCount = 0;
  let militaryCount = 0;
  let hasBarracks = false;
  let hasLumber = false;
  let th: Building | null = null;
  const goldMinesNearAI: Entity[] = [];

  for (const e of state.entities.values()) {
    if (e.faction !== aiFac) continue;
    if (e.kind === 'unit') {
      if (e.type === 'worker') workerCount++;
      else militaryCount++;
    } else if (e.kind === 'building' && (e as Building).isBuilt) {
      const bt = e.type as BuildingType;
      if (bt === 'th') th = e as Building;
      if (bt === 'barracks') hasBarracks = true;
      if (bt === 'lumbermill') hasLumber = true;
    }
  }

  // Find a gold mine near AI base
  let nearestMine: Entity | null = null;
  let mineD = Infinity;
  for (const e of state.entities.values()) {
    if (e.kind === 'building' && (e.type as any) === 'goldmine' /* special: mines are buildings in our model */) {
      // goldmine is actually a tile, but we represent it as building entity sometimes
      // In practice mines are not entities, they are tiles. We use findNearestHarvestable style.
    }
  }
  // For AI harvesting we use same functions

  // Maintain workers
  const idealWorkers = Math.min(7 + difficulty, 11);
  const goldNeeded = Math.max(0, 3 + Math.floor(difficulty * 0.6) - ai.workersOnGold);
  const woodNeeded = Math.max(0, 2 + Math.floor(difficulty * 0.4) - ai.workersOnWood);

  // Train workers if possible
  if (workerCount < idealWorkers && canAfford(state, aiFac, 65, 0, 1) && th) {
    spend(state, aiFac, 65, 0);
    const wx = th.pos.x + (Math.random() - 0.5) * 3.5;
    const wy = th.pos.y + 2.2 + (Math.random() - 0.5);
    createUnit(state, aiFac, 'worker', wx, wy);
  }

  // Build order
  if (!ai.plannedBarracks && hasBarracks) ai.plannedBarracks = true;
  if (!ai.plannedLumber && hasLumber) ai.plannedLumber = true;

  const buildCandidates: BuildingType[] = [];
  if (!ai.plannedBarracks && workerCount > 1) buildCandidates.push('barracks');
  if (!ai.plannedLumber && hasBarracks) buildCandidates.push('lumbermill');
  if (ai.plannedLumber && ai.plannedBarracks && ai.plannedTowers < 1 + Math.floor(difficulty/2)) {
    buildCandidates.push('tower');
  }
  // farms when supply tight
  if (state.supplyUsed[aiFac] + 3 >= state.supplyCap[aiFac] && workerCount > 2) {
    buildCandidates.unshift('farm');
  }

  // Issue build command to an idle worker
  if (buildCandidates.length > 0 && workerCount > 0) {
    const bt = buildCandidates[0];
    const stats = BUILDING_DATA[aiFac][bt];
    if (canAfford(state, aiFac, stats.goldCost, stats.woodCost, 0)) {
      // find idle worker
      for (const w of state.entities.values()) {
        if (w.faction !== aiFac || w.type !== 'worker' || w.order !== 'idle') continue;
        // find good placement spot near base or existing structures
        const place = findGoodBuildSpot(state, aiFac, bt, ai.baseCenter);
        if (place && isTileBuildable(state.tiles, place.x, place.y, stats.footprintW, stats.footprintH)) {
          spend(state, aiFac, stats.goldCost, stats.woodCost);
          w.order = 'build';
          w.buildType = bt;
          w.targetPos = { x: place.x + 0.5, y: place.y + 0.5 };
          if (bt === 'barracks') ai.plannedBarracks = true;
          if (bt === 'lumbermill') ai.plannedLumber = true;
          if (bt === 'tower') ai.plannedTowers++;
          break;
        }
      }
    }
  }

  // Train military continuously if can
  if (hasBarracks) {
    const trainInf = canAfford(state, aiFac, 95, 0, 1);
    const canRanged = hasLumber && canAfford(state, aiFac, 85, 40, 1);
    const canHeavy = hasLumber && hasBarracks && canAfford(state, aiFac, 185, 55, 2);

    let trained = false;
    if (canHeavy && militaryCount > 2 && Math.random() < 0.4) {
      spend(state, aiFac, 185, 55);
      const spawn = th ? {x: th.pos.x - 1.5 + Math.random(), y: th.pos.y + 3} : ai.baseCenter;
      createUnit(state, aiFac, 'heavy', spawn.x, spawn.y);
      trained = true;
    } else if (canRanged && (militaryCount % 2 === 0)) {
      spend(state, aiFac, 85, 40);
      const spawn = th ? {x: th.pos.x + 3 + Math.random()*1.5, y: th.pos.y + 1.5} : ai.baseCenter;
      createUnit(state, aiFac, 'ranged', spawn.x, spawn.y);
      trained = true;
    } else if (trainInf) {
      spend(state, aiFac, 95, 0);
      const spawn = th ? {x: th.pos.x - 3.2 + Math.random()*1.5 , y: th.pos.y + 2.2} : ai.baseCenter;
      createUnit(state, aiFac, 'inf', spawn.x, spawn.y);
      trained = true;
    }
  }

  // Harvesting assignment (simplified AI)
  const idleWorkers = Array.from(state.entities.values()).filter(e =>
    e.faction === aiFac && e.type === 'worker' && (e.order === 'idle' || !e.order)
  );

  for (const w of idleWorkers) {
    if (ai.workersOnGold < 4 + difficulty && Math.random() < 0.65) {
      const minePos = findNearestHarvestable(state, w.pos, 'gold', 18);
      if (minePos) {
        w.order = 'harvest';
        w.harvestResource = 'gold';
        w.targetId = minePos.id;
        w.targetPos = minePos.pos;
        ai.workersOnGold++;
      }
    } else {
      const woodPos = findNearestHarvestable(state, w.pos, 'wood', 14);
      if (woodPos) {
        w.order = 'harvest';
        w.harvestResource = 'wood';
        w.targetId = woodPos.id < 0 ? undefined : woodPos.id;
        w.targetPos = woodPos.pos;
        ai.workersOnWood++;
      }
    }
  }

  // Attack waves
  const waveInterval = Math.max(55, 90 - difficulty * 8) * SIM_HZ; // ticks
  const timeSinceLast = state.tick - ai.lastWaveTick;
  const readyForWave = timeSinceLast > (AI_FIRST_WAVE_DELAY_TICKS + (difficulty - 1) * 18 * SIM_HZ) || ai.lastWaveTick < 0;

  if (readyForWave && militaryCount >= Math.max(2, ai.nextWaveSize - 1)) {
    // launch wave at player base
    const playerEntities = Array.from(state.entities.values()).filter(e => e.faction === state.playerFaction);
    if (playerEntities.length > 0) {
      // target player th or a random military building or center of player units
      let targetPoint = { x: 12, y: 12 };
      let thPlayer: Entity | undefined;
      for (const pe of playerEntities) {
        if (pe.kind === 'building' && pe.type === 'th') { thPlayer = pe; break; }
      }
      if (thPlayer) targetPoint = { ...thPlayer.pos };
      else {
        // average player pos
        let sx=0, sy=0, n=0;
        for (const pe of playerEntities) { sx+=pe.pos.x; sy+=pe.pos.y; n++; }
        if (n>0) targetPoint = {x: sx/n, y:sy/n};
      }

      const waveSize = Math.max(3, ai.nextWaveSize + Math.floor((difficulty-1)*0.8));
      let sent = 0;
      const candidates = Array.from(state.entities.values())
        .filter(e => e.faction === aiFac && e.kind === 'unit' && e.type !== 'worker' && (e.order === 'idle' || !e.order));

      for (const u of candidates) {
        if (sent >= waveSize) break;
        u.order = 'attack';
        u.targetPos = targetPoint;
        u.targetId = undefined;
        sent++;
      }
      ai.lastWaveTick = state.tick;
      ai.nextWaveSize = Math.min(12, ai.nextWaveSize + 1 + Math.floor(difficulty / 2));
    }
  }

  // Defense: if player units near AI base, pull nearby military
  const playerThreats = Array.from(state.entities.values()).filter(e =>
    e.faction === state.playerFaction &&
    distanceTo(e.pos, ai.baseCenter) < 22 &&
    e.kind === 'unit'
  );
  if (playerThreats.length > 0) {
    const closestThreat = playerThreats.reduce((a,b) => distanceTo(a.pos, ai.baseCenter) < distanceTo(b.pos, ai.baseCenter) ? a : b);
    for (const u of state.entities.values()) {
      if (u.faction !== aiFac || u.kind !== 'unit' || u.type === 'worker') continue;
      if ((u.order === 'idle' || u.order === 'move') && distanceTo(u.pos, ai.baseCenter) < 16) {
        u.order = 'attack';
        u.targetPos = { ...closestThreat.pos };
        u.targetId = closestThreat.id;
      }
    }
  }

  // Rebuild destroyed important buildings - AI will naturally try via buildCandidates above
  // (since we set flags only when built, it will retry when conditions met)
}

function findGoodBuildSpot(state: GameState, fac: Faction, bt: BuildingType, base: Point): Point | null {
  const stats = BUILDING_DATA[fac][bt];
  const fw = stats.footprintW, fh = stats.footprintH;
  const candidates: Point[] = [];
  const cx = Math.floor(base.x), cy = Math.floor(base.y);

  for (let r = 1; r < 18; r++) {
    for (let a = 0; a < 20; a++) {
      const ang = (a / 20) * Math.PI * 2 + (r * 0.6);
      const tx = Math.floor(cx + Math.cos(ang) * r * 0.9);
      const ty = Math.floor(cy + Math.sin(ang) * r * 0.9);
      if (tx < 1 || ty < 1 || tx + fw >= state.mapW-1 || ty + fh >= state.mapH-1) continue;
      if (isTileBuildable(state.tiles, tx, ty, fw, fh)) {
        // check no other building too close
        let clear = true;
        for (const b of state.entities.values()) {
          if (b.kind !== 'building' || b.faction !== fac) continue;
          const bb = b as Building;
          const dist = Math.hypot(bb.footX + bb.footW/2 - (tx + fw/2), bb.footY + bb.footH/2 - (ty + fh/2));
          if (dist < (bt==='farm' ? 2.2 : 3.5)) { clear = false; break; }
        }
        if (clear) candidates.push({ x: tx, y: ty });
      }
    }
  }
  if (candidates.length === 0) return null;
  // pick the one closest to base
  candidates.sort((a,b) => Math.hypot(a.x-cx,a.y-cy) - Math.hypot(b.x-cx,b.y-cy));
  return candidates[0];
}

function checkWinLose(state: GameState): void {
  let playerBuildings = 0;
  let aiBuildings = 0;
  const playerFac = state.playerFaction;
  const aiFac = playerFac === 'human' ? 'orc' : 'human';

  for (const e of state.entities.values()) {
    if (e.kind !== 'building' || !(e as Building).isBuilt) continue;
    if (e.faction === playerFac) playerBuildings++;
    else aiBuildings++;
  }

  if (playerBuildings === 0 && state.gameOver === 'none') {
    state.gameOver = 'defeat';
  }
  if (aiBuildings === 0 && state.gameOver === 'none') {
    state.gameOver = 'victory';
  }
}

function assignAutoAttack(state: GameState, e: Entity): void {
  if (e.kind !== 'unit' || e.order !== 'idle') return;
  const sight = getEntitySightRadius(e) + 2;
  const tgt = findNearestEnemy(state, e, sight);
  if (tgt) {
    e.order = 'attack';
    e.targetId = tgt.id;
    e.targetPos = undefined;
  }
}

export function tickSimulation(state: GameState, steps: number = 1): void {
  const grid = buildWalkGrid(state.tiles, state.mapW, state.mapH);

  for (let s = 0; s < steps; s++) {
    if (state.paused || state.gameOver !== 'none') {
      state.tick += 1; // keep time moving for UI
      continue;
    }

    state.tick += 1;

    // === Units & Buildings behavior ===
    const toRemove: number[] = [];

    for (const e of state.entities.values()) {
      if (e.hp <= 0) { toRemove.push(e.id); continue; }

      if (e.kind === 'unit') {
        // cooldowns
        if (e.cooldown && e.cooldown > 0) e.cooldown -= 1;

        // auto acquire targets for idle / attack-move
        if ((e.order === 'idle' || e.order === 'move') && state.tick % 18 === (e.id % 18)) {
          acquireTarget(state, e);
        }

        if (e.order === 'harvest') {
          handleHarvest(state, e, SIM_DT);
        } else if (e.order === 'build') {
          handleBuild(state, e, SIM_DT);
        } else if (e.order === 'attack' || e.order === 'move') {
          if (e.order === 'attack' && e.targetId) {
            handleAttack(state, e, SIM_DT);
          } else if (e.targetPos) {
            const gDist = distanceTo(e.pos, e.targetPos);
            if (gDist > 0.55) {
              // follow path or direct
              if (!e.path || e.path.length === 0 || (state.tick % PATH_REPLAN_INTERVAL === 3)) {
                const pth = findPath(grid, e.pos, e.targetPos, state.mapW, state.mapH);
                if (pth) {
                  e.path = smoothPath(pth, grid, state.mapW, state.mapH);
                  e.pathIndex = 0;
                } else {
                  // direct move fallback
                  moveToward(e, e.targetPos, SIM_DT);
                }
              }
              if (e.path && e.path.length > 0) {
                applyUnitMovement(state, e, SIM_DT, grid);
              } else {
                moveToward(e, e.targetPos, SIM_DT);
              }
            } else {
              // arrived
              e.path = [];
              if (e.order === 'move') e.order = 'idle';
              if (e.order === 'attack') {
                // arrived at attack-move location: switch to guard / auto attack
                e.order = 'idle';
                assignAutoAttack(state, e);
              }
              e.targetPos = undefined;
            }
          } else if (e.order === 'attack' && !e.targetId) {
            e.order = 'idle';
          }
        } else {
          // idle: slight wander or stay, plus auto attack acquire
          if (state.tick % 45 === (e.id % 20)) {
            assignAutoAttack(state, e);
          }
          if (e.vel) {
            e.vel.x *= 0.8;
            e.vel.y *= 0.8;
          }
        }

        // bounds clamp
        e.pos.x = Math.max(0.6, Math.min(state.mapW - 0.6, e.pos.x));
        e.pos.y = Math.max(0.6, Math.min(state.mapH - 0.6, e.pos.y));

        // stuck detection for pathing
        if (e.path && e.path.length) {
          e.stuckTicks = (e.stuckTicks || 0) + 1;
          if (e.stuckTicks > STUCK_THRESHOLD) {
            e.path = [];
            e.stuckTicks = 0;
            e.order = 'idle';
          }
        } else {
          e.stuckTicks = 0;
        }
      } else if (e.kind === 'building') {
        const b = e as Building;
        if (b.isBuilt && b.type === 'tower' && state.tick % 7 === (b.id % 7)) {
          // tower auto attacks
          if (!b.targetId || !state.entities.has(b.targetId)) {
            const tgt = findNearestEnemy(state, b, TOWER_RANGE + 2);
            if (tgt) b.targetId = tgt.id;
          }
          if (b.targetId) {
            handleAttack(state, b, SIM_DT);
          }
        }
        if (b.cooldown && b.cooldown > 0) b.cooldown--;
      }
    }

    // cleanup dead (already removed in kill but safety)
    for (const id of toRemove) state.entities.delete(id);

    processProjectiles(state);
    updateCorpses(state);

    // AI
    if (state.tick % 4 === 0) {
      updateAI(state);
    }

    // Fog & visibility (expensive-ish but 64x64 ok)
    if (state.tick % 5 === 0) {
      updateFog(state);
      updateExploredBuildings(state);
    }

    // Win / lose
    if (state.tick % 11 === 0) {
      checkWinLose(state);
    }

    // occasional resource trickle for testing balance
    if (state.tick % 120 === 0) {
      // no free lunch
    }
  }
}

// === Orders / Player commands ===

export function issueOrder(state: GameState, order: PlayerOrder, addToSelection = false): void {
  if (state.gameOver !== 'none') return;
  const player = state.playerFaction;
  const selected = Array.from(state.selectedIds)
    .map(id => state.entities.get(id))
    .filter((e): e is Entity => !!e && e.faction === player);

  if (selected.length === 0) return;

  if (order.type === 'move') {
    for (const e of selected) {
      if (e.kind !== 'unit') continue;
      e.order = 'move';
      e.targetPos = { ...order.pos };
      e.targetId = undefined;
      e.buildType = undefined;
      // new path
      const grid = buildWalkGrid(state.tiles, state.mapW, state.mapH);
      const pth = findPath(grid, e.pos, order.pos, state.mapW, state.mapH);
      if (pth) {
        e.path = smoothPath(pth, grid, state.mapW, state.mapH);
        e.pathIndex = 0;
      } else {
        e.path = [];
      }
      e.stuckTicks = 0;
    }
  } else if (order.type === 'attack') {
    for (const e of selected) {
      if (e.kind !== 'unit') continue;
      if (order.targetId) {
        e.order = 'attack';
        e.targetId = order.targetId;
        e.targetPos = undefined;
      } else if (order.pos) {
        // attack-move
        e.order = 'attack';
        e.targetPos = { ...order.pos };
        e.targetId = undefined;
      }
      e.path = [];
    }
  } else if (order.type === 'harvest') {
    const tgt = state.entities.get(order.targetId);
    if (!tgt) return;
    const res = (tgt.type as any) === 'goldmine' ? 'gold' : 'wood';
    for (const e of selected) {
      if (e.kind !== 'unit' || e.type !== 'worker') continue;
      e.order = 'harvest';
      e.harvestResource = res;
      e.targetId = order.targetId;
      e.targetPos = { ...tgt.pos };
      e.path = [];
    }
  } else if (order.type === 'repair') {
    const tgt = state.entities.get(order.targetId);
    if (!tgt || tgt.kind !== 'building') return;
    for (const e of selected) {
      if (e.kind !== 'unit' || e.type !== 'worker') continue;
      e.order = 'repair';
      e.targetId = order.targetId;
      e.targetPos = { ...tgt.pos };
    }
  } else if (order.type === 'build') {
    const stats = BUILDING_DATA[player][order.buildingType];
    if (!canAfford(state, player, stats.goldCost, stats.woodCost, 0)) return;
    if (!isTileBuildable(state.tiles, Math.floor(order.pos.x), Math.floor(order.pos.y), stats.footprintW, stats.footprintH)) return;

    spend(state, player, stats.goldCost, stats.woodCost);

    for (const e of selected) {
      if (e.kind !== 'unit' || e.type !== 'worker') continue;
      e.order = 'build';
      e.buildType = order.buildingType;
      e.targetPos = { ...order.pos };
      e.targetId = undefined;
      e.path = [];
    }
  }
}

export function selectEntities(state: GameState, ids: number[], additive = false): void {
  if (!additive) state.selectedIds.clear();
  for (const id of ids) {
    const e = state.entities.get(id);
    if (e && e.faction === state.playerFaction) {
      state.selectedIds.add(id);
      e.selected = true;
    }
  }
  // clear selection flag on non-selected
  for (const e of state.entities.values()) {
    if (!state.selectedIds.has(e.id)) e.selected = false;
  }
}

export function boxSelect(state: GameState, r: {x1:number,y1:number,x2:number,y2:number}, additive = false): void {
  if (!additive) state.selectedIds.clear();
  const [minx, maxx] = [Math.min(r.x1,r.x2), Math.max(r.x1,r.x2)];
  const [miny, maxy] = [Math.min(r.y1,r.y2), Math.max(r.y1,r.y2)];
  for (const e of state.entities.values()) {
    if (e.faction !== state.playerFaction) continue;
    if (e.pos.x >= minx && e.pos.x <= maxx && e.pos.y >= miny && e.pos.y <= maxy) {
      state.selectedIds.add(e.id);
      e.selected = true;
    }
  }
}

export function setControlGroup(state: GameState, group: number, ids?: number[]): void {
  if (ids) {
    state.controlGroups[group] = ids.filter(id => state.entities.has(id));
  } else {
    state.controlGroups[group] = Array.from(state.selectedIds);
  }
}

export function recallControlGroup(state: GameState, group: number, additive = false): void {
  const ids = state.controlGroups[group] || [];
  const valid = ids.filter(id => state.entities.has(id));
  if (valid.length === 0) return;
  if (!additive) state.selectedIds.clear();
  for (const id of valid) {
    state.selectedIds.add(id);
    const e = state.entities.get(id);
    if (e) e.selected = true;
  }
}

export function togglePause(state: GameState): void {
  state.paused = !state.paused;
}

export function cycleSpeed(state: GameState): void {
  state.speed = state.speed === 1 ? 2 : 1;
}

export function getSelected(state: GameState): Entity[] {
  return Array.from(state.selectedIds).map(id => state.entities.get(id)!).filter(Boolean);
}

export function canBuildAt(state: GameState, bt: BuildingType, footX: number, footY: number, fac: Faction): boolean {
  const stats = BUILDING_DATA[fac][bt];
  return isTileBuildable(state.tiles, footX, footY, stats.footprintW, stats.footprintH);
}

export function trainUnit(state: GameState, ut: UnitType): boolean {
  const fac = state.playerFaction;
  const stats = UNIT_DATA[fac][ut];
  if (!canAfford(state, fac, stats.goldCost, stats.woodCost, stats.supply)) return false;

  // Need appropriate building(s)
  let hasReq = false;
  if (ut === 'worker' || ut === 'inf') {
    // need th or barracks
    for (const e of state.entities.values()) {
      if (e.faction === fac && e.kind === 'building' && (e as Building).isBuilt &&
          (e.type === 'th' || e.type === 'barracks')) { hasReq = true; break; }
    }
  } else if (ut === 'ranged') {
    for (const e of state.entities.values()) {
      if (e.faction === fac && e.kind === 'building' && (e as Building).isBuilt &&
          (e.type === 'barracks' || e.type === 'lumbermill')) { hasReq = true; break; }
    }
  } else if (ut === 'heavy') {
    let barr = false, lum = false;
    for (const e of state.entities.values()) {
      if (e.faction !== fac || e.kind !== 'building' || !(e as Building).isBuilt) continue;
      if (e.type === 'barracks') barr = true;
      if (e.type === 'lumbermill') lum = true;
    }
    hasReq = barr && lum;
  }
  if (!hasReq) return false;

  spend(state, fac, stats.goldCost, stats.woodCost);

  // spawn near a production building
  let spawnNear: Point = { x: 8, y: 8 };
  for (const e of state.entities.values()) {
    if (e.faction === fac && e.kind === 'building' && (e as Building).isBuilt) {
      if ((ut === 'worker' && e.type === 'th') ||
          ((ut === 'inf' || ut === 'heavy') && e.type === 'barracks') ||
          (ut === 'ranged' && (e.type === 'barracks' || e.type === 'lumbermill'))) {
        spawnNear = { x: e.pos.x - 1.8 + Math.random() * 3.2, y: e.pos.y + 2.2 };
        break;
      }
    }
  }

  createUnit(state, fac, ut, spawnNear.x, spawnNear.y);
  return true;
}

export function startConstruction(state: GameState, bt: BuildingType, footX: number, footY: number): boolean {
  const fac = state.playerFaction;
  const stats = BUILDING_DATA[fac][bt];
  if (!canAfford(state, fac, stats.goldCost, stats.woodCost, 0)) return false;
  if (!isTileBuildable(state.tiles, footX, footY, stats.footprintW, stats.footprintH)) return false;

  spend(state, fac, stats.goldCost, stats.woodCost);

  const b = createBuilding(state, fac, bt, footX, footY);
  // a worker will be ordered separately by input to go build it
  return true;
}

// Used by input: given screen click -> world tile or entity
export function worldToTile(wx: number, wy: number): Point {
  return { x: Math.floor(wx), y: Math.floor(wy) };
}
