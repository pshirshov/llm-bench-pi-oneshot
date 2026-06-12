// A* pathfinding on the tile grid. 8-directional with no corner cutting through
// blocked diagonals. Returns the next-step tile sequence from (sx,sy) to (gx,gy)
// inclusive, or null when the goal is unreachable.
//
// isWalkable(x,y) is the only terrain predicate; the caller supplies it
// (typically derived from map + building footprints + units).

import { SIM_CONSTANTS } from "./stats.js";
import { TILE, isWalkableTile } from "./tiles.js";
import { GameMap } from "./map.js";

export const SQRT2 = Math.SQRT2;

export interface PathOptions {
  /** Treat this tile as blocked even if map says walkable. */
  blocked?: Uint8Array;
  /** Max search steps before giving up (returns null). */
  maxSteps?: number;
}

/** Distance heuristic: octile distance. */
function heuristic(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
}

/** Build a Uint8Array sized to map where each cell is 1 if blocked. */
export function buildBlockedMap(map: GameMap): Uint8Array {
  const arr = new Uint8Array(map.width * map.height);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!isWalkableTile(map.get(x, y))) {
        arr[y * map.width + x] = 1;
      }
    }
  }
  return arr;
}

const DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

/** Find an A* path from (sx,sy) to (gx,gy). Returns array of [x,y] starting
 *  with the first step (not the start tile), or null if unreachable. */
export function findPath(
  map: GameMap,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
  opts: PathOptions = {},
): Array<[number, number]> | null {
  if (!map.inBounds(sx, sy) || !map.inBounds(gx, gy)) return null;
  const blocked = opts.blocked ?? buildBlockedMap(map);
  // Start / goal walkable: if not walkable, treat goal tile as reachable if
  // adjacent walkable (C4 handles "unreachable destination"). The caller
  // should pass a "near" target. Here we just check the goal is in-bounds and
  // allow blocked goal so the path can end at the goal.
  if (blocked[sy * map.width + sx] === 1) return null;
  const w = map.width;
  const h = map.height;
  const maxSteps = opts.maxSteps ?? SIM_CONSTANTS.maxPathfindSteps;

  // Treat goal as walkable for search purposes even if blocked: we want the
  // closest reachable tile if the actual goal is unwalkable.
  const goalBlocked = blocked[gy * w + gx] === 1;

  const N = w * h;
  const gScore = new Float32Array(N).fill(Infinity);
  const cameFrom = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  gScore[sy * w + sx] = 0;

  // Min-heap by f = g + h.
  const heap: Array<[number, number]> = [];
  heap.push([heuristic(sx, sy, gx, gy), sy * w + sx]);
  let steps = 0;
  while (heap.length > 0) {
    // Pop smallest.
    let bestI = 0;
    let best = heap[0] as [number, number];
    for (let i = 1; i < heap.length; i++) {
      const h = heap[i] as [number, number];
      if (h[0] < best[0]) {
        best = h;
        bestI = i;
      }
    }
    heap.splice(bestI, 1);
    const [, ci] = best;
    if (closed[ci] === 1) continue;
    closed[ci] = 1;
    const cx = ci % w;
    const cy = Math.floor(ci / w);
    if (cx === gx && cy === gy) {
      return reconstruct(cameFrom, ci, w);
    }
    steps++;
    if (steps > maxSteps) return null;
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (closed[ni] === 1) continue;
      // Don't allow going through blocked goal unless we ARE the goal.
      const isGoal = nx === gx && ny === gy;
      if (blocked[ni] === 1 && !(isGoal && goalBlocked)) continue;
      // No corner cutting: if diagonal, both axial neighbors must be free.
      if (dx !== 0 && dy !== 0) {
        if (blocked[cy * w + nx] === 1 || blocked[ny * w + cx] === 1) continue;
      }
      const tentative = (gScore[ci] as number) + cost;
      if (tentative < (gScore[ni] as number)) {
        gScore[ni] = tentative;
        cameFrom[ni] = ci;
        heap.push([tentative + heuristic(nx, ny, gx, gy), ni]);
      }
    }
  }
  return null;
}

function reconstruct(cameFrom: Int32Array, endIdx: number, w: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let cur = endIdx;
  while (cur !== -1) {
    const x = cur % w;
    const y = Math.floor(cur / w);
    out.push([x, y]);
    cur = cameFrom[cur] as number;
  }
  out.reverse();
  // Drop the start tile.
  out.shift();
  return out;
}

/** 8-direction land path length, ignoring units/buildings (terrain only). */
export function landPathLength(
  map: GameMap,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
): number {
  const path = findPath(map, sx, sy, gx, gy);
  if (path === null) return Infinity;
  let total = 0;
  let cx = sx;
  let cy = sy;
  for (const [x, y] of path) {
    const dx = x - cx;
    const dy = y - cy;
    if (dx === 0 || dy === 0) total += 1;
    else total += SQRT2;
    cx = x;
    cy = y;
  }
  return total;
}

/** Octile distance between two tiles. */
export function octile(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
}

void TILE;
