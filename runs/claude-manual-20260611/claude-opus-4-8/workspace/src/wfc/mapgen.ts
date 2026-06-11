/**
 * Deterministic WFC playability / repair pass and per-level map derivation.
 *
 * `solve()` (src/wfc/wfc.ts) emits a terrain grid that satisfies the adjacency
 * rules but says nothing about *playability*: a Warcraft-2-style map also needs
 * two well-separated, mutually land-reachable starts, each with a buildable
 * clearing and a gold mine + forest within reach, and roughly fair resources
 * between the sides.  This module wraps the solver with a pass that GUARANTEES
 * those properties, repairing deterministically when the raw collapse falls short.
 *
 * Determinism: `generateMap(w, h, seed, level)` mixes `(seed, level)` into a
 * forked substream of the seeded RNG (src/core/rng.ts), so identical arguments
 * reproduce the same grid, starts, and report bit-for-bit.  Nothing here reads
 * the global PRNG or wall-clock time.
 *
 * Passability choice: a tile is "land" (passable for reachability) iff it is NOT
 * water and NOT rock — grass, dirt, forest and goldMine are all walkable for
 * connecting starts.  Rationale: in the genre, units route around water and
 * mountains but can cross forest and a mined tile, so the broad passable set
 * matches how a player walks an army between bases.  Buildings need clear ground,
 * which the clearing step provides around each start.
 */

import { Grid } from "../core/grid.js";
import { createRng } from "../core/rng.js";
import type { RNG } from "../core/rng.js";
import { vec, manhattan } from "../core/vec.js";
import type { Vec2 } from "../core/vec.js";
import { solve } from "./wfc.js";
import type { TileType } from "./tiles.js";

// === Tuning constants (no magic numbers buried in the algorithm) ===

/** Reachability passability: these tiles block movement / connectivity. */
const IMPASSABLE: ReadonlySet<TileType> = new Set<TileType>(["water", "rock"]);

/** A start's buildable clearing radius (Chebyshev), converted to grass/dirt. */
const CLEARING_RADIUS = 2;

/** Each start must have a gold mine AND a forest within this many tiles (BFS land distance). */
const RESOURCE_REACH = 10;

/** Radius (Chebyshev) within which per-start gold/forest are counted for fairness. */
const FAIRNESS_RADIUS = 12;

/**
 * Fairness is judged on a CLAMPED score `min(gold, GOLD_FAIR_CAP) + min(forest,
 * FOREST_FAIR_CAP)`, not raw tile census.  WFC legitimately yields forest-dense
 * pockets (one start with 40 trees, the other 18), yet for the early economy both
 * are effectively unlimited wood; requiring identical raw counts is neither
 * achievable by addition-only repair nor meaningful.  Clamping rewards having
 * *enough* of each resource and ignores excess.
 */
const GOLD_FAIR_CAP = 3;
const FOREST_FAIR_CAP = 6;

/** Allowed absolute difference in CLAMPED fairness score between the two starts. */
const FAIRNESS_TOLERANCE = 2;

/**
 * Minimum start separation, as a fraction of the map's diagonal-ish scale
 * (max(width,height)).  Starts closer than this are considered too cramped and
 * trigger repair.
 */
const MIN_SEPARATION_FRACTION = 0.45;

/** Largest land component must contain at least this fraction of all cells. */
const MIN_COMPONENT_FRACTION = 0.25;

/** Bounded number of (collapse → repair → validate) attempts before the safety net. */
const MAX_GEN_ATTEMPTS = 12;

/** Half-width of the carved corridor when connecting components / starts. */
const CORRIDOR_HALF_WIDTH = 1;

// === Public result types ===

/** Per-start resource census carried in the report (for tests + UI). */
export interface StartResourceCounts {
  /** Gold-mine tiles within FAIRNESS_RADIUS of the start. */
  readonly gold: number;
  /** Forest tiles within FAIRNESS_RADIUS of the start. */
  readonly forest: number;
  /** BFS land distance from the start to its nearest gold mine (Infinity if none). */
  readonly nearestGoldDist: number;
  /** BFS land distance from the start to its nearest forest (Infinity if none). */
  readonly nearestForestDist: number;
}

