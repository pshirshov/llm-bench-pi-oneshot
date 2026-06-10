// Core simulation: world creation, command issuance, fixed-timestep tick.

import {
  FACTIONS,
  TILES,
  UNIT_STATS,
  BUILDING_STATS,
  type FactionId,
  type TileId,
  type UnitKind,
  type BuildingKind,
} from './data.js';
import { type MapData, type World, type FactionState, type UnitEntity, type BuildingEntity, type EntityId, type Entity, type ResourceTile, type ProjectileEntity, type FogState } from './state.js';
import { aStarSearch } from './pathfind.js';
import { chebyshev, chebyshevRange, dist2, clamp } from './math.js';
import { type Rng } from './rng.js';

// ──────────────────────────────────────────────────────────────────────────
// World construction
// ──────────────────────────────────────────────────────────────────────────

export function createFactionState(faction: FactionId, map: MapData): FactionState {
  return {
    faction,
    gold: 0,
    wood: 0,
    supplyUsed: 0,
    supplyCap: 0, // set after buildings placed
    fog: new Uint8Array(map.width * map.height),
    alive: true,
  };
}

export function createWorld(map: MapData, level: number, difficulty: number, _playerFaction: FactionId): World {
  const factions: Record<FactionId, FactionState> = {
    human: createFactionState('human', map),
    orc: createFactionState('orc', map),
  };
  const w: World = {
    map,
    units: new Map(),
    buildings: new Map(),
    projectiles: new Map(),
    resources: [],
    factions,
    nextId: 1,
    time: 0,
    level,
    difficulty,
    gameOver: false,
    events: [],
  };
  // Initial visibility: own start is visible.
  for (const f of [factions.human, factions.orc]) {
    f.fog.fill(0);
  }
  return w;
}

export function newId(w: World): EntityId {
  return w.nextId++;
}

export function supplyCap(w: World, faction: FactionId): number {
  let cap = 0;
  for (const b of w.buildings.values()) {
    if (b.faction !== faction) continue;
    if (b.underConstruction && b.buildProgress < b.buildTime * 0.5) continue; // require at least 50% built
    cap += BUILDING_STATS[b.buildingKind].providesSupply;
  }
  return cap;
}

export function recomputeSupplyCaps(w: World): void {
  for (const f of Object.keys(w.factions) as FactionId[]) {
    w.factions[factionIdx(f)].supplyCap = supplyCap(w, f);
  }
}

function factionIdx(f: FactionId): 'human' | 'orc' {
  return f;
}

// ──────────────────────────────────────────────────────────────────────────
// Map helpers
// ──────────────────────────────────────────────────────────────────────────

export function tileAt(w: World, x: number, y: number): TileId {
  if (x < 0 || y < 0 || x >= w.map.width || y >= w.map.height) return 'rock';
  return w.map.tiles[y * w.map.width + x] as TileId;
}

export function tileDef(t: TileId) { return TILES[t]; }

export function isWalkable(w: World, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= w.map.width || y >= w.map.height) return false;
  return TILES[w.map.tiles[y * w.map.width + x] as TileId].walkable;
}

export function isBuildable(w: World, x: number, y: number, wTiles: number, hTiles: number): boolean {
  for (let dy = 0; dy < hTiles; dy++) {
    for (let dx = 0; dx < wTiles; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= w.map.width || ty >= w.map.height) return false;
      const t = w.map.tiles[ty * w.map.width + tx] as TileId;
      if (!TILES[t].buildable) return false;
    }
  }
  // also no building footprint overlap
  for (const b of w.buildings.values()) {
    if (rectsOverlap(b.pos.x, b.pos.y, b.size.w, b.size.h, x, y, wTiles, hTiles)) return false;
  }
  return true;
}

