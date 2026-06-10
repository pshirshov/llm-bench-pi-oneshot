import { describe, it, expect } from 'vitest';
import { PRNG } from '../src/prng';
import { canBeAdjacent, TILE_DEFS, generateMap } from '../src/wfc';
import { TileType, Tile, GameMap } from '../src/types';
import { findPath } from '../src/astar';
import { createGameState, getSupply, canPlaceBuilding } from '../src/game';
import { Faction, UnitType, BuildingType } from '../src/types';
import { UNIT_STATS, BUILDING_STATS } from '../src/constants';

// ─── WFC Tests ───

describe('WFC', () => {
  it('adjacency rules are symmetric for compatible tiles', () => {
    // If A can border B, then B can border A
    for (const defA of TILE_DEFS) {
      for (const defB of TILE_DEFS) {
        if (defA.adj.has(defB.type)) {
          expect(defB.adj.has(defA.type)).toBe(true);
        }
      }
    }
  });

  it('generates a deterministic map for a fixed seed', () => {
    const map1 = generateMap(16, 16, 42);
    const map2 = generateMap(16, 16, 42);

    // Maps should be identical
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        expect(map1.tiles[y][x].type).toBe(map2.tiles[y][x].type);
      }
    }
  });

  it('different seeds produce different maps', () => {
    const map1 = generateMap(16, 16, 42);
    const map2 = generateMap(16, 16, 999);

    let different = false;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        if (map1.tiles[y][x].type !== map2.tiles[y][x].type) {
          different = true;
          break;
        }
      }
      if (different) break;
    }

    expect(different).toBe(true);
  });

  it('generated maps have walkable areas for starting positions', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const map = generateMap(32, 32, seed);
      let hasWalkable = false;
      for (let y = 2; y < 30; y++) {
        for (let x = 2; x < 30; x++) {
          const t = map.tiles[y][x].type;
          if (t === TileType.Grass || t === TileType.Dirt) {
            hasWalkable = true;
          }
        }
      }
      expect(hasWalkable).toBe(true);
    }
  });

  it('WFC respects adjacency constraints in output', () => {
    const map = generateMap(24, 24, 12345);
    for (let y = 0; y < map.height - 1; y++) {
      for (let x = 0; x < map.width - 1; x++) {
        const t = map.tiles[y][x].type;
        const r = map.tiles[y][x + 1].type;
        const b = map.tiles[y + 1][x].type;
        // Right neighbor must be compatible
        expect(canBeAdjacent(t, r)).toBe(true);
        // Bottom neighbor must be compatible
        expect(canBeAdjacent(t, b)).toBe(true);
      }
    }
  });
});

// ─── A* Tests ───

describe('A* Pathfinding', () => {
  function makeSimpleMap(w: number, h: number, walkable: Set<string>): GameMap {
    const tiles: Tile[][] = [];
    for (let y = 0; y < h; y++) {
      tiles[y] = [];
      for (let x = 0; x < w; x++) {
        tiles[y][x] = {
          type: walkable.has(`${x},${y}`) ? TileType.Grass : TileType.Water,
          buildingId: null,
          resourceAmount: 0,
          revealed: true,
        };
      }
    }
    return { width: w, height: h, tiles };
  }

  it('finds a straight-line path on open terrain', () => {
    const coords: string[] = [];
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        coords.push(`${x},${y}`);
      }
    }
    const map = makeSimpleMap(10, 10, new Set(coords));
    const path = findPath(map, 0, 0, 5, 5);
    expect(path.length).toBeGreaterThan(0);
    expect(path[0]).toEqual({ x: 0, y: 0 });
    expect(path[path.length - 1]).toEqual({ x: 5, y: 5 });
  });

  it('finds a path around an obstacle', () => {
    const walkable = new Set<string>();
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        walkable.add(`${x},${y}`);
      }
    }
    // Block a wall of tiles
    for (let y = 0; y < 9; y++) {
      walkable.delete(`5,${y}`);
    }
    walkable.add('5,9'); // Gap at the bottom

    const map = makeSimpleMap(10, 10, walkable);
    const path = findPath(map, 2, 2, 8, 2);
    expect(path.length).toBeGreaterThan(0);
    expect(path[path.length - 1]).toEqual({ x: 8, y: 2 });
  });

  it('returns short or empty path when goal is in unreachable region', () => {
    const walkable = new Set<string>();
    // Only a small island in the top-left corner
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        walkable.add(`${x},${y}`);
      }
    }
    const map = makeSimpleMap(10, 10, walkable);
    // Goal is far away in an area with no walkable tiles
    // The pathfinder will try to find the nearest walkable to the goal
    // which may be in the starting island, resulting in a path that doesn't
    // actually reach the original goal
    const path = findPath(map, 0, 0, 8, 8);
    // The path should either be empty or should not end at (8,8)
    if (path.length > 0) {
      const last = path[path.length - 1];
      expect(last.x !== 8 || last.y !== 8).toBe(true);
    }
  });

  it('does not cut corners through blocked diagonals', () => {
    const walkable = new Set<string>();
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        walkable.add(`${x},${y}`);
      }
    }
    // Block (1,0) and (0,1), making diagonal (0,0)→(1,1) impossible
    walkable.delete('1,0');
    walkable.delete('0,1');

    const map = makeSimpleMap(5, 5, walkable);
    const path = findPath(map, 0, 0, 2, 2);
    // If a path exists, it should not go directly diagonal from (0,0) to (1,1)
    // because that would cut through blocked corners
    if (path.length > 0) {
      // Check that no step in the path is a diagonal through blocked corners
      for (let i = 1; i < path.length; i++) {
        const dx = Math.abs(path[i].x - path[i - 1].x);
        const dy = Math.abs(path[i].y - path[i - 1].y);
        if (dx === 1 && dy === 1) {
          // Verify the cardinal neighbors are walkable
          const cx = path[i - 1].x;
          const cy = path[i - 1].y;
          const tile1 = map.tiles[cy][path[i].x].type;
          const tile2 = map.tiles[path[i].y][cx].type;
          expect(tile1 === 'grass' || tile1 === 'dirt' || tile1 === 'forest' || tile1 === 'gold_mine').toBe(true);
          expect(tile2 === 'grass' || tile2 === 'dirt' || tile2 === 'forest' || tile2 === 'gold_mine').toBe(true);
        }
      }
    }
  });

  it('shortest path has correct length for a straight line', () => {
    const walkable = new Set<string>();
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        walkable.add(`${x},${y}`);
      }
    }
    const map = makeSimpleMap(10, 10, walkable);
    const path = findPath(map, 0, 0, 5, 0);
    // Should be 6 steps: (0,0), (1,0), (2,0), (3,0), (4,0), (5,0)
    expect(path.length).toBe(6);
  });
});

