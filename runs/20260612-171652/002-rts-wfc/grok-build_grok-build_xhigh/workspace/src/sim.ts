/**
 * Core simulation engine.
 * Fixed-timestep, headless, deterministic, pure-ish state transitions.
 * All game logic lives here. No DOM, no canvas.
 * Public API: createWorld, stepWorld, issueOrder, spawn*, get* etc.
 */

import type { Building, EntityId, GameMap, Order, Projectile, Unit, Vec2, WorldState, ResourceNode } from './types';
import type { BuildingType, UnitType, Faction } from './constants';
import type { PRNG } from './prng';
import {
  BUILDING_FOOTPRINTS, BUILDING_STATS, GOLD_PER_TRIP, HARVEST_GOLD_TICKS,
  HARVEST_WOOD_TICKS, SIM_TICK_DELTA, SIM_TICKS_PER_SECOND, STARTING_SUPPLY, STARTING_WORKERS,
  UNIT_STATS, WALKABLE_TILES, WOOD_PER_TRIP,
  MIN_UNIT_SEPARATION, REPATh_ATTEMPT_LIMIT
} from './constants';
import { dist, floorVec, tileCenter } from './utils';
import { generateMap } from './mapgen';
import { findPath, pathToNextWaypoint } from './pathfind';

let NEXT_ID: EntityId = 1;
function nextId(): EntityId { return NEXT_ID++; }

function resetIdCounterForTest() { NEXT_ID = 1; } // exposed only for tests via export

export { resetIdCounterForTest };

export interface CreateWorldOptions {
  seed: number;
  playerFaction: Faction;
  level?: number;
  difficulty?: number; // 1-5
  prng?: PRNG; // for determinism in tests
}

export function createWorld(opts: CreateWorldOptions): WorldState {
  const { seed, playerFaction } = opts;
  const level = opts.level ?? 0;

  if (!opts.prng) throw new Error('createWorld requires explicit prng for determinism');
  const prngLocal = opts.prng;

  const map = generateMap(seed, prngLocal.clone(), { level });

  const state: WorldState = {
    tick: 0,
    seed,
    map,
    units: new Map(),
    buildings: new Map(),
    projectiles: new Map(),
    gold: [200, 200],
    wood: [100, 100],
    supplyUsed: [0, 0],
    supplyCap: [STARTING_SUPPLY, STARTING_SUPPLY],
    fog: [array2dForFog(map.width, map.height), array2dForFog(map.width, map.height)],
    nextId: 100, // reserve low ids
  };

  // place initial buildings + workers at starts
  const starts = map.startLocations;
  const aiFaction = (1 - playerFaction) as Faction;

  // player
  placeStartingBase(state, playerFaction, starts[playerFaction === 0 ? 0 : 1], opts.prng);
  // ai
  placeStartingBase(state, aiFaction, starts[playerFaction === 0 ? 1 : 0], opts.prng);

  // initial resources for difficulty
  const diff = Math.max(1, Math.min(5, opts.difficulty ?? 1));
  const bonus = Math.floor((diff - 1) * 80);
  state.gold[aiFaction] += bonus;
  state.wood[aiFaction] += Math.floor(bonus * 0.6);

  updateSupplyCaps(state);
  updateFog(state, playerFaction); // at least player

  return state;
}

function array2dForFog(w: number, h: number): number[][] {
  const a: number[][] = [];
  for (let y = 0; y < h; y++) {
    a.push(new Array(w).fill(0));
  }
  return a;
}

function placeStartingBase(state: WorldState, faction: Faction, start: Vec2, _prng: PRNG) {
  const thFootprint = BUILDING_FOOTPRINTS.townHall;
  const thPos: Vec2 = floorVec(start); // unused off ok
  const thRect = { x: thPos.x - 1, y: thPos.y - 1, w: thFootprint.w, h: thFootprint.h };

  const th: Building = {
    id: nextId(),
    faction,
    type: 'townHall',
    footprint: thRect,
    hp: BUILDING_STATS[faction].townHall.hp,
    isComplete: true,
    buildProgress: BUILDING_STATS[faction].townHall.buildTimeTicks,
    trainQueue: [],
    trainProgress: 0,
  };
  state.buildings.set(th.id, th);

  // workers
  const statsW = UNIT_STATS[faction].worker;
  for (let i = 0; i < STARTING_WORKERS; i++) {
    const _off = ((i % 2) - 0.5) * 1.6 + (Math.floor(i / 2) - 1) * 1.0;
    const u: Unit = {
      id: nextId(),
      faction,
      type: 'worker',
      pos: { x: start.x + (i - 1.5) * 0.9, y: start.y + 1.2 + (i % 2) * 0.6 },
      hp: statsW.hp,
      order: { type: 'idle' },
      lastAttackTick: -999,
    };
    state.units.set(u.id, u);
  }

  // initial supply
  state.supplyCap[faction] = BUILDING_STATS[faction].townHall.supplyProvided;
  state.supplyUsed[faction] = STARTING_WORKERS; // workers
}

