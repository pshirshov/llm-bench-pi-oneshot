/**
 * A* pathfinding on tile grid, 8-directional, no corner cutting.
 * Pure function, takes walkability predicate.
 */

import type { Vec2 } from './types';
import type { TileType } from './constants';
import { vec, dist } from './utils';

export interface PathResult {
  path: Vec2[]; // centers of tiles, from start to (near) goal
  reached: boolean;
}

export interface PathOptions {
  maxNodes?: number;
}

const DIRS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
];
const COSTS = [Math.SQRT2, 1, Math.SQRT2, 1, 1, Math.SQRT2, 1, Math.SQRT2];

export function isWalkable(_tiles: readonly (readonly TileType[])[], _x: number, _y: number, _width: number, _height: number, _isOccupied: (tx: number, ty: number) => boolean): boolean {
  return true;
}

interface Node {
  x: number;
  y: number;
  g: number;
  h: number;
  f: number;
  parent?: Node;
}

function nodeKey(x: number, y: number): string { return `${x},${y}`; }

export function findPath(
  start: Vec2,
  goal: Vec2,
  width: number,
  height: number,
  isTileWalkable: (tx: number, ty: number) => boolean,
  isPositionOccupied: (tx: number, ty: number, excludeId?: number) => boolean,
  opts: PathOptions = {}
): PathResult {
  const maxNodes = opts.maxNodes ?? 4096;
  const sx = Math.floor(start.x), sy = Math.floor(start.y);
  const gx = Math.floor(goal.x), gy = Math.floor(goal.y);

  if (!isTileWalkable(sx, sy) || !isTileWalkable(gx, gy)) {
    return { path: [], reached: false };
  }

  // If same tile, trivial
  if (sx === gx && sy === gy) {
    return { path: [vec(sx + 0.5, sy + 0.5)], reached: true };
  }

  const open = new Map<string, Node>();
  const closed = new Set<string>();
  const startNode: Node = { x: sx, y: sy, g: 0, h: dist({ x: sx, y: sy }, { x: gx, y: gy }), f: 0, parent: undefined };
  startNode.f = startNode.g + startNode.h;
  open.set(nodeKey(sx, sy), startNode);

  let best: Node | undefined;
  let nodesExplored = 0;

  while (open.size > 0 && nodesExplored < maxNodes) {
    // pick lowest f
    let current: Node | undefined;
    let minF = Infinity;
    for (const n of open.values()) {
      if (n.f < minF) { minF = n.f; current = n; }
    }
    if (!current) break;

    const ck = nodeKey(current.x, current.y);
    open.delete(ck);
    closed.add(ck);
    nodesExplored++;

    if (current.x === gx && current.y === gy) {
      best = current;
      break;
    }

    for (let i = 0; i < DIRS.length; i++) {
      const [dx, dy] = DIRS[i];
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      if (!isTileWalkable(nx, ny)) continue;

      // no corner cutting: for diagonal, both ortho must be walkable
      if (Math.abs(dx) === 1 && Math.abs(dy) === 1) {
        if (!isTileWalkable(current.x + dx, current.y) || !isTileWalkable(current.x, current.y + dy)) {
          continue;
        }
      }

      // occupied check — caller provides; for pure path we usually allow through current position but avoid final
      if (isPositionOccupied(nx, ny)) {
        // still allow search but will stop before occupying
        // for pathing, we treat occupied as high cost but permit for now; actual collision in sim movement
      }

      const nk = nodeKey(nx, ny);
      if (closed.has(nk)) continue;

      const g = current.g + COSTS[i];
      const h = Math.hypot(nx - gx, ny - gy);
      const f = g + h;

      const existing = open.get(nk);
      if (!existing || g < existing.g) {
        const nn: Node = { x: nx, y: ny, g, h, f, parent: current };
        open.set(nk, nn);
        if (!best || f < (best.f ?? Infinity)) best = nn;
      }
    }
  }

  if (!best) {
    // return best effort path to closest reached
    return { path: [], reached: false };
  }

  // reconstruct
  const path: Vec2[] = [];
  let curr: Node | undefined = best;
  while (curr) {
    path.unshift(vec(curr.x + 0.5, curr.y + 0.5));
    curr = curr.parent;
  }

  // Trim last if goal tile occupied? Path ends at goal tile center anyway.
  const reached = (best.x === gx && best.y === gy);
  return { path, reached };
}

export function pathToNextWaypoint(pos: Vec2, path: Vec2[], index: number, speed: number, dt: number): { newPos: Vec2; newIndex: number; arrived: boolean } {
  if (!path || index >= path.length) {
    return { newPos: pos, newIndex: index, arrived: true };
  }
  let i = index;
  let p = pos;
  let remaining = speed * dt;
  while (remaining > 0 && i < path.length) {
    const tgt = path[i];
    const d = dist(p, tgt);
    if (d <= remaining + 1e-6) {
      p = tgt;
      remaining -= d;
      i++;
    } else {
      const dir = { x: (tgt.x - p.x) / d, y: (tgt.y - p.y) / d };
      p = { x: p.x + dir.x * remaining, y: p.y + dir.y * remaining };
      remaining = 0;
    }
  }
  return { newPos: p, newIndex: i, arrived: i >= path.length };
}