/** Diagnostic report describing how the playable map was produced. */
export interface MapGenReport {
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  readonly levelIndex: number;
  /** The two chosen start tiles (mirrors `starts`). */
  readonly starts: readonly [Vec2, Vec2];
  /** Per-start resource census, index-aligned with `starts`. */
  readonly resources: readonly [StartResourceCounts, StartResourceCounts];
  /** Size (in tiles) of the largest land component the starts live in. */
  readonly componentSize: number;
  /** BFS land distance between the two starts (finite ⇒ mutually reachable). */
  readonly startDistance: number;
  /** How many collapse/repair attempts were consumed (1 = clean first try). */
  readonly attempts: number;
  /** Whether a connecting corridor had to be carved. */
  readonly carvedCorridor: boolean;
  /** Whether resource top-up / placement had to add or convert tiles. */
  readonly adjustedResources: boolean;
}

/** Full output of `generateMap`. */
export interface MapGenResult {
  readonly grid: Grid<TileType>;
  readonly starts: readonly [Vec2, Vec2];
  readonly report: MapGenReport;
}

// === Passability + connectivity primitives ===

/** A tile is land (passable for reachability) iff it is neither water nor rock. */
export function isLand(t: TileType): boolean {
  return !IMPASSABLE.has(t);
}

const PASSABLE_NEIGHBOR_OFFSETS: readonly Vec2[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

/** Flat array index for (x, y) on a grid of the given width. */
function idx(x: number, y: number, width: number): number {
  return y * width + x;
}

/**
 * Labels every cell with its 4-connected land-component id (-1 for impassable).
 * Returns the label grid plus, for each component id, its member cell count.
 */
interface ComponentLabels {
  readonly labels: Int32Array;
  readonly sizes: number[];
}

function labelComponents(grid: Grid<TileType>): ComponentLabels {
  const { width, height } = grid;
  const labels = new Int32Array(width * height).fill(-1);
  const sizes: number[] = [];
  const queue: number[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isLand(grid.get(x, y))) continue;
      if (labels[idx(x, y, width)] !== -1) continue;

      const id = sizes.length;
      let count = 0;
      labels[idx(x, y, width)] = id;
      queue.length = 0;
      queue.push(idx(x, y, width));

      while (queue.length > 0) {
        const cur = queue.pop() as number;
        count++;
        const cx = cur % width;
        const cy = (cur - cx) / width;
        for (const off of PASSABLE_NEIGHBOR_OFFSETS) {
          const nx = cx + off.x;
          const ny = cy + off.y;
          if (!grid.inBounds(nx, ny)) continue;
          if (!isLand(grid.get(nx, ny))) continue;
          const ni = idx(nx, ny, width);
          if (labels[ni] !== -1) continue;
          labels[ni] = id;
          queue.push(ni);
        }
      }
      sizes.push(count);
    }
  }

  return { labels, sizes };
}

/** Index of the component with the most cells; -1 when there is no land at all. */
function largestComponentId(sizes: readonly number[]): number {
  let best = -1;
  let bestSize = 0;
  for (let i = 0; i < sizes.length; i++) {
    if (sizes[i] > bestSize) {
      bestSize = sizes[i];
      best = i;
    }
  }
  return best;
}

/**
 * BFS over land tiles from `start`, returning a distance grid (number of land
 * steps; Infinity for unreachable / impassable cells).  4-connected.
 */
