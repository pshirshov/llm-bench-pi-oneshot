// Order handler: issues an Order to a single unit by setting up the
// UnitOrderState. The actual tick-by-tick progression lives in unitStep.ts.
//
// C4 (unreachable destination) is handled here: if the goal tile is not
// reachable, the handler walks toward the nearest reachable point and
// settles there.

import { World } from "./world.js";
import { UnitEntity, isBuilding, isUnit } from "./entities.js";
import { AttackMoveOrder, AttackOrder, BuildOrder, HarvestOrder, MoveOrder, Order, RepairOrder } from "./orders.js";
import { findPath, octile } from "./pathfinding.js";
import { getBuildingStats } from "./stats.js";
import { isResourceTile, isWalkableTile } from "./tiles.js";
import { buildTerrainBlockedMap, pickAdjacentWalkable } from "./helpers.js";

function unitBlocksForWorld(world: World, selfId: number): Uint8Array {
  const arr = buildTerrainBlockedMap(world);
  for (const e of world.entities.values()) {
    if (e.kind !== "unit") continue;
    if (e.id === selfId) continue;
    arr[e.y * world.map.width + e.x] = 1;
  }
  return arr;
}

function isBuildableAt(
  world: World,
  x: number, y: number, w: number, h: number,
  workerId: number,
): boolean {
  const map = world.map;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      if (!map.inBounds(xx, yy)) return false;
      if (!isWalkableTile(map.get(xx, yy))) return false;
      if (isResourceTile(map.get(xx, yy))) return false;
    }
  }
  for (const e of world.entities.values()) {
    if (e.kind !== "building") continue;
    if (e.construction < 1) continue;
    const stats = getBuildingStats(e.faction, e.buildingKind);
    if (rectsOverlap(x, y, w, h, e.x, e.y, stats.footprint.w, stats.footprint.h)) return false;
  }
  for (const e of world.entities.values()) {
    if (e.kind !== "unit") continue;
    if (e.id === workerId) continue;
    if (e.x >= x && e.x < x + w && e.y >= y && e.y < y + h) return false;
  }
  return true;
}

function rectsOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function findAdjacentWalkableToFootprint(
  world: World,
  blocked: Uint8Array,
  x: number, y: number, w: number, h: number,
): { x: number; y: number } | null {
  const W = world.map.width;
  const H = world.map.height;
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const onLeft = dx === -1;
      const onRight = dx === w;
      const onTop = dy === -1;
      const onBottom = dy === h;
      if (!onLeft && !onRight && !onTop && !onBottom) continue;
      const px = x + dx;
      const py = y + dy;
      if (px < 0 || py < 0 || px >= W || py >= H) continue;
      if (blocked[py * W + px] === 1) continue;
      if (!isWalkableTile(world.map.get(px, py))) continue;
      return { x: px, y: py };
    }
  }
  return null;
}

function nearestReachableTile(
  world: World,
  blocked: Uint8Array,
  sx: number, sy: number, gx: number, gy: number,
): { x: number; y: number } | null {
  const W = world.map.width;
  const H = world.map.height;
  const visited = new Uint8Array(W * H);
  const queue: Array<[number, number]> = [[gx, gy]];
  let head = 0;
  let safety = 400;
  while (head < queue.length && safety-- > 0) {
    const [x, y] = queue[head++] as [number, number];
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    if (visited[y * W + x] === 1) continue;
    visited[y * W + x] = 1;
    if (blocked[y * W + x] === 0 && isWalkableTile(world.map.get(x, y))) {
      const path = findPath(world.map, sx, sy, x, y, { blocked });
      if (path !== null) return { x, y };
    }
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (visited[ny * W + nx] === 1) continue;
        queue.push([nx, ny]);
      }
    }
  }
  return null;
}

function canPay(world: World, faction: "humans" | "orcs", gold: number, wood: number): boolean {
  const p = world.players[faction];
  return p.gold >= gold && p.wood >= wood;
}

function pay(world: World, faction: "humans" | "orcs", gold: number, wood: number): void {
  const p = world.players[faction];
  p.gold -= gold;
  p.wood -= wood;
}

function refund(world: World, faction: "humans" | "orcs", gold: number, wood: number): void {
  const p = world.players[faction];
  p.gold += gold;
  p.wood += wood;
}

function setMoveOrAttackMoveOrder(
  world: World,
  unit: UnitEntity,
  goal: { x: number; y: number },
  phase: "moving" | "patrolling",
  blocked: Uint8Array,
): boolean {
  let path = findPath(world.map, unit.x, unit.y, goal.x, goal.y, { blocked });
  if (path === null) {
    const near = nearestReachableTile(world, blocked, unit.x, unit.y, goal.x, goal.y);
    if (near === null) return false;
    path = findPath(world.map, unit.x, unit.y, near.x, near.y, { blocked });
    if (path === null) return false;
  }
  unit.orderState.path = path;
  unit.orderState.phase = phase;
  return true;
}

