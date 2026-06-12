import { describe, expect, test } from 'vitest';
import { TICK_RATE } from '../src/sim/constants';
import { analyzePlayability, createCampaignMap, mapGrid } from '../src/sim/map/generator';
import { areAdjacentKindsAllowed } from '../src/sim/map/tiles';
import { findPath, pathDistance } from '../src/sim/pathfinding';
import { validateAdjacency } from '../src/sim/map/wfc';
import { World } from '../src/sim/world';
import { serializeWorld } from '../src/sim/worldAccess';
import { makeMap, setBlock } from './helpers';

describe('determinism and map generation', () => {
  test('same seed and order stream serializes identically after 1000 ticks', () => {
    const a = World.create(1234, 1, { aiEnabled: false });
    const b = World.create(1234, 1, { aiEnabled: false });
    const idsA = Array.from(a.units.values()).filter(unit => unit.owner === 1).map(unit => unit.id);
    const idsB = Array.from(b.units.values()).filter(unit => unit.owner === 1).map(unit => unit.id);
    a.issueMove(idsA, { x: 12, y: 12 });
    b.issueMove(idsB, { x: 12, y: 12 });
    a.step(1000);
    b.step(1000);
    expect(serializeWorld(a)).toEqual(serializeWorld(b));
  });

  test('different seeds produce different maps', () => {
    expect(serializeWorld(World.create(100, 2, { aiEnabled: false })).mapHash)
      .not.toEqual(serializeWorld(World.create(101, 2, { aiEnabled: false })).mapHash);
  });

  test('WFC output respects every cardinal adjacency rule', () => {
    const map = createCampaignMap(77, 3);
    expect(validateAdjacency(map)).toBe(true);
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        const here = map.tiles[y * map.width + x].kind;
        if (x + 1 < map.width) {
          expect(areAdjacentKindsAllowed(here, map.tiles[y * map.width + x + 1].kind)).toBe(true);
        }
        if (y + 1 < map.height) {
          expect(areAdjacentKindsAllowed(here, map.tiles[(y + 1) * map.width + x].kind)).toBe(true);
        }
      }
    }
  });

  test('map generation is deterministic for a fixed seed and level', () => {
    const a = createCampaignMap(555, 4);
    const b = createCampaignMap(555, 4);
    expect(a.tiles.map(tile => tile.kind).join(',')).toEqual(b.tiles.map(tile => tile.kind).join(','));
  });

  test('playability pass succeeds across 20 seed-level combinations', () => {
    for (let seed = 1; seed <= 4; seed += 1) {
      for (let level = 1; level <= 5; level += 1) {
        const map = createCampaignMap(seed * 1000 + level, level);
        const report = analyzePlayability(map);
        expect(report.ok).toBe(true);
        expect(report.landDistance).toBeGreaterThanOrEqual(Math.max(map.width, map.height) * 0.6);
        expect(report.straightDistance).toBeGreaterThanOrEqual(Math.max(map.width, map.height) * 0.4);
        expect(report.resourcesNear).toBe(true);
      }
    }
  });
});

describe('A* pathfinding', () => {
  test('returns shortest 8-way path length on an open grid', () => {
    const grid = mapGrid(makeMap(8, 8));
    expect(pathDistance(grid, { x: 0, y: 0 }, { x: 3, y: 4 })).toBeCloseTo(3 * Math.SQRT2 + 1);
  });

  test('does not cut diagonally through blocked corners', () => {
    const map = makeMap(4, 4);
    setBlock(map, { x: 1, y: 0 });
    setBlock(map, { x: 0, y: 1 });
    const result = findPath(mapGrid(map), { x: 0, y: 0 }, { x: 2, y: 2 });
    expect(result.path[0]).not.toEqual({ x: 1, y: 1 });
  });

  test('reports unreachable targets instead of searching forever', () => {
    const map = makeMap(7, 7);
    for (let y = 1; y <= 3; y += 1) {
      for (let x = 1; x <= 3; x += 1) {
        if (x === 2 && y === 2) {
          continue;
        }
        setBlock(map, { x, y });
      }
    }
    const result = findPath(mapGrid(map), { x: 5, y: 5 }, { x: 2, y: 2 });
    expect(result.reachable).toBe(false);
    expect(result.visited).toBeLessThan(7 * 7);
  });

  test('boot smoke creates and steps all campaign levels', () => {
    for (let level = 1; level <= 5; level += 1) {
      const world = World.create(9000 + level, level, { aiEnabled: false });
      world.step(TICK_RATE * 30);
      expect(world.outcome).toBe('playing');
    }
  });
});
