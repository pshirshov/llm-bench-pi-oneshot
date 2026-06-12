/**
 * Wave Function Collapse map generator.
 * Minimal-entropy cell selection with adjacency-constraint propagation
 * over a weighted tile set.
 */

import type { PRNG } from '../core/prng';
import type { TileType } from '../core/types';
import { ALL_TILE_TYPES, TILE_DEFS, tilesAdjacentAllowed } from '../core/tiles';
import { createPRNG } from '../core/prng';

interface WFCell {
  options: Set<TileType>;
  collapsed: TileType | null;
  entropy: number;
}

interface WFCGrid {
  width: number;
  height: number;
  cells: WFCell[];
}

function cellIndex(grid: WFCGrid, x: number, y: number): number {
  return y * grid.width + x;
}

function inBounds(grid: WFCGrid, x: number, y: number): boolean {
  return x >= 0 && x < grid.width && y >= 0 && y < grid.height;
}

/** Calculate Shannon entropy approximation from tile weights */
function calcEntropy(options: Set<TileType>): number {
  if (options.size <= 1) return 0;
  let sumW = 0;
  let sumWLogW = 0;
  for (const t of options) {
    const w = TILE_DEFS[t].weight;
    if (w <= 0) continue;
    sumW += w;
    sumWLogW += w * Math.log(w);
  }
  if (sumW <= 0) return 0;
  return Math.log(sumW) - sumWLogW / sumW;
}

/** Initialize the grid with all options open */
function initGrid(width: number, height: number): WFCGrid {
  const cells: WFCell[] = [];
  const initialOptions = new Set<TileType>(
    ALL_TILE_TYPES.filter(t => TILE_DEFS[t].weight > 0),
  );
  for (let i = 0; i < width * height; i++) {
    cells.push({
      options: new Set(initialOptions),
      collapsed: null,
      entropy: calcEntropy(initialOptions),
    });
  }
  return { width, height, cells };
}

/** Cardinal + diagonal neighbor offsets */
const NEIGHBOR_DIRS = [
  { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 },
  { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }, { x: -1, y: -1 },
];

/** Get valid options for neighbor given constraints */
function getValidNeighborOptions(
  selfOptions: Set<TileType>,
  neighborX: number,
  neighborY: number,
  selfX: number,
  selfY: number,
  grid: WFCGrid,
): Set<TileType> {
  const valid = new Set<TileType>();
  const dx = neighborX - selfX;
  const dy = neighborY - selfY;

  for (const neighborType of ALL_TILE_TYPES) {
    if (TILE_DEFS[neighborType].weight <= 0) continue;
    let allowed = false;
    for (const selfType of selfOptions) {
      if (!tilesAdjacentAllowed(selfType, neighborType)) continue;
      if (dx !== 0 && dy !== 0) {
        // Diagonal: check both cardinal intermediates
        const mid1Ok = !inBounds(grid, selfX + dx, selfY) ||
          grid.cells[cellIndex(grid, selfX + dx, selfY)].options.size > 0;
        const mid2Ok = !inBounds(grid, selfX, selfY + dy) ||
          grid.cells[cellIndex(grid, selfX, selfY + dy)].options.size > 0;
        if (mid1Ok || mid2Ok) { allowed = true; break; }
      } else {
        allowed = true;
        break;
      }
    }
    if (allowed) valid.add(neighborType);
  }
  return valid;
}

/** Propagate constraints from a collapsed cell through the grid */
function propagate(grid: WFCGrid, startX: number, startY: number): boolean {
  const stack: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];

  while (stack.length > 0) {
    const { x, y } = stack.pop() as { x: number; y: number };
    const selfCell = grid.cells[cellIndex(grid, x, y)];

    for (const dir of NEIGHBOR_DIRS) {
      const nx = x + dir.x;
      const ny = y + dir.y;
      if (!inBounds(grid, nx, ny)) continue;

      const neighborCell = grid.cells[cellIndex(grid, nx, ny)];
      if (neighborCell.collapsed !== null) continue;

      const validOptions = getValidNeighborOptions(
        selfCell.options, nx, ny, x, y, grid,
      );

      let changed = false;
      for (const opt of neighborCell.options) {
        if (!validOptions.has(opt)) {
          neighborCell.options.delete(opt);
          changed = true;
        }
      }

      if (changed) {
        neighborCell.entropy = calcEntropy(neighborCell.options);
        if (neighborCell.options.size === 0) return false; // contradiction
        stack.push({ x: nx, y: ny });
      }
    }
  }
  return true;
}

/** Pick the uncollapsed cell with minimum entropy */
function pickMinEntropyCell(grid: WFCGrid, rng: PRNG): { x: number; y: number } | null {
  let minEntropy = Infinity;
  let candidates: Array<{ x: number; y: number }> = [];

  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const cell = grid.cells[cellIndex(grid, x, y)];
      if (cell.collapsed !== null) continue;
      if (cell.options.size === 0) continue;

      if (cell.entropy < minEntropy - 0.001) {
        minEntropy = cell.entropy;
        candidates = [{ x, y }];
      } else if (Math.abs(cell.entropy - minEntropy) < 0.001) {
        candidates.push({ x, y });
      }
    }
  }

  if (candidates.length === 0) return null;
  return candidates[rng.nextInt(0, candidates.length - 1)];
}

