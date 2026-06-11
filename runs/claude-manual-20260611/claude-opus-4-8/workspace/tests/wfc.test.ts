import { describe, it, expect } from "vitest";
import { createRng } from "../src/core/rng.js";
import { Grid } from "../src/core/grid.js";
import type { Vec2 } from "../src/core/vec.js";
import { solve } from "../src/wfc/wfc.js";
import {
  ADJACENCY,
  TILE_TYPES,
  adjacencySymmetryViolations,
} from "../src/wfc/tiles.js";
import type { TileType } from "../src/wfc/tiles.js";
import { generateMap, fairnessScore } from "../src/wfc/mapgen.js";
import type { MapGenResult } from "../src/wfc/mapgen.js";

/** True iff tile `a` is permitted orthogonally adjacent to tile `b`. */
function adjacent(a: TileType, b: TileType): boolean {
  return ADJACENCY[a].includes(b);
}

/**
 * Returns the first orthogonally-adjacent output pair that VIOLATES the
 * adjacency table, or null if every orthogonal pair is legal.
 */
function firstAdjacencyViolation(
  g: Grid<TileType>,
): { a: TileType; b: TileType; x: number; y: number } | null {
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      const a = g.get(x, y);
      if (x + 1 < g.width) {
        const b = g.get(x + 1, y);
        if (!adjacent(a, b)) return { a, b, x, y };
      }
      if (y + 1 < g.height) {
        const b = g.get(x, y + 1);
        if (!adjacent(a, b)) return { a, b, x, y };
      }
    }
  }
  return null;
}

function flatten(g: Grid<TileType>): TileType[] {
  const out: TileType[] = [];
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) out.push(g.get(x, y));
  }
  return out;
}

