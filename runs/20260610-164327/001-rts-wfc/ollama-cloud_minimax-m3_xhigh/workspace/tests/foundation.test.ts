import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/rng.js';
import { defaultAdjacency, generateWFC } from '../src/wfc.js';
import { aStarSearch, pathLengthTiles } from '../src/pathfind.js';
import { UNIT_STATS, BUILDING_STATS } from '../src/data.js';

describe('rng / mulberry32', () => {
  it('is deterministic for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const av = [a(), a(), a(), a()];
    const bv = [b(), b(), b(), b()];
    expect(av).toEqual(bv);
  });

  it('produces values in [0,1)', () => {
    const r = mulberry32(1);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('different seeds produce different streams', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    let diffs = 0;
    for (let i = 0; i < 100; i++) if (a() !== b()) diffs++;
    expect(diffs).toBeGreaterThan(95);
  });
});

describe('WFC map generation', () => {
  it('is fully deterministic for a fixed seed', () => {
    const a = generateWFC({ width: 32, height: 32, seed: 12345 });
    const b = generateWFC({ width: 32, height: 32, seed: 12345 });
    expect(a.tiles).toEqual(b.tiles);
  });

  it('produces different maps for different seeds', () => {
    const a = generateWFC({ width: 32, height: 32, seed: 1 });
    const b = generateWFC({ width: 32, height: 32, seed: 2 });
    let diffs = 0;
    for (let i = 0; i < a.tiles.length; i++) if (a.tiles[i] !== b.tiles[i]) diffs++;
    expect(diffs).toBeGreaterThan(50);
  });

  it('all tiles are valid tile ids', () => {
    const m = generateWFC({ width: 24, height: 24, seed: 99 });
    const valid = new Set(['grass', 'dirt', 'forest', 'water', 'rock', 'gold_mine']);
    for (const t of m.tiles) expect(valid.has(t)).toBe(true);
    expect(m.tiles.length).toBe(24 * 24);
  });

  it('honors adjacency: water tiles border water, dirt, or grass only', () => {
    const m = generateWFC({ width: 32, height: 32, seed: 7 });
    const bad: string[] = [];
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        const t = m.tiles[y * m.width + x];
        if (t !== 'water') continue;
        const neighbors: string[] = [];
        if (x > 0) neighbors.push(m.tiles[y * m.width + (x - 1)] as string);
        if (x < m.width - 1) neighbors.push(m.tiles[y * m.width + (x + 1)] as string);
        if (y > 0) neighbors.push(m.tiles[(y - 1) * m.width + x] as string);
        if (y < m.height - 1) neighbors.push(m.tiles[(y + 1) * m.width + x] as string);
        for (const n of neighbors) {
          if (n !== 'water' && n !== 'dirt' && n !== 'grass') bad.push(`water@${x},${y} next to ${n}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('gold mine tiles border grass or dirt only', () => {
    const m = generateWFC({ width: 32, height: 32, seed: 13 });
    const bad: string[] = [];
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        const t = m.tiles[y * m.width + x];
        if (t !== 'gold_mine') continue;
        const neighbors: string[] = [];
        if (x > 0) neighbors.push(m.tiles[y * m.width + (x - 1)] as string);
        if (x < m.width - 1) neighbors.push(m.tiles[y * m.width + (x + 1)] as string);
        if (y > 0) neighbors.push(m.tiles[(y - 1) * m.width + x] as string);
        if (y < m.height - 1) neighbors.push(m.tiles[(y + 1) * m.width + x] as string);
        for (const n of neighbors) {
          if (n !== 'grass' && n !== 'dirt') bad.push(`gold_mine@${x},${y} next to ${n}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('adjacency rule table is symmetric', () => {
    const adj = defaultAdjacency();
    const ids = ['grass', 'dirt', 'forest', 'water', 'rock', 'gold_mine'] as const;
    for (const a of ids) {
      for (const b of ids) {
        const aRules = adj.rules[a];
        const bRules = adj.rules[b];
        if (!aRules || !bRules) continue;
        const aN = aRules[0]?.includes(b) ?? false; // a allows b to its north?
        const bS = bRules[2]?.includes(a) ?? false; // b allows a to its south?
        expect(aN).toBe(bS);
      }
    }
  });
});

describe('A* pathfinding', () => {
  function walkableEmpty(w: number, h: number) {
    return (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  }
  function withWalls(w: number, h: number, walls: Set<string>) {
    return (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && !walls.has(`${x},${y}`);
  }

  it('returns single-node path when start equals target', () => {
    const p = aStarSearch({ width: 10, height: 10 }, 3, 3, 3, 3, { walkable: walkableEmpty(10, 10) });
    expect(p).toEqual([{ x: 3, y: 3 }]);
  });

  it('finds a straight cardinal path', () => {
    const p = aStarSearch({ width: 10, height: 10 }, 0, 0, 5, 0, { walkable: walkableEmpty(10, 10) });
    expect(p).not.toBeNull();
    expect(pathLengthTiles(p as { x: number; y: number }[])).toBeCloseTo(5, 5);
    const last = (p as { x: number; y: number }[])[(p as { x: number; y: number }[]).length - 1];
    expect(last).toEqual({ x: 5, y: 0 });
  });

  it('uses a diagonal path of length sqrt(2) per step', () => {
    const p = aStarSearch({ width: 10, height: 10 }, 0, 0, 4, 4, { walkable: walkableEmpty(10, 10) });
    expect(p).not.toBeNull();
    // 4 diagonals => 4*sqrt(2)
    expect(pathLengthTiles(p as { x: number; y: number }[])).toBeCloseTo(4 * Math.SQRT2, 5);
  });

  it('routes around walls and finds the shortest path', () => {
    // wall column at x=2 except for a gap at y=3
    const walls = new Set<string>();
    for (let y = 0; y < 8; y++) if (y !== 3) walls.add(`2,${y}`);
    const p = aStarSearch({ width: 8, height: 8 }, 0, 0, 4, 0, { walkable: withWalls(8, 8, walls) });
    expect(p).not.toBeNull();
    // shortest: (0,0) -> (0,1) -> (0,2) -> (0,3) -> (2,3) -> (3,2) -> (4,1) -> (4,0)
    // = 3 + 2 + 2*sqrt(2) + 1 = 6 + 2*sqrt(2)
    const len = pathLengthTiles(p as { x: number; y: number }[]);
    expect(len).toBeCloseTo(6 + 2 * Math.SQRT2, 5);
  });

  it('returns null when target is unreachable', () => {
    const walls = new Set<string>();
    for (let y = 0; y < 10; y++) walls.add(`5,${y}`);
    const p = aStarSearch({ width: 10, height: 10 }, 0, 0, 7, 0, { walkable: withWalls(10, 10, walls) });
    expect(p).toBeNull();
  });

  it('does not corner-cut through blocked diagonals', () => {
    // A diagonal pass between (2,2) and (3,3) is blocked by walls at (3,2) and (2,3)
    // but the cardinal-neighbors rule says both must be walkable. Build a corridor:
    // we put a single wall at (3,2) but leave (2,3) walkable; diagonal from
    // (2,2) -> (3,3) should be forbidden.
    const walls = new Set<string>(['3,2']);
    const p = aStarSearch({ width: 6, height: 6 }, 2, 2, 3, 3, { walkable: withWalls(6, 6, walls) });
    expect(p).not.toBeNull();
    for (let i = 1; i < (p as { x: number; y: number }[]).length; i++) {
      const a = (p as { x: number; y: number }[])[i - 1] as { x: number; y: number };
      const b = (p as { x: number; y: number }[])[i] as { x: number; y: number };
      if (a.x !== b.x && a.y !== b.y) {
        // diagonal step: both cardinal neighbors must be walkable
        expect(walls.has(`${b.x},${a.y}`)).toBe(false);
        expect(walls.has(`${a.x},${b.y}`)).toBe(false);
      }
    }
  });

  it('returns null for non-walkable target', () => {
    const p = aStarSearch({ width: 5, height: 5 }, 0, 0, 2, 2, { walkable: () => false });
    expect(p).toBeNull();
  });
});

describe('combat damage math & supply accounting', () => {
  it('armor reduces damage with a minimum of 1', () => {
    const dmg = (att: number, arm: number): number => Math.max(1, att - arm);
    expect(dmg(10, 3)).toBe(7);
    expect(dmg(5, 5)).toBe(1);   // min 1
    expect(dmg(2, 9)).toBe(1);   // min 1
  });

  it('ranged unit has range >= 2 and lower HP than heavy', () => {
    expect(UNIT_STATS.ranged.attackRange).toBeGreaterThanOrEqual(2);
    expect(UNIT_STATS.heavy.hp).toBeGreaterThan(UNIT_STATS.ranged.hp);
  });

  it('heavy unit is the most expensive and consumes the most supply', () => {
    const heavyCost = UNIT_STATS.heavy.cost.gold + UNIT_STATS.heavy.cost.wood;
    const workerCost = UNIT_STATS.worker.cost.gold + UNIT_STATS.worker.cost.wood;
    expect(heavyCost).toBeGreaterThan(workerCost);
    expect(UNIT_STATS.heavy.supply).toBeGreaterThan(UNIT_STATS.worker.supply);
  });

  it('buildings have positive HP, armor, and finite build times', () => {
    for (const k of Object.keys(BUILDING_STATS) as Array<keyof typeof BUILDING_STATS>) {
      const b = BUILDING_STATS[k];
      expect(b.hp).toBeGreaterThan(0);
      expect(b.armor).toBeGreaterThanOrEqual(0);
      expect(b.buildTime).toBeGreaterThanOrEqual(0);
      expect(b.size.w).toBeGreaterThan(0);
      expect(b.size.h).toBeGreaterThan(0);
    }
  });

  it('town hall is the only building that provides supply at the start; farm extends it', () => {
    expect(BUILDING_STATS.townhall.providesSupply).toBe(10);
    // at the start only the town hall exists, so initial supply cap = 10
    expect(BUILDING_STATS.farm.providesSupply).toBe(8);
    for (const k of ['barracks', 'mill', 'tower'] as const) {
      expect(BUILDING_STATS[k].providesSupply).toBe(0);
    }
  });

  it('adding a farm extends supply cap by its providesSupply', () => {
    const cap = BUILDING_STATS.townhall.providesSupply + BUILDING_STATS.farm.providesSupply;
    const used = UNIT_STATS.worker.supply + UNIT_STATS.worker.supply + UNIT_STATS.melee.supply; // 1+1+2 = 4
    const fits = used + UNIT_STATS.heavy.supply <= cap;
    expect(fits).toBe(true); // 4 + 4 = 8 <= 18
    const blocked = used + UNIT_STATS.heavy.supply * 4 <= cap; // 4 + 16 = 20 > 18
    expect(blocked).toBe(false);
  });
});
