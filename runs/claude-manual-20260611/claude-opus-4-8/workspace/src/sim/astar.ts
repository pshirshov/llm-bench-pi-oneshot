/**
 * A* pathfinding on a rectangular tile grid.
 *
 * - 8-directional movement (cardinals + diagonals).
 * - NO corner-cutting: a diagonal step from (x,y) to (x+dx, y+dy) is illegal
 *   if EITHER shared cardinal cell — (x+dx, y) or (x, y+dy) — is blocked.
 *   This prevents a unit from squeezing diagonally between two blockers.
 * - Octile admissible heuristic: cardinal step costs 1, diagonal step costs √2.
 * - Binary min-heap open set for O(log n) push/pop.
 *
 * The solver is decoupled from tile semantics: passability is supplied as an
 * `isBlocked(x, y)` predicate, so callers map terrain / buildings / units onto
 * it however they like. Pure, deterministic function — no DOM, no global RNG.
 */

import type { Vec2 } from "../core/vec.js";

/** √2 — the cost of one diagonal step under the octile metric. */
const DIAGONAL_COST = Math.SQRT2;
/** Cost of one cardinal (axis-aligned) step. */
const CARDINAL_COST = 1;

/** The 8 movement steps, paired with whether the step is diagonal. */
interface Step {
  readonly dx: number;
  readonly dy: number;
  readonly diagonal: boolean;
}

const STEPS: readonly Step[] = [
  { dx: 0, dy: -1, diagonal: false },
  { dx: 1, dy: 0, diagonal: false },
  { dx: 0, dy: 1, diagonal: false },
  { dx: -1, dy: 0, diagonal: false },
  { dx: 1, dy: -1, diagonal: true },
  { dx: 1, dy: 1, diagonal: true },
  { dx: -1, dy: 1, diagonal: true },
  { dx: -1, dy: -1, diagonal: true },
];

export interface AStarOptions {
  /**
   * Maximum number of node expansions (pops from the open set). When the budget
   * is exhausted before the goal is reached, the search returns `null`. Useful
   * to bound per-tick pathfinding cost. Omitted ⇒ unbounded.
   */
  readonly budget?: number;
  /**
   * When true and the goal tile is itself blocked, the search instead targets
   * the cheapest reachable tile ADJACENT (8-connected) to the goal and returns
   * a path ending there. Used for harvesting a mine / attacking a building,
   * where the actor must stand next to — not on — the target.
   */
  readonly stopAdjacent?: boolean;
}

/**
 * Octile distance between two cells: the admissible, consistent heuristic for
 * 8-directional movement with cardinal cost 1 and diagonal cost √2.
 */
export function octileDistance(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  const lo = Math.min(dx, dy);
  const hi = Math.max(dx, dy);
  // `lo` diagonal moves cover the shorter axis, the rest are cardinal.
  return DIAGONAL_COST * lo + CARDINAL_COST * (hi - lo);
}

// ---------------------------------------------------------------------------
// Binary min-heap keyed on f-score, ordered by node index for O(1) lookups.
// ---------------------------------------------------------------------------

/**
 * Binary min-heap of node indices, ordered by an externally supplied f-score
 * array. Stores indices (not objects) so it stays allocation-light; the heap
 * never owns the score, it only reads `fScore[node]` at compare time.
 */
class MinHeap {
  private readonly heap: number[] = [];

  constructor(private readonly fScore: Float64Array) {}

  get size(): number {
    return this.heap.length;
  }

  push(node: number): void {
    const heap = this.heap;
    heap.push(node);
    this.siftUp(heap.length - 1);
  }