// ---------------------------------------------------------------------------
// (a) The adjacency table is SYMMETRIC: ∀ A allows B ⟺ B allows A.
// ---------------------------------------------------------------------------
describe("WFC adjacency table", () => {
  it("is symmetric for every tile pair", () => {
    expect(adjacencySymmetryViolations()).toEqual([]);
  });

  it("never permits goldMine next to water (forbidden-adjacency spot check)", () => {
    // (e) concrete forbidden adjacency, asserted directly on the rule table.
    expect(adjacent("goldMine", "water")).toBe(false);
    expect(adjacent("water", "goldMine")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (b) Propagation correctness: every orthogonal output pair is legal,
//     across several map sizes.
// ---------------------------------------------------------------------------
describe("WFC solve — propagation correctness", () => {
  const sizes: ReadonlyArray<readonly [number, number]> = [
    [8, 8],
    [16, 12],
    [24, 24],
    [32, 20],
  ];

  for (const [w, h] of sizes) {
    it(`produces only legal orthogonal adjacencies on ${w}x${h}`, () => {
      const g = solve(w, h, createRng(12345));
      expect(g).not.toBeNull();
      const grid = g!;
      expect(grid.width).toBe(w);
      expect(grid.height).toBe(h);
      // Every emitted tile is a known tile type.
      for (const t of flatten(grid)) {
        expect(TILE_TYPES).toContain(t);
      }
      // No orthogonally-adjacent pair violates the adjacency table.
      expect(firstAdjacencyViolation(grid)).toBeNull();
    });
  }

  it("never places a goldMine next to water in a solved grid", () => {
    // (e) the same forbidden adjacency, now checked on real solver output.
    const grid = solve(28, 28, createRng(99))!;
    expect(grid).not.toBeNull();
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        if (grid.get(x, y) !== "goldMine") continue;
        for (const [dx, dy] of [
          [0, -1],
          [1, 0],
          [0, 1],
          [-1, 0],
        ] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (grid.inBounds(nx, ny)) {
            expect(grid.get(nx, ny)).not.toBe("water");
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// (c) DETERMINISM: same seed twice ⇒ identical grids.
// ---------------------------------------------------------------------------
describe("WFC solve — determinism", () => {
  it("yields identical grids for the same seed", () => {
    const a = solve(20, 20, createRng(0xc0ffee))!;
    const b = solve(20, 20, createRng(0xc0ffee))!;
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(flatten(a)).toEqual(flatten(b));
  });

  // ---------------------------------------------------------------------------
  // (d) DIFFERENT seeds ⇒ (generally) different grids.
  // ---------------------------------------------------------------------------
  it("yields different grids for different seeds", () => {
    const a = solve(20, 20, createRng(1))!;
    const b = solve(20, 20, createRng(2))!;
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(flatten(a)).not.toEqual(flatten(b));
  });
});

// ===========================================================================
// Playability / repair pass — src/wfc/mapgen.ts (generateMap).
//
// These tests treat generateMap as a BLACK BOX: reachability and resource-reach
// are recomputed here with an INDEPENDENT flood-fill, so a defect in the
// module's own BFS cannot mask a defect in the map it produced.
// ===========================================================================

/**
 * The spec'd resource reach ("a gold mine AND forest within ≤ N tiles of each
 * start").  Kept in sync with RESOURCE_REACH in src/wfc/mapgen.ts; if the module
 * loosens that bound, this independent check must be updated deliberately.
 */
const RESOURCE_REACH = 10;
/** Independent passability predicate: land = NOT water and NOT rock. */
function isLandTile(t: TileType): boolean {
  return t !== "water" && t !== "rock";
}

/**
 * Independent 4-connected land BFS over a tile grid from `start`, returning a
 * distance map (land steps; Infinity = unreachable).  Deliberately a fresh
 * implementation, not the module's landDistances, so the assertions below
 * validate the OUTPUT map rather than re-using the code under test.
 */
function bfsLandDist(grid: Grid<TileType>, start: Vec2): Map<number, number> {
  const dist = new Map<number, number>();
  const key = (x: number, y: number): number => y * grid.width + x;
  if (!isLandTile(grid.get(start.x, start.y))) return dist;
  const offsets: ReadonlyArray<readonly [number, number]> = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];
  let frontier: Vec2[] = [start];
  dist.set(key(start.x, start.y), 0);
  while (frontier.length > 0) {
    const next: Vec2[] = [];
    for (const c of frontier) {
      const d = dist.get(key(c.x, c.y))! + 1;
      for (const [dx, dy] of offsets) {
        const nx = c.x + dx;
        const ny = c.y + dy;
        if (!grid.inBounds(nx, ny)) continue;
        if (!isLandTile(grid.get(nx, ny))) continue;
        const k = key(nx, ny);
        if (dist.has(k)) continue;
        dist.set(k, d);
        next.push({ x: nx, y: ny });
      }
    }
    frontier = next;
  }
  return dist;
}

/** Nearest land BFS distance from `start` to any tile of kind `kind`, or Infinity. */
function nearestKindDist(grid: Grid<TileType>, start: Vec2, kind: TileType): number {
  const dist = bfsLandDist(grid, start);
  let best = Number.POSITIVE_INFINITY;
  for (const [k, d] of dist) {
    const x = k % grid.width;
    const y = (k - x) / grid.width;
    if (grid.get(x, y) === kind && d < best) best = d;
  }
  return best;
}

/** Serialises a result's grid + starts + resource census for equality checks. */
function serialise(r: MapGenResult): string {
  const cells: TileType[] = [];
  for (let y = 0; y < r.grid.height; y++) {
    for (let x = 0; x < r.grid.width; x++) cells.push(r.grid.get(x, y));
  }
  return JSON.stringify({
    cells,
    starts: r.starts,
    resources: r.report.resources,
  });
}

/**
 * Test matrix.  Sizes are kept modest because the underlying WFC solver is
 * super-linear in cell count; the matrix still exercises several seeds, two map
 * sizes, and all 5 campaign levels.  Each (seed, size, level) map is generated
 * ONCE into `FIXTURES` and shared across assertion blocks (a)-(c) so the matrix
 * is not rebuilt per test.  The determinism block (d) regenerates only the
 * cheaper 24² subset to stay well inside the test timeout.
 */
const MAPGEN_SEEDS: readonly number[] = [1, 7, 12345, 0xc0ffee, 2024];
const MAPGEN_LEVELS = 5;
const RESOURCE_FAIR_TOLERANCE = 2;
const PRIMARY_SIZE: readonly [number, number] = [24, 24];
/** A handful of larger maps for size diversity (fewer, since 32² is ~3x costlier). */
const LARGER_SIZE: readonly [number, number] = [32, 32];
const LARGER_SEEDS: readonly number[] = [7, 2024];

interface Fixture {
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly level: number;
  readonly result: MapGenResult;
}

function buildFixtures(
  seeds: readonly number[],
  [width, height]: readonly [number, number],
): Fixture[] {
  return seeds.flatMap((seed) =>
    Array.from({ length: MAPGEN_LEVELS }, (_unused, level) => ({
      seed,
      width,
      height,
      level,
      result: generateMap(width, height, seed, level),
    })),
  );
}

/** Cheaper 24² maps, regenerated in the determinism check. */
const PRIMARY_FIXTURES: readonly Fixture[] = buildFixtures(MAPGEN_SEEDS, PRIMARY_SIZE);
/** All maps (24² + a few 32²) used by the property checks (a)-(c). */
const FIXTURES: readonly Fixture[] = [
  ...PRIMARY_FIXTURES,
  ...buildFixtures(LARGER_SEEDS, LARGER_SIZE),
];

// Generous per-test timeout: these are compute-bound property tests over many
// maps, not a hang risk; the bound guards against a pathological regression.
const MAPGEN_TEST_TIMEOUT_MS = 20_000;

describe("WFC mapgen — playability pass", () => {
  // -------------------------------------------------------------------------
  // (a) Two starts exist and are mutually land-reachable (independent BFS).
  // -------------------------------------------------------------------------
  it("places two distinct starts that are land-reachable from each other", () => {
    for (const { result } of FIXTURES) {
      const [a, b] = result.starts;

      // Two distinct, in-bounds start tiles.
      expect(result.starts).toHaveLength(2);
      expect(a).not.toEqual(b);
      expect(result.grid.inBounds(a.x, a.y)).toBe(true);
      expect(result.grid.inBounds(b.x, b.y)).toBe(true);

      // Both sit on land.
      expect(isLandTile(result.grid.get(a.x, a.y))).toBe(true);
      expect(isLandTile(result.grid.get(b.x, b.y))).toBe(true);

      // Mutually reachable: B appears in A's INDEPENDENT land-BFS.
      const distFromA = bfsLandDist(result.grid, a);
      const dAB = distFromA.get(b.y * result.grid.width + b.x);
      expect(dAB).toBeDefined();
      expect(Number.isFinite(dAB!)).toBe(true);
    }
  }, MAPGEN_TEST_TIMEOUT_MS);

  // -------------------------------------------------------------------------
  // (b) Each start has a gold mine AND a forest within the spec'd reach.
  // -------------------------------------------------------------------------
  it("guarantees a gold mine and a forest within reach of each start", () => {
    for (const { result } of FIXTURES) {
      for (const start of result.starts) {
        const goldDist = nearestKindDist(result.grid, start, "goldMine");
        const forestDist = nearestKindDist(result.grid, start, "forest");
        expect(goldDist).toBeLessThanOrEqual(RESOURCE_REACH);
        expect(forestDist).toBeLessThanOrEqual(RESOURCE_REACH);
      }
    }
  }, MAPGEN_TEST_TIMEOUT_MS);

  // -------------------------------------------------------------------------
  // (c) Approximate resource fairness: clamped scores within tolerance.
  // -------------------------------------------------------------------------
  it("keeps the two starts' resources fair within tolerance", () => {
    for (const { result } of FIXTURES) {
      const [ra, rb] = result.report.resources;
      // Each start has at least some of each resource near it.
      expect(ra.gold).toBeGreaterThan(0);
      expect(rb.gold).toBeGreaterThan(0);
      expect(ra.forest).toBeGreaterThan(0);
      expect(rb.forest).toBeGreaterThan(0);
      // Clamped fairness scores differ by at most the tolerance.
      const diff = Math.abs(fairnessScore(ra) - fairnessScore(rb));
      expect(diff).toBeLessThanOrEqual(RESOURCE_FAIR_TOLERANCE);
    }
  }, MAPGEN_TEST_TIMEOUT_MS);

  // -------------------------------------------------------------------------
  // (d) Full determinism: same (seed, level) ⇒ identical grid + starts +
  //     report resources.  Regenerates a SECOND time and compares byte-for-byte
  //     against the shared fixture, across every seed in the matrix.
  // -------------------------------------------------------------------------
  it("is fully deterministic in (seed, level) across several seeds", () => {
    // Regenerate the cheaper 24² subset (every seed, all levels) and compare
    // byte-for-byte against the shared fixture.
    for (const { seed, width, height, level, result } of PRIMARY_FIXTURES) {
      const again = generateMap(width, height, seed, level);
      expect(serialise(again)).toBe(serialise(result));
    }
    // Different levels of the same campaign seed differ (sanity: not a constant map).
    const lvl0 = generateMap(32, 32, 777, 0);
    const lvl1 = generateMap(32, 32, 777, 1);
    expect(serialise(lvl0)).not.toBe(serialise(lvl1));
  }, MAPGEN_TEST_TIMEOUT_MS);
});
