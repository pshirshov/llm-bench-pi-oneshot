import { Grid } from "../core/grid.js";
import { Rng } from "../core/rng.js";
import type { TileCoord } from "../core/vec.js";
import { runWfc } from "./wfc.js";
import { TILE_PROPS, TileType } from "./tiles.js";

/** Output of map generation: terrain plus two validated start locations. */
export interface GeneratedMap {
  readonly tiles: Grid<TileType>;
  readonly starts: readonly [TileCoord, TileCoord];
  /** Diagnostics describing how the map satisfied playability (for the README/debug). */
  readonly report: MapReport;
}

export interface MapReport {
  wfcAttempts: number;
  carvedCorridor: boolean;
  goldPlaced: number;
  forestPlanted: number;
  largestComponent: number;
}

// Playability tuning constants.
const CLEARING_RADIUS = 3; // carved buildable radius around each start (-> 7x7)
const HARVEST_REACH = 11; // radius within which a start must find gold + forest
const MIN_FOREST_TILES = 14; // minimum choppable tiles within reach of a start
const MIN_GOLD_MINES = 1;
const FAIRNESS_FOREST_TOLERANCE = 8; // max allowed difference in forest tiles between starts
const MAX_WFC_ATTEMPTS = 16;

function isPassable(t: TileType): boolean {
  return TILE_PROPS[t].passable;
}

/**
 * Label connected land (passable) components using 4-connectivity. Returns the
 * set of tile indices forming the largest component.
 */
function largestLandComponent(tiles: Grid<TileType>): Set<number> {
  const { width, height } = tiles;
  const visited = new Uint8Array(width * height);
  let best = new Set<number>();
  const stack: number[] = [];
  for (let start = 0; start < width * height; start++) {
    if (visited[start]) continue;
    const sx = start % width;
    const sy = (start / width) | 0;
    if (!isPassable(tiles.get(sx, sy))) {
      visited[start] = 1;
      continue;
    }
    const component = new Set<number>();
    stack.length = 0;
    stack.push(start);
    visited[start] = 1;
    while (stack.length > 0) {
      const idx = stack.pop() as number;
      component.add(idx);
      const x = idx % width;
      const y = (idx / width) | 0;
      const neigh = [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ];
      for (const [nx, ny] of neigh) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const nIdx = ny * width + nx;
        if (visited[nIdx]) continue;
        visited[nIdx] = 1;
        if (isPassable(tiles.get(nx, ny))) stack.push(nIdx);
      }
    }
    if (component.size > best.size) best = component;
  }
  return best;
}

/** Find two well-separated start tiles within a component. */
function chooseStarts(
  component: Set<number>,
  width: number,
): { a: TileCoord; b: TileCoord; separation: number } {
  // Use extremes along the two diagonals; keep the more separated pair.
  let minSum = Infinity;
  let maxSum = -Infinity;
  let minDiff = Infinity;
  let maxDiff = -Infinity;
  let aSum: TileCoord = { tx: 0, ty: 0 };
  let bSum: TileCoord = { tx: 0, ty: 0 };
  let aDiff: TileCoord = { tx: 0, ty: 0 };
  let bDiff: TileCoord = { tx: 0, ty: 0 };
  for (const idx of component) {
    const tx = idx % width;
    const ty = (idx / width) | 0;
    const sum = tx + ty;
    const diff = tx - ty;
    if (sum < minSum) {
      minSum = sum;
      aSum = { tx, ty };
    }
    if (sum > maxSum) {
      maxSum = sum;
      bSum = { tx, ty };
    }
    if (diff < minDiff) {
      minDiff = diff;
      aDiff = { tx, ty };
    }
    if (diff > maxDiff) {
      maxDiff = diff;
      bDiff = { tx, ty };
    }
  }
  const sepSum = Math.hypot(aSum.tx - bSum.tx, aSum.ty - bSum.ty);
  const sepDiff = Math.hypot(aDiff.tx - bDiff.tx, aDiff.ty - bDiff.ty);
  if (sepSum >= sepDiff) return { a: aSum, b: bSum, separation: sepSum };
  return { a: aDiff, b: bDiff, separation: sepDiff };
}

