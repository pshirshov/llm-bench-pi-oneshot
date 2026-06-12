// Helpers shared by the various sim step phases.

import { World } from "./world.js";
import { UnitEntity, BuildingEntity, isBuilding, isUnit } from "./entities.js";
import { TILE, isWalkableTile, isResourceTile } from "./tiles.js";
import { UnitOrderState } from "./orders.js";
import { findPath, buildBlockedMap } from "./pathfinding.js";
import { UnitKind, getUnitStats, getBuildingStats } from "./stats.js";

/** Returns true if a unit at (x, y) (integer tile coords) is currently
 *  occupying a tile that is "occupied" for movement purposes (including
 *  itself's tile). The caller subtracts self before checking. */
export function tileOccupiedByUnit(
  world: World,
  x: number,
  y: number,
  selfId: number,
  reserve: ReadonlySet<number>,
): boolean {
  for (const e of world.entities.values()) {
    if (e.kind !== "unit") continue;
    if (e.id === selfId) continue;
    if (reserve.has(e.id)) continue;
    if (e.x === x && e.y === y) return true;
  }
  return false;
}

/** Build a temporary blocked grid for pathfinding that excludes units (units
 *  are handled by the movement layer, not pathfinding). */
export function buildTerrainBlockedMap(world: World): Uint8Array {
  const map = world.map;
  const arr = buildBlockedMap(map);
  // Add building footprints as blocked.
  for (const e of world.entities.values()) {
    if (!isBuilding(e)) continue;
    if (e.construction < 1) continue;
    const stats = getBuildingStats(e.faction, e.buildingKind);
    for (let dy = 0; dy < stats.footprint.h; dy++) {
      for (let dx = 0; dx < stats.footprint.w; dx++) {
        const x = e.x + dx;
        const y = e.y + dy;
        if (map.inBounds(x, y)) arr[y * map.width + x] = 1;
      }
    }
  }
  return arr;
}

/** Pick the closest walkable tile adjacent to (tx, ty) — used for source
 *  tiles (gold mine, forest) which are unwalkable. Returns null if no such
 *  tile is reachable within the map. */
export function pickAdjacentWalkable(
  world: World,
  tx: number,
  ty: number,
  blocked: Uint8Array,
): { x: number; y: number } | null {
  const w = world.map.width;
  const h = world.map.height;
  let best: { x: number; y: number; d: number } | null = null;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = tx + dx;
      const y = ty + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      if (blocked[y * w + x] === 1) continue;
      if (!isWalkableTile(world.map.get(x, y))) continue;
      const d = dx * dx + dy * dy;
      if (best === null || d < best.d) best = { x, y, d };
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}

export function isAdjacent(ax: number, ay: number, bx: number, by: number): boolean {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return dx <= 1 && dy <= 1;
}

/** The pathfinder's idea of "neighbor". */
export function pathStepTowards(
  world: World,
  blocked: Uint8Array,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
): Array<[number, number]> | null {
  return findPath(world.map, sx, sy, gx, gy, { blocked });
}

void TILE;
void isResourceTile;
void UnitKind;
void getUnitStats;
void UnitEntity;
void BuildingEntity;
void isUnit;
void UnitOrderState;