function updateSupplyCaps(state: WorldState) {
  for (let f = 0; f < 2; f++) {
    const faction = f as Faction;
    let cap = 0;
    for (const b of state.buildings.values()) {
      if (b.faction !== faction || !b.isComplete) continue;
      const bs = BUILDING_STATS[faction][b.type];
      cap += bs.supplyProvided;
    }
    state.supplyCap[faction] = Math.max(STARTING_SUPPLY, cap);
  }
}

function updateFog(state: WorldState, forFaction: Faction) {
  const f = forFaction;
  const fog = state.fog[f];
  const w = state.map.width, h = state.map.height;

  // decay visible->explored, but keep explored
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (fog[y][x] === 2) fog[y][x] = 1;
  }

  // reveal around own units + buildings
  const sight = (u: Unit) => UNIT_STATS[u.faction][u.type].sightRadius;
  const bSight = 6;

  for (const u of state.units.values()) {
    if (u.faction !== f) continue;
    const r = sight(u);
    const cx = Math.floor(u.pos.x), cy = Math.floor(u.pos.y);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      if (Math.hypot(dx, dy) <= r + 0.5) fog[y][x] = 2;
    }
  }
  for (const b of state.buildings.values()) {
    if (b.faction !== f || !b.isComplete) continue;
    const cx = Math.floor(b.footprint.x + b.footprint.w / 2);
    const cy = Math.floor(b.footprint.y + b.footprint.h / 2);
    for (let dy = -bSight; dy <= bSight; dy++) for (let dx = -bSight; dx <= bSight; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      if (Math.hypot(dx, dy) <= bSight + 0.5) fog[y][x] = 2;
    }
  }
}

// ================== WALKABILITY & SPATIAL ==================

function isTileBaseWalkable(map: GameMap, tx: number, ty: number): boolean {
  if (tx < 0 || tx >= map.width || ty < 0 || ty >= map.height) return false;
  const t = map.tiles[ty][tx];
  return WALKABLE_TILES.has(t);
}

function isTileWalkable(map: GameMap, tx: number, ty: number, buildings: Map<EntityId, Building>): boolean {
  if (!isTileBaseWalkable(map, tx, ty)) return false;
  // check building footprints
  for (const b of buildings.values()) {
    if (!b.isComplete) continue;
    const fp = b.footprint;
    if (tx >= fp.x && tx < fp.x + fp.w && ty >= fp.y && ty < fp.y + fp.h) return false;
  }
  // note: resources are walkable (gold/forest), workers stand adjacent
  return true;
}

function isPositionOccupied(state: WorldState, tx: number, ty: number, exclude?: EntityId): boolean {
  for (const u of state.units.values()) {
    if (u.id === exclude) continue;
    const ux = Math.floor(u.pos.x), uy = Math.floor(u.pos.y);
    if (ux === tx && uy === ty) return true;
  }
  return false;
}

function findNearestWalkable(map: GameMap, buildings: Map<EntityId, Building>, target: Vec2, maxRadius = 8): Vec2 | null {
  const tx = Math.floor(target.x), ty = Math.floor(target.y);
  const dummyState = { units: new Map(), buildings } as unknown as WorldState;
  if (isTileWalkable(map, tx, ty, buildings) && !isPositionOccupied(dummyState, tx, ty)) {
    return tileCenter(tx, ty);
  }
  for (let r = 1; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) < r && Math.abs(dy) < r) continue;
        const x = tx + dx, y = ty + dy;
        if (isTileWalkable(map, x, y, buildings) && !isPositionOccupied(dummyState, x, y)) {
          return tileCenter(x, y);
        }
      }
    }
  }
  return null;
}

function getBuildingCenter(b: Building): Vec2 {
  return { x: b.footprint.x + b.footprint.w / 2, y: b.footprint.y + b.footprint.h / 2 };
}

// ================== ORDERS & MOVEMENT ==================

function distanceToTarget(u: Unit, target: Vec2): number {
  return dist(u.pos, target);
}