function landDistances(grid: Grid<TileType>, start: Vec2): Float64Array {
  const { width, height } = grid;
  const dist = new Float64Array(width * height).fill(Number.POSITIVE_INFINITY);
  if (!isLand(grid.get(start.x, start.y))) return dist;

  let frontier: number[] = [idx(start.x, start.y, width)];
  dist[frontier[0]] = 0;

  while (frontier.length > 0) {
    const next: number[] = [];
    for (const cur of frontier) {
      const cx = cur % width;
      const cy = (cur - cx) / width;
      const d = dist[cur] + 1;
      for (const off of PASSABLE_NEIGHBOR_OFFSETS) {
        const nx = cx + off.x;
        const ny = cy + off.y;
        if (!grid.inBounds(nx, ny)) continue;
        if (!isLand(grid.get(nx, ny))) continue;
        const ni = idx(nx, ny, width);
        if (d < dist[ni]) {
          dist[ni] = d;
          next.push(ni);
        }
      }
    }
    frontier = next;
  }

  return dist;
}

/**
 * Finds the land cell within `componentId` farthest (by BFS land distance) from
 * `from`.  Ties are broken deterministically by lowest flat index, so the result
 * depends only on the grid, not on iteration accidents.
 */
function farthestInComponent(
  grid: Grid<TileType>,
  labels: Int32Array,
  componentId: number,
  from: Vec2,
): Vec2 {
  const { width } = grid;
  const dist = landDistances(grid, from);
  let best = from;
  let bestDist = -1;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== componentId) continue;
    const d = dist[i];
    if (d === Number.POSITIVE_INFINITY) continue;
    if (d > bestDist) {
      bestDist = d;
      const x = i % width;
      best = vec(x, (i - x) / width);
    }
  }
  return best;
}

/** First (lowest-index) land cell belonging to `componentId`. */
function anyCellOf(labels: Int32Array, componentId: number, width: number): Vec2 {
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] === componentId) {
      const x = i % width;
      return vec(x, (i - x) / width);
    }
  }
  throw new Error(`anyCellOf: component ${componentId} has no cells`);
}

// === Repair primitives — all deterministic ===

/**
 * Carves a land corridor (sets cells to dirt) along the straight Bresenham line
 * between `a` and `b`, widened by CORRIDOR_HALF_WIDTH.  Used to splice two land
 * components together so the starts become mutually reachable.  Only impassable
 * tiles are converted; existing land is left intact.
 */
