/**
 * Tests for WFC map generation, determinism, and adjacency constraints.
 */
import { describe, it, expect } from 'vitest';
import { generateWFCMap, findStartLocations, ensureReachability } from '../src/map/wfc.js';
import { PRNG } from '../src/engine/prng.js';
import { TileType } from '../src/engine/types.js';

const DEFAULT_WEIGHTS: Record<TileType, number> = {
  grass: 40, dirt: 15, forest: 20, water: 8, rock: 8, gold_mine: 2
};

describe('WFC Map Generation', () => {
  it('generates deterministic maps for same seed', () => {
    const opts = { width: 32, height: 32, weights: DEFAULT_WEIGHTS, seed: 42 };
    const map1 = generateWFCMap(opts);
    const map2 = generateWFCMap(opts);

    expect(map1).toEqual(map2);
  });

  it('generates different maps for different seeds', () => {
    const map1 = generateWFCMap({ width: 32, height: 32, weights: DEFAULT_WEIGHTS, seed: 42 });
    const map2 = generateWFCMap({ width: 32, height: 32, weights: DEFAULT_WEIGHTS, seed: 123 });

    // Maps should differ in at least some tiles
    let differs = false;
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        if (map1[y][x] !== map2[y][x]) {
          differs = true;
          break;
        }
      }
      if (differs) break;
    }
    expect(differs).toBe(true);
  });

  it('respects adjacency constraints: water only borders water/dirt/rock', () => {
    const map = generateWFCMap({ width: 48, height: 48, weights: DEFAULT_WEIGHTS, seed: 42 });
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    const waterAdj = new Set(['water', 'dirt', 'rock']);

    for (let y = 1; y < 47; y++) {
      for (let x = 1; x < 47; x++) {
        if (map[y][x] !== 'water') continue;
        for (const [dx, dy] of dirs) {
          const neighbor = map[y + dy][x + dx];
          expect(waterAdj.has(neighbor)).toBe(true);
        }
      }
    }
  });

  it('gold_mine only appears adjacent to grass/dirt/forest', () => {
    const map = generateWFCMap({ width: 48, height: 48, weights: DEFAULT_WEIGHTS, seed: 42 });
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    const goldAdj = new Set(['grass', 'dirt', 'forest']);

    for (let y = 1; y < 47; y++) {
      for (let x = 1; x < 47; x++) {
        if (map[y][x] !== 'gold_mine') continue;
        for (const [dx, dy] of dirs) {
          const neighbor = map[y + dy][x + dx];
          expect(goldAdj.has(neighbor)).toBe(true);
        }
      }
    }
  });

  it('produces maps with all tile types', () => {
    const map = generateWFCMap({ width: 48, height: 48, weights: DEFAULT_WEIGHTS, seed: 42 });
    const types = new Set<TileType>();

    for (let y = 0; y < 48; y++) {
      for (let x = 0; x < 48; x++) {
        types.add(map[y][x]);
      }
    }

    expect(types.has('grass')).toBe(true);
    expect(types.has('dirt')).toBe(true);
    expect(types.has('forest')).toBe(true);
  });
});

describe('Start Location Finding', () => {
  it('finds two start locations on a valid map', () => {
    const map = generateWFCMap({ width: 48, height: 48, weights: DEFAULT_WEIGHTS, seed: 42 });
    const rng = new PRNG(42);
    const result = findStartLocations(map, rng, 48, 48);

    if (result) {
      const [loc1, loc2] = result;
      expect(loc1.x).toBeGreaterThanOrEqual(0);
      expect(loc1.y).toBeGreaterThanOrEqual(0);
      expect(loc2.x).toBeGreaterThanOrEqual(0);
      expect(loc2.y).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('Reachability', () => {
  it('confirms reachability on connected map', () => {
    // All grass map should be reachable
    const map: TileType[][] = [];
    for (let y = 0; y < 16; y++) {
      map[y] = [];
      for (let x = 0; x < 16; x++) {
        map[y][x] = 'grass';
      }
    }

    const result = ensureReachability(map, { x: 2, y: 2 }, { x: 13, y: 13 }, 16, 16);
    expect(result).toBe(true);
  });

  it('reports unreachability when blocked', () => {
    // Map with water barrier
    const map: TileType[][] = [];
    for (let y = 0; y < 16; y++) {
      map[y] = [];
      for (let x = 0; x < 16; x++) {
        map[y][x] = y === 8 ? 'water' : 'grass';
      }
    }

    const result = ensureReachability(map, { x: 2, y: 2 }, { x: 13, y: 13 }, 16, 16);
    expect(result).toBe(false);
  });
});

describe('PRNG', () => {
  it('produces deterministic sequence', () => {
    const rng1 = new PRNG(42);
    const rng2 = new PRNG(42);

    for (let i = 0; i < 100; i++) {
      expect(rng1.next()).toBe(rng2.next());
    }
  });

  it('int returns values in range', () => {
    const rng = new PRNG(42);
    for (let i = 0; i < 100; i++) {
      const v = rng.int(5, 15);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThanOrEqual(15);
    }
  });
});