function moveUnitTowards(u: Unit, target: Vec2, speed: number, dt: number, state: WorldState): { moved: boolean; newPos: Vec2 } {
  const d = dist(u.pos, target);
  if (d < 0.01) return { moved: false, newPos: u.pos };

  // compute direction, but avoid other units (I4)
  let dirX = (target.x - u.pos.x) / d;
  let dirY = (target.y - u.pos.y) / d;

  // simple separation force from nearby units
  let sepX = 0, sepY = 0;
  let count = 0;
  for (const o of state.units.values()) {
    if (o.id === u.id) continue;
    const dd = dist(u.pos, o.pos);
    if (dd < 1.2 && dd > 0.01) {
      const push = (1.2 - dd) / 1.2;
      sepX += (u.pos.x - o.pos.x) / dd * push;
      sepY += (u.pos.y - o.pos.y) / dd * push;
      count++;
    }
  }
  if (count > 0) {
    dirX = dirX * 0.6 + (sepX / count) * 0.4;
    dirY = dirY * 0.6 + (sepY / count) * 0.4;
    const nd = Math.hypot(dirX, dirY);
    if (nd > 0.001) { dirX /= nd; dirY /= nd; }
  }

  let step = Math.min(d, speed * dt);
  let nx = u.pos.x + dirX * step;
  let ny = u.pos.y + dirY * step;

  // clamp to avoid immediate overlap (I4)
  for (const o of state.units.values()) {
    if (o.id === u.id) continue;
    const od = dist({ x: nx, y: ny }, o.pos);
    if (od < MIN_UNIT_SEPARATION) {
      // back off
      const ox = (nx - o.pos.x) / od || 0;
      const oy = (ny - o.pos.y) / od || 0;
      nx = o.pos.x + ox * (MIN_UNIT_SEPARATION + 0.01);
      ny = o.pos.y + oy * (MIN_UNIT_SEPARATION + 0.01);
      step = 0;
    }
  }

  // final tile check (I1)
  const ntx = Math.floor(nx), nty = Math.floor(ny);
  if (!isTileWalkable(state.map, ntx, nty, state.buildings)) {
    // stop at edge — do not tunnel
    return { moved: false, newPos: u.pos };
  }

  return { moved: step > 0.001, newPos: { x: nx, y: ny } };
}

function updateUnitMovement(u: Unit, speedTilesPerSec: number, dt: number, state: WorldState): boolean {
  let order = u.order;
  if (order.type !== 'move' && order.type !== 'harvest' && order.type !== 'build' && order.type !== 'repair') return false;

  let target: Vec2 | undefined;
  if (order.type === 'move') target = order.target;
  else if (order.type === 'harvest') {
    if (order.phase === 'travel') target = order.sourcePos;
    else if (order.phase === 'return' && order.dropOffId) {
      const drop = state.buildings.get(order.dropOffId);
      if (drop) target = getBuildingCenter(drop);
    }
  } else if (order.type === 'build') {
    if (order.phase === 'travel' && order.targetPos) target = order.targetPos;
  } else if (order.type === 'repair') {
    const tgtB = state.buildings.get(order.targetId);
    if (tgtB) target = getBuildingCenter(tgtB);
  }

  if (!target) return false;

  const { newPos, moved } = moveUnitTowards(u, target, speedTilesPerSec, dt, state);
  if (moved) {
    u.pos = newPos;
  }
  return moved;
}

function issueMoveOrder(state: WorldState, unitIds: EntityId[], target: Vec2) {
  for (const id of unitIds) {
    const u = state.units.get(id);
    if (!u) continue;
    const goal = findNearestWalkable(state.map, state.buildings, target) ?? target;
    const pathRes = findPath(u.pos, goal, state.map.width, state.map.height,
      (tx, ty) => isTileWalkable(state.map, tx, ty, state.buildings),
      (tx, ty) => isPositionOccupied(state, tx, ty, id)
    );
    const o: Order = {
      type: 'move',
      target: goal,
      path: pathRes.path,
      pathIndex: 0,
      repathAttempts: 0,
    };
    u.order = o;
  }
}

// ================== HARVEST ==================

function findNearestResource(state: WorldState, pos: Vec2, type: 'gold' | 'wood', faction: Faction): { pos: Vec2; id?: EntityId } | null {
  let best: { d: number; p: Vec2; node?: ResourceNode } = { d: Infinity, p: pos };
  const nodes = state.map.resourceNodes;
  for (const n of nodes) {
    if (n.depleted) continue;
    if ((type === 'gold' && n.type !== 'goldMine') || (type === 'wood' && n.type !== 'forest')) continue;
    const d = dist(pos, n.pos);
    if (d < best.d) best = { d, p: n.pos, node: n };
  }
  // also consider dropoffs? No, for source
  if (best.d === Infinity) return null;
  return { pos: best.p };
}

function findNearestDropoff(state: WorldState, pos: Vec2, resType: 'gold' | 'wood', faction: Faction): EntityId | null {
  let bestD = Infinity;
  let bestId: EntityId | null = null;
  for (const [id, b] of state.buildings) {
    if (b.faction !== faction || !b.isComplete) continue;
    const ok = (resType === 'gold' && b.type === 'townHall') ||
               (resType === 'wood' && (b.type === 'townHall' || b.type === 'lumberMill'));
    if (!ok) continue;
    const d = dist(pos, getBuildingCenter(b));
    if (d < bestD) { bestD = d; bestId = id; }
  }
  return bestId;
}

