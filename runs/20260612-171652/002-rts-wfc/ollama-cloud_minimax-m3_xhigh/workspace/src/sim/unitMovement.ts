// Unit step: advances a single unit by one tick. The unit's state lives in
// UnitOrderState (see orders.ts). This file dispatches to phase-specific
// helpers imported from the other step modules.

import { World } from "./world.js";
import { BuildingEntity, isBuilding, UnitEntity } from "./entities.js";
import { TILE, isWalkableTile } from "./tiles.js";
import { findPath, octile } from "./pathfinding.js";
import { getBuildingStats, getUnitStats } from "./stats.js";
import { Order } from "./orders.js";
import { buildTerrainBlockedMap } from "./helpers.js";

function tileFreeOfOtherUnits(world: World, x: number, y: number, selfId: number): boolean {
  for (const e of world.entities.values()) {
    if (e.kind !== "unit") continue;
    if (e.id === selfId) continue;
    if (e.x === x && e.y === y) return false;
  }
  return true;
}

export function unitBlocks(world: World, selfId: number): Uint8Array {
  const arr = buildTerrainBlockedMap(world);
  for (const e of world.entities.values()) {
    if (e.kind !== "unit") continue;
    if (e.id === selfId) continue;
    arr[e.y * world.map.width + e.x] = 1;
  }
  return arr;
}

export function nearestDropOffBuilding(
  world: World,
  unit: UnitEntity,
  resource: "gold" | "wood",
): BuildingEntity | null {
  let best: BuildingEntity | null = null;
  let bestD = Infinity;
  for (const e of world.entities.values()) {
    if (e.kind !== "building") continue;
    if (e.faction !== unit.faction) continue;
    if (e.construction < 1) continue;
    if (resource === "gold" && e.buildingKind !== "townhall") continue;
    if (resource === "wood" && e.buildingKind !== "townhall" && e.buildingKind !== "lumbermill") continue;
    const d = octile(unit.x, unit.y, e.x, e.y);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

export function findWalkableTileAdjacentToSource(
  world: World,
  blocked: Uint8Array,
  sx: number, sy: number,
  selfId: number,
): { x: number; y: number } | null {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = sx + dx;
      const y = sy + dy;
      if (x < 0 || y < 0 || x >= world.map.width || y >= world.map.height) continue;
      if (blocked[y * world.map.width + x] === 1) continue;
      if (!isWalkableTile(world.map.get(x, y))) continue;
      if (!tileFreeOfOtherUnits(world, x, y, selfId)) continue;
      return { x, y };
    }
  }
  return null;
}

export function findAdjacentWalkableToBuilding(
  world: World,
  blocked: Uint8Array,
  b: BuildingEntity,
  selfId: number,
): { x: number; y: number } | null {
  const stats = getBuildingStats(b.faction, b.buildingKind);
  const W = world.map.width;
  for (let dy = -1; dy <= stats.footprint.h; dy++) {
    for (let dx = -1; dx <= stats.footprint.w; dx++) {
      const onLeft = dx === -1;
      const onRight = dx === stats.footprint.w;
      const onTop = dy === -1;
      const onBottom = dy === stats.footprint.h;
      if (!onLeft && !onRight && !onTop && !onBottom) continue;
      const x = b.x + dx;
      const y = b.y + dy;
      if (x < 0 || y < 0 || x >= W || y >= world.map.height) continue;
      if (blocked[y * W + x] === 1) continue;
      if (!isWalkableTile(world.map.get(x, y))) continue;
      if (!tileFreeOfOtherUnits(world, x, y, selfId)) continue;
      return { x, y };
    }
  }
  return null;
}

