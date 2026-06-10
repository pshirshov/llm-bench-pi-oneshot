// ─── A* pathfinding on the tile grid ───
// 8-directional, no corner cutting through blocked diagonals.

import { GameMap, Vec2 } from './types';
import { WALKABLE_TILES } from './constants';

interface Node {
  x: number;
  y: number;
  g: number; // cost from start
  h: number; // heuristic to goal
  f: number; // g + h
  parent: Node | null;
}

const SQRT2 = Math.SQRT2;

// 8-directional offsets: [dx, dy, cost]
const NEIGHBORS: [number, number, number][] = [
  [0, -1, 1],   // N
  [1, 0, 1],    // E
  [0, 1, 1],    // S
  [-1, 0, 1],   // W
  [1, -1, SQRT2], // NE
  [1, 1, SQRT2],  // SE
  [-1, 1, SQRT2],  // SW
  [-1, -1, SQRT2], // NW
];

// Diagonal movement requires both adjacent cardinals to be walkable
// Corner-cut prevention data is embedded in the loop below

export function findPath(
  map: GameMap,
  startX: number,
  startY: number,
  goalX: number,
  goalY: number,
  excludeEntity?: number,
): Vec2[] {
  // Clamp to map bounds
  const sx = Math.max(0, Math.min(map.width - 1, Math.round(startX)));
  const sy = Math.max(0, Math.min(map.height - 1, Math.round(startY)));
  const gx = Math.max(0, Math.min(map.width - 1, Math.round(goalX)));
  const gy = Math.max(0, Math.min(map.height - 1, Math.round(goalY)));

  if (!isWalkable(map, gx, gy, excludeEntity)) {
    // Goal is blocked — find nearest walkable tile to goal
    const nearGoal = findNearestWalkable(map, gx, gy, excludeEntity);
    if (!nearGoal) return [];
    return findPath(map, startX, startY, nearGoal.x, nearGoal.y, excludeEntity);
  }

  if (sx === gx && sy === gy) return [{ x: gx, y: gy }];

  const openSet: Node[] = [];
  const closedSet = new Map<string, Node>();
  const key = (x: number, y: number) => `${x},${y}`;

  const startNode: Node = {
    x: sx, y: sy,
    g: 0,
    h: heuristic(sx, sy, gx, gy),
    f: heuristic(sx, sy, gx, gy),
    parent: null,
  };

  openSet.push(startNode);

  let iterations = 0;
  const maxIterations = map.width * map.height * 2;

  while (openSet.length > 0 && iterations < maxIterations) {
    iterations++;

    // Find node with lowest f
    let bestIdx = 0;
    for (let i = 1; i < openSet.length; i++) {
      if (openSet[i].f < openSet[bestIdx].f ||
        (openSet[i].f === openSet[bestIdx].f && openSet[i].h < openSet[bestIdx].h)) {
        bestIdx = i;
      }
    }

    const current = openSet[bestIdx];
    openSet.splice(bestIdx, 1);

    if (current.x === gx && current.y === gy) {
      // Reconstruct path
      const path: Vec2[] = [];
      let node: Node | null = current;
      while (node) {
        path.unshift({ x: node.x, y: node.y });
        node = node.parent;
      }
      return path;
    }

    closedSet.set(key(current.x, current.y), current);

    // Expand neighbors
    for (let i = 0; i < 8; i++) {
      const [dx, dy, cost] = NEIGHBORS[i];
      const nx = current.x + dx;
      const ny = current.y + dy;

      if (nx < 0 || nx >= map.width || ny < 0 || ny >= map.height) continue;
      if (!isWalkable(map, nx, ny, excludeEntity)) continue;

      // Corner cutting check for diagonals
      if (Math.abs(dx) + Math.abs(dy) === 2) {
        // Find which cardinal check we need
        if (!isWalkable(map, current.x + dx, current.y, excludeEntity) ||
          !isWalkable(map, current.x, current.y + dy, excludeEntity)) {
          continue;
        }
      }

      const nk = key(nx, ny);
      if (closedSet.has(nk)) continue;

      const g = current.g + cost;
      const h = heuristic(nx, ny, gx, gy);
      const f = g + h;

      const existing = openSet.find(n => n.x === nx && n.y === ny);
      if (existing) {
        if (g < existing.g) {
          existing.g = g;
          existing.f = f;
          existing.parent = current;
        }
      } else {
        openSet.push({ x: nx, y: ny, g, h, f, parent: current });
      }
    }
  }

  return []; // No path found
}

function heuristic(x1: number, y1: number, x2: number, y2: number): number {
  // Octile distance (admissible for 8-directional movement)
  const dx = Math.abs(x1 - x2);
  const dy = Math.abs(y1 - y2);
  return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
}

function isWalkable(
  map: GameMap,
  x: number,
  y: number,
  excludeEntity?: number,
): boolean {
  const tile = map.tiles[y][x];
  if (!WALKABLE_TILES.has(tile.type)) return false;
  if (tile.buildingId !== null && tile.buildingId !== excludeEntity) return false;
  return true;
}

function findNearestWalkable(
  map: GameMap,
  cx: number,
  cy: number,
  excludeEntity: number | undefined,
): { x: number; y: number } | null {
  for (let r = 1; r < 20; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= map.width || y < 0 || y >= map.height) continue;
        if (isWalkable(map, x, y, excludeEntity)) {
          return { x, y };
        }
      }
    }
  }
  return null;
}

/** Flood fill to find all tiles reachable from (sx, sy) */
export function floodFill(map: GameMap, sx: number, sy: number): Set<string> {
  const visited = new Set<string>();
  const queue: { x: number; y: number }[] = [{ x: sx, y: sy }];
  visited.add(`${sx},${sy}`);

  while (queue.length > 0) {
    const { x, y } = queue.shift()!;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = x + dx;
      const ny = y + dy;
      const key = `${nx},${ny}`;
      if (visited.has(key)) continue;
      if (nx < 0 || nx >= map.width || ny < 0 || ny >= map.height) continue;
      if (!WALKABLE_TILES.has(map.tiles[ny][nx].type)) continue;
      visited.add(key);
      queue.push({ x: nx, y: ny });
    }
  }

  return visited;
}