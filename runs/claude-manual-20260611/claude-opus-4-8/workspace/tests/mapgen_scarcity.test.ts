/**
 * D5 — per-level terrain scarcity is now an actual mapgen knob.
 *
 * `generateMap(w, h, seed, level, { scarcity })` takes a 0..1 scarcity factor
 * (default 0 = previous behaviour). At higher values the WFC solve raises the
 * weight of constrained terrain (water / rock) and lowers that of free resources
 * (forest / goldMine). The playability / repair pass is scarcity-independent, so
 * the hard guarantees (two reachable starts, gold + forest within reach of each)
 * still hold at every scarcity level — verified here with an INDEPENDENT BFS so a
 * defect in the module's own reachability code cannot mask a bad output map.
 *
 * `levelMap` threads each `CampaignLevel.scarcity` through, so later campaign
 * levels are deterministically more constrained than `Greenfields` (level 0,
 * scarcity 0).
 */

import { describe, it, expect } from "vitest";
import type { Grid } from "../src/core/grid.js";
import type { Vec2 } from "../src/core/vec.js";
import { generateMap } from "../src/wfc/mapgen.js";
import type { MapGenResult } from "../src/wfc/mapgen.js";
import { campaignLevel, levelMap } from "../src/game/campaign.js";
import type { TileType } from "../src/wfc/tiles.js";

// --- Independent passability + reachability (a fresh implementation, NOT the
//     module's own landDistances, so it validates the produced map). ---

/** Independent passability predicate: land = NOT water and NOT rock. */
function isLandTile(t: TileType): boolean {
  return t !== "water" && t !== "rock";
}

const RESOURCE_REACH = 10;

/** Independent 4-connected land BFS from `start` → distance map (Infinity = unreachable). */
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

/** Census of the grid: constrained tiles (water+rock) and free resources (gold+forest). */
function census(grid: Grid<TileType>): { waterRock: number; freeResources: number } {
  let waterRock = 0;
  let freeResources = 0;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const t = grid.get(x, y);
      if (t === "water" || t === "rock") waterRock++;
      else if (t === "goldMine" || t === "forest") freeResources++;
    }
  }
  return { waterRock, freeResources };
}

/** Asserts the hard playability guarantees on a produced map via INDEPENDENT BFS. */
function expectPlayable(result: MapGenResult): void {
  const [a, b] = result.starts;
  expect(a).not.toEqual(b);
  // Both starts on land and mutually reachable.
  expect(isLandTile(result.grid.get(a.x, a.y))).toBe(true);
  expect(isLandTile(result.grid.get(b.x, b.y))).toBe(true);
  const dAB = bfsLandDist(result.grid, a).get(b.y * result.grid.width + b.x);
  expect(dAB).toBeDefined();
  expect(Number.isFinite(dAB!)).toBe(true);
  // Each start has a gold mine AND a forest within reach.
  for (const start of result.starts) {
    expect(nearestKindDist(result.grid, start, "goldMine")).toBeLessThanOrEqual(RESOURCE_REACH);
    expect(nearestKindDist(result.grid, start, "forest")).toBeLessThanOrEqual(RESOURCE_REACH);
  }
}

const SEEDS: readonly number[] = [1, 7, 12345, 2024];
const SIZE = 24;
const HIGH_SCARCITY = 0.85;
const TEST_TIMEOUT_MS = 30_000;