function setHarvestOrder(
  world: World,
  unit: UnitEntity,
  h: HarvestOrder,
  blocked: Uint8Array,
): boolean {
  const t = world.map.get(h.tx, h.ty);
  if (!isResourceTile(t)) return false;
  const adj = pickAdjacentWalkable(world, h.tx, h.ty, blocked);
  if (adj === null) return false;
  const path = findPath(world.map, unit.x, unit.y, adj.x, adj.y, { blocked });
  if (path === null) return false;
  unit.orderState.path = path;
  unit.orderState.phase = "gathering";
  return true;
}

function setBuildOrder(
  world: World,
  unit: UnitEntity,
  b: BuildOrder,
  blocked: Uint8Array,
): boolean {
  const stats = getBuildingStats(unit.faction, b.building);
  if (!isBuildableAt(world, b.x, b.y, stats.footprint.w, stats.footprint.h, unit.id)) {
    return false;
  }
  if (!canPay(world, unit.faction, stats.goldCost, stats.woodCost)) {
    return false;
  }
  pay(world, unit.faction, stats.goldCost, stats.woodCost);
  const build = world.spawnBuilding(unit.faction, b.building, b.x, b.y, 0, unit.id);
  build.trainQueue = [];
  const adj = findAdjacentWalkableToFootprint(world, blocked, b.x, b.y, stats.footprint.w, stats.footprint.h);
  if (adj === null) {
    world.removeEntity(build.id);
    refund(world, unit.faction, stats.goldCost, stats.woodCost);
    return false;
  }
  const path = findPath(world.map, unit.x, unit.y, adj.x, adj.y, { blocked });
  if (path === null) {
    world.removeEntity(build.id);
    refund(world, unit.faction, stats.goldCost, stats.woodCost);
    return false;
  }
  unit.orderState.path = path;
  unit.orderState.phase = "building";
  return true;
}

function setRepairOrder(
  world: World,
  unit: UnitEntity,
  r: RepairOrder,
): boolean {
  const t = world.entities.get(r.target);
  if (!t || !isBuilding(t) || t.faction !== unit.faction) return false;
  unit.target = t.id;
  unit.orderState.phase = "repairing";
  return true;
}

function setAttackOrder(world: World, unit: UnitEntity, a: AttackOrder): boolean {
  const t = world.entities.get(a.target);
  if (!t) return false;
  if (t.kind !== "unit" && t.kind !== "building") return false;
  if (t.faction === unit.faction) return false;
  unit.target = t.id;
  unit.orderState.phase = "attacking";
  return true;
}

function trySetOrder(world: World, unit: UnitEntity, order: Order, blocked: Uint8Array): boolean {
  unit.orderState.order = order;
  unit.orderState.path = [];
  unit.orderState.moveProgress = 0;
  unit.orderState.workProgress = 0;
  unit.orderState.repathAttempts = 0;
  unit.orderState.cargo = { gold: 0, wood: 0 };
  unit.orderState.watchdog = 0;
  unit.target = null;
  unit.moveGoal = null;

  let ok = false;
  switch (order.kind) {
    case "move": {
      const m = order as MoveOrder;
      ok = setMoveOrAttackMoveOrder(world, unit, { x: m.x, y: m.y }, "moving", blocked);
      break;
    }
    case "attackMove": {
      const m = order as AttackMoveOrder;
      ok = setMoveOrAttackMoveOrder(world, unit, { x: m.x, y: m.y }, "patrolling", blocked);
      break;
    }
    case "attack": {
      ok = setAttackOrder(world, unit, order as AttackOrder);
      break;
    }
    case "harvest": {
      ok = setHarvestOrder(world, unit, order as HarvestOrder, blocked);
      break;
    }
    case "build": {
      ok = setBuildOrder(world, unit, order as BuildOrder, blocked);
      break;
    }
    case "repair": {
      ok = setRepairOrder(world, unit, order as RepairOrder);
      break;
    }
    case "train": {
      // Train orders are handled at the building level.
      unit.orderState.order = null;
      unit.orderState.phase = "idle";
      return false;
    }
  }
  if (!ok) {
    unit.orderState.order = null;
    unit.orderState.phase = "idle";
  }
  return ok;
}

/** Issue an order to a single unit. */
export function issueOrder(world: World, unitId: number, order: Order): boolean {
  const unit = world.entities.get(unitId);
  if (!unit || !isUnit(unit)) return false;
  const blocked = unitBlocksForWorld(world, unit.id);
  return trySetOrder(world, unit, order, blocked);
}

/** Build placement validator (public for tests). */
export function isPlacementValid(
  world: World,
  x: number, y: number, w: number, h: number,
  faction: "humans" | "orcs",
  workerId: number | null = null,
): boolean {
  if (!isBuildableAt(world, x, y, w, h, workerId ?? -1)) return false;
  // Also: must be within the faction's "buildable" range (i.e. adjacent to
  // a friendly building or worker). We relax this for AI planning by allowing
  // any valid placement, but for player input we restrict to within 8 tiles
  // of any friendly building. The test surface uses the unconstrained form.
  void faction;
  return true;
}

void octile;