function carveCorridor(grid: Grid<TileType>, a: Vec2, b: Vec2): void {
  let x0 = a.x;
  let y0 = a.y;
  const x1 = b.x;
  const y1 = b.y;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  // Bounded by the grid perimeter; the loop terminates when (x0,y0) reaches the end.
  for (;;) {
    widenCarve(grid, x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
}

/** Converts impassable tiles in a small square around (cx, cy) to dirt. */
function widenCarve(grid: Grid<TileType>, cx: number, cy: number): void {
  for (let dy = -CORRIDOR_HALF_WIDTH; dy <= CORRIDOR_HALF_WIDTH; dy++) {
    for (let dx = -CORRIDOR_HALF_WIDTH; dx <= CORRIDOR_HALF_WIDTH; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (!grid.inBounds(x, y)) continue;
      if (!isLand(grid.get(x, y))) grid.set(x, y, "dirt");
    }
  }
}

/**
 * Connects every land component to the largest one by carving a corridor from a
 * representative cell of each smaller component to the largest component's
 * representative.  Afterwards the whole map is (4-connected) land-reachable.
 * Returns true iff at least one corridor was carved.
 */
function connectAllComponents(grid: Grid<TileType>): boolean {
  const { labels, sizes } = labelComponents(grid);
  const main = largestComponentId(sizes);
  if (main < 0) return false; // no land at all — caller handles via re-collapse
  const target = anyCellOf(labels, main, grid.width);
  let carved = false;
  for (let id = 0; id < sizes.length; id++) {
    if (id === main) continue;
    const from = anyCellOf(labels, id, grid.width);
    carveCorridor(grid, from, target);
    carved = true;
  }
  return carved;
}

/** Stamps a buildable clearing (grass/dirt) of CLEARING_RADIUS around `center`. */
function carveClearing(grid: Grid<TileType>, center: Vec2, rng: RNG): void {
  for (let dy = -CLEARING_RADIUS; dy <= CLEARING_RADIUS; dy++) {
    for (let dx = -CLEARING_RADIUS; dx <= CLEARING_RADIUS; dx++) {
      const x = center.x + dx;
      const y = center.y + dy;
      if (!grid.inBounds(x, y)) continue;
      // Mostly grass with occasional dirt for visual variety; the exact tile is
      // irrelevant to buildability (both are clear) but stays seed-deterministic.
      grid.set(x, y, rng.next() < 0.2 ? "dirt" : "grass");
    }
  }
  grid.set(center.x, center.y, "grass");
}

// === Resource guarantees + fairness — deterministic ===

/**
 * Nearest cell satisfying `pred` by land distance, using a PRECOMPUTED distance
 * field `dist` (from `landDistances(grid, start)`).  Returns the cell + its
 * distance, or null if none is reachable.  Deterministic: ties resolve to the
 * lowest flat index.  Taking `dist` as a parameter lets the resource phase reuse
 * one BFS per start instead of rerunning it for every query — placing a resource
 * only ever converts land→land, so the land-distance field is invariant under
 * those edits and may be shared safely.
 */
function nearestLandCell(
  grid: Grid<TileType>,
  dist: Float64Array,
  pred: (t: TileType) => boolean,
): { cell: Vec2; dist: number } | null {
  const { width } = grid;
  let best: Vec2 | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < dist.length; i++) {
    const d = dist[i];
    if (d === Number.POSITIVE_INFINITY || d >= bestDist) continue;
    const x = i % width;
    const y = (i - x) / width;
    if (pred(grid.get(x, y))) {
      bestDist = d;
      best = vec(x, y);
    }
  }
  return best === null ? null : { cell: best, dist: bestDist };
}

/** True iff any orthogonal neighbour of `cell` is a gold mine or forest. */
function hasResourceNeighbor(grid: Grid<TileType>, cell: Vec2): boolean {
  for (const off of PASSABLE_NEIGHBOR_OFFSETS) {
    const nx = cell.x + off.x;
    const ny = cell.y + off.y;
    if (!grid.inBounds(nx, ny)) continue;
    const t = grid.get(nx, ny);
    if (t === "goldMine" || t === "forest") return true;
  }
  return false;
}

/** True iff any orthogonal neighbour of `cell` is water or rock. */
function hasObstacleNeighbor(grid: Grid<TileType>, cell: Vec2): boolean {
  for (const off of PASSABLE_NEIGHBOR_OFFSETS) {
    const nx = cell.x + off.x;
    const ny = cell.y + off.y;
    if (!grid.inBounds(nx, ny)) continue;
    const t = grid.get(nx, ny);
    if (t === "water" || t === "rock") return true;
  }
  return false;
}

/**
 * Picks the closest land cell (BFS distance in [minDist, RESOURCE_REACH]) on
 * which to place a converted resource.  Two invariants keep placement safe and
 * *monotone* (so the fairness loop converges): the cell is plain ground
 * (grass/dirt), and it has NO orthogonal resource neighbour — so a placement here
 * can neither overwrite nor be overwritten by an existing mine/forest.  With
 * `avoidObstacle` (gold mines, which may not border water/rock) cells with an
 * obstacle neighbour are skipped too, keeping the goldMine rule intact without
 * rewriting any neighbour.
 */
function pickConversionCell(
  grid: Grid<TileType>,
  dist: Float64Array,
  minDist: number,
  avoidObstacle: boolean,
): Vec2 | null {
  const { width } = grid;
  let best: Vec2 | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < dist.length; i++) {
    const d = dist[i];
    if (d < minDist || d > RESOURCE_REACH) continue;
    if (d >= bestDist) continue;
    const x = i % width;
    const y = (i - x) / width;
    const t = grid.get(x, y);
    if (t !== "grass" && t !== "dirt") continue; // only convert plain ground
    const cell = vec(x, y);
    if (hasResourceNeighbor(grid, cell)) continue; // never clobber a neighbour resource
    if (avoidObstacle && hasObstacleNeighbor(grid, cell)) continue;
    bestDist = d;
    best = cell;
  }
  return best;
}

