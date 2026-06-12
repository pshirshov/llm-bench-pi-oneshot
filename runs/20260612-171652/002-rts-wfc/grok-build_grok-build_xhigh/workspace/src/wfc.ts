/**
 * Core Wave Function Collapse implementation.
 * Pure, deterministic given PRNG.
 * Extracted to keep mapgen.ts under line limit.
 */

import type { PRNG } from './prng';
import type { TileType } from './constants';
import { array2d } from './utils';

export type Tile = TileType;

const BASE_TILES = ['grass', 'dirt', 'forest', 'water', 'rock', 'goldMine'] as const;

export const TILE_WEIGHTS: Record<Tile, number> = {
  grass: 35,
  dirt: 20,
  forest: 18,
  water: 8,
  rock: 7,
  goldMine: 1.5,
  goldDepleted: 0,
  forestDepleted: 0,
};

export const ADJACENCY: Record<Tile, readonly Tile[]> = {
  grass: ['grass', 'dirt', 'forest', 'goldMine', 'goldDepleted'],
  dirt: ['grass', 'dirt', 'forest', 'water', 'rock', 'goldMine', 'goldDepleted'],
  forest: ['grass', 'dirt', 'forest', 'forestDepleted'],
  water: ['water', 'dirt'],
  rock: ['rock', 'dirt', 'grass'],
  goldMine: ['grass', 'dirt', 'goldDepleted'],
  goldDepleted: ['grass', 'dirt', 'goldMine'],
  forestDepleted: ['grass', 'dirt', 'forest'],
};

export function getAllowedNeighbors(tile: Tile): readonly Tile[] {
  return ADJACENCY[tile] ?? BASE_TILES;
}

interface Cell {
  possible: Set<Tile>;
  collapsed?: Tile;
}

function createCells(w: number, h: number): Cell[][] {
  const cells: Cell[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Cell[] = [];
    for (let x = 0; x < w; x++) {
      row.push({ possible: new Set(BASE_TILES) });
    }
    cells.push(row);
  }
  return cells;
}

function countEntropy(cell: Cell): number {
  return cell.possible.size;
}

export function getLowestEntropy(cells: Cell[][], prng: PRNG): { x: number; y: number } | null {
  let minEnt = Infinity;
  let candidates: { x: number; y: number }[] = [];
  for (let y = 0; y < cells.length; y++) {
    for (let x = 0; x < cells[0].length; x++) {
      const c = cells[y][x];
      if (c.collapsed) continue;
      const e = countEntropy(c);
      if (e < minEnt && e > 0) {
        minEnt = e;
        candidates = [{ x, y }];
      } else if (e === minEnt) {
        candidates.push({ x, y });
      }
    }
  }
  if (candidates.length === 0) return null;
  return candidates[prng.nextInt(candidates.length)];
}

export function propagate(cells: Cell[][], x: number, y: number, w: number, h: number): boolean {
  const stack: Array<{ x: number; y: number }> = [{ x, y }];
  const visited = new Set<string>();

  while (stack.length > 0) {
    const curr = stack.pop();
    if (!curr) continue;
    const key = `${curr.x},${curr.y}`;
    if (visited.has(key)) continue;
    visited.add(key);

    const cell = cells[curr.y][curr.x];
    if (!cell.collapsed && cell.possible.size === 0) return false;

    const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
    for (const [dx, dy] of dirs) {
      const nx = curr.x + dx;
      const ny = curr.y + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;

      const ncell = cells[ny][nx];
      if (ncell.collapsed) continue;

      const allowed = cell.collapsed
        ? getAllowedNeighbors(cell.collapsed)
        : [...cell.possible].flatMap(t => getAllowedNeighbors(t));

      const newPoss = new Set<Tile>();
      for (const p of ncell.possible) {
        if (allowed.includes(p)) newPoss.add(p);
      }

      if (newPoss.size < ncell.possible.size) {
        ncell.possible = newPoss;
        if (newPoss.size === 0) return false;
        stack.push({ x: nx, y: ny });
      }
    }
  }
  return true;
}

function collapseCell(cell: Cell, prng: PRNG): Tile {
  const opts = Array.from(cell.possible);
  if (opts.length === 0) return 'grass';
  const weights = opts.map(t => TILE_WEIGHTS[t] ?? 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = prng.next() * total;
  for (let i = 0; i < opts.length; i++) {
    r -= weights[i];
    if (r <= 0) return opts[i];
  }
  return opts[opts.length - 1];
}

export function runCollapse(cells: Cell[][], prng: PRNG, w: number, h: number): boolean {
  // Seed a few cells deterministically
  for (let i = 0; i < Math.min(4, Math.floor(w * h * 0.025)); i++) {
    const sx = prng.nextInt(w);
    const sy = prng.nextInt(h);
    const cell = cells[sy][sx];
    if (!cell.collapsed) {
      const pick = collapseCell(cell, prng);
      cell.collapsed = pick;
      cell.possible = new Set([pick]);
      if (!propagate(cells, sx, sy, w, h)) return false;
    }
  }

  while (true) {
    const next = getLowestEntropy(cells, prng);
    if (!next) break;
    const { x, y } = next;
    const cell = cells[y][x];
    const pick = collapseCell(cell, prng);
    cell.collapsed = pick;
    cell.possible = new Set([pick]);
    if (!propagate(cells, x, y, w, h)) return false;
  }
  return true;
}

export function cellsToTiles(cells: Cell[][]): TileType[][] {
  const h = cells.length;
  const w = cells[0].length;
  const tiles: TileType[][] = array2d(w, h, 'grass' as TileType);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = cells[y][x];
      tiles[y][x] = c.collapsed ?? 'grass';
    }
  }
  return tiles;
}

export function createAndCollapse(w: number, h: number, prng: PRNG): TileType[][] | null {
  const cells = createCells(w, h);
  const ok = runCollapse(cells, prng, w, h);
  if (!ok) return null;
  return cellsToTiles(cells);
}

export function validateAdjacencies(tiles: TileType[][], width: number, height: number): boolean {
  const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = tiles[y][x];
      const allowed = getAllowedNeighbors(t);
      for (const [dx, dy] of dirs) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const nt = tiles[ny][nx];
        if (!allowed.includes(nt) && nt !== t) {
          if ((t === 'goldMine' && nt === 'goldDepleted') || (t === 'forest' && nt === 'forestDepleted')) continue;
          return false;
        }
      }
    }
  }
  return true;
}
