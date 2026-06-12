import type { Point } from './types';
import { gridDistance, inBounds, keyOf, samePoint } from './utils';

export interface GridSpec {
  width: number;
  height: number;
  isBlocked(x: number, y: number): boolean;
}

export interface PathResult {
  path: Point[];
  reachable: boolean;
  destination: Point;
  cost: number;
  visited: number;
}

interface NodeRecord {
  point: Point;
  g: number;
  f: number;
}

const neighborDeltas = [
  { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
  { x: -1, y: 0 }, { x: 1, y: 0 },
  { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 }
];

export function findPath(grid: GridSpec, start: Point, goal: Point): PathResult {
  const nearestGoal = nearestUnblocked(grid, goal);
  const target = nearestGoal ?? goal;
  if (grid.isBlocked(start.x, start.y)) {
    return { path: [], reachable: false, destination: start, cost: 0, visited: 0 };
  }
  if (nearestGoal === undefined) {
    return searchToClosest(grid, start, goal);
  }
  return aStar(grid, start, target, goal);
}

export function pathDistance(grid: GridSpec, start: Point, goal: Point): number | undefined {
  const result = findPath(grid, start, goal);
  if (!result.reachable || !samePoint(result.destination, goal)) {
    return undefined;
  }
  return result.cost;
}

function aStar(grid: GridSpec, start: Point, target: Point, desired: Point): PathResult {
  if (samePoint(start, target)) {
    return { path: [], reachable: true, destination: target, cost: 0, visited: 1 };
  }
  const open: NodeRecord[] = [{ point: start, g: 0, f: gridDistance(start, target) }];
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[keyOf(start), 0]]);
  const closed = new Set<string>();
  let best = start;
  let bestDistance = gridDistance(start, desired);
  while (open.length > 0) {
    const current = popLowest(open);
    const currentKey = keyOf(current.point);
    if (closed.has(currentKey)) {
      continue;
    }
    closed.add(currentKey);
    const desiredDistance = gridDistance(current.point, desired);
    if (desiredDistance < bestDistance) {
      best = current.point;
      bestDistance = desiredDistance;
    }
    if (samePoint(current.point, target)) {
      return {
        path: reconstruct(cameFrom, current.point).slice(1),
        reachable: samePoint(target, desired),
        destination: current.point,
        cost: current.g,
        visited: closed.size
      };
    }
    for (const next of validNeighbors(grid, current.point)) {
      const nextKey = keyOf(next);
      if (closed.has(nextKey)) {
        continue;
      }
      const step = next.x !== current.point.x && next.y !== current.point.y ? Math.SQRT2 : 1;
      const tentative = current.g + step;
      const old = gScore.get(nextKey);
      if (old === undefined || tentative < old) {
        cameFrom.set(nextKey, currentKey);
        gScore.set(nextKey, tentative);
        open.push({ point: next, g: tentative, f: tentative + gridDistance(next, target) });
      }
    }
  }
  const path = reconstruct(cameFrom, best).slice(1);
  return { path, reachable: false, destination: best, cost: pathCost(path, start), visited: closed.size };
}

function searchToClosest(grid: GridSpec, start: Point, desired: Point): PathResult {
  return aStar(grid, start, start, desired);
}

function nearestUnblocked(grid: GridSpec, goal: Point): Point | undefined {
  if (inBounds(grid.width, grid.height, goal.x, goal.y) && !grid.isBlocked(goal.x, goal.y)) {
    return goal;
  }
  const maxRadius = Math.max(grid.width, grid.height);
  for (let radius = 1; radius <= maxRadius; radius += 1) {
    let best: Point | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let y = goal.y - radius; y <= goal.y + radius; y += 1) {
      for (let x = goal.x - radius; x <= goal.x + radius; x += 1) {
        if (Math.max(Math.abs(x - goal.x), Math.abs(y - goal.y)) !== radius) {
          continue;
        }
        if (inBounds(grid.width, grid.height, x, y) && !grid.isBlocked(x, y)) {
          const candidate = { x, y };
          const distance = gridDistance(candidate, goal);
          if (distance < bestDistance) {
            best = candidate;
            bestDistance = distance;
          }
        }
      }
    }
    if (best !== undefined) {
      return best;
    }
  }
  return undefined;
}

export function validNeighbors(grid: GridSpec, point: Point): Point[] {
  const result: Point[] = [];
  for (const delta of neighborDeltas) {
    const x = point.x + delta.x;
    const y = point.y + delta.y;
    if (!inBounds(grid.width, grid.height, x, y) || grid.isBlocked(x, y)) {
      continue;
    }
    if (delta.x !== 0 && delta.y !== 0) {
      if (grid.isBlocked(point.x + delta.x, point.y) || grid.isBlocked(point.x, point.y + delta.y)) {
        continue;
      }
    }
    result.push({ x, y });
  }
  return result;
}

function popLowest(open: NodeRecord[]): NodeRecord {
  let bestIndex = 0;
  let bestF = open[0].f;
  for (let i = 1; i < open.length; i += 1) {
    if (open[i].f < bestF) {
      bestIndex = i;
      bestF = open[i].f;
    }
  }
  const [record] = open.splice(bestIndex, 1);
  if (record === undefined) {
    throw new Error('open set underflow');
  }
  return record;
}

function reconstruct(cameFrom: Map<string, string>, end: Point): Point[] {
  const points = [end];
  let cursor = keyOf(end);
  while (cameFrom.has(cursor)) {
    const previous = cameFrom.get(cursor);
    if (previous === undefined) {
      throw new Error('path predecessor missing');
    }
    const parsed = parseKey(previous);
    points.push(parsed);
    cursor = previous;
  }
  return points.reverse();
}

function parseKey(key: string): Point {
  const parts = key.split(',');
  if (parts.length !== 2) {
    throw new Error(`invalid point key ${key}`);
  }
  return { x: Number.parseInt(parts[0], 10), y: Number.parseInt(parts[1], 10) };
}

function pathCost(path: Point[], start: Point): number {
  let total = 0;
  let previous = start;
  for (const point of path) {
    total += point.x !== previous.x && point.y !== previous.y ? Math.SQRT2 : 1;
    previous = point;
  }
  return total;
}