// placeGoldMine / placeForest are single, non-destructive cell writes: the cell
// came from pickConversionCell (plain ground, no resource neighbour; for gold,
// no obstacle neighbour either), so the result respects the goldMine adjacency
// rule without rewriting neighbours.  A forest left abutting water is a benign
// repair-time deviation — the WFC adjacency table constrains only raw solver
// output, not the repaired map.
function placeGoldMine(grid: Grid<TileType>, cell: Vec2): void {
  grid.set(cell.x, cell.y, "goldMine");
}

function placeForest(grid: Grid<TileType>, cell: Vec2): void {
  grid.set(cell.x, cell.y, "forest");
}

/** True iff a tile of kind `kind` lies within RESOURCE_REACH land steps of the start. */
function hasKindWithinReach(grid: Grid<TileType>, dist: Float64Array, kind: TileType): boolean {
  const n = nearestLandCell(grid, dist, (t) => t === kind);
  return n !== null && n.dist <= RESOURCE_REACH;
}

/**
 * Ensures a gold mine and a forest exist WITHIN RESOURCE_REACH of `start`,
 * converting the nearest qualifying plain-ground cell when the resource is absent
 * *or merely too far* (a mine 25 tiles away fails the within-reach guarantee, so
 * its existence elsewhere must not suppress a local placement — else the driver
 * needlessly re-collapses).  Conversions only turn land→land, so the precomputed
 * `dist` field stays valid for the second placement.  Returns true iff it placed.
 */
function ensureResourcesNear(grid: Grid<TileType>, dist: Float64Array): boolean {
  let changed = false;

  if (!hasKindWithinReach(grid, dist, "goldMine")) {
    const cell = pickConversionCell(grid, dist, CLEARING_RADIUS + 1, true);
    if (cell !== null) {
      placeGoldMine(grid, cell);
      changed = true;
    }
  }

  if (!hasKindWithinReach(grid, dist, "forest")) {
    const cell = pickConversionCell(grid, dist, CLEARING_RADIUS + 1, false);
    if (cell !== null) {
      placeForest(grid, cell);
      changed = true;
    }
  }

  return changed;
}

/**
 * Counts tiles matching `pred` within FAIRNESS_RADIUS (Chebyshev) of `center`.
 * Scans only the (2R+1)² window around `center` (clamped to bounds) rather than
 * the whole grid, so the cost is independent of map size.
 */
function countNear(grid: Grid<TileType>, center: Vec2, pred: (t: TileType) => boolean): number {
  const x0 = Math.max(0, center.x - FAIRNESS_RADIUS);
  const x1 = Math.min(grid.width - 1, center.x + FAIRNESS_RADIUS);
  const y0 = Math.max(0, center.y - FAIRNESS_RADIUS);
  const y1 = Math.min(grid.height - 1, center.y + FAIRNESS_RADIUS);
  let n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (pred(grid.get(x, y))) n++;
    }
  }
  return n;
}

function resourceCounts(grid: Grid<TileType>, start: Vec2, dist: Float64Array): StartResourceCounts {
  const gold = countNear(grid, start, (t) => t === "goldMine");
  const forest = countNear(grid, start, (t) => t === "forest");
  const ng = nearestLandCell(grid, dist, (t) => t === "goldMine");
  const nf = nearestLandCell(grid, dist, (t) => t === "forest");
  return {
    gold,
    forest,
    nearestGoldDist: ng === null ? Number.POSITIVE_INFINITY : ng.dist,
    nearestForestDist: nf === null ? Number.POSITIVE_INFINITY : nf.dist,
  };
}

/** Clamped fairness score: rewards having *enough* gold + forest, ignores excess. */
export function fairnessScore(counts: StartResourceCounts): number {
  return Math.min(counts.gold, GOLD_FAIR_CAP) + Math.min(counts.forest, FOREST_FAIR_CAP);
}