export function rectsOverlap(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// Find the nearest free tile next to a position that a unit can stand on
// (used when issuing a build order: worker walks to adjacent tile).
export function nearestAdjacentWalkable(w: World, x: number, y: number, maxR: number): { x: number; y: number } | null {
  let best: { x: number; y: number; d: number } | null = null;
  for (let dy = -maxR; dy <= maxR; dy++) {
    for (let dx = -maxR; dx <= maxR; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (!isWalkable(w, nx, ny)) continue;
      // also not occupied by an enemy building
      let blocked = false;
      for (const b of w.buildings.values()) {
        if (b.faction !== w.factions.human.faction && b.faction !== w.factions.orc.faction) continue;
        if (rectsOverlap(b.pos.x, b.pos.y, b.size.w, b.size.h, nx, ny, 1, 1)) { blocked = true; break; }
      }
      if (blocked) continue;
      const d = dx * dx + dy * dy;
      if (!best || d < best.d) best = { x: nx, y: ny, d };
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}

// ──────────────────────────────────────────────────────────────────────────
// Resources / tiles
// ──────────────────────────────────────────────────────────────────────────

export function initResourceTiles(w: World): void {
  w.resources.length = 0;
  for (let y = 0; y < w.map.height; y++) {
    for (let x = 0; x < w.map.width; x++) {
      const t = w.map.tiles[y * w.map.width + x] as TileId;
      const d = TILES[t];
      if (d.resource === 'gold') w.resources.push({ x, y, type: 'gold', amount: d.hp });
      else if (d.resource === 'wood') w.resources.push({ x, y, type: 'wood', amount: d.hp });
    }
  }
}

export function resourceAt(w: World, x: number, y: number): ResourceTile | null {
  for (const r of w.resources) {
    if (r.x === x && r.y === y && r.amount > 0) return r;
  }
  return null;
}

export function nearestResource(w: World, x: number, y: number, type: 'gold' | 'wood', maxR: number): ResourceTile | null {
  let best: ResourceTile | null = null;
  let bestD = Infinity;
  for (const r of w.resources) {
    if (r.type !== type || r.amount <= 0) continue;
    if (r.reservedBy !== undefined) continue; // someone is on the way / harvesting
    const d = dist2(r.x, r.y, x, y);
    if (d > maxR * maxR) continue;
    if (d < bestD) { bestD = d; best = r; }
  }
  return best;
}

export function nearestResourceUnreserved(w: World, x: number, y: number, type: 'gold' | 'wood', maxR: number): ResourceTile | null {
  // same as nearestResource, but doesn't require reservedBy === undefined
  let best: ResourceTile | null = null;
  let bestD = Infinity;
  for (const r of w.resources) {
    if (r.type !== type || r.amount <= 0) continue;
    const d = dist2(r.x, r.y, x, y);
    if (d > maxR * maxR) continue;
    if (d < bestD) { bestD = d; best = r; }
  }
  return best;
}

export function nearestDropoff(w: World, faction: FactionId, x: number, y: number, type: 'gold' | 'wood'): BuildingEntity | null {
  let best: BuildingEntity | null = null;
  let bestD = Infinity;
  for (const b of w.buildings.values()) {
    if (b.faction !== faction) continue;
    if (b.underConstruction) continue;
    const accepts = (type === 'gold' && b.accepts.gold) || (type === 'wood' && b.accepts.wood);
    if (!accepts) continue;
    const d = dist2(b.pos.x + b.size.w / 2, b.pos.y + b.size.h / 2, x, y);
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}

// ──────────────────────────────────────────────────────────────────────────
// Entity placement (for initial setup)
// ──────────────────────────────────────────────────────────────────────────

export function placeUnit(w: World, faction: FactionId, unitKind: UnitKind, x: number, y: number): UnitEntity {
  const stats = UNIT_STATS[unitKind];
  const id = newId(w);
  const u: UnitEntity = {
    id,
    kind: 'unit',
    faction,
    unitKind,
    pos: { x: x + 0.5, y: y + 0.5 },
    hp: stats.hp,
    path: [],
    pathIdx: 0,
    order: { kind: 'idle' },
    attackCooldown: 0,
    carry: { gold: 0, wood: 0 },
    occ: { x, y },
    facing: 0,
  };
  w.units.set(id, u);
  w.factions[factionIdx(faction)].supplyUsed += stats.supply;
  return u;
}

export function placeBuilding(w: World, faction: FactionId, bk: BuildingKind, x: number, y: number, underConstruction: boolean, _factionStartResources: { gold: number; wood: number } = { gold: 0, wood: 0 }): BuildingEntity {
  const stats = BUILDING_STATS[bk];
  const id = newId(w);
  const b: BuildingEntity = {
    id,
    kind: 'building',
    faction,
    buildingKind: bk,
    pos: { x, y },
    size: { ...stats.size },
    hp: stats.hp,
    maxHp: stats.hp,
    armor: stats.armor,
    underConstruction,
    buildProgress: underConstruction ? 0 : stats.buildTime,
    buildTime: stats.buildTime,
    trainQueue: [],
    trainProgress: 0,
    accepts: {
      gold: bk === 'townhall' || bk === 'barracks' || bk === 'farm' || bk === 'tower',
      wood: bk === 'townhall' || bk === 'barracks' || bk === 'mill' || bk === 'tower',
    },
    attackCooldown: 0,
    attackDamage: stats.attackDamage ? { ...stats.attackDamage } : undefined,
    attackRange: stats.attackRange,
    attackCooldownMax: stats.attackCooldown,
  };
  w.buildings.set(id, b);
  if (bk === 'townhall') {
    // town halls give free supply even when "started under construction"
    w.factions[factionIdx(faction)].supplyCap += stats.providesSupply;
  }
  if (underConstruction) {
    // partial HP during construction
    b.hp = Math.max(1, Math.floor(stats.hp * 0.25));
  } else {
    // pre-built
    b.hp = stats.hp;
    w.factions[factionIdx(faction)].supplyCap += stats.providesSupply;
  }
  return b;
}

export function setupFactionStart(w: World, faction: FactionId, startTile: { x: number; y: number }, startingRes: { gold: number; wood: number }, startingWorkers: number, townHallHpFrac: number): { townHall: BuildingEntity; workers: UnitEntity[] } {
  const f = w.factions[factionIdx(faction)];
  f.gold = startingRes.gold;
  f.wood = startingRes.wood;
  // Place town hall centered on startTile
  const stats = BUILDING_STATS.townhall;
  const th = placeBuilding(w, faction, 'townhall', startTile.x - 1, startTile.y - 1, true);
  th.buildProgress = stats.buildTime; // town hall is already complete
  th.underConstruction = false;
  th.hp = Math.floor(stats.hp * townHallHpFrac);
  th.maxHp = stats.hp;
  // Place initial workers around it
  const workers: UnitEntity[] = [];
  let placed = 0;
  for (let r = 2; r < 5 && placed < startingWorkers; r++) {
    for (let dx = -r; dx <= r && placed < startingWorkers; dx++) {
      for (let dy = -r; dy <= r && placed < startingWorkers; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = startTile.x + dx;
        const ty = startTile.y + dy;
        if (!isWalkable(w, tx, ty)) continue;
        if (rectsOverlap(th.pos.x, th.pos.y, th.size.w, th.size.h, tx, ty, 1, 1)) continue;
        const u = placeUnit(w, faction, 'worker', tx, ty);
        workers.push(u);
        placed++;
      }
    }
  }
  // Reveal a small area around the start
  revealArea(w, faction, startTile.x, startTile.y, 6);
  return { townHall: th, workers };
}

// ──────────────────────────────────────────────────────────────────────────
// Fog of war
// ──────────────────────────────────────────────────────────────────────────

export function fogGet(w: World, faction: FactionId, x: number, y: number): FogState {
  if (x < 0 || y < 0 || x >= w.map.width || y >= w.map.height) return 'unexplored';
  const v = w.factions[factionIdx(faction)].fog[y * w.map.width + x] as number;
  return v === 2 ? 'visible' : v === 1 ? 'explored' : 'unexplored';
}

export function fogSet(w: World, faction: FactionId, x: number, y: number, v: FogState): void {
  if (x < 0 || y < 0 || x >= w.map.width || y >= w.map.height) return;
  w.factions[factionIdx(faction)].fog[y * w.map.width + x] = v === 'visible' ? 2 : v === 'explored' ? 1 : 0;
}

export function revealArea(w: World, faction: FactionId, cx: number, cy: number, r: number): void {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= w.map.width || y >= w.map.height) continue;
      if (chebyshev(x, y, cx, cy) > r) continue;
      // LOS: blocked by trees/rock
      if (losBlocked(w, cx, cy, x, y)) continue;
      fogSet(w, faction, x, y, 'visible');
    }
  }
}

function losBlocked(w: World, ax: number, ay: number, bx: number, by: number): boolean {
  // Bresenham-ish check; any blocker on the line blocks.
  const dx = Math.abs(bx - ax);
  const dy = Math.abs(by - ay);
  const sx = ax < bx ? 1 : -1;
  const sy = ay < by ? 1 : -1;
  let err = dx - dy;
  let x = ax;
  let y = ay;
  while (true) {
    if (!(x === ax && y === ay) && !(x === bx && y === by)) {
      const t = w.map.tiles[y * w.map.width + x] as TileId;
      if (TILES[t].blocksSight) return true;
    }
    if (x === bx && y === by) return false;
    const e2 = err * 2;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Pathfinding wrapper that tries the goal tile then nearby tiles
// ──────────────────────────────────────────────────────────────────────────

export function findPath(w: World, sx: number, sy: number, tx: number, ty: number, _unitW: number = 0.5): { x: number; y: number }[] | null {
  // shrink goal to nearest walkable tile if needed
  const goal = (() => {
    if (isWalkable(w, tx, ty)) return { x: tx, y: ty };
    for (let r = 1; r < 5; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (isWalkable(w, tx + dx, ty + dy)) return { x: tx + dx, y: ty + dy };
        }
      }
    }
    return null;
  })();
  if (!goal) return null;
  if (sx === goal.x && sy === goal.y) return [{ x: sx, y: sy }];
  return aStarSearch(w.map, sx, sy, goal.x, goal.y, { walkable: (x, y) => isWalkable(w, x, y) });
}

export function pathToEntity(w: World, unit: UnitEntity, targetId: EntityId): boolean {
  const t = w.units.get(targetId) || w.buildings.get(targetId);
  if (!t) return false;
  const tx = Math.floor(t.pos.x + (('size' in t) ? t.size.w / 2 : 0.5));
  const ty = Math.floor(t.pos.y + (('size' in t) ? t.size.h / 2 : 0.5));
  const sx = unit.occ.x;
  const sy = unit.occ.y;
  const p = findPath(w, sx, sy, tx, ty);
  if (!p) return false;
  unit.path = p;
  unit.pathIdx = 0;
  return true;
}

export function pathToTile(w: World, unit: UnitEntity, tx: number, ty: number): boolean {
  const p = findPath(w, unit.occ.x, unit.occ.y, tx, ty);
  if (!p) return false;
  unit.path = p;
  unit.pathIdx = 0;
  return true;
}

// ──────────────────────────────────────────────────────────────────────────
// Tick / update
// ──────────────────────────────────────────────────────────────────────────

export function tick(w: World, dt: number, _rng: Rng): void {
  if (w.gameOver) return;
  w.time += dt;
  // 1. Movement: move units along their paths
  for (const u of w.units.values()) {
    if (u.hp <= 0) continue;
    moveUnit(w, u, dt);
  }
  // 2. Worker state machines: harvesting, building, repairing
  for (const u of w.units.values()) {
    if (u.hp <= 0) continue;
    if (u.unitKind === 'worker') updateWorker(w, u, dt);
  }
  // 3. Combat / auto-acquire
  for (const u of w.units.values()) {
    if (u.hp <= 0) continue;
    updateUnitCombat(w, u, dt);
  }
  // 3b. Buildings with attack (towers)
  for (const b of w.buildings.values()) {
    if (b.hp <= 0) continue;
    if (b.attackDamage) updateBuildingCombat(w, b, dt);
  }
  // 4. Training queues
  for (const b of w.buildings.values()) {
    if (b.hp <= 0) continue;
    if (b.underConstruction) continue;
    if (b.trainQueue.length === 0) continue;
    if (!canTrain(w, b.faction, b.trainQueue[0] as UnitKind)) {
      // pause progress; don't dequeue
      continue;
    }
    const stats = UNIT_STATS[b.trainQueue[0] as UnitKind];
    b.trainProgress += dt;
    if (b.trainProgress >= stats.buildTime) {
      b.trainProgress = 0;
      const kind = b.trainQueue.shift() as UnitKind;
      spawnUnitAtBuilding(w, b, kind);
    }
  }
  // 5. Construction: workers build assigned buildings
  for (const u of w.units.values()) {
    if (u.hp <= 0) continue;
    if (u.workerState === 'building') {
      const tgt = w.buildings.get(u.buildTarget as EntityId);
      if (tgt) {
        tgt.buildProgress += dt;
        if (tgt.buildProgress >= tgt.buildTime) {
          tgt.underConstruction = false;
          tgt.hp = tgt.maxHp;
          u.workerState = 'idle';
          u.buildTarget = undefined;
          u.order = { kind: 'idle' };
          recomputeSupplyCaps(w);
        }
      }
    }
  }
  // 6. Projectiles
  for (const p of w.projectiles.values()) {
    updateProjectile(w, p, dt);
  }
  // 7. Death cleanup
  const dead: EntityId[] = [];
  for (const u of w.units.values()) {
    if (u.hp <= 0) {
      u.corpseTimer = (u.corpseTimer ?? 0) + dt;
      if ((u.corpseT = (u.corpseTimer) / 1.5) >= 1) dead.push(u.id);
    }
  }
  for (const b of w.buildings.values()) {
    if (b.hp <= 0 && !b.underConstruction) {
      // buildings "die" instantly for now
      dead.push(b.id);
    }
  }
  for (const id of dead) removeEntity(w, id);
  // 8. Fog of war
  for (const f of Object.keys(w.factions) as FactionId[]) {
    recomputeFactionFog(w, f);
  }
  // 9. Win check
  checkVictory(w);
}

function moveUnit(w: World, u: UnitEntity, dt: number): void {
  if (u.path.length === 0 || u.pathIdx >= u.path.length) return;
  const stats = UNIT_STATS[u.unitKind];
  const speed = stats.moveSpeed;
  let remaining = speed * dt;
  while (remaining > 0 && u.pathIdx < u.path.length) {
    const next = u.path[u.pathIdx] as { x: number; y: number };
    const tx = next.x + 0.5;
    const ty = next.y + 0.5;
    const dx = tx - u.pos.x;
    const dy = ty - u.pos.y;
    const d = Math.hypot(dx, dy);
    u.facing = Math.atan2(dy, dx);
    if (d <= remaining) {
      u.pos.x = tx;
      u.pos.y = ty;
      u.occ.x = next.x;
      u.occ.y = next.y;
      remaining -= d;
      u.pathIdx++;
    } else {
      u.pos.x += (dx / d) * remaining;
      u.pos.y += (dy / d) * remaining;
      remaining = 0;
    }
  }
  // very soft separation: if overlapping another unit by too much, slide a bit
  for (const other of w.units.values()) {
    if (other === u || other.hp <= 0) continue;
    const dx = u.pos.x - other.pos.x;
    const dy = u.pos.y - other.pos.y;
    const d2 = dx * dx + dy * dy;
    const minD = 0.55;
    if (d2 < minD * minD && d2 > 1e-6) {
      const d = Math.sqrt(d2);
      const push = (minD - d) * 0.5;
      u.pos.x += (dx / d) * push;
      u.pos.y += (dy / d) * push;
    }
  }
}

function updateWorker(w: World, u: UnitEntity, dt: number): void {
  const stats = UNIT_STATS.worker;
  // State: idle -> find something to do
  if (!u.workerState || u.workerState === 'idle') {
    decideWorkerAction(w, u);
    return;
  }
  // Moving to resource
  if (u.workerState === 'movingToResource') {
    if (u.path.length === 0 || u.pathIdx >= u.path.length) {
      const tgt = resourceAt(w, u.occ.x, u.occ.y);
      if (tgt) {
        u.workerState = 'harvesting';
        u.harvestTimer = 0;
      } else {
        u.workerState = 'idle';
      }
    } else {
      // also check: are we adjacent to or on the last waypoint? if so, snap.
      const last = u.path[u.path.length - 1] as { x: number; y: number };
      if (last && u.occ.x === last.x && u.occ.y === last.y) {
        u.pathIdx = u.path.length;
        const tgt = resourceAt(w, u.occ.x, u.occ.y);
        if (tgt) {
          u.workerState = 'harvesting';
          u.harvestTimer = 0;
        } else {
          u.workerState = 'idle';
        }
      }
    }
  }
  // Harvesting
  if (u.workerState === 'harvesting') {
    u.harvestTimer = (u.harvestTimer ?? 0) + dt;
    const harvestDur = 1.0; // seconds per trip action
    if ((u.harvestTimer ?? 0) >= harvestDur) {
      const res = resourceAt(w, u.occ.x, u.occ.y);
      if (res) {
        const amount = res.type === 'gold' ? 8 : 1; // gold: 8 per trip; wood: 1 forest hp per swing
        res.amount -= amount;
        if (res.type === 'gold') {
          u.carry.gold += amount;
        } else {
          u.carry.wood += amount;
        }
        u.carry = { gold: Math.min(u.carry.gold, 100), wood: Math.min(u.carry.wood, 100) };
        w.events.push({ t: w.time, kind: 'harvest', worker: u.id, amount, type: res.type });
        if (res.amount <= 0) {
          // Deplete: convert tile to dirt
          if (res.type === 'gold') {
            w.map.tiles[res.y * w.map.width + res.x] = 'dirt';
          } else {
            w.map.tiles[res.y * w.map.width + res.x] = 'dirt';
          }
          res.reservedBy = undefined;
        }
      }
      // If carrying, return; else resume harvesting
      if (u.carry.gold >= 100 || u.carry.wood >= 100 || (res && res.amount <= 0)) {
        // find dropoff
        const dropType: 'gold' | 'wood' = u.carry.gold > 0 ? 'gold' : 'wood';
        const drop = nearestDropoff(w, u.faction, u.pos.x, u.pos.y, dropType);
        if (drop) {
          u.order = { kind: 'returnResource', dropOff: drop.id };
          u.workerState = 'returning';
          const tx = Math.floor(drop.pos.x + drop.size.w / 2);
          const ty = Math.floor(drop.pos.y + drop.size.h / 2);
          pathToTile(w, u, tx, ty);
        } else {
          u.workerState = 'idle';
        }
      }
    }
  }
  // Returning
  if (u.workerState === 'returning') {
    if (u.path.length === 0 || u.pathIdx >= u.path.length) {
      doReturn(w, u);
    } else {
      const last = u.path[u.path.length - 1] as { x: number; y: number };
      if (last && u.occ.x === last.x && u.occ.y === last.y) {
        u.pathIdx = u.path.length;
        doReturn(w, u);
      }
    }
  }
  // Building: tracked in tick()
  // Repairing
  if (u.workerState === 'repairing') {
    if (u.targetId !== undefined) {
      const tgt = w.buildings.get(u.targetId);
      if (tgt) {
        tgt.hp = Math.min(tgt.maxHp, tgt.hp + stats.damage.max * dt * 4);
        if (tgt.hp >= tgt.maxHp) {
          u.workerState = 'idle';
          u.targetId = undefined;
        }
      } else {
        u.workerState = 'idle';
        u.targetId = undefined;
      }
    }
  }
  // moveToBuild: handled via moveUnit, and state transitions to 'building' on arrival
  if (u.workerState === 'movingToBuild') {
    const arrived = u.path.length === 0
      || u.pathIdx >= u.path.length
      || ((): boolean => {
        const last = u.path[u.path.length - 1] as { x: number; y: number } | undefined;
        return !!last && last.x === u.occ.x && last.y === u.occ.y;
      })();
    if (arrived) {
      const tgt = u.buildTarget !== undefined ? w.buildings.get(u.buildTarget) : null;
      if (tgt) {
        const adj = nearestAdjacentWalkable(w, tgt.pos.x, tgt.pos.y, 2);
        if (adj && (adj.x === u.occ.x && adj.y === u.occ.y)) {
          u.workerState = 'building';
        } else {
          u.workerState = 'idle';
        }
      } else {
        u.workerState = 'idle';
      }
    }
  }
  void stats;
}

function doReturn(w: World, u: UnitEntity): void {
  const f = w.factions[factionIdx(u.faction)];
  f.gold += u.carry.gold;
  f.wood += u.carry.wood;
  const dep = u.carry.gold + u.carry.wood;
  const dropType: 'gold' | 'wood' = u.carry.gold > 0 ? 'gold' : 'wood';
  w.events.push({ t: w.time, kind: 'deposit', building: (u.order as { dropOff: EntityId }).dropOff, amount: dep, type: dropType });
  u.carry = { gold: 0, wood: 0 };
  const res = nearestResource(w, u.occ.x, u.occ.y, dropType, 12);
  if (res) {
    res.reservedBy = u.id;
    u.targetId = undefined;
    u.workerState = 'movingToResource';
    pathToTile(w, u, res.x, res.y);
  } else {
    u.workerState = 'idle';
  }
}

function decideWorkerAction(w: World, u: UnitEntity): void {
  const f = w.factions[factionIdx(u.faction)];
  // If we're nearly broke, every worker should harvest (and we cap builders to 1
  // unfinished building at a time, so the rest can mine).
  const broke = f.gold < 400;
  let builderCount = 0;
  for (const o of w.units.values()) {
    if (o.faction !== u.faction || o.hp <= 0) continue;
    if (o.workerState === 'building' || o.workerState === 'movingToBuild') builderCount++;
  }
  // 1. Look for an unfinished building to work on (only if not broke AND not too many builders)
  if (!broke && builderCount < 2) {
    for (const b of w.buildings.values()) {
      if (b.faction !== u.faction) continue;
      if (!b.underConstruction) continue;
      u.buildTarget = b.id;
      u.workerState = 'movingToBuild';
      const adj = nearestAdjacentWalkable(w, b.pos.x, b.pos.y, 2);
      if (adj) pathToTile(w, u, adj.x, adj.y);
      return;
    }
  }
  // 2. Look for a damaged building to repair
  for (const b of w.buildings.values()) {
    if (b.faction !== u.faction) continue;
    if (b.underConstruction) continue;
    if (b.hp >= b.maxHp) continue;
    u.targetId = b.id;
    u.workerState = 'movingToRepair';
    const adj = nearestAdjacentWalkable(w, b.pos.x, b.pos.y, 2);
    if (adj) pathToTile(w, u, adj.x, adj.y);
    return;
  }
  // 3. Harvest: gold or wood depending on need
  const harvestF = w.factions[factionIdx(u.faction)];
  const needGold = harvestF.gold < 600;
  const needWood = harvestF.wood < 400;
  // First try the preferred type at a wide range; if nothing, try the other.
  const prefs: ('gold' | 'wood')[] = needGold ? ['gold', 'wood'] : needWood ? ['wood', 'gold'] : ['gold', 'wood'];
  for (const t of prefs) {
    let res = nearestResource(w, u.occ.x, u.occ.y, t, 12);
    if (!res) res = nearestResourceUnreserved(w, u.occ.x, u.occ.y, t, 20);
    if (res) {
      res.reservedBy = u.id;
      u.workerState = 'movingToResource';
      pathToTile(w, u, res.x, res.y);
      return;
    }
  }
  // nothing to do
  u.workerState = 'idle';
  u.order = { kind: 'idle' };
}

// Combat
function updateUnitCombat(w: World, u: UnitEntity, dt: number): void {
  const stats = UNIT_STATS[u.unitKind];
  u.attackCooldown = Math.max(0, u.attackCooldown - dt);
  // Determine target: from order
  let target: Entity | null = null;
  if (u.order.kind === 'attack') {
    target = w.units.get(u.order.target) || w.buildings.get(u.order.target) || null;
    if (!target) { u.order = { kind: 'idle' }; }
  } else if (u.order.kind === 'attackMove') {
    // find nearest enemy in sight
    const t = findNearestEnemyInSight(w, u);
    if (t) { target = t; }
  } else if (u.order.kind === 'idle' || (u.order.kind === 'move')) {
    // auto-acquire: guard mode
    if (u.order.kind === 'idle') {
      const t = findNearestEnemyInSight(w, u);
      if (t) { u.order = { kind: 'attack', target: t.id }; target = t; }
    }
  }
  if (!target) return;
  // Range check
  const tr = (target as { pos: { x: number; y: number } }).pos;
  const cx = 'size' in target ? tr.x + (target as BuildingEntity).size.w / 2 : tr.x;
  const cy = 'size' in target ? tr.y + (target as BuildingEntity).size.h / 2 : tr.y;
  const inRange = chebyshevRange(u.occ.x, u.occ.y, Math.floor(cx), Math.floor(cy), stats.attackRange);
  if (!inRange) {
    // chase: if attack-move or attack, try to close
    if (u.order.kind === 'attack' || u.order.kind === 'attackMove') {
      const tx = 'size' in target ? Math.floor(tr.x + (target as BuildingEntity).size.w / 2) : Math.floor(tr.x);
      const ty = 'size' in target ? Math.floor(tr.y + (target as BuildingEntity).size.h / 2) : Math.floor(tr.y);
      if (u.path.length === 0 || u.pathIdx >= u.path.length) {
        pathToTile(w, u, tx, ty);
      }
    }
    return;
  }
  // In range: attack if cooldown elapsed
  if (u.attackCooldown > 0) return;
  u.attackCooldown = stats.attackCooldown;
  if (stats.attackRange > 1) {
    // ranged: spawn projectile
    const proj: ProjectileEntity = {
      id: newId(w),
      kind: 'projectile',
      faction: u.faction,
      pos: { x: u.pos.x, y: u.pos.y },
      target: target.id,
      targetKind: target.kind === 'unit' ? 'unit' : 'building',
      damage: stats.damage.min + Math.floor((stats.damage.max - stats.damage.min) * Math.random()),
      speed: 14,
      ttl: 1.0,
    };
    w.projectiles.set(proj.id, proj);
  } else {
    // melee: instant
    applyDamage(w, u, target, stats.damage.min + Math.floor((stats.damage.max - stats.damage.min) * Math.random()));
  }
}

function updateBuildingCombat(w: World, b: BuildingEntity, dt: number): void {
  if (!b.attackDamage || b.attackRange === undefined || b.attackCooldownMax === undefined) return;
  b.attackCooldown = (b.attackCooldown ?? 0) - dt;
  if ((b.attackCooldown ?? 0) > 0) return;
  // find nearest enemy unit in range
  const cx = b.pos.x + b.size.w / 2;
  const cy = b.pos.y + b.size.h / 2;
  let best: UnitEntity | null = null;
  let bestD = Infinity;
  for (const u of w.units.values()) {
    if (u.faction === b.faction || u.hp <= 0) continue;
    if (chebyshevRange(Math.floor(cx), Math.floor(cy), u.occ.x, u.occ.y, b.attackRange)) {
      const d = dist2(cx, cy, u.pos.x, u.pos.y);
      if (d < bestD) { bestD = d; best = u; }
    }
  }
  if (!best) return;
  b.attackCooldown = b.attackCooldownMax;
  const damage = b.attackDamage.min + Math.floor((b.attackDamage.max - b.attackDamage.min) * Math.random());
  // tower projectiles (for visual flair)
  const proj: ProjectileEntity = {
    id: newId(w),
    kind: 'projectile',
    faction: b.faction,
    pos: { x: cx, y: cy },
    target: best.id,
    targetKind: 'unit',
    damage,
    speed: 16,
    ttl: 0.6,
  };
  w.projectiles.set(proj.id, proj);
}

function findNearestEnemyInSight(w: World, u: UnitEntity): UnitEntity | BuildingEntity | null {
  const stats = UNIT_STATS[u.unitKind];
  const sight = stats.sight;
  let best: UnitEntity | BuildingEntity | null = null;
  let bestD = Infinity;
  for (const o of w.units.values()) {
    if (o.faction === u.faction || o.hp <= 0) continue;
    if (!chebyshevRange(u.occ.x, u.occ.y, o.occ.x, o.occ.y, sight)) continue;
    if (fogGet(w, u.faction, o.occ.x, o.occ.y) !== 'visible') continue;
    const d = dist2(u.pos.x, u.pos.y, o.pos.x, o.pos.y);
    if (d < bestD) { bestD = d; best = o; }
  }
  for (const b of w.buildings.values()) {
    if (b.faction === u.faction || b.hp <= 0) continue;
    const bcx = Math.floor(b.pos.x + b.size.w / 2);
    const bcy = Math.floor(b.pos.y + b.size.h / 2);
    if (!chebyshevRange(u.occ.x, u.occ.y, bcx, bcy, sight)) continue;
    if (fogGet(w, u.faction, bcx, bcy) !== 'visible') continue;
    const d = dist2(u.pos.x, u.pos.y, b.pos.x + b.size.w / 2, b.pos.y + b.size.h / 2);
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}

export function applyDamage(w: World, attacker: UnitEntity, target: Entity, amount: number): void {
  if (target.kind === 'projectile') return;
  let armor = 0;
  if (target.kind === 'unit') {
    armor = 0; // unit armor encoded in stats but kept at 0 in this design
  } else if (target.kind === 'building') {
    armor = target.armor;
  }
  const dmg = Math.max(1, amount - armor);
  if (target.kind === 'unit') {
    target.hp -= dmg;
    w.events.push({ t: w.time, kind: 'damage', attacker: attacker.id, target: target.id, amount: dmg });
    if (target.hp <= 0) w.events.push({ t: w.time, kind: 'death', entity: target.id });
  } else if (target.kind === 'building') {
    target.hp -= dmg;
    target.flashTimer = 0.15;
    w.events.push({ t: w.time, kind: 'damage', attacker: attacker.id, target: target.id, amount: dmg });
    if (target.hp <= 0) w.events.push({ t: w.time, kind: 'death', entity: target.id });
  }
}

function updateProjectile(w: World, p: ProjectileEntity, dt: number): void {
  const target = p.targetKind === 'unit' ? w.units.get(p.target) : w.buildings.get(p.target);
  let tx = 0;
  let ty = 0;
  if (target) {
    if (target.kind === 'unit') { tx = target.pos.x; ty = target.pos.y; }
    else { tx = target.pos.x + target.size.w / 2; ty = target.pos.y + target.size.h / 2; }
  } else {
    // target dead; expire
    p.ttl -= dt;
    if (p.ttl <= 0) w.projectiles.delete(p.id);
    return;
  }
  const dx = tx - p.pos.x;
  const dy = ty - p.pos.y;
  const d = Math.hypot(dx, dy);
  const step = p.speed * dt;
  if (d <= step || d < 0.05) {
    p.pos.x = tx;
    p.pos.y = ty;
    // damage on hit
    if (target) {
      if (target.kind === 'unit') {
        target.hp -= p.damage;
        w.events.push({ t: w.time, kind: 'damage', attacker: p.id, target: target.id, amount: p.damage });
        if (target.hp <= 0) w.events.push({ t: w.time, kind: 'death', entity: target.id });
      } else {
        target.hp -= p.damage;
        target.flashTimer = 0.15;
        w.events.push({ t: w.time, kind: 'damage', attacker: p.id, target: target.id, amount: p.damage });
        if (target.hp <= 0) w.events.push({ t: w.time, kind: 'death', entity: target.id });
      }
    }
    w.projectiles.delete(p.id);
    return;
  }
  p.pos.x += (dx / d) * step;
  p.pos.y += (dy / d) * step;
  p.ttl -= dt;
  if (p.ttl <= 0) w.projectiles.delete(p.id);
}

function removeEntity(w: World, id: EntityId): void {
  const u = w.units.get(id);
  if (u) {
    w.units.delete(id);
    w.factions[factionIdx(u.faction)].supplyUsed -= UNIT_STATS[u.unitKind].supply;
    return;
  }
  const b = w.buildings.get(id);
  if (b) {
    w.buildings.delete(id);
    recomputeSupplyCaps(w);
    return;
  }
  const p = w.projectiles.get(id);
  if (p) {
    w.projectiles.delete(id);
    return;
  }
}

function recomputeFactionFog(w: World, faction: FactionId): void {
  // 1. Demote "visible" tiles to "explored" (or keep visible if a unit nearby)
  const fog = w.factions[factionIdx(faction)].fog;
  // First, set everything currently visible-but-not-in-sight-this-tick to explored
  for (let i = 0; i < fog.length; i++) {
    if (fog[i] === 2) fog[i] = 1; // explored
  }
  // 2. Reveal areas around each unit/building
  for (const u of w.units.values()) {
    if (u.faction !== faction || u.hp <= 0) continue;
    const r = UNIT_STATS[u.unitKind].sight;
    revealArea(w, faction, u.occ.x, u.occ.y, r);
  }
  for (const b of w.buildings.values()) {
    if (b.faction !== faction) continue;
    // buildings reveal a small area
    revealArea(w, faction, b.pos.x + Math.floor(b.size.w / 2), b.pos.y + Math.floor(b.size.h / 2), 4);
  }
}

function checkVictory(w: World): void {
  const alive: Record<FactionId, boolean> = { human: false, orc: false };
  for (const b of w.buildings.values()) {
    if (b.hp > 0) alive[b.faction] = true;
  }
  for (const f of Object.keys(alive) as FactionId[]) {
    w.factions[factionIdx(f)].alive = alive[f];
  }
  if (!alive.human && !alive.orc) {
    // tie: pick a winner for simplicity: whoever still has units wins; if none, the AI
    if (w.units.size > 0) {
      const f = w.units.values().next().value?.faction;
      if (f) w.gameOver = { winner: f };
    } else {
      w.gameOver = { winner: 'orc' };
    }
    return;
  }
  if (!alive.human) w.gameOver = { winner: 'orc' };
  if (!alive.orc) w.gameOver = { winner: 'human' };
}

// ──────────────────────────────────────────────────────────────────────────
// Training / building placement (player commands)
// ──────────────────────────────────────────────────────────────────────────

export function canPlaceBuilding(w: World, _faction: FactionId, bk: BuildingKind, x: number, y: number): boolean {
  const stats = BUILDING_STATS[bk];
  return isBuildable(w, x, y, stats.size.w, stats.size.h);
}

export function tryQueueBuilding(w: World, faction: FactionId, bk: BuildingKind, x: number, y: number): BuildingEntity | null {
  const stats = BUILDING_STATS[bk];
  const f = w.factions[factionIdx(faction)];
  if (f.gold < stats.cost.gold || f.wood < stats.cost.wood) return null;
  if (!isBuildable(w, x, y, stats.size.w, stats.size.h)) return null;
  f.gold -= stats.cost.gold;
  f.wood -= stats.cost.wood;
  const b = placeBuilding(w, faction, bk, x, y, true);
  w.events.push({ t: w.time, kind: 'build', entity: b.id, building: bk, x, y });
  recomputeSupplyCaps(w);
  return b;
}

export function canTrain(w: World, faction: FactionId, kind: UnitKind): boolean {
  const stats = UNIT_STATS[kind];
  const f = w.factions[factionIdx(faction)];
  if (f.gold < stats.cost.gold || f.wood < stats.cost.wood) return false;
  if (f.supplyUsed + stats.supply > f.supplyCap) return false;
  // prerequisites
  if (kind === 'melee' && !hasBuildingKind(w, faction, 'barracks')) return false;
  if (kind === 'ranged' && (!hasBuildingKind(w, faction, 'barracks') || !hasBuildingKind(w, faction, 'mill'))) return false;
  if (kind === 'heavy' && (!hasBuildingKind(w, faction, 'barracks') || !hasBuildingKind(w, faction, 'mill'))) return false;
  return true;
}

export function tryQueueTrain(w: World, buildingId: EntityId, kind: UnitKind): boolean {
  const b = w.buildings.get(buildingId);
  if (!b) return false;
  if (b.underConstruction) return false;
  // town hall can only train workers
  if (b.buildingKind === 'townhall' && kind !== 'worker') return false;
  if (b.buildingKind !== 'townhall' && b.buildingKind !== 'barracks') return false;
  if (b.buildingKind === 'barracks' && kind === 'worker') return false;
  if (!canTrain(w, b.faction, kind)) return false;
  const stats = UNIT_STATS[kind];
  w.factions[factionIdx(b.faction)].gold -= stats.cost.gold;
  w.factions[factionIdx(b.faction)].wood -= stats.cost.wood;
  b.trainQueue.push(kind);
  return true;
}

export function cancelTrain(w: World, buildingId: EntityId, index: number): boolean {
  const b = w.buildings.get(buildingId);
  if (!b) return false;
  if (index < 0 || index >= b.trainQueue.length) return false;
  const k = b.trainQueue[index] as UnitKind;
  b.trainQueue.splice(index, 1);
  // refund 80% of cost
  const stats = UNIT_STATS[k];
  w.factions[factionIdx(b.faction)].gold += Math.floor(stats.cost.gold * 0.8);
  w.factions[factionIdx(b.faction)].wood += Math.floor(stats.cost.wood * 0.8);
  return true;
}

function hasBuildingKind(w: World, faction: FactionId, bk: BuildingKind): boolean {
  for (const b of w.buildings.values()) {
    if (b.faction === faction && b.buildingKind === bk && !b.underConstruction) return true;
  }
  return false;
}

function spawnUnitAtBuilding(w: World, b: BuildingEntity, kind: UnitKind): void {
  // find a free adjacent tile
  for (let r = 1; r < 6; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = b.pos.x + Math.floor(b.size.w / 2) + dx;
        const ty = b.pos.y + Math.floor(b.size.h / 2) + dy;
        if (!isWalkable(w, tx, ty)) continue;
        // not on another unit
        let occupied = false;
        for (const u of w.units.values()) {
          if (u.occ.x === tx && u.occ.y === ty) { occupied = true; break; }
        }
        if (occupied) continue;
        const u = placeUnit(w, b.faction, kind, tx, ty);
        w.events.push({ t: w.time, kind: 'train', entity: u.id, unit: kind, owner: b.id });
        return;
      }
    }
  }
  // fallback: drop at center (may overlap)
  const u = placeUnit(w, b.faction, kind, b.pos.x + Math.floor(b.size.w / 2), b.pos.y + Math.floor(b.size.h / 2));
  w.events.push({ t: w.time, kind: 'train', entity: u.id, unit: kind, owner: b.id });
}