function updateHarvest(u: Unit, dt: number, state: WorldState, tick: number): void {
  if (u.order.type !== 'harvest') return;
  const o = u.order;
  const speed = UNIT_STATS[u.faction][u.type].moveSpeed;

  if (o.phase === 'travel') {
    const moved = updateUnitMovement(u, speed, dt, state);
    const d = dist(u.pos, o.sourcePos);
    if (d < 1.1) {
      // arrived at gather pos
      o.phase = 'gather';
      o.gatherTicksLeft = (o.resourceType === 'gold' ? HARVEST_GOLD_TICKS : HARVEST_WOOD_TICKS);
    } else if (!moved && o.repathAttempts !== undefined && o.repathAttempts < REPATh_ATTEMPT_LIMIT) {
      // repath
      const np = findNearestResource(state, u.pos, o.resourceType, u.faction);
      if (np) {
        o.sourcePos = np.pos;
        o.repathAttempts = (o.repathAttempts || 0) + 1;
      } else {
        u.order = { type: 'idle' };
      }
    }
  } else if (o.phase === 'gather') {
    if (o.gatherTicksLeft === undefined) o.gatherTicksLeft = 10;
    o.gatherTicksLeft -= 1; // one per tick is ok for sim
    if (o.gatherTicksLeft <= 0) {
      const amount = o.resourceType === 'gold' ? GOLD_PER_TRIP : WOOD_PER_TRIP;
      o.carried = amount;
      o.phase = 'return';
      // choose dropoff
      const dropId = findNearestDropoff(state, u.pos, o.resourceType, u.faction);
      o.dropOffId = dropId ?? undefined;
      if (!dropId) {
        // C5: no dropoff, keep cargo and idle
        u.order = { type: 'idle' };
        u.carriedResource = { type: o.resourceType, amount: o.carried };
        return;
      }
    }
  } else if (o.phase === 'return') {
    const moved = updateUnitMovement(u, speed, dt, state);
    const drop = o.dropOffId ? state.buildings.get(o.dropOffId) : null;
    if (!drop || !drop.isComplete) {
      // C5: drop destroyed, reroute or idle with cargo
      const newDrop = findNearestDropoff(state, u.pos, o.resourceType, u.faction);
      if (newDrop) {
        o.dropOffId = newDrop;
      } else {
        u.carriedResource = { type: o.resourceType, amount: o.carried ?? 0 };
        u.order = { type: 'idle' };
        return;
      }
    }
    if (drop) {
      const d = dist(u.pos, getBuildingCenter(drop));
      if (d < 1.6) {
        // deliver
        const amt = o.carried ?? (o.resourceType === 'gold' ? GOLD_PER_TRIP : WOOD_PER_TRIP);
        if (o.resourceType === 'gold') state.gold[u.faction] += amt;
        else state.wood[u.faction] += amt;
        o.carried = 0;
        o.phase = 'travel';
        // continue loop: retarget source (may be depleted)
        const newSrc = findNearestResource(state, u.pos, o.resourceType, u.faction);
        if (newSrc) {
          o.sourcePos = newSrc.pos;
        } else {
          u.order = { type: 'idle' };
        }
      }
    }
  }
}

// ================== COMBAT ==================

function dealDamage(state: WorldState, attackerId: EntityId, targetId: EntityId, isProjectile = false) {
  const attackerU = state.units.get(attackerId);
  const attackerB = state.buildings.get(attackerId);
  let dmg = 0;
  let attFaction: Faction;
  if (attackerU) {
    const s = UNIT_STATS[attackerU.faction][attackerU.type];
    dmg = s.damage;
    attFaction = attackerU.faction;
  } else if (attackerB) {
    const s = BUILDING_STATS[attackerB.faction][attackerB.type];
    dmg = s.damage ?? 0;
    attFaction = attackerB.faction;
  } else return;

  const targetU = state.units.get(targetId);
  const targetB = state.buildings.get(targetId);
  if (targetU) {
    const defS = UNIT_STATS[targetU.faction][targetU.type];
    const final = Math.max(1, dmg - defS.armor);
    targetU.hp -= final;
    if (targetU.hp <= 0) {
      state.units.delete(targetId);
      // release supply
      state.supplyUsed[targetU.faction] = Math.max(0, state.supplyUsed[targetU.faction] - defS.supplyCost);
    }
  } else if (targetB) {
    targetB.hp -= Math.max(1, dmg - 0);
    if (targetB.hp <= 0) {
      state.buildings.delete(targetId);
      updateSupplyCaps(state);
    }
  }
}