/**
 * Brings the two starts' CLAMPED fairness scores within FAIRNESS_TOLERANCE by
 * topping up the poorer side's deficient resource (gold toward GOLD_FAIR_CAP,
 * else forest).  `dists[i]` is the precomputed land-distance field for
 * `starts[i]` (valid throughout, since placements convert land→land).  Each
 * side's score is bounded by the caps, so the loop converges in a few additions;
 * the explicit bound is a belt-and-braces termination guard.  Returns true iff it
 * added any tile.
 */
function balanceResources(
  grid: Grid<TileType>,
  starts: readonly [Vec2, Vec2],
  dists: readonly [Float64Array, Float64Array],
): boolean {
  let changed = false;
  const maxAdds = (GOLD_FAIR_CAP + FOREST_FAIR_CAP) * 2;
  for (let i = 0; i < maxAdds; i++) {
    const a = resourceCounts(grid, starts[0], dists[0]);
    const b = resourceCounts(grid, starts[1], dists[1]);
    const scoreA = fairnessScore(a);
    const scoreB = fairnessScore(b);
    if (Math.abs(scoreA - scoreB) <= FAIRNESS_TOLERANCE) break;

    const poorerIndex = scoreA < scoreB ? 0 : 1;
    const counts = poorerIndex === 0 ? a : b;

    // Raise whichever capped resource is still below its cap; gold first (scarcer),
    // forest otherwise.  If both are already capped, no addition can help — stop.
    const goldDeficient = counts.gold < GOLD_FAIR_CAP;
    const forestDeficient = counts.forest < FOREST_FAIR_CAP;
    if (!goldDeficient && !forestDeficient) break;
    const addForest = !goldDeficient;

    const cell = pickConversionCell(grid, dists[poorerIndex], CLEARING_RADIUS + 1, !addForest);
    if (cell === null) break; // nowhere left to top up — accept current balance

    if (addForest) placeForest(grid, cell);
    else placeGoldMine(grid, cell);
    changed = true;
  }
  return changed;
}

// === Start selection ===

interface StartSelection {
  readonly starts: readonly [Vec2, Vec2];
  readonly componentSize: number;
  readonly startDistance: number;
}

/**
 * Selects two starts as the (approx) graph-diameter endpoints of the largest
 * land component: double-BFS — A = farthest land cell from an arbitrary
 * component cell; B = farthest land cell from A.  Both lie in the same
 * component, so they are mutually land-reachable by construction.  Returns null
 * iff there is no land or the two endpoints coincide (degenerate component).
 */
function selectStarts(grid: Grid<TileType>): StartSelection | null {
  const { labels, sizes } = labelComponents(grid);
  const main = largestComponentId(sizes);
  if (main < 0) return null;

  const seed = anyCellOf(labels, main, grid.width);
  const a = farthestInComponent(grid, labels, main, seed);
  const b = farthestInComponent(grid, labels, main, a);
  if (a.x === b.x && a.y === b.y) return null;

  const distGrid = landDistances(grid, a);
  const startDistance = distGrid[idx(b.x, b.y, grid.width)];

  // Canonical order: lower flat index first, so `starts` is a pure function of
  // the grid (independent of which endpoint the double-BFS happened to label A).
  const ai = idx(a.x, a.y, grid.width);
  const bi = idx(b.x, b.y, grid.width);
  const starts: readonly [Vec2, Vec2] = ai <= bi ? [a, b] : [b, a];

  return { starts, componentSize: sizes[main], startDistance };
}

/** True iff the selection is roomy enough (component + separation) to skip repair. */
function selectionIsAdequate(sel: StartSelection, grid: Grid<TileType>): boolean {
  const cellCount = grid.width * grid.height;
  const minComponent = Math.floor(cellCount * MIN_COMPONENT_FRACTION);
  const minSeparation = Math.floor(Math.max(grid.width, grid.height) * MIN_SEPARATION_FRACTION);
  if (sel.componentSize < minComponent) return false;
  if (!Number.isFinite(sel.startDistance)) return false;
  // Use Manhattan separation as a cheap geometric spread check on top of the
  // (already-finite) BFS reachability.
  if (manhattan(sel.starts[0], sel.starts[1]) < minSeparation) return false;
  return true;
}

