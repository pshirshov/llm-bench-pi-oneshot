// High-level entry: produce a fully playable map + starts for a given
// (campaignSeed, level) combination. Deterministic for fixed inputs.

import { Rng } from "./rng.js";
import { generateWfc, densitiesForLevel, WfcOptions } from "./wfc.js";
import { generatePlayableMap, PlayabilityResult } from "./playability.js";
import { SIM_CONSTANTS } from "./stats.js";
import { GameMap } from "./map.js";
import { TILE, isWalkableTile } from "./tiles.js";
import { HARVEST } from "./stats.js";

export interface CampaignLevelInfo {
  readonly level: number;
  readonly size: number;
  readonly difficulty: number;
  readonly result: PlayabilityResult;
}

/** Initialize a level 1..5: returns the map, starts, and difficulty. */
export function setupLevel(campaignSeed: number, level: number): CampaignLevelInfo {
  const idx = Math.max(1, Math.min(5, level)) - 1;
  const size = SIM_CONSTANTS.mapSizes[idx] as number;
  const difficulty = SIM_CONSTANTS.levelDifficulty[idx] as number;
  const densities = densitiesForLevel(level);
  const rng = makeLevelRng(campaignSeed, level);
  const result = generatePlayableMap({
    rng,
    maxCollapseAttempts: 6,
    wfcFactory: (child: Rng) => {
      const wfcOpts: WfcOptions = {
        width: size,
        height: size,
        forestDensity: densities.forestDensity,
        waterDensity: densities.waterDensity,
        rockDensity: densities.rockDensity,
        goldDensity: densities.goldDensity,
        grassBorder: true,
      };
      const wfcRes = generateWfc({ ...wfcOpts, rng: child, maxAttempts: 3 });
      return { width: wfcRes.map.width, height: wfcRes.map.height, map: wfcRes.map };
    },
  });
  // Initialize per-tile deposits: every gold mine starts with HARVEST.mineGold,
  // every forest tile with HARVEST.forestWood.
  initDeposits(result.map);
  return { level, size, difficulty, result };
}

export function makeLevelRng(campaignSeed: number, level: number): Rng {
  // Derive a sub-seed deterministically.
  let h = 2166136261 >>> 0;
  const s = `${campaignSeed}|level|${level}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return new (class {
    private state: number;
    public readonly seed: number;
    constructor(seed: number) {
      this.seed = seed >>> 0;
      let x = this.seed | 0;
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      this.state = x | 0;
    }
    next(): number {
      let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    int(n: number): number {
      if (n <= 0) return 0;
      return Math.floor(this.next() * n);
    }
    range(a: number, b: number): number {
      return a + this.int(b - a + 1);
    }
    shuffle<T>(arr: T[]): T[] {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = this.int(i + 1);
        const tmp = arr[i] as T;
        arr[i] = arr[j] as T;
        arr[j] = tmp;
      }
      return arr;
    }
    chance(p: number): boolean {
      return this.next() < p;
    }
    pick<T>(values: readonly T[]): T {
      if (values.length === 0) throw new Error("empty pick");
      return values[this.int(values.length)] as T;
    }
    child(tag: string | number): Rng {
      let hh = 2166136261 >>> 0;
      const ss = `${this.seed}::${tag}`;
      for (let i = 0; i < ss.length; i++) {
        hh ^= ss.charCodeAt(i);
        hh = Math.imul(hh, 16777619);
      }
      return makeLevelRng(hh >>> 0, 1);
    }
  })(h);
}

function initDeposits(map: GameMap): void {
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = map.get(x, y);
      if (t === TILE.GOLD_MINE) {
        map.mineGold[map.idx(x, y)] = HARVEST.mineGold;
      } else if (t === TILE.FOREST) {
        map.forestWood[map.idx(x, y)] = HARVEST.forestWood;
      }
    }
  }
}

/** Helper: returns the count of walkable tiles (for tests). */
export function walkableCount(map: GameMap): number {
  let n = 0;
  for (const t of map.tiles) if (isWalkableTile(t)) n++;
  return n;
}