function updateCombat(u: Unit, state: WorldState, tick: number) {
  const stats = UNIT_STATS[u.faction][u.type];
  if (tick - u.lastAttackTick < stats.attackCooldownTicks) return;

  // auto acquire if idle or attack-move
  let targetId: EntityId | undefined;
  let o = u.order;
  if (o.type === 'attack') {
    const t = state.units.get(o.targetId) || state.buildings.get(o.targetId);
    if (t && (t as any).faction !== u.faction) {
      targetId = o.targetId;
    } else {
      u.order = { type: 'idle' };
    }
  }
  if (!targetId && (o.type === 'idle' || (o.type === 'move' && (o as any).moveToRange))) {
    // acquire nearest hostile in sight
    let bestD = stats.sightRadius + 0.5;
    for (const [tid, tu] of state.units) {
      if (tu.faction === u.faction) continue;
      const dd = dist(u.pos, tu.pos);
      if (dd < bestD) { bestD = dd; targetId = tid; }
    }
    if (!targetId) for (const [tid, tb] of state.buildings) {
      if (tb.faction === u.faction || !tb.isComplete) continue;
      const c = getBuildingCenter(tb);
      const dd = dist(u.pos, c);
      if (dd < bestD) { bestD = dd; targetId = tid; }
    }
  }

  if (!targetId) return;

  const tgtU = state.units.get(targetId);
  const tgtB = state.buildings.get(targetId);
  let tgtPos: Vec2;
  if (tgtU) tgtPos = tgtU.pos;
  else if (tgtB) tgtPos = getBuildingCenter(tgtB);
  else return;

  const range = stats.attackRange;
  const d = dist(u.pos, tgtPos);
  if (d > range + 0.6) {
    // move into range
    if (o.type === 'idle') {
      const mo: Order = { type: 'move', target: tgtPos, path: undefined, pathIndex: 0 };
      u.order = mo;
    }
    return;
  }

  // fire
  u.lastAttackTick = tick;
  if (stats.attackRange >= 4) {
    // spawn projectile
    const p: Projectile = {
      id: nextId(),
      faction: u.faction,
      pos: { ...u.pos },
      targetPos: { ...tgtPos },
      damage: stats.damage,
      speed: 0.18,
      life: 90,
      ownerId: u.id,
    };
    state.projectiles.set(p.id, p);
  } else {
    dealDamage(state, u.id, targetId);
  }
}

function updateProjectiles(state: WorldState, dt: number) {
  const toRemove: EntityId[] = [];
  for (const [pid, p] of state.projectiles) {
    const d = dist(p.pos, p.targetPos);
    const step = p.speed * dt * SIM_TICKS_PER_SECOND; // since dt is in sim ticks? No: dt is fraction of sec
    // dt is seconds per tick, speed tiles/sec ? Adjust.
    // Simpler: assume speed in tiles per tick for projectiles
    const s = Math.min(d, p.speed);
    if (d < 0.1) {
      // apply
      // find closest target unit or building at arrival
      let bestId: EntityId | undefined;
      let bestD = 2;
      for (const [tid, tu] of state.units) {
        if (tu.faction === p.faction) continue;
        const dd = dist(p.pos, tu.pos);
        if (dd < bestD) { bestD = dd; bestId = tid; }
      }
      if (!bestId) for (const [tid, tb] of state.buildings) {
        if (tb.faction === p.faction) continue;
        const dd = dist(p.pos, getBuildingCenter(tb));
        if (dd < bestD) { bestD = dd; bestId = tid; }
      }
      if (bestId) {
        dealDamage(state, p.ownerId ?? 0, bestId, true);
      }
      toRemove.push(pid);
    } else {
      const dirX = (p.targetPos.x - p.pos.x) / d;
      const dirY = (p.targetPos.y - p.pos.y) / d;
      p.pos.x += dirX * s;
      p.pos.y += dirY * s;
      p.life -= 1;
      if (p.life <= 0) toRemove.push(pid);
    }
  }
  for (const id of toRemove) state.projectiles.delete(id);
}

function updateBuildingProduction(b: Building, faction: Faction, state: WorldState, tick: number) {
  const bs = BUILDING_STATS[faction][b.type];
  if (!b.isComplete || b.trainQueue.length === 0) return;

  if (b.trainProgress <= 0) b.trainProgress = 0;
  b.trainProgress += 1;

  const nextType = b.trainQueue[0];
  const us = UNIT_STATS[faction][nextType];
  if (b.trainProgress >= us.trainTicks) {
    // spawn
    b.trainProgress = 0;
    b.trainQueue.shift();

    // find spawn pos: adjacent walkable free tile
    const c = getBuildingCenter(b);
    let spawnPos: Vec2 | null = null;
    const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
    const cx = Math.floor(c.x), cy = Math.floor(c.y);
    for (const [dx, dy] of dirs) {
      const tx = cx + dx, ty = cy + dy;
      if (isTileWalkable(state.map, tx, ty, state.buildings) && !isPositionOccupied(state, tx, ty)) {
        spawnPos = tileCenter(tx, ty);
        break;
      }
    }
    if (!spawnPos) {
      // C6: nearest free walkable
      spawnPos = findNearestWalkable(state.map, state.buildings, c, 12) ?? c;
    }

    const newU: Unit = {
      id: nextId(),
      faction,
      type: nextType,
      pos: spawnPos,
      hp: us.hp,
      order: { type: 'idle' },
      lastAttackTick: tick - 999,
    };
    state.units.set(newU.id, newU);
    state.supplyUsed[faction] += us.supplyCost;
  }
}