function carveClearing(tiles: Grid<TileType>, center: TileCoord): void {
  for (let dy = -CLEARING_RADIUS; dy <= CLEARING_RADIUS; dy++) {
    for (let dx = -CLEARING_RADIUS; dx <= CLEARING_RADIUS; dx++) {
      const x = center.tx + dx;
      const y = center.ty + dy;
      if (!tiles.inBounds(x, y)) continue;
      // Keep the disc roughly round.
      if (dx * dx + dy * dy > (CLEARING_RADIUS + 0.5) * (CLEARING_RADIUS + 0.5)) continue;
      tiles.set(x, y, TileType.Grass);
    }
  }
}

/** Carve an L-shaped land corridor so the two starts are reachable by land. */
function carveCorridor(tiles: Grid<TileType>, a: TileCoord, b: TileCoord): void {
  let x = a.tx;
  let y = a.ty;
  const stepTo = (tx: number, ty: number): void => {
    while (x !== tx) {
      x += Math.sign(tx - x);
      if (!isPassable(tiles.get(x, y))) tiles.set(x, y, TileType.Dirt);
    }
    while (y !== ty) {
      y += Math.sign(ty - y);
      if (!isPassable(tiles.get(x, y))) tiles.set(x, y, TileType.Dirt);
    }
  };
  stepTo(b.tx, a.ty);
  stepTo(b.tx, b.ty);
}

function countWithinReach(
  tiles: Grid<TileType>,
  center: TileCoord,
  predicate: (t: TileType) => boolean,
): number {
  let count = 0;
  for (let dy = -HARVEST_REACH; dy <= HARVEST_REACH; dy++) {
    for (let dx = -HARVEST_REACH; dx <= HARVEST_REACH; dx++) {
      const x = center.tx + dx;
      const y = center.ty + dy;
      if (!tiles.inBounds(x, y)) continue;
      if (dx * dx + dy * dy > HARVEST_REACH * HARVEST_REACH) continue;
      if (predicate(tiles.get(x, y))) count++;
    }
  }
  return count;
}

/**
 * Place tiles of `type` in a deterministic spiral of empty (buildable) tiles
 * starting just outside a start's clearing, until `needed` have been placed.
 * Returns how many were placed.
 */
function placeResource(
  tiles: Grid<TileType>,
  center: TileCoord,
  type: TileType,
  needed: number,
  rng: Rng,
): number {
  if (needed <= 0) return 0;
  // Candidate ring tiles between the clearing edge and harvest reach.
  const candidates: TileCoord[] = [];
  for (let dy = -HARVEST_REACH; dy <= HARVEST_REACH; dy++) {
    for (let dx = -HARVEST_REACH; dx <= HARVEST_REACH; dx++) {
      const r2 = dx * dx + dy * dy;
      const minR = CLEARING_RADIUS + 2;
      if (r2 < minR * minR || r2 > HARVEST_REACH * HARVEST_REACH) continue;
      const x = center.tx + dx;
      const y = center.ty + dy;
      if (!tiles.inBounds(x, y)) continue;
      const t = tiles.get(x, y);
      if (t === TileType.Grass || t === TileType.Dirt) candidates.push({ tx: x, ty: y });
    }
  }
  rng.shuffle(candidates);
  let placed = 0;
  for (const c of candidates) {
    if (placed >= needed) break;
    tiles.set(c.tx, c.ty, type);
    placed++;
  }
  return placed;
}

/**
 * Generate a playable map for the given seed and size. Runs genuine WFC, then
 * applies a deterministic playability pass (start selection, reachability,
 * resource guarantees, fairness). All randomness derives from `seed`.
 */
