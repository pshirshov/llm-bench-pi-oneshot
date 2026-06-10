import type { TileCoord, Vec2 } from "../core/vec.js";
import { findPath } from "./astar.js";
import type { GameMap } from "./gamemap.js";
import type { Unit } from "./entity.js";

/** BFS outward from a tile to find the nearest passable tile (for retargeting clicks on blocked terrain). */
export function nearestPassable(map: GameMap, tile: TileCoord, maxRadius = 12): TileCoord | null {
  if (map.isPassable(tile.tx, tile.ty)) return tile;
  const visited = new Set<number>();
  const queue: TileCoord[] = [tile];
  visited.add(tile.ty * map.width + tile.tx);
  let head = 0;
  let depth = 0;
  // Ring-limited BFS.
  while (head < queue.length) {
    const levelEnd = queue.length;
    while (head < levelEnd) {
      const cur = queue[head++]!;
      if (map.isPassable(cur.tx, cur.ty)) return cur;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = cur.tx + dx;
        const ny = cur.ty + dy;
        if (!map.tiles.inBounds(nx, ny)) continue;
        const key = ny * map.width + nx;
        if (visited.has(key)) continue;
        visited.add(key);
        queue.push({ tx: nx, ty: ny });
      }
    }
    if (++depth > maxRadius) break;
  }
  return null;
}

/** Tile a unit currently occupies. */
export function unitTile(u: Unit): TileCoord {
  return { tx: Math.floor(u.pos.x), ty: Math.floor(u.pos.y) };
}

/**
 * Compute and assign a path for `unit` to `goal`. When `stopAdjacent`, the path
 * ends on a tile next to the goal (for harvest/build/attack on blocked targets).
 * Returns true if a path (possibly empty = already there) was found.
 */
export function assignPath(
  map: GameMap,
  unit: Unit,
  goal: TileCoord,
  stopAdjacent: boolean,
): boolean {
  const start = unitTile(unit);
  const isBlocked = (x: number, y: number): boolean => !map.isPassable(x, y);
  const path = findPath(map.width, map.height, isBlocked, start, goal, { stopAdjacent });
  if (path === null) {
    unit.path = [];
    unit.waypointIndex = 0;
    unit.pathGoal = null;
    return false;
  }
  unit.path = path;
  unit.waypointIndex = 0;
  unit.pathGoal = { tx: goal.tx, ty: goal.ty };
  return true;
}

/** Centre point of a tile. */
export function tileCenter(t: TileCoord): Vec2 {
  return { x: t.tx + 0.5, y: t.ty + 0.5 };
}
