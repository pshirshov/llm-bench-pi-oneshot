import { describe, it, expect } from 'vitest';
import { runWFC, countTiles } from '../src/wfc';
import { mulberry32 } from '../src/rng';

describe('WFC map generation', () => {
  it('produces consistent output for identical seed', () => {
    const rng1 = mulberry32(12345);
    const rng2 = mulberry32(12345);
    const r1 = runWFC({ width: 24, height: 24, rng: rng1, maxAttempts: 5 });
    const r2 = runWFC({ width: 24, height: 24, rng: rng2, maxAttempts: 5 });
    expect(r1.success).toBe(r2.success);
    expect(r1.tiles).toEqual(r2.tiles);
  });

  it('respects basic adjacency constraints (no water directly next to goldmine without dirt)', () => {
    const rng = mulberry32(99991);
    const res = runWFC({ width: 28, height: 28, rng, maxAttempts: 6 });
    const tiles = res.tiles;
    const w = tiles[0].length;
    const h = tiles.length;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = tiles[y][x];
        if (t === 'goldmine') {
          // check 4 cardinal neighbors
          const dirs = [[0,-1],[1,0],[0,1],[-1,0]];
          for (const [dx,dy] of dirs) {
            const nx = x + dx, ny = y + dy;
            if (nx>=0&&ny>=0&&nx<w&&ny<h) {
              const n = tiles[ny][nx];
              expect(['grass','dirt','forest'].includes(n)).toBe(true);
            }
          }
        }
        if (t === 'water') {
          const dirs = [[0,-1],[1,0],[0,1],[-1,0]];
          for (const [dx,dy] of dirs) {
            const nx = x + dx, ny = y + dy;
            if (nx>=0&&ny>=0&&nx<w&&ny<h) {
              const n = tiles[ny][nx];
              expect(['water','dirt'].includes(n)).toBe(true);
            }
          }
        }
      }
    }
  });

  it('generates a usable number of grass/dirt for playability', () => {
    const rng = mulberry32(777);
    const res = runWFC({ width: 32, height: 32, rng, maxAttempts: 5 });
    const cnt = countTiles(res.tiles);
    const walkable = (cnt.grass || 0) + (cnt.dirt || 0) + (cnt.goldmine || 0);
    expect(walkable).toBeGreaterThan(280);
  });
});