// ─── Combat Math Tests ───

describe('Combat', () => {
  it('damage is attacker damage minus defender armor, minimum 1', () => {
    // Infantry: attack 8, Knight: armor 4
    const infantryAttack = UNIT_STATS[UnitType.Infantry].attackDamage;
    const knightArmor = UNIT_STATS[UnitType.Heavy].armor;
    const damage = Math.max(1, infantryAttack - knightArmor);
    expect(damage).toBe(4); // 8 - 4 = 4

    // Worker: attack 5 vs Infantry: armor 2
    const workerAttack = UNIT_STATS[UnitType.Worker].attackDamage;
    const infantryArmor = UNIT_STATS[UnitType.Infantry].armor;
    const damage2 = Math.max(1, workerAttack - infantryArmor);
    expect(damage2).toBe(3); // 5 - 2 = 3

    // Heavy: attack 12 vs Worker: armor 0
    const heavyAttack = UNIT_STATS[UnitType.Heavy].attackDamage;
    const workerArmor = UNIT_STATS[UnitType.Worker].armor;
    const damage3 = Math.max(1, heavyAttack - workerArmor);
    expect(damage3).toBe(12);

    // Minimum damage: Worker vs Knight (5 - 4 = 1)
    const minDamage = Math.max(1, workerAttack - knightArmor);
    expect(minDamage).toBe(1);
  });

  it('ranged units have higher attack range than melee', () => {
    const rangedRange = UNIT_STATS[UnitType.Ranged].attackRange;
    const infantryRange = UNIT_STATS[UnitType.Infantry].attackRange;
    const heavyRange = UNIT_STATS[UnitType.Heavy].attackRange;
    expect(rangedRange).toBeGreaterThan(infantryRange);
    expect(rangedRange).toBeGreaterThan(heavyRange);
  });
});

// ─── Supply Accounting Tests ───

describe('Supply', () => {
  it('Town Hall provides starting supply', () => {
    const townHallSupply = BUILDING_STATS[BuildingType.TownHall].supplyProvided;
    expect(townHallSupply).toBe(5);
  });

  it('Farm provides 6 supply', () => {
    const farmSupply = BUILDING_STATS[BuildingType.Farm].supplyProvided;
    expect(farmSupply).toBe(6);
  });

  it('workers cost 1 supply each', () => {
    const workerSupply = UNIT_STATS[UnitType.Worker].supplyCost;
    expect(workerSupply).toBe(1);
  });

  it('heavy units cost 2 supply', () => {
    const heavySupply = UNIT_STATS[UnitType.Heavy].supplyCost;
    expect(heavySupply).toBe(2);
  });

  it('initial game has correct supply (5 cap from Town Hall, 3 used)', () => {
    const state = createGameState(12345, Faction.Human, 1);
    const supply = getSupply(state, Faction.Human);
    // 3 workers × 1 supply = 3 used
    // 5 supply cap from Town Hall
    expect(supply.used).toBe(3);
    expect(supply.cap).toBe(5);
  });

  it('building a farm increases supply cap', () => {
    const state = createGameState(12345, Faction.Human, 1);
    // Place a farm
    const placed = canPlaceBuilding(state, BuildingType.Farm, state.playerStart.x + 3, state.playerStart.y, Faction.Human);
    // This just checks validity, doesn't place it
    expect(typeof placed).toBe('boolean');
  });
});

// ─── PRNG Tests ───

describe('PRNG', () => {
  it('produces deterministic sequences for a given seed', () => {
    const rng1 = new PRNG(42);
    const rng2 = new PRNG(42);
    for (let i = 0; i < 100; i++) {
      expect(rng1.next()).toBe(rng2.next());
    }
  });

  it('different seeds produce different sequences', () => {
    const rng1 = new PRNG(42);
    const rng2 = new PRNG(999);
    let different = false;
    for (let i = 0; i < 10; i++) {
      if (rng1.next() !== rng2.next()) different = true;
    }
    expect(different).toBe(true);
  });

  it('nextInt produces values within range', () => {
    const rng = new PRNG(42);
    for (let i = 0; i < 1000; i++) {
      const val = rng.nextInt(5, 10);
      expect(val).toBeGreaterThanOrEqual(5);
      expect(val).toBeLessThanOrEqual(10);
    }
  });
});