describe("D5 — generateMap scarcity knob", () => {
  it("a scarcity:0 call is byte-identical to the no-options (default) call", () => {
    // The default path must be unchanged so existing 4-arg call sites and tests
    // see exactly the historical map.
    for (const seed of SEEDS) {
      const withOpts = generateMap(SIZE, SIZE, seed, 0, { scarcity: 0 });
      const noOpts = generateMap(SIZE, SIZE, seed, 0);
      expect(serialise(withOpts)).toBe(serialise(noOpts));
    }
  }, TEST_TIMEOUT_MS);

  it(
    "higher scarcity yields MORE water+rock and FEWER free resources, for the same seed",
    () => {
      for (const seed of SEEDS) {
        const low = generateMap(SIZE, SIZE, seed, 0, { scarcity: 0 });
        const high = generateMap(SIZE, SIZE, seed, 0, { scarcity: HIGH_SCARCITY });

        const cLow = census(low.grid);
        const cHigh = census(high.grid);

        // Constrained terrain rises; free resources fall. Both hold per-seed at
        // the 0 → 0.85 extremes (the WFC weights are biased that way).
        expect(
          cHigh.waterRock,
          `seed ${seed}: water+rock should rise (low=${cLow.waterRock}, high=${cHigh.waterRock})`,
        ).toBeGreaterThan(cLow.waterRock);
        expect(
          cHigh.freeResources,
          `seed ${seed}: gold+forest should fall (low=${cLow.freeResources}, high=${cHigh.freeResources})`,
        ).toBeLessThan(cLow.freeResources);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "still guarantees a playable map (two reachable starts, gold+forest in reach) at high scarcity",
    () => {
      for (const seed of SEEDS) {
        const high = generateMap(SIZE, SIZE, seed, 0, { scarcity: HIGH_SCARCITY });
        expectPlayable(high);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it("is deterministic in (seed, level, scarcity): identical args reproduce the map", () => {
    for (const seed of SEEDS) {
      const a = generateMap(SIZE, SIZE, seed, 0, { scarcity: HIGH_SCARCITY });
      const b = generateMap(SIZE, SIZE, seed, 0, { scarcity: HIGH_SCARCITY });
      expect(serialise(a)).toBe(serialise(b));
    }
  }, TEST_TIMEOUT_MS);

  it("clamps out-of-range scarcity: >1 behaves as 1, <0 behaves as 0", () => {
    // Clamp invariants keep the knob total: scarcity 2 == scarcity 1, scarcity
    // -1 == scarcity 0 (== the default path).
    const seed = 7;
    expect(serialise(generateMap(SIZE, SIZE, seed, 0, { scarcity: 2 }))).toBe(
      serialise(generateMap(SIZE, SIZE, seed, 0, { scarcity: 1 })),
    );
    expect(serialise(generateMap(SIZE, SIZE, seed, 0, { scarcity: -1 }))).toBe(
      serialise(generateMap(SIZE, SIZE, seed, 0)),
    );
  }, TEST_TIMEOUT_MS);
});

describe("D5 — campaign levels thread rising scarcity into levelMap", () => {
  it("declares strictly non-decreasing scarcity, starting at 0 and rising above it", () => {
    const scarcities = [0, 1, 2, 3, 4].map((i) => campaignLevel(i).scarcity);
    expect(scarcities[0]).toBe(0); // level 0 == historical behaviour
    for (let i = 1; i < scarcities.length; i++) {
      expect(scarcities[i]).toBeGreaterThan(scarcities[i - 1]);
    }
    for (const s of scarcities) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });

  it(
    "levelMap applies each level's scarcity: a constrained level keeps the playability guarantees",
    () => {
      // Generate the two smallest levels (32², 48²) so the check stays cheap; the
      // higher-scarcity level (1) must still be playable. (Levels 2-4 share the
      // same scarcity-independent repair pass; campaign.test.ts covers all five.)
      const CAMPAIGN_SEED = 4242;
      for (const levelIndex of [0, 1]) {
        const result = levelMap(CAMPAIGN_SEED, levelIndex);
        expectPlayable(result);
      }
    },
    TEST_TIMEOUT_MS,
  );
});

/** Serialises a result's grid + starts for byte-equality checks. */
function serialise(r: MapGenResult): string {
  const cells: TileType[] = [];
  for (let y = 0; y < r.grid.height; y++) {
    for (let x = 0; x < r.grid.width; x++) cells.push(r.grid.get(x, y));
  }
  return JSON.stringify({ cells, starts: r.starts });
}