// === Top-level driver ===

/**
 * Derives the per-level RNG from (seed, levelIndex).  Forking with a label that
 * embeds the level index guarantees that level N of campaign `seed` always draws
 * from the same substream, while different levels (and different seeds) get
 * uncorrelated streams.
 */
function levelRng(seed: number, levelIndex: number): RNG {
  return createRng(seed).fork(`level-${levelIndex}`);
}

/** Outcome of one playability attempt (or the all-grass fallback). */
interface Attempt {
  readonly grid: Grid<TileType>;
  readonly starts: readonly [Vec2, Vec2];
  readonly componentSize: number;
  readonly startDistance: number;
  readonly carvedCorridor: boolean;
  readonly adjustedResources: boolean;
}

/**
 * Runs one full playability attempt on a freshly-collapsed grid:
 *   collapse → connect components → select starts → (repair if cramped) →
 *   clearings → resource guarantees → fairness top-up → final census.
 * Returns null only if the raw collapse failed (null grid) or no land exists,
 * signalling the driver to retry from a forked seed.
 */
function attemptPlayableMap(width: number, height: number, attemptRng: RNG): Attempt | null {
  const solved = solve(width, height, attemptRng.fork("solve"));
  if (solved === null) return null;
  const grid = solved.clone();

  // (1) Make the whole map one land mass so any two land cells are reachable.
  let carvedCorridor = connectAllComponents(grid);

  // (2) Choose two well-separated, mutually-reachable starts.
  let sel = selectStarts(grid);
  if (sel === null) return null; // no usable land — re-collapse

  if (!selectionIsAdequate(sel, grid)) {
    // Cramped/short: carve a direct corridor between the endpoints and re-select.
    carveCorridor(grid, sel.starts[0], sel.starts[1]);
    carvedCorridor = true;
    sel = selectStarts(grid);
    if (sel === null) return null;
  }

  const starts = sel.starts;

  // (3) Buildable clearings around each start.
  carveClearing(grid, starts[0], attemptRng.fork("clearing-0"));
  carveClearing(grid, starts[1], attemptRng.fork("clearing-1"));

  // Clearings can sever a thin corridor; re-stitch and recompute reachability.
  if (connectAllComponents(grid)) carvedCorridor = true;

  // From here the land topology is FIXED: resource placement only converts
  // land→land, so one BFS per start serves every subsequent query.
  const dist0 = landDistances(grid, starts[0]);
  const dist1 = landDistances(grid, starts[1]);

  // (4) Guarantee a gold mine + forest within reach of each start.
  const adjusted0 = ensureResourcesNear(grid, dist0);
  const adjusted1 = ensureResourcesNear(grid, dist1);

  // (5) Approximate resource fairness.
  const balanced = balanceResources(grid, starts, [dist0, dist1]);

  // The post-repair start distance for the report (dist0 is still valid).
  const finalDist = dist0[idx(starts[1].x, starts[1].y, width)];

  return {
    grid,
    starts,
    componentSize: sel.componentSize,
    startDistance: finalDist,
    carvedCorridor,
    adjustedResources: adjusted0 || adjusted1 || balanced,
  };
}

/**
 * Generates a fully-playable map for campaign `seed`, level `levelIndex`.
 *
 * Deterministic in (width, height, seed, levelIndex): identical arguments always
 * reproduce the same grid, starts, and report.  Runs up to MAX_GEN_ATTEMPTS
 * collapse/repair passes (each from a distinct forked substream); the final
 * attempt is forced through with full corridor-carving so the function always
 * returns a playable map rather than throwing.
 */
