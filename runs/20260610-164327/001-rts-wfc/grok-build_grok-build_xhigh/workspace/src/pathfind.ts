import type { Point } from './types';
import { TILE_WALKABLE } from './data';

export type Grid = boolean[][]; // true = walkable

export function buildWalkGrid(tiles: string[][], w: number, h: number): Grid {
  const grid: boolean[][] = [];
  for (let y = 0; y < h; y++) {
    grid[y] = [];
    for (let x = 0; x < w; x++) {
      grid[y][x] = TILE_WALKABLE[tiles[y][x] as keyof typeof TILE_WALKABLE] ?? false;
    }
  }
  return grid;
}

interface Node {
  x: number; y: number;
  g: number; h: number; f: number;
  parent: Node | null;
}

function heuristic(a: Point, b: Point): number {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); // octile
}

function inBounds(x: number, y: number, w: number, h: number): boolean {
  return x >= 0 && y >= 0 && x < w && y < h;
}

function isWalkable(grid: Grid, x: number, y: number): boolean {
  return grid[y] ? grid[y][x] : false;
}

// 8 directions. Prevent corner cutting: diagonal only if both cardinal neighbors are walkable.
const DIRS8 = [
  [-1, -1], [-1, 0], [-1, 1],
  [ 0, -1],           [ 0, 1],
  [ 1, -1], [ 1, 0], [ 1, 1]
];

export function findPath(
  grid: Grid,
  start: Point,
  goal: Point,
  w: number,
  h: number
): Point[] | null {
  if (!inBounds(Math.floor(start.x), Math.floor(start.y), w, h) ||
      !inBounds(Math.floor(goal.x), Math.floor(goal.y), w, h)) return null;

  const sx = Math.floor(start.x), sy = Math.floor(start.y);
  const gx = Math.floor(goal.x), gy = Math.floor(goal.y);

  if (!isWalkable(grid, sx, sy) || !isWalkable(grid, gx, gy)) return null;
  if (sx === gx && sy === gy) return [{ x: gx + 0.5, y: gy + 0.5 }];

  const open: Node[] = [];
  const closed = new Set<string>();
  const cameFrom = new Map<string, {x:number,y:number}>();
  const gScore = new Map<string, number>();
  const fScore = new Map<string, number>();

  const key = (x: number, y: number) => `${x},${y}`;

  const startNode: Node = { x: sx, y: sy, g: 0, h: heuristic({x:sx,y:sy}, {x:gx,y:gy}), f: 0, parent: null };
  startNode.f = startNode.h;
  open.push(startNode);
  gScore.set(key(sx,sy), 0);
  fScore.set(key(sx,sy), startNode.f);

  while (open.length > 0) {
    // lowest f
    open.sort((a, b) => a.f - b.f || a.h - b.h);
    const curr = open.shift()!;
    const ck = key(curr.x, curr.y);

    if (curr.x === gx && curr.y === gy) {
      // reconstruct
      const path: Point[] = [];
      let at = { x: curr.x, y: curr.y };
      while (true) {
        path.unshift({ x: at.x + 0.5, y: at.y + 0.5 });
        const prev = cameFrom.get(key(at.x, at.y));
        if (!prev) break;
        at = prev;
      }
      return path.length > 1 ? path : null;
    }

    closed.add(ck);

    for (const [dx, dy] of DIRS8) {
      const nx = curr.x + dx;
      const ny = curr.y + dy;
      if (!inBounds(nx, ny, w, h)) continue;
      if (!isWalkable(grid, nx, ny)) continue;

      // corner cutting check
      if (dx !== 0 && dy !== 0) {
        if (!isWalkable(grid, curr.x + dx, curr.y) || !isWalkable(grid, curr.x, curr.y + dy)) {
          continue;
        }
      }

      const nkey = key(nx, ny);
      if (closed.has(nkey)) continue;

      const tentativeG = curr.g + Math.hypot(dx, dy);

      const existingG = gScore.get(nkey);
      if (existingG === undefined || tentativeG < existingG) {
        gScore.set(nkey, tentativeG);
        const nh = heuristic({x:nx,y:ny}, {x:gx,y:gy});
        const nf = tentativeG + nh;
        fScore.set(nkey, nf);

        cameFrom.set(nkey, { x: curr.x, y: curr.y });

        const neighbor: Node = { x: nx, y: ny, g: tentativeG, h: nh, f: nf, parent: curr };
        // remove old if present
        const idx = open.findIndex(n => n.x === nx && n.y === ny);
        if (idx !== -1) open.splice(idx, 1);
        open.push(neighbor);
      }
    }
  }
  return null;
}

// Smooth / shorten path slightly for units
export function smoothPath(path: Point[], grid: Grid, w: number, h: number): Point[] {
  if (path.length <= 2) return path;
  const out = [path[0]];
  let i = 0;
  while (i < path.length - 1) {
    let j = i + 1;
    for (let k = path.length - 1; k > i; k--) {
      const a = path[i], b = path[k];
      // Check direct line walkable (coarse)
      let clear = true;
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 1.5);
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        const cx = a.x + (b.x - a.x) * t;
        const cy = a.y + (b.y - a.y) * t;
        const tx = Math.floor(cx), ty = Math.floor(cy);
        if (!inBounds(tx, ty, w, h) || !isWalkable(grid, tx, ty)) { clear = false; break; }
      }
      if (clear) { j = k; break; }
    }
    out.push(path[j]);
    i = j;
  }
  return out;
}
