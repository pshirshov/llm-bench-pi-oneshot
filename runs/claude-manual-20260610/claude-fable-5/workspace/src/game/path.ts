/**
 * A* on the tile grid. 8-directional; a diagonal step is allowed only when
 * both adjacent orthogonal tiles are open (no corner cutting). Operates on a
 * blocking grid (1 = blocked) of the given dimensions.
 */

export interface PathGrid {
  width: number;
  height: number;
  blocked: Uint8Array;
}

const SQRT2 = Math.SQRT2;

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, val: number): void {
    const keys = this.keys;
    const vals = this.vals;
    keys.push(key);
    vals.push(val);
    let i = keys.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= keys[i]) break;
      [keys[p], keys[i]] = [keys[i], keys[p]];
      [vals[p], vals[i]] = [vals[i], vals[p]];
      i = p;
    }
  }

  pop(): number {
    const keys = this.keys;
    const vals = this.vals;
    const top = vals[0];
    const lastKey = keys.pop()!;
    const lastVal = vals.pop()!;
    if (keys.length > 0) {
      keys[0] = lastKey;
      vals[0] = lastVal;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < keys.length && keys[l] < keys[m]) m = l;
        if (r < keys.length && keys[r] < keys[m]) m = r;
        if (m === i) break;
        [keys[m], keys[i]] = [keys[i], keys[m]];
        [vals[m], vals[i]] = [vals[i], vals[m]];
        i = m;
      }
    }
    return top;
  }
}

function octile(dx: number, dy: number): number {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  return ax > ay ? ax + (SQRT2 - 1) * ay : ay + (SQRT2 - 1) * ax;
}

export interface PathResult {
  /** Tile indices from start (exclusive) to goal (inclusive). */
  path: number[];
  cost: number;
}

/**
 * Find a shortest path between tile indices. Returns null when unreachable.
 * If `approach` is true and the goal itself is blocked, paths to the nearest
 * reachable tile adjacent to the goal instead (used for harvest/build/attack
 * orders that target blocked tiles).
 */
export function findPath(
  grid: PathGrid,
  start: number,
  goal: number,
  approach = false,
): PathResult | null {
  const { width: w, height: h, blocked } = grid;
  const n = w * h;
  if (start < 0 || start >= n || goal < 0 || goal >= n) return null;
  // A blocked start tile is tolerated: a unit that somehow ended up inside
  // an obstacle (e.g. shoved during construction) must be able to walk out.

  const goalBlocked = blocked[goal] === 1;
  if (goalBlocked && !approach) return null;

  const gx = goal % w;
  const gy = (goal / w) | 0;

  const gScore = new Float64Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const open = new MinHeap();

  gScore[start] = 0;
  open.push(octile(gx - (start % w), gy - ((start / w) | 0)), start);

  // For approach mode: track the closed node closest to the goal.
  let bestApproach = -1;
  let bestApproachDist = Infinity;

  while (open.size > 0) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;

    const cx = cur % w;
    const cy = (cur / w) | 0;

    if (cur === goal) break;
    const dGoal = octile(gx - cx, gy - cy);
    if (goalBlocked && dGoal < 1.5) {
      // Adjacent to the blocked goal: good enough.
      bestApproach = cur;
      break;
    }
    if (dGoal < bestApproachDist) {
      bestApproachDist = dGoal;
      bestApproach = cur;
    }

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (blocked[ni] || closed[ni]) continue;
        if (dx !== 0 && dy !== 0) {
          // No corner cutting: both orthogonal neighbours must be open.
          if (blocked[cy * w + nx] || blocked[ny * w + cx]) continue;
        }
        const step = dx !== 0 && dy !== 0 ? SQRT2 : 1;
        const ng = gScore[cur] + step;
        if (ng < gScore[ni]) {
          gScore[ni] = ng;
          parent[ni] = cur;
          open.push(ng + octile(gx - nx, gy - ny), ni);
        }
      }
    }
  }

  let end = -1;
  if (closed[goal]) end = goal;
  else if (approach && bestApproach >= 0) end = bestApproach;
  if (end < 0 || (end === start && start !== goal && !approach)) return null;

  const path: number[] = [];
  let cur = end;
  while (cur !== start && cur >= 0) {
    path.push(cur);
    cur = parent[cur];
  }
  path.reverse();
  return { path, cost: gScore[end] };
}
