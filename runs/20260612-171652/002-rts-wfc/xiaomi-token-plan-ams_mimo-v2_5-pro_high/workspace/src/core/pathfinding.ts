/**
 * A* pathfinding on a tile grid (8-directional, no corner cutting through blocked diagonals).
 */

import type { Vec2, GameMap } from './types';

interface ANode {
  x: number;
  y: number;
  g: number;
  h: number;
  f: number;
  parent: ANode | null;
}

/** 8-directional neighbors: cardinal + diagonal */
const DIRS: readonly Vec2[] = [
  { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 },
  { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }, { x: -1, y: -1 },
];

function tileIndex(map: GameMap, x: number, y: number): number {
  return y * map.width + x;
}

function inBounds(map: GameMap, x: number, y: number): boolean {
  return x >= 0 && x < map.width && y >= 0 && y < map.height;
}

/**
 * Check if movement from (fx,fy) to (tx,ty) is allowed.
 * Diagonal moves must not cut through blocked corners.
 */
function canMove(map: GameMap, fx: number, fy: number, tx: number, ty: number): boolean {
  if (!inBounds(map, tx, ty)) return false;
  if (!map.walkable[tileIndex(map, tx, ty)]) return false;
  const dx = tx - fx;
  const dy = ty - fy;
  // Diagonal: both adjacent cardinals must be walkable
  if (dx !== 0 && dy !== 0) {
    if (!map.walkable[tileIndex(map, fx + dx, fy)]) return false;
    if (!map.walkable[tileIndex(map, fx, fy + dy)]) return false;
  }
  return true;
}

/** Heuristic: Chebyshev distance (admissible for 8-directional with diagonal cost √2) */
function heuristic(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  // Chebyshev: max(dx,dy) + (√2-1)*min(dx,dy) — more accurate than plain max
  const dMin = Math.min(dx, dy);
  const dMax = Math.max(dx, dy);
  return dMax + (Math.SQRT2 - 1) * dMin;
}

/** Find the nearest walkable tile to (tx, ty), searching outward in a spiral */
export function findNearestWalkable(map: GameMap, tx: number, ty: number): Vec2 | null {
  if (inBounds(map, tx, ty) && map.walkable[tileIndex(map, tx, ty)]) {
    return { x: tx, y: ty };
  }
  for (let r = 1; r < Math.max(map.width, map.height); r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const nx = tx + dx;
        const ny = ty + dy;
        if (inBounds(map, nx, ny) && map.walkable[tileIndex(map, nx, ny)]) {
          return { x: nx, y: ny };
        }
      }
    }
  }
  return null;
}

/**
 * A* pathfinding.
 * Returns the path as a list of tile centers (excluding the start tile),
 * or null if no path exists.
 */
export function findPath(
  map: GameMap,
  sx: number, sy: number,
  tx: number, ty: number,
  maxNodes: number = 2000,
): Vec2[] | null {
  if (!inBounds(map, sx, sy)) return null;
  if (!inBounds(map, tx, ty)) return null;

  // Find actual walkable target (may be inside a building)
  const actualTarget = findNearestWalkable(map, tx, ty);
  if (!actualTarget) return null;

  const goalX = actualTarget.x;
  const goalY = actualTarget.y;

  if (sx === goalX && sy === goalY) return [];

  const open: ANode[] = [];
  const closed = new Set<number>();

  const startNode: ANode = {
    x: sx, y: sy, g: 0, h: heuristic(sx, sy, goalX, goalY),
    f: heuristic(sx, sy, goalX, goalY), parent: null,
  };
  open.push(startNode);

  let iterations = 0;
  while (open.length > 0 && iterations < maxNodes) {
    iterations++;

    // Find node with lowest f
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }
    const current = open[bestIdx];
    open[bestIdx] = open[open.length - 1];
    open.pop();

    if (current.x === goalX && current.y === goalY) {
      // Reconstruct path
      const path: Vec2[] = [];
      let node: ANode | null = current;
      while (node !== null) {
        path.push({ x: node.x, y: node.y });
        node = node.parent;
      }
      path.reverse();
      return path.slice(1); // Exclude start tile
    }

    const key = tileIndex(map, current.x, current.y);
    if (closed.has(key)) continue;
    closed.add(key);

    for (const dir of DIRS) {
      const nx = current.x + dir.x;
      const ny = current.y + dir.y;
      if (!canMove(map, current.x, current.y, nx, ny)) continue;
      const nkey = tileIndex(map, nx, ny);
      if (closed.has(nkey)) continue;

      const isDiag = dir.x !== 0 && dir.y !== 0;
      const moveCost = isDiag ? Math.SQRT2 : 1;
      const g = current.g + moveCost;

      // Check if already in open with better g
      const existingIdx = open.findIndex(n => n.x === nx && n.y === ny);
      if (existingIdx >= 0 && open[existingIdx].g <= g) continue;

      const h = heuristic(nx, ny, goalX, goalY);
      const node: ANode = { x: nx, y: ny, g, h, f: g + h, parent: current };

      if (existingIdx >= 0) {
        open[existingIdx] = node;
      } else {
        open.push(node);
      }
    }
  }

  return null; // No path found
}

/**
 * Simplified pathfinding that reports only reachable status.
 */
export function isReachable(
  map: GameMap,
  sx: number, sy: number,
  tx: number, ty: number,
): boolean {
  const path = findPath(map, sx, sy, tx, ty, 500);
  return path !== null;
}

/** 8-directional neighbor walkability check (for range queries) */
export function getWalkableNeighbors(map: GameMap, x: number, y: number): Vec2[] {
  const result: Vec2[] = [];
  for (const dir of DIRS) {
    const nx = x + dir.x;
    const ny = y + dir.y;
    if (inBounds(map, nx, ny) && map.walkable[tileIndex(map, nx, ny)]) {
      result.push({ x: nx, y: ny });
    }
  }
  return result;
}