/** Collapse a cell to a weighted random option */
function collapseCell(grid: WFCGrid, x: number, y: number, rng: PRNG): void {
  const cell = grid.cells[cellIndex(grid, x, y)];
  const options = [...cell.options];
  if (options.length === 0) return;

  let totalWeight = 0;
  for (const opt of options) {
    totalWeight += TILE_DEFS[opt].weight;
  }

  let roll = rng.nextFloat(0, totalWeight);
  for (const opt of options) {
    roll -= TILE_DEFS[opt].weight;
    if (roll <= 0) {
      cell.collapsed = opt;
      cell.options = new Set([opt]);
      cell.entropy = 0;
      return;
    }
  }
  // Fallback
  const last = options[options.length - 1];
  cell.collapsed = last;
  cell.options = new Set([last]);
  cell.entropy = 0;
}

/** Run the full WFC algorithm */
export function runWFC(
  width: number,
  height: number,
  rng: PRNG,
): TileType[] {
  const grid = initGrid(width, height);
  let maxIterations = width * height * 10;

  while (maxIterations-- > 0) {
    const pos = pickMinEntropyCell(grid, rng);
    if (!pos) break;

    collapseCell(grid, pos.x, pos.y, rng);
    const ok = propagate(grid, pos.x, pos.y);
    if (!ok) {
      // Contradiction — restart with a new sub-seed
      return runWFC(width, height, createPRNG(rng.nextInt(0, 2147483647)));
    }
  }

  // Fill any remaining uncollapsed cells with grass
  const tiles: TileType[] = [];
  for (let i = 0; i < width * height; i++) {
    const cell = grid.cells[i];
    tiles.push(cell.collapsed ?? 'grass');
  }
  return tiles;
}

/**
 * Ensure gold mines exist near start areas for resource harvesting.
 */
export function ensureGoldMines(
  tiles: TileType[],
  width: number,
  height: number,
  rng: PRNG,
  minMines: number = 4,
  starts?: Array<{ x: number; y: number }>,
): TileType[] {
  const result = [...tiles];
  let mineCount = result.filter(t => t === 'goldMine').length;

  // First, ensure mines near each start location
  if (starts) {
    for (const start of starts) {
      let placed = false;
      for (let r = 5; r <= 12; r++) {
        for (let attempts = 0; attempts < 20; attempts++) {
          const angle = rng.nextFloat(0, Math.PI * 2);
          const fx = Math.round(start.x + r * Math.cos(angle));
          const fy = Math.round(start.y + r * Math.sin(angle));
          if (fx < 1 || fx >= width - 1 || fy < 1 || fy >= height - 1) continue;
          const idx = fy * width + fx;
          if (result[idx] !== 'grass' && result[idx] !== 'dirt') continue;
          result[idx] = 'goldMine';
          mineCount++;
          placed = true;
          break;
        }
        if (placed) break;
      }
    }
  }

  while (mineCount < minMines) {
    // Find a grass or dirt tile that's not too close to edges
    for (let attempts = 0; attempts < 200 && mineCount < minMines; attempts++) {
      const x = rng.nextInt(3, width - 4);
      const y = rng.nextInt(3, height - 4);
      const idx = y * width + x;
      if (result[idx] !== 'grass' && result[idx] !== 'dirt') continue;

      // Check that surrounding area is mostly walkable
      let clearCount = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const t = result[ny * width + nx];
          if (t === 'grass' || t === 'dirt') clearCount++;
        }
      }
      if (clearCount >= 15) {
        result[idx] = 'goldMine';
        mineCount++;
      }
    }
    // If we failed to place enough after 200 attempts each iteration,
    // force-place at a known grass tile
    if (mineCount < minMines) {
      for (let y = 5; y < height - 5 && mineCount < minMines; y += 10) {
        for (let x = 5; x < width - 5 && mineCount < minMines; x += 10) {
          const idx = y * width + x;
          if (result[idx] === 'grass' || result[idx] === 'dirt') {
            result[idx] = 'goldMine';
            mineCount++;
          }
        }
      }
      break; // Prevent infinite loop
    }
  }
  return result;
}

/**
 * Ensure forest tiles exist near start areas for wood harvesting.
 */
export function ensureForestNearStarts(
  tiles: TileType[],
  width: number,
  height: number,
  starts: Array<{ x: number; y: number }>,
  rng: PRNG,
): TileType[] {
  const result = [...tiles];
  for (const start of starts) {
    // Place a line of forest within 15 tiles of the start
    let placed = false;
    for (let r = 5; r <= 12; r++) {
      for (let attempts = 0; attempts < 20; attempts++) {
        const angle = rng.nextFloat(0, Math.PI * 2);
        const fx = Math.round(start.x + r * Math.cos(angle));
        const fy = Math.round(start.y + r * Math.sin(angle));
        if (fx < 1 || fx >= width - 1 || fy < 1 || fy >= height - 1) continue;
        const idx = fy * width + fx;
        if (result[idx] !== 'grass' && result[idx] !== 'dirt') continue;
        result[idx] = 'forest';
        placed = true;
        // Place a few more forest tiles nearby for a cluster
        for (let dr = 0; dr < 3; dr++) {
          const ddx = rng.nextInt(-1, 1);
          const ddy = rng.nextInt(-1, 1);
          const nx = fx + ddx;
          const ny = fy + ddy;
          if (nx < 1 || nx >= width - 1 || ny < 1 || ny >= height - 1) continue;
          const nidx = ny * width + nx;
          if (result[nidx] === 'grass' || result[nidx] === 'dirt') {
            result[nidx] = 'forest';
          }
        }
        break;
      }
      if (placed) break;
    }
  }
  return result;
}