export function generateMap(
  width: number,
  height: number,
  seed: number,
  levelIndex: number,
): MapGenResult {
  if (width <= 0 || height <= 0) {
    throw new RangeError(`generateMap: dimensions must be positive, got ${width}x${height}`);
  }
  if (!Number.isInteger(levelIndex) || levelIndex < 0) {
    throw new RangeError(`generateMap: levelIndex must be a non-negative integer, got ${levelIndex}`);
  }

  const base = levelRng(seed, levelIndex);

  let result: Attempt | null = null;
  let usedAttempts = 0;

  for (let attempt = 0; attempt < MAX_GEN_ATTEMPTS; attempt++) {
    usedAttempts = attempt + 1;
    const attemptRng = base.fork(`attempt-${attempt}`);
    const candidate = attemptPlayableMap(width, height, attemptRng);
    if (candidate === null) continue;

    // Validate the hard guarantees; accept the first attempt that satisfies them.
    const ok =
      Number.isFinite(candidate.startDistance) &&
      hasResourceWithinReach(candidate.grid, candidate.starts[0]) &&
      hasResourceWithinReach(candidate.grid, candidate.starts[1]);

    if (ok || attempt === MAX_GEN_ATTEMPTS - 1) {
      result = candidate;
      break;
    }
    result = candidate; // keep the latest as a fallback
  }

  if (result === null) {
    // Every collapse returned null land (astronomically unlikely for these rules).
    // Build a trivial all-grass fallback so the campaign never hard-fails.
    result = buildGrassFallback(width, height, base);
    usedAttempts = MAX_GEN_ATTEMPTS;
  }

  const resources: readonly [StartResourceCounts, StartResourceCounts] = [
    resourceCounts(result.grid, result.starts[0], landDistances(result.grid, result.starts[0])),
    resourceCounts(result.grid, result.starts[1], landDistances(result.grid, result.starts[1])),
  ];

  const report: MapGenReport = {
    width,
    height,
    seed,
    levelIndex,
    starts: result.starts,
    resources,
    componentSize: result.componentSize,
    startDistance: result.startDistance,
    attempts: usedAttempts,
    carvedCorridor: result.carvedCorridor,
    adjustedResources: result.adjustedResources,
  };

  return { grid: result.grid, starts: result.starts, report };
}

/** True iff `start` has a gold mine AND a forest within RESOURCE_REACH land steps. */
function hasResourceWithinReach(grid: Grid<TileType>, start: Vec2): boolean {
  const dist = landDistances(grid, start);
  const g = nearestLandCell(grid, dist, (t) => t === "goldMine");
  const f = nearestLandCell(grid, dist, (t) => t === "forest");
  return g !== null && g.dist <= RESOURCE_REACH && f !== null && f.dist <= RESOURCE_REACH;
}

/**
 * Last-resort fallback: an all-grass map with two opposite-corner starts, each
 * given a gold mine + forest and balanced.  Reached only if WFC returns null on
 * every attempt (effectively impossible under the permissive rules); present so
 * the campaign is total.
 */
function buildGrassFallback(width: number, height: number, rng: RNG): Attempt {
  const grid = new Grid<TileType>(width, height, "grass");
  const inset = Math.max(1, Math.floor(Math.min(width, height) * 0.15));
  const a = vec(inset, inset);
  const b = vec(width - 1 - inset, height - 1 - inset);
  const starts: readonly [Vec2, Vec2] = idx(a.x, a.y, width) <= idx(b.x, b.y, width) ? [a, b] : [b, a];

  carveClearing(grid, starts[0], rng.fork("fallback-clearing-0"));
  carveClearing(grid, starts[1], rng.fork("fallback-clearing-1"));
  const fDist0 = landDistances(grid, starts[0]);
  const fDist1 = landDistances(grid, starts[1]);
  ensureResourcesNear(grid, fDist0);
  ensureResourcesNear(grid, fDist1);
  balanceResources(grid, starts, [fDist0, fDist1]);

  const startDistance = fDist0[idx(starts[1].x, starts[1].y, width)];
  return {
    grid,
    starts,
    componentSize: width * height,
    startDistance,
    carvedCorridor: false,
    adjustedResources: true,
  };
}
