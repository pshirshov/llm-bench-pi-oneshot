// Wave Function Collapse map generator.
//
// Operates over an 8-direction adjacency table and per-tile weights. Uses
// minimum-entropy cell selection and AC-3-style propagation. Deterministic for
// a given seed via the provided Rng.
//
// The generator produces a GameMap; a separate playability pass in playability.ts
// checks the result and can trigger deterministic re-collapse or repair.

import { TILE, TileType, isWalkableTile } from "./tiles.js";
import { Rng } from "./rng.js";
import { GameMap } from "./map.js";

export interface TileDefinition {
  readonly id: TileType;
  readonly weight: number;
}

export interface WfcOptions {
  readonly width: number;
  readonly height: number;
  /** Resource density bias per "biome" knob. */
  readonly forestDensity: number;
  readonly waterDensity: number;
  readonly rockDensity: number;
  readonly goldDensity: number;
  /** Optional hard boundary border: tiles forced to TILE.GRASS at the rim. */
  readonly grassBorder: boolean;
}

/** Adjacency rule: tile A may sit next to tile B. Indexed by tile id. */
export const ADJACENCY: Record<TileType, ReadonlySet<TileType>> = (() => {
  // Gold mines sit in clearings of grass/dirt, but we allow them to border
  // any non-water tile so that a single gold mine does not cascade-constrain
  // its surroundings. The playability pass can still ensure at least one
  // grass/dirt neighbor exists at map-gen time.
  const gold: TileType[] = [TILE.GOLD_MINE, TILE.GRASS, TILE.DIRT, TILE.FOREST, TILE.ROCK];
  const grass: TileType[] = [TILE.GRASS, TILE.DIRT, TILE.FOREST, TILE.WATER, TILE.ROCK, TILE.GOLD_MINE];
  const dirt: TileType[] = [TILE.GRASS, TILE.DIRT, TILE.FOREST, TILE.WATER, TILE.ROCK, TILE.GOLD_MINE];
  const forest: TileType[] = [TILE.GRASS, TILE.DIRT, TILE.FOREST, TILE.GOLD_MINE];
  const water: TileType[] = [TILE.WATER, TILE.DIRT];
  const rock: TileType[] = [TILE.ROCK, TILE.GRASS, TILE.DIRT, TILE.FOREST, TILE.GOLD_MINE];

  const build = (allow: TileType[]): ReadonlySet<TileType> => new Set(allow);

  return {
    [TILE.GRASS]: build(grass),
    [TILE.DIRT]: build(dirt),
    [TILE.FOREST]: build(forest),
    [TILE.WATER]: build(water),
    [TILE.ROCK]: build(rock),
    [TILE.GOLD_MINE]: build(gold),
    [TILE.DEPLETED_MINE]: build([TILE.GRASS, TILE.DIRT, TILE.ROCK]),
    [TILE.STUMP]: build([TILE.GRASS, TILE.DIRT, TILE.FOREST, TILE.STUMP, TILE.ROCK]),
  };
})();

/** Returns true if tile A is allowed adjacent to tile B (8-directional). */
export function isAdjacencyAllowed(a: TileType, b: TileType): boolean {
  return ADJACENCY[a].has(b);
}

const ALL_TILES: TileType[] = [TILE.GRASS, TILE.DIRT, TILE.FOREST, TILE.WATER, TILE.ROCK, TILE.GOLD_MINE];

function weightsForOptions(opts: WfcOptions): Map<TileType, number> {
  const w = new Map<TileType, number>();
  w.set(TILE.GRASS, 8.0);
  w.set(TILE.DIRT, 3.0);
  w.set(TILE.FOREST, 4.0 * opts.forestDensity);
  w.set(TILE.WATER, 0.4 + 0.8 * opts.waterDensity);
  w.set(TILE.ROCK, 0.5 + 0.7 * opts.rockDensity);
  w.set(TILE.GOLD_MINE, 1.2 + 0.6 * opts.goldDensity);
  return w;
}interface Cell {
  options: Set<TileType>;
}

export interface WfcResult {
  readonly map: GameMap;
  readonly ok: boolean;
  readonly attempts: number;
  readonly seed: number;
}

export interface WfcGeneratorOptions extends WfcOptions {
  readonly rng: Rng;
  readonly maxAttempts?: number;
}