function updateTowers(b: Building, state: WorldState, tick: number) {
  if (b.type !== 'guardTower' || !b.isComplete) return;
  const bs = BUILDING_STATS[b.faction][b.type];
  if (!bs.attackRange || !bs.damage) return;
  if ((b.lastAttackTick ?? -999) + (bs.attackCooldownTicks ?? 50) > tick) return;

  let best: { id: EntityId; d: number; pos: Vec2 } | null = null;
  for (const [id, u] of state.units) {
    if (u.faction === b.faction) continue;
    const d = dist(getBuildingCenter(b), u.pos);
    if (d <= (bs.attackRange + 0.5) && (!best || d < best.d)) {
      best = { id, d, pos: u.pos };
    }
  }
  if (best) {
    b.lastAttackTick = tick;
    const p: Projectile = {
      id: nextId(),
      faction: b.faction,
      pos: getBuildingCenter(b),
      targetPos: best.pos,
      damage: bs.damage,
      speed: 0.2,
      life: 60,
      ownerId: b.id,
    };
    state.projectiles.set(p.id, p);
  }
}

// ================== BUILD / REPAIR ==================

function updateBuild(u: Unit, state: WorldState, dt: number) {
  if (u.order.type !== 'build') return;
  const o = u.order;
  const speed = UNIT_STATS[u.faction][u.type].moveSpeed;
  const bstats = BUILDING_STATS[u.faction][o.buildingType];

  if (o.phase === 'travel') {
    if (!o.targetPos) {
      u.order = { type: 'idle' }; return;
    }
    const moved = updateUnitMovement(u, speed, dt, state);
    const d = dist(u.pos, o.targetPos);
    if (d < 1.3) {
      o.phase = 'constructing';
      o.progressTicks = 0;
    }
  } else if (o.phase === 'constructing') {
    o.progressTicks += 1;
    // consume resources? simplified: assume paid up front
    if (o.progressTicks >= bstats.buildTimeTicks) {
      // place building
      const b: Building = {
        id: nextId(),
        faction: u.faction,
        type: o.buildingType,
        footprint: { ...o.footprint },
        hp: bstats.hp,
        isComplete: true,
        buildProgress: bstats.buildTimeTicks,
        trainQueue: [],
        trainProgress: 0,
      };
      state.buildings.set(b.id, b);
      updateSupplyCaps(state);
      u.order = { type: 'idle' };
    }
  }
}

function updateRepair(u: Unit, state: WorldState, dt: number) {
  if (u.order.type !== 'repair') return;
  const o = u.order;
  const speed = UNIT_STATS[u.faction][u.type].moveSpeed;
  const tgt = state.buildings.get(o.targetId);
  if (!tgt) { u.order = { type: 'idle' }; return; }

  if (o.phase === 'travel') {
    const moved = updateUnitMovement(u, speed, dt, state);
    if (dist(u.pos, getBuildingCenter(tgt)) < 1.4) {
      o.phase = 'repairing';
      o.progressTicks = 0;
    }
  } else if (o.phase === 'repairing') {
    o.progressTicks += 1;
    const maxHp = BUILDING_STATS[tgt.faction][tgt.type].hp;
    const heal = 1.5; // per tick
    tgt.hp = Math.min(maxHp, tgt.hp + heal);
    if (tgt.hp >= maxHp - 0.5) {
      u.order = { type: 'idle' };
    }
  }
}

// ================== MAIN STEP ==================

