/**
 * A* pathfinding on tile grid (8-directional, no corner cutting through blocked diagonals).
 */
import { Tile, TILE_SIZE } from '../engine/types.js';

export interface PathResult {
  path: Array<{ x: number; y: number }>;
  found: boolean;
}

/** Check if a tile is walkable */
function isWalkable(tiles: Tile[][], x: number, y: number, mapW: number, mapH: number): boolean {
  if (x < 0 || x >= mapW || y < 0 || y >= mapH) return false;
  const t = tiles[y][x].type;
  return t !== 'water' && t !== 'rock';
}

/** A* from (sx, sy) to (gx, gy) in tile coords */
export function findPath(
  tiles: Tile[][],
  sx: number,
  sy: number,
  gx: number,
  gy: number,
  mapW: number,
  mapH: number,
  entityRadius: number = 0
): PathResult {
  // Clamp to map
  gx = Math.max(0, Math.min(mapW - 1, gx));
  gy = Math.max(0, Math.min(mapH - 1, gy));
  sx = Math.max(0, Math.min(mapW - 1, sx));
  sy = Math.max(0, Math.min(mapH - 1, sy));

  if (!isWalkable(tiles, gx, gy, mapW, mapH)) {
    // Find nearest walkable tile to goal
    const near = findNearestWalkable(tiles, gx, gy, mapW, mapH);
    if (!near) return { path: [], found: false };
    gx = near.x;
    gy = near.y;
  }

  if (sx === gx && sy === gy) return { path: [{ x: gx, y: gy }], found: true };

  // 8-directional moves: dx, dy, cost
  const dirs = [
    [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
    [-1, -1, 1.414], [-1, 1, 1.414], [1, -1, 1.414], [1, 1, 1.414]
  ];

  interface Node {
    x: number;
    y: number;
    g: number;
    h: number;
    f: number;
    parent: Node | null;
  }

  const openSet: Node[] = [];
  const closedSet = new Set<number>();
  const key = (x: number, y: number) => y * mapW + x;

  const heuristic = (x: number, y: number): number => {
    // Octile distance
    const dx = Math.abs(x - gx);
    const dy = Math.abs(y - gy);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };

  const startNode: Node = {
    x: sx, y: sy, g: 0, h: heuristic(sx, sy), f: heuristic(sx, sy), parent: null
  };
  openSet.push(startNode);

  const gScores = new Map<number, number>();
  gScores.set(key(sx, sy), 0);

  let iterations = 0;
  const maxIterations = mapW * mapH * 2;

  while (openSet.length > 0 && iterations < maxIterations) {
    iterations++;

    // Find node with lowest f
    let bestIdx = 0;
    for (let i = 1; i < openSet.length; i++) {
      if (openSet[i].f < openSet[bestIdx].f) bestIdx = i;
    }
    const current = openSet[bestIdx];
    openSet.splice(bestIdx, 1);

    const ck = key(current.x, current.y);
    if (closedSet.has(ck)) continue;
    closedSet.add(ck);

    if (current.x === gx && current.y === gy) {
      // Reconstruct path
      const path: Array<{ x: number; y: number }> = [];
      let node: Node | null = current;
      while (node) {
        path.unshift({ x: node.x, y: node.y });
        node = node.parent;
      }
      return { path: simplifyPath(path), found: true };
    }

    for (const [dx, dy, cost] of dirs) {
      const nx = current.x + dx;
      const ny = current.y + dy;

      if (!isWalkable(tiles, nx, ny, mapW, mapH)) continue;

      // No corner cutting: if diagonal, both adjacent cells must be walkable
      if (dx !== 0 && dy !== 0) {
        if (!isWalkable(tiles, current.x + dx, current.y, mapW, mapH) ||
            !isWalkable(tiles, current.x, current.y + dy, mapW, mapH)) {
          continue;
        }
      }

      // Check building collision if entityRadius > 0
      if (entityRadius > 0) {
        let blocked = false;
        for (let oy = 0; oy < entityRadius && !blocked; oy++) {
          for (let ox = 0; ox < entityRadius && !blocked; ox++) {
            const checkX = nx - Math.floor(entityRadius / 2) + ox;
            const checkY = ny - Math.floor(entityRadius / 2) + oy;
            if (!isWalkable(tiles, checkX, checkY, mapW, mapH)) blocked = true;
          }
        }
        if (blocked) continue;
      }

      const nk = key(nx, ny);
      if (closedSet.has(nk)) continue;

      const ng = current.g + cost;
      const prevG = gScores.get(nk);
      if (prevG !== undefined && ng >= prevG) continue;

      gScores.set(nk, ng);
      const h = heuristic(nx, ny);
      openSet.push({ x: nx, y: ny, g: ng, h, f: ng + h, parent: current });
    }
  }

  return { path: [], found: false };
}

/** Simplify path by removing collinear points */
function simplifyPath(path: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  if (path.length <= 2) return path;

  const result = [path[0]];
  let prevDx = path[1].x - path[0].x;
  let prevDy = path[1].y - path[0].y;

  for (let i = 2; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x;
    const dy = path[i].y - path[i - 1].y;
    if (dx !== prevDx || dy !== prevDy) {
      result.push(path[i - 1]);
      prevDx = dx;
      prevDy = dy;
    }
  }
  result.push(path[path.length - 1]);
  return result;
}

/** Find nearest walkable tile to (x, y) */
function findNearestWalkable(
  tiles: Tile[][],
  x: number,
  y: number,
  mapW: number,
  mapH: number
): { x: number; y: number } | null {
  for (let r = 1; r < 20; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (isWalkable(tiles, nx, ny, mapW, mapH)) return { x: nx, y: ny };
      }
    }
  }
  return null;
}

/** Convert pixel position to tile position */
export function pixelToTile(px: number, py: number): { tx: number; ty: number } {
  return {
    tx: Math.floor(px / TILE_SIZE),
    ty: Math.floor(py / TILE_SIZE)
  };
}

/** Convert tile position to pixel position (center of tile) */
export function tileToPixel(tx: number, ty: number): { px: number; py: number } {
  return {
    px: tx * TILE_SIZE + TILE_SIZE / 2,
    py: ty * TILE_SIZE + TILE_SIZE / 2
  };
}