export function generateWfc(opts: WfcGeneratorOptions): WfcResult {
  const { width, height, rng } = opts;
  const maxAttempts = opts.maxAttempts ?? 3;
  let attempts = 0;
  while (attempts < maxAttempts) {
    attempts++;
    const child = rng.child(`wfc-attempt-${attempts}`);
    const tiles = runWfcOnce(width, height, opts, child);
    if (tiles !== null) {
      const map = new GameMap(width, height, tiles);
      return { map, ok: true, attempts, seed: rng.seed };
    }
  }
  const tiles: TileType[] = new Array(width * height).fill(TILE.GRASS);
  return { map: new GameMap(width, height, tiles), ok: false, attempts, seed: rng.seed };
}

function runWfcOnce(
  width: number,
  height: number,
  opts: WfcOptions,
  rng: Rng,
): TileType[] | null {
  const weights = weightsForOptions(opts);
  const cells: Cell[] = [];
  for (let i = 0; i < width * height; i++) {
    cells.push({ options: new Set(ALL_TILES) });
  }

  const idx = (x: number, y: number): number => y * width + x;
  const inBounds = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height;

  if (opts.grassBorder) {
    for (let x = 0; x < width; x++) {
      constrain(idx(x, 0), TILE.GRASS, cells, width, height, inBounds);
      constrain(idx(x, height - 1), TILE.GRASS, cells, width, height, inBounds);
    }
    for (let y = 0; y < height; y++) {
      constrain(idx(0, y), TILE.GRASS, cells, width, height, inBounds);
      constrain(idx(width - 1, y), TILE.GRASS, cells, width, height, inBounds);
    }
  }

  // Initial propagation: water and rock can only cluster with themselves (or
  // dirt/grass), but mostly their initial domains are intact. The collapse
  // step below handles picking.
  const DIRS: Array<[number, number]> = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      DIRS.push([dx, dy]);
    }
  }

  const neighborsOf = (x: number, y: number): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (inBounds(nx, ny)) out.push([nx, ny]);
    }
    return out;
  };

  let safety = width * height * 50;
  while (safety-- > 0) {
    // Find minimum-entropy uncollapsed cell.
    let bestIdx = -1;
    let bestEntropy = Infinity;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i] as Cell;
      if (c.options.size <= 1) continue;
      const e = entropy(c, weights, rng);
      if (e < bestEntropy) {
        bestEntropy = e;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;

    const cell = cells[bestIdx] as Cell;
    // Lookahead: weighted-shuffle the options, then try each in that order.
    // The first one that doesn't immediately cause a contradiction is chosen.
    const options = weightedShuffle(Array.from(cell.options), weights, rng);
    let chosen: TileType | null = null;
    for (const opt of options) {
      // Save state.
      const saved = cells.map((c) => new Set(c.options));
      cell.options.clear();
      cell.options.add(opt);
      const ok = propagate(cells, bestIdx, width, height, inBounds, neighborsOf);
      // Restore state.
      for (let i = 0; i < cells.length; i++) {
        cells[i]!.options = saved[i] ?? new Set();
      }
      if (ok) {
        chosen = opt;
        break;
      }
    }
    if (chosen === null) {
      // No option works without a contradiction: pick the highest-weight and
      // hope propagation doesn't kill neighbors. The outer generateWfc
      // retries up to maxAttempts.
      chosen = options[0] as TileType;
      let bestW = -1;
      for (const opt of options) {
        const w = weights.get(opt) ?? 1;
        if (w > bestW) {
          bestW = w;
          chosen = opt;
        }
      }
    }
    cell.options.clear();
    cell.options.add(chosen);
    if (!propagate(cells, bestIdx, width, height, inBounds, neighborsOf)) {
      return null;
    }
  }

  // Build tile array. If any cell still has multiple options, pick one arbitrarily.
  const tiles: TileType[] = new Array(width * height);
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i] as Cell;
    if (c.options.size === 0) {
      return null;
    }
    if (c.options.size === 1) {
      tiles[i] = c.options.values().next().value as TileType;
    } else {
      // Pick the lowest-weight non-walkable-favoring option to avoid orphan mines.
      let chosen: TileType = TILE.GRASS;
      let bestW = -1;
      for (const t of c.options) {
        const w = weights.get(t) ?? 1;
        if (w > bestW) {
          bestW = w;
          chosen = t;
        }
      }
      tiles[i] = chosen;
    }
  }
  return tiles;
}