// ──────────────────────────────────────────────────────────────────────────
// Issue orders
// ──────────────────────────────────────────────────────────────────────────

export function orderMove(w: World, units: UnitEntity[], tx: number, ty: number, attackMove: boolean): void {
  if (units.length === 0) return;
  if (units.length === 1) {
    const u = units[0] as UnitEntity;
    if (attackMove) {
      u.order = { kind: 'attackMove', tx, ty };
    } else {
      u.order = { kind: 'move', tx, ty };
    }
    pathToTile(w, u, tx, ty);
    return;
  }
  // group: spread formation
  const positions = formationTiles(w, units.length, tx, ty);
  for (let i = 0; i < units.length; i++) {
    const u = units[i] as UnitEntity;
    const p = positions[i] as { x: number; y: number };
    if (attackMove) {
      u.order = { kind: 'attackMove', tx: p.x, ty: p.y };
    } else {
      u.order = { kind: 'move', tx: p.x, ty: p.y };
    }
    pathToTile(w, u, p.x, p.y);
  }
}

function formationTiles(w: World, n: number, tx: number, ty: number): { x: number; y: number }[] {
  const result: { x: number; y: number }[] = [];
  const side = Math.ceil(Math.sqrt(n));
  let i = 0;
  for (let r = 0; r < side; r++) {
    for (let c = 0; c < side; c++) {
      if (i >= n) break;
      const px = clamp(tx - Math.floor(side / 2) + c, 0, w.map.width - 1);
      const py = clamp(ty - Math.floor(side / 2) + r, 0, w.map.height - 1);
      result.push({ x: px, y: py });
      i++;
    }
  }
  return result;
}

