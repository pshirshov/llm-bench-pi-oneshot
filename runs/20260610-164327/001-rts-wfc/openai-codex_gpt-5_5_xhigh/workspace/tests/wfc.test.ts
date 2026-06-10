import { describe, expect, it } from 'vitest';
import { generateLevelMap, mapHash, tileCanNeighbor, validateAdjacency } from '../src/wfc';

function countTile(map: ReturnType<typeof generateLevelMap>, tile: string): number {
  return map.tiles.filter((candidate) => candidate === tile).length;
}

describe('WFC map generation', () => {
  it('BA: produces deterministic maps for a fixed campaign seed and level', () => {
    const first = generateLevelMap(424242, 2);
    const second = generateLevelMap(424242, 2);

    expect(mapHash(first)).toBe(mapHash(second));
    expect(first.tiles).toEqual(second.tiles);
    expect(first.starts).toEqual(second.starts);
  });

  it('BA: propagates adjacency constraints across the collapsed map', () => {
    const map = generateLevelMap(99117, 3);

    expect(validateAdjacency(map.tiles, map.width, map.height)).toBe(true);
    expect(tileCanNeighbor('water', 'grass')).toBe(false);
    expect(tileCanNeighbor('gold', 'forest')).toBe(false);
    expect(tileCanNeighbor('water', 'dirt')).toBe(true);
  });

  it('BG: repairs generated terrain into two fair playable starts with resources', () => {
    const map = generateLevelMap(20260610, 1);
    const [player, ai] = map.starts;

    expect(map.starts).toHaveLength(2);
    expect(player.label).toBe('player');
    expect(ai.label).toBe('ai');
    expect(Math.abs(player.x - ai.x)).toBeGreaterThan(14);
    expect(countTile(map, 'gold')).toBeGreaterThanOrEqual(2);
    expect(countTile(map, 'forest')).toBeGreaterThan(20);
  });
});