function entropy(c: Cell, weights: Map<TileType, number>, rng: Rng): number {
  let total = 0;
  for (const t of c.options) {
    total += weights.get(t) ?? 1;
  }
  if (total <= 0) return Infinity;
  let h = 0;
  for (const t of c.options) {
    const p = (weights.get(t) ?? 1) / total;
    h -= p * Math.log(p);
  }
  // Add a small noise so equal-entropy cells randomize deterministically.
  return h + rng.next() * 1e-6;
}

function weightedShuffle(
  options: TileType[],
  weights: Map<TileType, number>,
  rng: Rng,
): TileType[] {
  // Build a list of (option, weight) pairs, sort by weight, then do a
  // Fisher-Yates-style weighted shuffle.
  const out = options.slice();
  for (let i = 0; i < out.length; i++) {
    // Pick j in [i, length) with probability proportional to weight.
    let total = 0;
    for (let k = i; k < out.length; k++) total += weights.get(out[k] as TileType) ?? 1;
    let r = rng.next() * total;
    let pickJ = i;
    for (let k = i; k < out.length; k++) {
      r -= weights.get(out[k] as TileType) ?? 1;
      if (r <= 0) { pickJ = k; break; }
    }
    if (pickJ !== i) {
      const tmp = out[i] as TileType;
      out[i] = out[pickJ] as TileType;
      out[pickJ] = tmp;
    }
  }
  return out;
}

function constrain(
  cellIdx: number,
  tile: TileType,
  cells: Cell[],
  width: number,
  height: number,
  inBounds: (x: number, y: number) => boolean,
): boolean {
  const cell = cells[cellIdx] as Cell;
  if (cell.options.size === 1 && cell.options.has(tile)) return true;
  cell.options.clear();
  cell.options.add(tile);
  return propagate(cells, cellIdx, width, height, inBounds, (_x, _y) => []);
}

function propagate(
  cells: Cell[],
  startIdx: number,
  width: number,
  _height: number,
  inBounds: (x: number, y: number) => boolean,
  neighborsOf: (x: number, y: number) => Array<[number, number]>,
): boolean {
  const stack: number[] = [startIdx];
  let safety = cells.length * 32;
  while (stack.length > 0 && safety-- > 0) {
    const ci = stack.pop() as number;
    const cx = ci % width;
    const cy = Math.floor(ci / width);
    const myOptions = cells[ci] as Cell;
    for (const [nx, ny] of neighborsOf(cx, cy)) {
      if (!inBounds(nx, ny)) continue;
      const ni = ny * width + nx;
      const nc = cells[ni] as Cell;
      if (nc.options.size === 0) return false;
      const before = nc.options.size;
      prune(nc, myOptions);
      const after = nc.options.size;
      if (after === 0) return false;
      if (after < before) stack.push(ni);
    }
  }
  return true;
}

function prune(nc: Cell, myOptions: Cell): void {
  // nc is allowed to keep option t only if at least one of my options is
  // adjacent-compatible with t.
  const keep: TileType[] = [];
  for (const t of nc.options) {
    for (const m of myOptions.options) {
      if (isAdjacencyAllowed(m, t)) {
        keep.push(t);
        break;
      }
    }
  }
  if (keep.length !== nc.options.size) {
    nc.options = new Set(keep);
  }
}

/** Adjust densities for a given level (1..5). */
export function densitiesForLevel(level: number): {
  forestDensity: number;
  waterDensity: number;
  rockDensity: number;
  goldDensity: number;
} {
  // Levels 1..5: increasing constraints.
  const f = [1.0, 1.0, 0.95, 0.9, 0.8][Math.max(0, Math.min(4, level - 1))] as number;
  const w = [0.6, 0.7, 0.8, 0.9, 1.0][Math.max(0, Math.min(4, level - 1))] as number;
  const r = [0.5, 0.6, 0.7, 0.8, 0.9][Math.max(0, Math.min(4, level - 1))] as number;
  const g = [1.0, 0.9, 0.85, 0.8, 0.7][Math.max(0, Math.min(4, level - 1))] as number;
  return { forestDensity: f, waterDensity: w, rockDensity: r, goldDensity: g };
}

/** Quick walkability summary for stats. */
export function walkableRatio(map: GameMap): number {
  let walk = 0;
  for (const t of map.tiles) {
    if (isWalkableTile(t)) walk++;
  }
  return walk / map.tiles.length;
}

void ALL_TILES;
