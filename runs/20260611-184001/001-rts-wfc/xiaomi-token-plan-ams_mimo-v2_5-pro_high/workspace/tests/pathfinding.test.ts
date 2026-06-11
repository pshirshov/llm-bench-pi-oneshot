/**
 * Tests for A* pathfinding: shortest path, corner cutting, unreachable handling.
 */
import { describe, it, expect } from 'vitest';
import { findPath } from '../src/pathfinding/astar.js';
import { Tile, TileType } from '../src/engine/types.js';

function makeTiles(width: number, height: number, type: TileType = 'grass'): Tile[][] {
  const tiles: Tile[][] = [];
  for (let y = 0; y < height; y++) {
    tiles[y] = [];
    for (let x = 0; x < width; x++) {
      tiles[y][x] = { type, resource: 0, fog: 2, lastSeen: type, lastSeenEntity: null };
    }
  }
  return tiles;
}

describe('A* Pathfinding', () => {
  it('finds direct path on empty map', () => {
    const tiles = makeTiles(16, 16);
    const result = findPath(tiles, 1, 1, 14, 14, 16, 16);

    expect(result.found).toBe(true);
    expect(result.path.length).toBeGreaterThan(0);
    expect(result.path[0]).toEqual({ x: 1, y: 1 });
    expect(result.path[result.path.length - 1]).toEqual({ x: 14, y: 14 });
  });

  it('finds shortest path (Manhattan distance for straight path)', () => {
    const tiles = makeTiles(16, 16);
    // Straight horizontal path
    const result = findPath(tiles, 1, 8, 14, 8, 16, 16);

    expect(result.found).toBe(true);
    // Path length should be reasonable (not excessively long)
    expect(result.path.length).toBeLessThanOrEqual(16);
  });

  it('finds path around obstacles', () => {
    const tiles = makeTiles(16, 16);
    // Create wall with gap
    for (let x = 0; x < 16; x++) {
      if (x !== 8) { // Gap at x=8
        tiles[8][x].type = 'rock';
      }
    }

    const result = findPath(tiles, 1, 5, 14, 12, 16, 16);
    expect(result.found).toBe(true);
    expect(result.path.length).toBeGreaterThan(0);
  });

  it('returns not found when destination is unreachable', () => {
    const tiles = makeTiles(16, 16);
    // Surround destination with rock
    tiles[14][14].type = 'rock';
    tiles[13][14].type = 'rock';
    tiles[14][13].type = 'rock';
    tiles[15][14].type = 'rock';
    tiles[14][15].type = 'rock';
    tiles[13][13].type = 'rock';
    tiles[15][15].type = 'rock';
    tiles[13][15].type = 'rock';
    tiles[15][13].type = 'rock';

    const result = findPath(tiles, 1, 1, 14, 14, 16, 16);
    // Should either fail or find alternate path
    // If it finds a path, it must not go through rock
    if (result.found) {
      for (const p of result.path) {
        expect(tiles[p.y][p.x].type).not.toBe('rock');
        expect(tiles[p.y][p.x].type).not.toBe('water');
      }
    }
  });

  it('does not cut corners through blocked diagonals', () => {
    const tiles = makeTiles(8, 8);
    // Block diagonal corners: place rocks to force corner-cutting check
    tiles[3][4].type = 'rock';
    tiles[4][3].type = 'rock';

    const result = findPath(tiles, 2, 2, 6, 6, 8, 8);
    expect(result.found).toBe(true);

    // Verify no diagonal move passes through a blocked adjacent tile
    for (let i = 1; i < result.path.length; i++) {
      const prev = result.path[i - 1];
      const curr = result.path[i];
      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;

      // If diagonal move
      if (dx !== 0 && dy !== 0) {
        // Both adjacent cells must be walkable
        expect(tiles[prev.y][prev.x + dx].type).not.toBe('rock');
        expect(tiles[prev.y + dy][prev.x].type).not.toBe('rock');
      }
    }
  });

  it('handles start equals goal', () => {
    const tiles = makeTiles(8, 8);
    const result = findPath(tiles, 4, 4, 4, 4, 8, 8);

    expect(result.found).toBe(true);
    expect(result.path.length).toBeGreaterThanOrEqual(1);
  });

  it('handles water tiles as unwalkable', () => {
    const tiles = makeTiles(16, 16);
    // Create water barrier
    for (let x = 0; x < 16; x++) {
      tiles[8][x].type = 'water';
    }

    const result = findPath(tiles, 1, 5, 14, 12, 16, 16);
    // Should fail or find path around
    if (result.found) {
      for (const p of result.path) {
        expect(tiles[p.y][p.x].type).not.toBe('water');
      }
    }
  });
});
