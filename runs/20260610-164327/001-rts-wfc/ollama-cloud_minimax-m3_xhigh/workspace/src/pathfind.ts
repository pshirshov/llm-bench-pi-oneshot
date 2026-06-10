// A* pathfinding on a 2D tile grid, 8-directional.
// - "walkable" predicate encodes which tiles units can pass through.
// - Diagonal moves are allowed but cannot "corner cut" through two blocked
//   diagonals (i.e. both adjacent cardinal tiles must allow movement for the
//   diagonal to be legal).
// - Unreachable handling: returns null.

import { octile } from './math.js';

export interface AStarOptions {
  walkable: (x: number, y: number) => boolean;
}

interface Node {
  x: number;
  y: number;
  g: number;
  f: number;
  parent: Node | null;
}

const DIRS8: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

// Binary min-heap keyed on f (with g as tiebreak). Index 0 unused.
// We use `as Node` reads: the heap is only mutated through `push`/`pop`, and
// between them every slot from 1..len is a real Node. noUncheckedIndexedAccess
// would otherwise pretend otherwise.
class Heap {
  private a: Array<Node | null> = [null, null];
  private len: number = 1;
  push(n: Node): void {
    this.a[this.len] = n;
    let i = this.len;
    this.len++;
    while (i > 1) {
      const p = i >> 1;
      const pa = this.a[p] as Node;
      const ca = this.a[i] as Node;
      if (pa.f < ca.f || (pa.f === ca.f && pa.g <= ca.g)) break;
      this.a[p] = ca;
      this.a[i] = pa;
      i = p;
    }
  }
  pop(): Node | null {
    if (this.len <= 1) return null;
    const top = this.a[1] as Node;
    this.len--;
    if (this.len === 1) {
      this.a[1] = null;
      return top;
    }
    const last = this.a[this.len] as Node;
    this.a[1] = last;
    this.a[this.len] = null;
    let i = 1;
    const n = this.len - 1;
    while (true) {
      const l = i << 1;
      const r = l + 1;
      let smallest = i;
      if (l <= n) {
        const sl = this.a[l] as Node;
        const ss = this.a[smallest] as Node;
        if (sl.f < ss.f || (sl.f === ss.f && sl.g < ss.g)) smallest = l;
      }
      if (r <= n) {
        const sr = this.a[r] as Node;
        const ss = this.a[smallest] as Node;
        if (sr.f < ss.f || (sr.f === ss.f && sr.g < ss.g)) smallest = r;
      }
      if (smallest === i) break;
      const a = this.a[i] as Node;
      const b = this.a[smallest] as Node;
      this.a[i] = b;
      this.a[smallest] = a;
      i = smallest;
    }
    return top;
  }
  get size(): number { return this.len - 1; }
}

export function aStarSearch(grid: { width: number; height: number }, sx: number, sy: number, tx: number, ty: number, opts: AStarOptions): { x: number; y: number }[] | null {
  if (sx === tx && sy === ty) return [{ x: sx, y: sy }];
  if (!opts.walkable(tx, ty) || !opts.walkable(sx, sy)) return null;

  const open = new Heap();
  const bestG = new Float32Array(grid.width * grid.height).fill(Infinity);
  const closed = new Uint8Array(grid.width * grid.height);
  const key = (x: number, y: number): number => y * grid.width + x;
  const start: Node = { x: sx, y: sy, g: 0, f: octile(tx - sx, ty - sy), parent: null };
  open.push(start);
  bestG[key(sx, sy)] = 0;

  while (open.size > 0) {
    const cur = open.pop();
    if (!cur) break;
    const ci = key(cur.x, cur.y);
    if (closed[ci]) continue;
    closed[ci] = 1;
    if (cur.x === tx && cur.y === ty) {
      const path: { x: number; y: number }[] = [];
      let n: Node | null = cur;
      while (n) { path.push({ x: n.x, y: n.y }); n = n.parent; }
      path.reverse();
      return path;
    }
    for (const dir of DIRS8) {
      if (!dir) continue;
      const [dx, dy, cost] = dir;
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
      if (!opts.walkable(nx, ny)) continue;
      // corner-cut guard for diagonal moves
      if (dx !== 0 && dy !== 0) {
        if (!opts.walkable(cur.x + dx, cur.y) || !opts.walkable(cur.x, cur.y + dy)) continue;
      }
      const tentative = cur.g + cost;
      const ni = key(nx, ny);
      const curBest = bestG[ni] ?? Infinity;
      if (tentative >= curBest) continue;
      bestG[ni] = tentative;
      const h = octile(tx - nx, ty - ny);
      open.push({ x: nx, y: ny, g: tentative, f: tentative + h, parent: cur });
    }
  }
  return null;
}

export function pathLengthTiles(path: { x: number; y: number }[]): number {
  if (path.length === 0) return 0;
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as { x: number; y: number };
    const b = path[i] as { x: number; y: number };
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    total += (dx === 1 && dy === 1) ? Math.SQRT2 : 1;
  }
  return total;
}
