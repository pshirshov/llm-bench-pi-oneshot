import { Grid } from "../core/grid.js";
import type { Rng } from "../core/rng.js";
import { ADJACENCY, ALL_TILES, TILE_WEIGHTS, TileType } from "./tiles.js";

/**
 * A genuine tiled Wave Function Collapse generator.
 *
 * Each cell starts as a superposition of all tile types (a bitmask). The
 * algorithm repeatedly:
 *   1. selects the cell of minimal entropy (fewest remaining possibilities),
 *   2. collapses it to a single tile chosen by weighted random pick,
 *   3. propagates the adjacency constraints to neighbours until a fixpoint.
 *
 * Adjacency here is rotation-independent (the same set of compatible neighbours
 * applies in all four orthogonal directions), so a single per-tile mask suffices.
 *
 * Returns the fully collapsed grid, or `null` on contradiction (an empty cell).
 */

const TILE_COUNT = ALL_TILES.length;
const FULL_MASK = (1 << TILE_COUNT) - 1;

/** Precomputed: for each tile, the bitmask of tiles allowed beside it. */
const ADJ_MASK: number[] = ALL_TILES.map((t) => {
  let mask = 0;
  for (const other of ALL_TILES) {
    if (ADJACENCY[t].has(other)) mask |= 1 << other;
  }
  return mask;
});

function popcount(mask: number): number {
  let count = 0;
  let m = mask;
  while (m) {
    m &= m - 1;
    count++;
  }
  return count;
}

/** Union of allowed-neighbour masks over every tile present in `mask`. */
function allowedNeighbours(mask: number): number {
  let result = 0;
  let m = mask;
  while (m) {
    const bit = m & -m;
    const tile = Math.log2(bit) | 0;
    result |= ADJ_MASK[tile] as number;
    m &= m - 1;
  }
  return result;
}

const NEIGHBOUR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export interface WfcResult {
  readonly grid: Grid<TileType>;
  readonly iterations: number;
}

/**
 * Run one WFC attempt. Returns null on contradiction so the caller can
 * deterministically retry with a forked generator.
 */
export function runWfc(width: number, height: number, rng: Rng): WfcResult | null {
  const size = width * height;
  const possibilities = new Array<number>(size).fill(FULL_MASK);
  let collapsedCount = 0;
  let iterations = 0;

  // Cache weights indexed by tile for the weighted collapse pick.
  const weightOf = (t: TileType): number => TILE_WEIGHTS[t];

  const propagate = (startIndex: number): boolean => {
    const stack: number[] = [startIndex];
    while (stack.length > 0) {
      const idx = stack.pop() as number;
      const x = idx % width;
      const y = (idx / width) | 0;
      const allowedFromHere = allowedNeighbours(possibilities[idx] as number);
      for (const [dx, dy] of NEIGHBOUR_OFFSETS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const nIdx = ny * width + nx;
        const before = possibilities[nIdx] as number;
        const after = before & allowedFromHere;
        if (after === before) continue;
        if (after === 0) return false; // contradiction
        possibilities[nIdx] = after;
        stack.push(nIdx);
      }
    }
    return true;
  };

  const collapseCell = (idx: number): boolean => {
    const mask = possibilities[idx] as number;
    // Build the weighted choice over remaining tiles.
    const tiles: TileType[] = [];
    const weights: number[] = [];
    let m = mask;
    while (m) {
      const bit = m & -m;
      const tile = Math.log2(bit) as TileType;
      tiles.push(tile);
      weights.push(weightOf(tile));
      m &= m - 1;
    }
    const chosen = tiles[rng.weightedIndex(weights)] as TileType;
    possibilities[idx] = 1 << chosen;
    collapsedCount++;
    return propagate(idx);
  };

  while (collapsedCount < size) {
    iterations++;
    // Find minimal-entropy uncollapsed cell, with rng noise as a deterministic
    // tie-breaker so the choice depends on the seed.
    let bestIdx = -1;
    let bestEntropy = Infinity;
    for (let i = 0; i < size; i++) {
      const count = popcount(possibilities[i] as number);
      if (count <= 1) continue;
      const entropy = count + rng.next() * 0.6;
      if (entropy < bestEntropy) {
        bestEntropy = entropy;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break; // everything collapsed
    if (!collapseCell(bestIdx)) return null;
  }

  const grid = new Grid<TileType>(width, height, (x, y) => {
    const mask = possibilities[y * width + x] as number;
    // Each collapsed cell has exactly one bit set.
    return Math.log2(mask) as TileType;
  });

  return { grid, iterations };
}