export function orderAttack(w: World, units: UnitEntity[], targetId: EntityId): void {
  for (const u of units) {
    u.order = { kind: 'attack', target: targetId };
    pathToEntity(w, u, targetId);
    w.events.push({ t: w.time, kind: 'attackOrder', unit: u.id, target: targetId });
  }
}

export function orderStop(_w: World, units: UnitEntity[]): void {
  for (const u of units) {
    u.order = { kind: 'idle' };
    u.path = [];
    u.pathIdx = 0;
    u.workerState = 'idle';
  }
}

export function orderRepair(w: World, units: UnitEntity[], targetId: EntityId): void {
  for (const u of units) {
    if (u.unitKind !== 'worker') continue;
    u.targetId = targetId;
    u.workerState = 'movingToRepair';
    u.order = { kind: 'repair', target: targetId };
    const b = w.buildings.get(targetId);
    if (b) {
      const adj = nearestAdjacentWalkable(w, b.pos.x, b.pos.y, 2);
      if (adj) pathToTile(w, u, adj.x, adj.y);
    }
  }
}

export function orderBuild(w: World, units: UnitEntity[], buildingId: EntityId): void {
  for (const u of units) {
    if (u.unitKind !== 'worker') continue;
    u.buildTarget = buildingId;
    u.workerState = 'movingToBuild';
    u.order = { kind: 'build', target: buildingId };
    const b = w.buildings.get(buildingId);
    if (b) {
      const adj = nearestAdjacentWalkable(w, b.pos.x, b.pos.y, 2);
      if (adj) pathToTile(w, u, adj.x, adj.y);
    }
  }
}

export { FACTIONS };
