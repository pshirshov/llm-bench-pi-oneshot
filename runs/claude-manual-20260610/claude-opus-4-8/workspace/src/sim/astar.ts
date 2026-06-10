import type { TileCoord } from "../core/vec.js";

/**
 * A* pathfinding on a tile grid.
 *
 *  - 8-directional movement.
 *  - No corner cutting: a diagonal step (dx,dy) is only allowed when both
 *    orthogonally-adjacent cells (x+dx,y) and (x,y+dy) are passable.
 *  - Octile-distance heuristic (admissible & consistent for these step costs).
 *
 * `isBlocked(x, y)` reports whether a tile cannot be entered. The function is
 * bounded by `maxExpansions` so a pathological query cannot stall the sim.
 */

const SQRT2 = Math.SQRT2;
const DEFAULT_MAX_EXPANSIONS = 20000;

interface MinHeap {
  push(node: number, priority: number): void;
  pop(): number;
  size(): number;
}

function createMinHeap(): MinHeap {
  const nodes: number[] = [];
  const prios: number[] = [];
  const swap = (i: number, j: number): void => {
    const tn = nodes[i]!;
    nodes[i] = nodes[j]!;
    nodes[j] = tn;
    const tp = prios[i]!;
    prios[i] = prios[j]!;
    prios[j] = tp;
  };
  return {
    size: () => nodes.length,
    push(node: number, priority: number): void {
      nodes.push(node);
      prios.push(priority);
      let i = nodes.length - 1;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (prios[parent]! <= prios[i]!) break;
        swap(i, parent);
        i = parent;
      }
    },
    pop(): number {
      const top = nodes[0]!;
      const lastNode = nodes.pop() as number;
      const lastPrio = prios.pop() as number;
      if (nodes.length > 0) {
        nodes[0] = lastNode;
        prios[0] = lastPrio;
        let i = 0;
        const n = nodes.length;
        for (;;) {
          const l = 2 * i + 1;
          const r = 2 * i + 2;
          let smallest = i;
          if (l < n && prios[l]! < prios[smallest]!) smallest = l;
          if (r < n && prios[r]! < prios[smallest]!) smallest = r;
          if (smallest === i) break;
          swap(i, smallest);
          i = smallest;
        }
      }
      return top;
    },
  };
}

function octile(dx: number, dy: number): number {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  return ax > ay ? ax - ay + SQRT2 * ay : ay - ax + SQRT2 * ax;
}

export type BlockedFn = (x: number, y: number) => boolean;

export interface PathOptions {
  /** Stop when a node adjacent (8-dir) to the goal is reached, rather than the goal itself. Used for harvest/build/attack against blocked targets. */
  stopAdjacent?: boolean;
  maxExpansions?: number;
}

const STEPS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

/**
 * Find a path from `start` to `goal`. Returns the list of tile waypoints
 * starting at the first step after `start` and ending at the reached tile
 * (goal, or an adjacent tile when `stopAdjacent`). Returns `null` if no path
 * exists or the expansion budget is exhausted; returns `[]` if already there.
 */
export function findPath(
  width: number,
  height: number,
  isBlocked: BlockedFn,
  start: TileCoord,
  goal: TileCoord,
  options: PathOptions = {},
): TileCoord[] | null {
  const stopAdjacent = options.stopAdjacent ?? false;
  const maxExpansions = options.maxExpansions ?? DEFAULT_MAX_EXPANSIONS;

  const idx = (x: number, y: number): number => y * width + x;
  const inBounds = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height;

  const startIdx = idx(start.tx, start.ty);
  const goalIdx = idx(goal.tx, goal.ty);

  const isGoal = (x: number, y: number): boolean => {
    if (stopAdjacent) {
      const dx = Math.abs(x - goal.tx);
      const dy = Math.abs(y - goal.ty);
      return dx <= 1 && dy <= 1 && !(dx === 0 && dy === 0);
    }
    return x === goal.tx && y === goal.ty;
  };

  if (isGoal(start.tx, start.ty)) return [];
  // When targeting the goal tile itself it must be enterable.
  if (!stopAdjacent && isBlocked(goal.tx, goal.ty)) return null;

  const size = width * height;
  const gScore = new Float64Array(size).fill(Infinity);
  const cameFrom = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  const open = createMinHeap();

  gScore[startIdx] = 0;
  open.push(startIdx, octile(start.tx - goal.tx, start.ty - goal.ty));

  let expansions = 0;
  let reachedIdx = -1;

  while (open.size() > 0) {
    const current = open.pop();
    if (closed[current]) continue;
    closed[current] = 1;
    const cx = current % width;
    const cy = (current / width) | 0;

    if (isGoal(cx, cy)) {
      reachedIdx = current;
      break;
    }

    if (++expansions > maxExpansions) return null;

    for (const [dx, dy, cost] of STEPS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inBounds(nx, ny)) continue;
      if (isBlocked(nx, ny)) continue;
      // No corner cutting through blocked diagonals.
      if (dx !== 0 && dy !== 0) {
        if (isBlocked(cx + dx, cy) || isBlocked(cx, cy + dy)) continue;
      }
      const nIdx = idx(nx, ny);
      if (closed[nIdx]) continue;
      const tentative = gScore[current]! + cost;
      if (tentative < gScore[nIdx]!) {
        gScore[nIdx] = tentative;
        cameFrom[nIdx] = current;
        const h = octile(nx - goal.tx, ny - goal.ty);
        open.push(nIdx, tentative + h);
      }
    }
  }

  if (reachedIdx === -1) return null;

  // Reconstruct.
  const path: TileCoord[] = [];
  let node = reachedIdx;
  while (node !== startIdx && node !== -1) {
    path.push({ tx: node % width, ty: (node / width) | 0 });
    node = cameFrom[node]!;
  }
  path.reverse();
  // Ignore the unused goalIdx reference in stopAdjacent mode.
  void goalIdx;
  return path;
}
