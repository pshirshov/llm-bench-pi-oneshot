import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { generateMap, bfsReachable } from '../src/map/gamemap';
import { LEVELS, levelSeed, mapGenConfigFor } from '../src/map/levels';
import { ADJACENCY_MASK, Tile } from '../src/map/tiles';
import { runWfc } from '../src/map/wfc';

const WEIGHTS = mapGenConfigFor(LEVELS[0]).weights;

describe('WFC', () => {
  it('produces a fully collapsed grid that satisfies every adjacency constraint', () => {
    const { tiles } = runWfc({ width: 24, height: 24, weights: WEIGHTS }, new Rng(42));
    expect(tiles.length).toBe(24 * 24);
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 24; x++) {
        const t = tiles[y * 24 + x];
        if (x + 1 < 24) {
          const right = tiles[y * 24 + x + 1];
          expect((ADJACENCY_MASK[t] >> right) & 1, `(${x},${y})=${t} vs right=${right}`).toBe(1);
        }
        if (y + 1 < 24) {
          const down = tiles[(y + 1) * 24 + x];
          expect((ADJACENCY_MASK[t] >> down) & 1, `(${x},${y})=${t} vs down=${down}`).toBe(1);
        }
      }
    }
  });

  it('never places water next to grass, forest, rock, or gold (water borders water/dirt only)', () => {
    const { tiles } = runWfc({ width: 32, height: 32, weights: WEIGHTS }, new Rng(7));
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        if (tiles[y * 32 + x] !== Tile.Water) continue;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          if (nx < 0 || ny < 0 || nx >= 32 || ny >= 32) continue;
          const n = tiles[ny * 32 + nx];
          expect([Tile.Water, Tile.Dirt]).toContain(n);
        }
      }
    }
  });

  it('is deterministic for a fixed seed and differs across seeds', () => {
    const a = runWfc({ width: 20, height: 20, weights: WEIGHTS }, new Rng(123));
    const b = runWfc({ width: 20, height: 20, weights: WEIGHTS }, new Rng(123));
    const c = runWfc({ width: 20, height: 20, weights: WEIGHTS }, new Rng(124));
    expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
    expect(Array.from(a.tiles)).not.toEqual(Array.from(c.tiles));
  });
});

describe('map generation playability', () => {
  it('guarantees two mutually reachable starts with gold and forest in reach (all levels)', () => {
    for (const lvl of LEVELS) {
      const seed = levelSeed(1337, lvl.id);
      const map = generateMap(mapGenConfigFor(lvl), seed);
      const [a, b] = map.starts;
      expect(bfsReachable(map, a, b), `level ${lvl.id} starts reachable`).toBe(true);
      for (const start of map.starts) {
        let gold = 0;
        let forest = 0;
        for (let y = start.y - 12; y <= start.y + 12; y++) {
          for (let x = start.x - 12; x <= start.x + 12; x++) {
            if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
            const t = map.tiles[y * map.width + x];
            if (t === Tile.GoldMine) gold++;
            if (t === Tile.Forest) forest++;
          }
        }
        expect(gold, `level ${lvl.id} gold near start`).toBeGreaterThan(0);
        expect(forest, `level ${lvl.id} forest near start`).toBeGreaterThan(0);
      }
    }
  });

  it('derives identical maps from identical (campaign seed, level) pairs', () => {
    const cfg = mapGenConfigFor(LEVELS[1]);
    const m1 = generateMap(cfg, levelSeed(999, 2));
    const m2 = generateMap(cfg, levelSeed(999, 2));
    expect(Array.from(m1.tiles)).toEqual(Array.from(m2.tiles));
    expect(m1.starts).toEqual(m2.starts);
  });
});