export function retargetHarvestSource(
  world: World,
  unit: UnitEntity,
  resource: "gold" | "wood",
  blocked: Uint8Array,
): boolean {
  let best: { x: number; y: number; d: number } | null = null;
  for (let y = 0; y < world.map.height; y++) {
    for (let x = 0; x < world.map.width; x++) {
      const t = world.map.get(x, y);
      if (resource === "gold" && t !== TILE.GOLD_MINE) continue;
      if (resource === "wood" && t !== TILE.FOREST) continue;
      const idx = y * world.map.width + x;
      if (resource === "gold" && (world.map.mineGold[idx] ?? 0) <= 0) continue;
      if (resource === "wood" && (world.map.forestWood[idx] ?? 0) <= 0) continue;
      const d = octile(unit.x, unit.y, x, y);
      if (best === null || d < best.d) best = { x, y, d };
    }
  }
  if (best === null) return false;
  const adj = findWalkableTileAdjacentToSource(world, blocked, best.x, best.y, unit.id);
  if (adj === null) return false;
  const path = findPath(world.map, unit.x, unit.y, adj.x, adj.y, { blocked });
  if (path === null) return false;
  unit.orderState.order = { kind: "harvest", tx: best.x, ty: best.y } as Order;
  unit.orderState.path = path;
  unit.orderState.repathAttempts = 0;
  unit.orderState.phase = "gathering";
  return true;
}

export function stepAlongPath(world: World, unit: UnitEntity, blocked: Uint8Array, dt: number): void {
  if (unit.orderState.path.length === 0) return;
  const stats = getUnitStats(unit.faction, unit.unitKind);
  const speed = stats.moveSpeed;
  let progress = unit.orderState.moveProgress;
  let guard = 0;
  while (progress < dt * speed && guard++ < 8) {
    const next = unit.orderState.path[0];
    if (!next) break;
    const [nx, ny] = next;
    if (!isWalkableTile(world.map.get(nx, ny))) {
      unit.orderState.path = [];
      return;
    }
    const fromX = unit.x;
    const fromY = unit.y;
    if (nx !== fromX && ny !== fromY) {
      if (
        !isWalkableTile(world.map.get(fromX, ny)) ||
        !isWalkableTile(world.map.get(nx, fromY))
      ) {
        const axial = findAxialDetour(world, blocked, fromX, fromY, nx, ny, unit.id);
        if (axial !== null) {
          unit.orderState.path.unshift(axial);
          continue;
        }
        unit.orderState.path = [];
        return;
      }
    }
    if (!tileFreeOfOtherUnits(world, nx, ny, unit.id)) return;
    const remaining = dt * speed - progress;
    const dx = nx - fromX;
    const dy = ny - fromY;
    const stepCost = dx !== 0 && dy !== 0 ? Math.SQRT2 : 1;
    if (remaining >= stepCost) {
      unit.x = nx;
      unit.y = ny;
      unit.subX = 0.5;
      unit.subY = 0.5;
      progress += stepCost;
      unit.orderState.path.shift();
      const jx = (world.rng.next() - 0.5) * 0.1;
      const jy = (world.rng.next() - 0.5) * 0.1;
      unit.subX = Math.max(0.05, Math.min(0.95, 0.5 + jx));
      unit.subY = Math.max(0.05, Math.min(0.95, 0.5 + jy));
    } else {
      const frac = remaining / stepCost;
      unit.subX = 0.5 + (nx - fromX) * frac;
      unit.subY = 0.5 + (ny - fromY) * frac;
      progress = dt * speed;
    }
  }
  unit.orderState.moveProgress = progress;
  if (unit.orderState.path.length === 0) {
    unit.subX = 0.5;
    unit.subY = 0.5;
  }
}

function findAxialDetour(
  world: World,
  blocked: Uint8Array,
  fromX: number, fromY: number,
  toX: number, toY: number,
  selfId: number,
): [number, number] | null {
  const c1 = isWalkableTile(world.map.get(toX, fromY)) && tileFreeOfOtherUnits(world, toX, fromY, selfId);
  const c2 = isWalkableTile(world.map.get(fromX, toY)) && tileFreeOfOtherUnits(world, fromX, toY, selfId);
  if (c1 && blocked[fromY * world.map.width + toX] === 0) return [toX, fromY];
  if (c2 && blocked[toY * world.map.width + fromX] === 0) return [fromX, toY];
  return null;
}

void isBuilding;