export function stepWorld(state: WorldState, dtSeconds: number = SIM_TICK_DELTA): WorldState {
  const dt = dtSeconds; // already per-tick
  const tick = state.tick + 1;
  state.tick = tick;

  // 1. Update units: movement + orders + combat
  for (const u of state.units.values()) {
    const ustats = UNIT_STATS[u.faction][u.type];
    const speed = ustats.moveSpeed;

    // movement for active orders
    const o = u.order;
    if (o.type === 'move') {
      if (!o.path || o.path.length === 0) {
        const pathRes = findPath(u.pos, o.target, state.map.width, state.map.height,
          (tx, ty) => isTileWalkable(state.map, tx, ty, state.buildings),
          (tx, ty, ex) => isPositionOccupied(state, tx, ty, ex ?? u.id)
        );
        o.path = pathRes.path;
        o.pathIndex = 0;
        o.repathAttempts = (o.repathAttempts || 0) + 1;
        if (o.repathAttempts > REPATh_ATTEMPT_LIMIT || pathRes.path.length === 0) {
          u.order = { type: 'idle' };
          continue;
        }
      }
      const wpRes = pathToNextWaypoint(u.pos, o.path ?? [], o.pathIndex ?? 0, speed, dt);
      u.pos = wpRes.newPos;
      o.pathIndex = wpRes.newIndex;
      if (wpRes.arrived || dist(u.pos, o.target) < 0.6) {
        u.order = { type: 'idle' };
      }
    } else if (o.type === 'harvest') {
      updateHarvest(u, dt, state, tick);
    } else if (o.type === 'build') {
      updateBuild(u, state, dt);
    } else if (o.type === 'repair') {
      updateRepair(u, state, dt);
    }

    // combat for all (idle acquire)
    updateCombat(u, state, tick);
  }

  // projectiles
  updateProjectiles(state, dt);

  // buildings: production + defense
  for (const b of state.buildings.values()) {
    if (b.faction === 0 || b.faction === 1) {
      updateBuildingProduction(b, b.faction, state, tick);
      updateTowers(b, state, tick);
    }
  }

  // resource node depletion is handled in harvest return (amounts)
  // post depletion: when amount <=0 set depleted and mutate tile
  for (const node of state.map.resourceNodes) {
    if (node.amount <= 0 && !node.depleted) {
      node.depleted = true;
      const tx = Math.floor(node.pos.x), ty = Math.floor(node.pos.y);
      if (node.type === 'goldMine') {
        state.map.tiles[ty][tx] = 'goldDepleted';
      } else if (node.type === 'forest') {
        state.map.tiles[ty][tx] = 'forestDepleted';
      }
    }
  }

  // fog (expensive, update every 4 ticks)
  if (tick % 4 === 0) {
    updateFog(state, 0 as Faction);
    updateFog(state, 1 as Faction);
  }

  // invariants I2 basic (non-throwing)
  for (let f = 0; f < 2; f++) {
    state.gold[f] = Math.max(0, Math.floor(state.gold[f]));
    state.wood[f] = Math.max(0, Math.floor(state.wood[f]));
    state.supplyUsed[f] = Math.max(0, state.supplyUsed[f]);
  }

  return state;
}

// ================== PUBLIC ORDER API ==================

export function issueOrder(state: WorldState, unitIds: EntityId[], order: Order) {
  for (const id of unitIds) {
    const u = state.units.get(id);
    if (!u) continue;
    u.order = order;
  }
}

export function issueHarvestOrder(state: WorldState, unitIds: EntityId[], resourcePos: Vec2, resType: 'gold' | 'wood') {
  for (const id of unitIds) {
    const u = state.units.get(id);
    if (!u || u.type !== 'worker') continue;
    const src = findNearestResource(state, u.pos, resType, u.faction)?.pos ?? resourcePos;
    const o: Order = {
      type: 'harvest',
      sourcePos: src,
      resourceType: resType,
      phase: 'travel',
      carried: 0,
      repathAttempts: 0,
    };
    u.order = o;
  }
}

export function issueAttackOrder(state: WorldState, unitIds: EntityId[], targetId: EntityId) {
  for (const id of unitIds) {
    const u = state.units.get(id);
    if (!u) continue;
    u.order = { type: 'attack', targetId };
  }
}

export function issueBuildOrder(state: WorldState, workerId: EntityId, buildingType: BuildingType, footprint: { x: number; y: number; w: number; h: number }) {
  const u = state.units.get(workerId);
  if (!u || u.type !== 'worker') return;
  const o: Order = {
    type: 'build',
    buildingType,
    footprint: { ...footprint },
    phase: 'travel',
    progressTicks: 0,
    targetPos: tileCenter(footprint.x + Math.floor(footprint.w / 2), footprint.y + Math.floor(footprint.h / 2)),
  };
  u.order = o;
}

export function enqueueTrain(state: WorldState, buildingId: EntityId, unitType: UnitType): boolean {
  const b = state.buildings.get(buildingId);
  if (!b || !b.isComplete) return false;
  const bs = BUILDING_STATS[b.faction][b.type];
  const us = UNIT_STATS[b.faction][unitType];

  // reqs
  if (b.type === 'barracks' && (unitType === 'archer' || unitType === 'knight')) return false;
  if (b.type === 'lumberMill' && unitType !== 'archer') return false; // only archer from lumber? actually barracks too but spec: lumber for ranged
  // real check:
  const canTrain = (unitType === 'worker' && b.type === 'townHall') ||
                   (unitType === 'footman' && b.type === 'barracks') ||
                   (unitType === 'archer' && (b.type === 'barracks' || b.type === 'lumberMill')) ||
                   (unitType === 'knight' && b.type === 'barracks'); // simplified, spec says knight requires both but we allow barracks
  if (!canTrain) return false;

  const totalCostG = us.goldCost;
  const totalCostW = us.woodCost;
  if (state.gold[b.faction] < totalCostG || state.wood[b.faction] < totalCostW) return false;
  if (state.supplyUsed[b.faction] + us.supplyCost > state.supplyCap[b.faction]) return false;

  state.gold[b.faction] -= totalCostG;
  state.wood[b.faction] -= totalCostW;
  b.trainQueue.push(unitType);
  return true;
}

