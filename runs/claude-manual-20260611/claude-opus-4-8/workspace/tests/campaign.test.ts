/**
 * Campaign tests (T18).
 *
 * Verifies the three properties the acceptance focuses on:
 *   (a) DETERMINISM — a fixed campaign seed reproduces ALL FIVE level maps
 *       bit-identically across repeated calls;
 *   (b) ESCALATION — later levels have STRICTLY LARGER dimensions AND a higher
 *       AI difficulty than earlier ones;
 *   (c) DISTINCTNESS — the five per-level seeds (and hence maps) are pairwise
 *       distinct.
 * Plus the headless progression contract (no `localStorage` ⇒ only level 0
 * unlocked; winning a level reports the next as unlocked).
 *
 * Performance note: generating the larger maps (80×80, 96×96) via genuine WFC
 * costs a few seconds each. Each level's two independent generations are
 * therefore computed ONCE in `beforeAll` (yielding to the event loop between
 * levels so the vitest worker keeps reporting), and the individual `it` blocks
 * only do cheap string comparisons over the cached results.
 */

import { describe, it, expect, beforeAll } from "vitest";

import {
  CAMPAIGN_LEVELS,
  CAMPAIGN_LEVEL_COUNT,
  campaignLevel,
  levelSeed,
  levelMap,
  isLevelUnlocked,
  unlockedLevels,
  recordVictory,
} from "../src/game/campaign.js";
import type { MapGenResult } from "../src/wfc/mapgen.js";
import type { Grid } from "../src/core/grid.js";
import type { TileType } from "../src/wfc/tiles.js";

/** Fixed campaign seed used across the determinism/distinctness checks. */
const CAMPAIGN_SEED = 1234567;

/** Serialises a tile grid (dimensions + every tile) to a comparable string. */
function serializeGrid(grid: Grid<TileType>): string {
  const parts: string[] = [`${grid.width}x${grid.height}`];
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      parts.push(grid.get(x, y));
    }
  }
  return parts.join(",");
}

/** Serialises the full map result (grid + starts) for equality. */
function serializeMap(result: MapGenResult): string {
  const s = result.starts;
  return `${serializeGrid(result.grid)}|starts=${s[0].x},${s[0].y};${s[1].x},${s[1].y}`;
}

/** Two independent generations of each level's map, serialized — filled in beforeAll. */
interface LevelPair {
  readonly width: number;
  readonly height: number;
  readonly callA: string;
  readonly callB: string;
}

const pairs: LevelPair[] = [];

beforeAll(async () => {
  for (let i = 0; i < CAMPAIGN_LEVEL_COUNT; i++) {
    const a = levelMap(CAMPAIGN_SEED, i);
    const b = levelMap(CAMPAIGN_SEED, i);
    pairs.push({
      width: a.grid.width,
      height: a.grid.height,
      callA: serializeMap(a),
      callB: serializeMap(b),
    });
    // Yield so the worker can flush a heartbeat between the heavy generations.
    await new Promise((resolve) => setImmediate(resolve));
  }
}, 120_000);

describe("campaign levels", () => {
  it("defines exactly five named levels in order", () => {
    expect(CAMPAIGN_LEVEL_COUNT).toBe(5);
    expect(CAMPAIGN_LEVELS.map((l) => l.name)).toEqual([
      "Greenfields",
      "Riverbend",
      "Stonewatch",
      "The Narrows",
      "Ironhold",
    ]);
    CAMPAIGN_LEVELS.forEach((l, i) => expect(l.index).toBe(i));
  });

  it("escalates: dimensions strictly grow AND AI difficulty strictly rises", () => {
    for (let i = 1; i < CAMPAIGN_LEVEL_COUNT; i++) {
      const prev = CAMPAIGN_LEVELS[i - 1];
      const cur = CAMPAIGN_LEVELS[i];
      expect(cur.width).toBeGreaterThan(prev.width);
      expect(cur.height).toBeGreaterThan(prev.height);
      expect(cur.aiDifficulty).toBeGreaterThan(prev.aiDifficulty);
    }
    // Concrete endpoints from the spec.
    expect(CAMPAIGN_LEVELS[0].width).toBe(32);
    expect(CAMPAIGN_LEVELS[0].aiDifficulty).toBe(1);
    expect(CAMPAIGN_LEVELS[4].width).toBe(96);
    expect(CAMPAIGN_LEVELS[4].aiDifficulty).toBe(5);
  });
});

describe("campaign map derivation", () => {
  it("is DETERMINISTIC: a fixed seed reproduces all 5 level maps across calls", () => {
    expect(pairs).toHaveLength(CAMPAIGN_LEVEL_COUNT);
    for (let i = 0; i < CAMPAIGN_LEVEL_COUNT; i++) {
      // Two independent generations of the same (seed, level) are byte-identical.
      expect(pairs[i].callB).toBe(pairs[i].callA);
      // The generated grid carries the level's declared dimensions.
      const level = campaignLevel(i);
      expect(pairs[i].width).toBe(level.width);
      expect(pairs[i].height).toBe(level.height);
    }
  });

  it("produces DISTINCT per-level seeds (all five pairwise different)", () => {
    const seeds = CAMPAIGN_LEVELS.map((l) => levelSeed(CAMPAIGN_SEED, l.index));
    expect(new Set(seeds).size).toBe(CAMPAIGN_LEVEL_COUNT);
  });

  it("produces DISTINCT maps for the five levels (no two identical)", () => {
    const serialized = pairs.map((p) => p.callA);
    expect(new Set(serialized).size).toBe(CAMPAIGN_LEVEL_COUNT);
  });

  it("derives different maps for different campaign seeds at the same level", () => {
    // Smallest level (32×32) keeps this cross-seed check cheap.
    const a = serializeMap(levelMap(CAMPAIGN_SEED, 0));
    const b = serializeMap(levelMap(CAMPAIGN_SEED + 1, 0));
    expect(b).not.toBe(a);
  });
});

describe("campaign progression (headless / no localStorage)", () => {
  it("starts with only level 0 unlocked when storage is unavailable", () => {
    // The vitest 'node' environment provides no localStorage, exercising the
    // in-memory default path.
    expect(unlockedLevels()).toEqual([0]);
    expect(isLevelUnlocked(0)).toBe(true);
    expect(isLevelUnlocked(1)).toBe(false);
  });

  it("recordVictory reports the next level as unlocked, and null on the last", () => {
    expect(recordVictory(0)).toBe(1);
    expect(recordVictory(3)).toBe(4);
    expect(recordVictory(CAMPAIGN_LEVEL_COUNT - 1)).toBeNull();
  });

  it("rejects an invalid level index", () => {
    expect(() => recordVictory(-1)).toThrow();
    expect(() => campaignLevel(99)).toThrow();
  });
});