export function generateMap(seed: number, width: number, height: number): GeneratedMap {
  const baseRng = new Rng(seed);
  const report: MapReport = {
    wfcAttempts: 0,
    carvedCorridor: false,
    goldPlaced: 0,
    forestPlanted: 0,
    largestComponent: 0,
  };

  const minComponent = Math.floor(width * height * 0.18);
  const minSeparation = Math.max(width, height) * 0.5;

  let tiles: Grid<TileType> | null = null;
  let starts: { a: TileCoord; b: TileCoord; separation: number } | null = null;

  for (let attempt = 0; attempt < MAX_WFC_ATTEMPTS; attempt++) {
    report.wfcAttempts = attempt + 1;
    const attemptRng = baseRng.fork(attempt * 0x1000193 + 1);
    const result = runWfc(width, height, attemptRng);
    if (result === null) continue; // contradiction; retry deterministically
    const component = largestLandComponent(result.grid);
    if (component.size < minComponent) continue;
    const chosen = chooseStarts(component, width);
    if (chosen.separation < minSeparation) continue;
    tiles = result.grid;
    starts = chosen;
    report.largestComponent = component.size;
    break;
  }

  let carvedCorridor = false;
  if (tiles === null || starts === null) {
    // Last-resort deterministic fallback: take a fresh collapse (ignoring
    // contradictions by retrying) and carve guaranteed playability into it.
    let fallback = runWfc(width, height, baseRng.fork(0xdead));
    let guard = 0;
    while (fallback === null && guard < MAX_WFC_ATTEMPTS) {
      fallback = runWfc(width, height, baseRng.fork(0xdead + ++guard));
    }
    // A grid of grass as the absolute floor if WFC keeps contradicting.
    tiles = fallback?.grid ?? new Grid<TileType>(width, height, () => TileType.Grass);
    const inset = Math.max(CLEARING_RADIUS + 2, Math.floor(Math.min(width, height) * 0.15));
    starts = {
      a: { tx: inset, ty: inset },
      b: { tx: width - 1 - inset, ty: height - 1 - inset },
      separation: Math.hypot(width - 1 - 2 * inset, height - 1 - 2 * inset),
    };
    carvedCorridor = true;
    report.largestComponent = largestLandComponent(tiles).size;
  }

  // Carve buildable clearings at both starts.
  carveClearing(tiles, starts.a);
  carveClearing(tiles, starts.b);

  // Guarantee land reachability when we fell back, or when the starts ended up
  // in different components after clearing (defensive).
  const ensureReachable = (): boolean => {
    const comp = largestLandComponent(tiles as Grid<TileType>);
    const aIdx = (starts as { a: TileCoord }).a.ty * width + (starts as { a: TileCoord }).a.tx;
    const bIdx = (starts as { b: TileCoord }).b.ty * width + (starts as { b: TileCoord }).b.tx;
    return comp.has(aIdx) && comp.has(bIdx);
  };
  if (carvedCorridor || !ensureReachable()) {
    carveCorridor(tiles, starts.a, starts.b);
    report.carvedCorridor = true;
  }

  // Resource guarantees + fairness, per start.
  const resourceRng = baseRng.fork(0x5eed);
  const forestCounts: number[] = [];
  for (const start of [starts.a, starts.b]) {
    const golds = countWithinReach(tiles, start, (t) => t === TileType.GoldMine);
    if (golds < MIN_GOLD_MINES) {
      report.goldPlaced += placeResource(
        tiles,
        start,
        TileType.GoldMine,
        MIN_GOLD_MINES - golds,
        resourceRng,
      );
    }
    let forests = countWithinReach(tiles, start, (t) => t === TileType.Forest);
    if (forests < MIN_FOREST_TILES) {
      report.forestPlanted += placeResource(
        tiles,
        start,
        TileType.Forest,
        MIN_FOREST_TILES - forests,
        resourceRng,
      );
      forests = MIN_FOREST_TILES;
    }
    forestCounts.push(countWithinReach(tiles, start, (t) => t === TileType.Forest));
  }

  // Approximate resource fairness: top up the poorer side's forests.
  const diff = Math.abs(forestCounts[0]! - forestCounts[1]!);
  if (diff > FAIRNESS_FOREST_TOLERANCE) {
    const poorer = forestCounts[0]! < forestCounts[1]! ? starts.a : starts.b;
    report.forestPlanted += placeResource(
      tiles,
      poorer,
      TileType.Forest,
      diff - FAIRNESS_FOREST_TOLERANCE,
      resourceRng,
    );
  }

  return { tiles, starts: [starts.a, starts.b], report };
}