  pop(): number {
    const heap = this.heap;
    const top = heap[0];
    const last = heap.pop() as number;
    if (heap.length > 0) {
      heap[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  private siftUp(i: number): void {
    const heap = this.heap;
    const f = this.fScore;
    const node = heap[i];
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (f[heap[parent]] <= f[node]) break;
      heap[i] = heap[parent];
      i = parent;
    }
    heap[i] = node;
  }

  private siftDown(i: number): void {
    const heap = this.heap;
    const f = this.fScore;
    const n = heap.length;
    const node = heap[i];
    for (;;) {
      const left = 2 * i + 1;
      if (left >= n) break;
      const right = left + 1;
      let smallest = left;
      if (right < n && f[heap[right]] < f[heap[left]]) smallest = right;
      if (f[heap[smallest]] >= f[node]) break;
      heap[i] = heap[smallest];
      i = smallest;
    }
    heap[i] = node;
  }
}

/**
 * Compute a shortest 8-directional path from `start` to `goal` over a
 * `width`×`height` grid, honouring the no-corner-cutting rule.
 *
 * @returns
 *  - the path as an array of `Vec2` (from `start` through to the goal tile, or
 *    to an adjacent tile when `stopAdjacent` targets a blocked goal),
 *  - `[]` when `start === goal` (already there),
 *  - `null` when the goal is unreachable, out of bounds, or the expansion
 *    budget is exhausted first.
 */
export function astar(
  width: number,
  height: number,
  isBlocked: (x: number, y: number) => boolean,
  start: Vec2,
  goal: Vec2,
  opts?: AStarOptions,
): Vec2[] | null {
  const budget = opts?.budget ?? Number.POSITIVE_INFINITY;
  const stopAdjacent = opts?.stopAdjacent ?? false;

  const inBounds = (x: number, y: number): boolean => x >= 0 && x < width && y >= 0 && y < height;

  // Start must be on the board and standable.
  if (!inBounds(start.x, start.y) || !inBounds(goal.x, goal.y)) return null;
  if (isBlocked(start.x, start.y)) return null;

  // Already at the goal.
  if (start.x === goal.x && start.y === goal.y) return [];

  // Resolve the set of acceptable destination cells.
  // Normal mode: the goal itself, but only if standable.
  // stopAdjacent mode on a blocked goal: any in-bounds, standable 8-neighbour.
  const goalBlocked = isBlocked(goal.x, goal.y);
  const isGoalCell = (x: number, y: number): boolean => {
    if (stopAdjacent && goalBlocked) {
      // A standable cell that is 8-adjacent to the (blocked) goal.
      const dx = Math.abs(x - goal.x);
      const dy = Math.abs(y - goal.y);
      return dx <= 1 && dy <= 1 && !(dx === 0 && dy === 0);
    }
    return x === goal.x && y === goal.y;
  };

  // If we need to stand ON the goal but it is blocked (and stopAdjacent is off,
  // or the goal isn't blocked at all), the normal target rules apply. A blocked
  // goal with stopAdjacent off is simply unreachable.
  if (!stopAdjacent && goalBlocked) return null;
  // stopAdjacent requested but goal not blocked: behave like a normal search to
  // the goal tile (caller already standable there).

  const size = width * height;
  const idx = (x: number, y: number): number => y * width + x;

  const gScore = new Float64Array(size).fill(Number.POSITIVE_INFINITY);
  const fScore = new Float64Array(size).fill(Number.POSITIVE_INFINITY);
  const cameFrom = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);

  // Heuristic toward the goal point. For stopAdjacent this slightly overshoots
  // (it measures distance to the blocked goal centre, not its ring), which
  // remains admissible because reaching a neighbour is never costlier than
  // reaching the centre.
  const heuristic = (x: number, y: number): number => octileDistance(x, y, goal.x, goal.y);

  const open = new MinHeap(fScore);
  const startIdx = idx(start.x, start.y);
  gScore[startIdx] = 0;
  fScore[startIdx] = heuristic(start.x, start.y);
  open.push(startIdx);

  let expansions = 0;

  while (open.size > 0) {
    const current = open.pop();
    if (closed[current]) continue; // stale heap entry (lazy decrease-key)

    const cx = current % width;
    const cy = (current - cx) / width;

    if (isGoalCell(cx, cy)) {
      return reconstruct(cameFrom, current, width);
    }

    closed[current] = 1;

    expansions++;
    if (expansions >= budget) return null;

    const currentG = gScore[current];

    for (const step of STEPS) {
      const nx = cx + step.dx;
      const ny = cy + step.dy;
      if (!inBounds(nx, ny)) continue;
      if (isBlocked(nx, ny)) continue;

      if (step.diagonal) {
        // No corner-cutting: both shared cardinal cells must be open.
        if (isBlocked(cx + step.dx, cy) || isBlocked(cx, cy + step.dy)) continue;
      }

      const nIdx = idx(nx, ny);
      if (closed[nIdx]) continue;

      const stepCost = step.diagonal ? DIAGONAL_COST : CARDINAL_COST;
      const tentativeG = currentG + stepCost;
      if (tentativeG < gScore[nIdx]) {
        cameFrom[nIdx] = current;
        gScore[nIdx] = tentativeG;
        fScore[nIdx] = tentativeG + heuristic(nx, ny);
        open.push(nIdx); // lazy decrease-key: push a fresh, better entry
      }
    }
  }

  return null;
}

/** Walk the cameFrom chain from the goal node back to the start. */
function reconstruct(cameFrom: Int32Array, goalIdx: number, width: number): Vec2[] {
  const path: Vec2[] = [];
  let node = goalIdx;
  while (node !== -1) {
    const x = node % width;
    const y = (node - x) / width;
    path.push({ x, y });
    node = cameFrom[node];
  }
  path.reverse();
  return path;
}
