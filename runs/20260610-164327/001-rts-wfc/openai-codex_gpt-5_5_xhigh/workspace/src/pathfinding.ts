import type { GameMap, Point } from './types';
import { tileBlocksMovement } from './data';

export interface Grid {
  width: number;
  height: number;
  isPassable(x: number, y: number): boolean;
}

interface OpenNode {
  index: number;
  f: number;
}

const DIRECTIONS: readonly Point[] = [
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: 1, y: 1 },
];

export function gridFromMap(map: GameMap, extraBlocked: ReadonlySet<number>): Grid {
  return {
    width: map.width,
    height: map.height,
    isPassable(x: number, y: number): boolean {
      if (!inBounds(x, y, map.width, map.height)) {
        return false;
      }
      const index = indexOf(x, y, map.width);
      return !tileBlocksMovement(map.tiles[index]!) && !extraBlocked.has(index);
    },
  };
}

export function findPath(grid: Grid, start: Point, goal: Point): Point[] {
  const sx = Math.floor(start.x);
  const sy = Math.floor(start.y);
  const gx = Math.floor(goal.x);
  const gy = Math.floor(goal.y);
  if (!inBounds(sx, sy, grid.width, grid.height) || !inBounds(gx, gy, grid.width, grid.height)) {
    return [];
  }
  if (!grid.isPassable(sx, sy) || !grid.isPassable(gx, gy)) {
    return [];
  }

  const startIndex = indexOf(sx, sy, grid.width);
  const goalIndex = indexOf(gx, gy, grid.width);
  const size = grid.width * grid.height;
  const cameFrom = new Int32Array(size);
  cameFrom.fill(-1);
  const gScore = new Float64Array(size);
  gScore.fill(Number.POSITIVE_INFINITY);
  gScore[startIndex] = 0;
  const closed = new Uint8Array(size);
  const open: OpenNode[] = [{ index: startIndex, f: heuristic(sx, sy, gx, gy) }];

  while (open.length > 0) {
    const current = popLowest(open);
    if (closed[current] === 1) {
      continue;
    }
    if (current === goalIndex) {
      return reconstruct(cameFrom, current, grid.width);
    }
    closed[current] = 1;
    const cx = current % grid.width;
    const cy = Math.floor(current / grid.width);
    for (const direction of DIRECTIONS) {
      const nx = cx + direction.x;
      const ny = cy + direction.y;
      if (!canStep(grid, cx, cy, nx, ny)) {
        continue;
      }
      const neighbor = indexOf(nx, ny, grid.width);
      if (closed[neighbor] === 1) {
        continue;
      }
      const stepCost = direction.x !== 0 && direction.y !== 0 ? Math.SQRT2 : 1;
      const tentative = gScore[current]! + stepCost;
      if (tentative < gScore[neighbor]!) {
        cameFrom[neighbor] = current;
        gScore[neighbor] = tentative;
        open.push({ index: neighbor, f: tentative + heuristic(nx, ny, gx, gy) });
      }
    }
  }
  return [];
}

export function pathDistance(path: readonly Point[]): number {
  if (path.length <= 1) {
    return 0;
  }
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    const previous = path[i - 1]!;
    const current = path[i]!;
    const dx = Math.abs(current.x - previous.x);
    const dy = Math.abs(current.y - previous.y);
    total += dx === 1 && dy === 1 ? Math.SQRT2 : 1;
  }
  return total;
}

export function findNearestPassable(grid: Grid, target: Point, maxRadius: number): Point | null {
  const tx = Math.floor(target.x);
  const ty = Math.floor(target.y);
  if (inBounds(tx, ty, grid.width, grid.height) && grid.isPassable(tx, ty)) {
    return { x: tx, y: ty };
  }
  for (let radius = 1; radius <= maxRadius; radius += 1) {
    for (let y = ty - radius; y <= ty + radius; y += 1) {
      for (let x = tx - radius; x <= tx + radius; x += 1) {
        if (Math.abs(x - tx) !== radius && Math.abs(y - ty) !== radius) {
          continue;
        }
        if (inBounds(x, y, grid.width, grid.height) && grid.isPassable(x, y)) {
          return { x, y };
        }
      }
    }
  }
  return null;
}

function canStep(grid: Grid, fromX: number, fromY: number, toX: number, toY: number): boolean {
  if (!inBounds(toX, toY, grid.width, grid.height) || !grid.isPassable(toX, toY)) {
    return false;
  }
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (dx !== 0 && dy !== 0) {
    return grid.isPassable(fromX + dx, fromY) && grid.isPassable(fromX, fromY + dy);
  }
  return true;
}

function reconstruct(cameFrom: Int32Array, currentIndex: number, width: number): Point[] {
  const reversed: Point[] = [];
  let current = currentIndex;
  while (current !== -1) {
    reversed.push({ x: current % width, y: Math.floor(current / width) });
    current = cameFrom[current]!;
  }
  return reversed.reverse();
}

function popLowest(open: OpenNode[]): number {
  let bestIndex = 0;
  let bestF = open[0]!.f;
  for (let i = 1; i < open.length; i += 1) {
    if (open[i]!.f < bestF) {
      bestF = open[i]!.f;
      bestIndex = i;
    }
  }
  const [node] = open.splice(bestIndex, 1);
  if (node === undefined) {
    throw new Error('open list unexpectedly empty');
  }
  return node.index;
}

function heuristic(x: number, y: number, gx: number, gy: number): number {
  const dx = Math.abs(gx - x);
  const dy = Math.abs(gy - y);
  const diagonal = Math.min(dx, dy);
  const straight = Math.max(dx, dy) - diagonal;
  return diagonal * Math.SQRT2 + straight;
}

function inBounds(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && y >= 0 && x < width && y < height;
}

export function indexOf(x: number, y: number, width: number): number {
  return y * width + x;
}