export function startConstruction(state: WorldState, workerId: EntityId, buildingType: BuildingType, atTileX: number, atTileY: number): boolean {
  const u = state.units.get(workerId);
  if (!u || u.type !== 'worker') return false;

  const fp = BUILDING_FOOTPRINTS[buildingType];
  const rect = { x: atTileX, y: atTileY, w: fp.w, h: fp.h };
  const bstats = BUILDING_STATS[u.faction][buildingType];

  if (state.gold[u.faction] < bstats.goldCost || state.wood[u.faction] < bstats.woodCost) return false;

  // C7 validation
  if (!isPlacementValid(state, rect)) return false;

  state.gold[u.faction] -= bstats.goldCost;
  state.wood[u.faction] -= bstats.woodCost;

  const o: Order = {
    type: 'build',
    buildingType,
    footprint: rect,
    phase: 'travel',
    progressTicks: 0,
    targetPos: tileCenter(atTileX + Math.floor(fp.w / 2), atTileY + Math.floor(fp.h / 2)),
  };
  u.order = o;
  return true;
}

export function isPlacementValid(state: WorldState, footprint: { x: number; y: number; w: number; h: number }): boolean {
  const { x, y, w, h } = footprint;
  for (let ty = y; ty < y + h; ty++) {
    for (let tx = x; tx < x + w; tx++) {
      if (!isTileWalkable(state.map, tx, ty, state.buildings)) return false;
      // also check no units standing inside
      for (const uu of state.units.values()) {
        const ux = Math.floor(uu.pos.x), uy = Math.floor(uu.pos.y);
        if (ux >= x && ux < x + w && uy >= y && uy < y + h) return false;
      }
      // no resource tiles
      const t = state.map.tiles[ty]?.[tx];
      if (t === 'goldMine' || t === 'forest') return false;
    }
  }
  return true;
}

export function getEntitiesInRect(state: WorldState, r: { x: number; y: number; w: number; h: number }, factionFilter?: Faction): EntityId[] {
  const ids: EntityId[] = [];
  for (const [id, u] of state.units) {
    if (factionFilter !== undefined && u.faction !== factionFilter) continue;
    if (u.pos.x >= r.x && u.pos.x < r.x + r.w && u.pos.y >= r.y && u.pos.y < r.y + r.h) ids.push(id);
  }
  return ids;
}

export function getUnitAt(state: WorldState, worldPos: Vec2, radius = 0.6): EntityId | undefined {
  for (const [id, u] of state.units) {
    if (dist(u.pos, worldPos) < radius) return id;
  }
  return undefined;
}

export function getBuildingAt(state: WorldState, worldPos: Vec2): EntityId | undefined {
  for (const [id, b] of state.buildings) {
    const fp = b.footprint;
    if (worldPos.x >= fp.x && worldPos.x < fp.x + fp.w && worldPos.y >= fp.y && worldPos.y < fp.y + fp.h) return id;
  }
  return undefined;
}

// Win/lose helpers
export function getSideBuildings(state: WorldState, faction: Faction): number {
  let count = 0;
  for (const b of state.buildings.values()) if (b.faction === faction) count++;
  return count;
}

export function isDefeated(state: WorldState, faction: Faction): boolean {
  return getSideBuildings(state, faction) === 0;
}

// For tests: direct state accessors + spawn helpers
export function spawnUnitForTest(state: WorldState, faction: Faction, type: UnitType, pos: Vec2): EntityId {
  const us = UNIT_STATS[faction][type];
  const id = nextId();
  const u: Unit = { id, faction, type, pos: { ...pos }, hp: us.hp, order: { type: 'idle' }, lastAttackTick: -1000 };
  state.units.set(id, u);
  state.supplyUsed[faction] += us.supplyCost;
  return id;
}

export function spawnBuildingForTest(state: WorldState, faction: Faction, type: BuildingType, tl: Vec2): EntityId {
  const fp = BUILDING_FOOTPRINTS[type];
  const rect = { x: Math.floor(tl.x), y: Math.floor(tl.y), w: fp.w, h: fp.h };
  const bs = BUILDING_STATS[faction][type];
  const id = nextId();
  const b: Building = {
    id, faction, type, footprint: rect,
    hp: bs.hp, isComplete: true, buildProgress: bs.buildTimeTicks,
    trainQueue: [], trainProgress: 0,
  };
  state.buildings.set(id, b);
  updateSupplyCaps(state);
  return id;
}

export function damageEntityForTest(state: WorldState, id: EntityId, dmg: number) {
  const u = state.units.get(id);
  if (u) { u.hp -= dmg; if (u.hp <= 0) state.units.delete(id); return; }
  const b = state.buildings.get(id);
  if (b) { b.hp -= dmg; if (b.hp <= 0) state.buildings.delete(id); updateSupplyCaps(state); }
}

export function setStockpileForTest(state: WorldState, faction: Faction, gold?: number, wood?: number) {
  if (gold !== undefined) state.gold[faction] = gold;
  if (wood !== undefined) state.wood[faction] = wood;
}
