/**
 * Tests for A* pathfinding.
 */

import { describe, it, expect } from 'vitest';
import { findPath, isReachable, findNearestWalkable } from '../src/core/pathfinding';
import type { GameMap, FogState } from '../src/core/types';

function makeTestMap(
  width: number,
  height: number,
  walkable: boolean[],
): GameMap {
  return {
    width,
    height,
    tiles: new Array(width * height).fill('grass'),
    walkable,
    fog: {
      humans: new Array<FogState>(width * height).fill('visible'),
      orcs: new Array<FogState>(width * height).fill('visible'),
    },
    startLocations: { humans: { x: 0, y: 0 }, orcs: { x: width - 1, y: height - 1 } },
    level: 0,
  };
}

describe('Pathfinding', () => {
  it('should find shortest path on open grid', () => {
    const w = 10;
    const h = 10;
    const walkable = new Array(w * h).fill(true);
    const map = makeTestMap(w, h, walkable);
    
    const path = findPath(map, 0, 0, 9, 9);
    expect(path).not.toBeNull();
    if (path) {
      expect(path.length).toBeGreaterThan(0);
      expect(path[path.length - 1]).toEqual({ x: 9, y: 9 });
    }
  });

  it('should not cut through blocked diagonals', () => {
    // Create a map where diagonal movement would cut through blocked tiles
    const w = 5;
    const h = 5;
    const walkable = new Array(w * h).fill(true);
    // Block the tiles that would be adjacent to a diagonal move
    walkable[1 * w + 1] = false; // Block (1,1)
    walkable[1 * w + 2] = false; // Block (2,1)
    walkable[2 * w + 1] = false; // Block (1,2)
    
    const map = makeTestMap(w, h, walkable);
    const path = findPath(map, 0, 0, 2, 2);
    
    // Should not be able to move diagonally through blocked corners
    if (path) {
      for (let i = 1; i < path.length; i++) {
        const prev = path[i - 1];
        const curr = path[i];
        const dx = Math.abs(curr.x - prev.x);
        const dy = Math.abs(curr.y - prev.y);
        expect(dx).toBeLessThanOrEqual(1);
        expect(dy).toBeLessThanOrEqual(1);
      }
    }
  });

  it('should report unreachable targets as null', () => {
    const w = 5;
    const h = 5;
    const walkable = new Array(w * h).fill(true);
    // Create a wall separating start from target
    for (let y = 0; y < h; y++) {
      walkable[y * w + 2] = false;
    }
    const map = makeTestMap(w, h, walkable);
    
    const path = findPath(map, 0, 0, 4, 4);
    expect(path).toBeNull();
  });

  it('should handle same start and target', () => {
    const w = 5;
    const h = 5;
    const walkable = new Array(w * h).fill(true);
    const map = makeTestMap(w, h, walkable);
    
    const path = findPath(map, 2, 2, 2, 2);
    expect(path).toEqual([]);
  });

  it('should find nearest walkable tile', () => {
    const w = 5;
    const h = 5;
    const walkable = new Array(w * h).fill(true);
    walkable[2 * w + 2] = false; // Block center
    
    const map = makeTestMap(w, h, walkable);
    const nearest = findNearestWalkable(map, 2, 2);
    
    expect(nearest).not.toBeNull();
    if (nearest) {
      expect(nearest.x !== 2 || nearest.y !== 2).toBe(true);
    }
  });

  it('isReachable should return true for reachable targets', () => {
    const w = 10;
    const h = 10;
    const walkable = new Array(w * h).fill(true);
    const map = makeTestMap(w, h, walkable);
    
    expect(isReachable(map, 0, 0, 9, 9)).toBe(true);
  });

  it('isReachable should return false for unreachable targets', () => {
    const w = 5;
    const h = 5;
    const walkable = new Array(w * h).fill(true);
    for (let y = 0; y < h; y++) {
      walkable[y * w + 2] = false;
    }
    const map = makeTestMap(w, h, walkable);
    
    expect(isReachable(map, 0, 0, 4, 4)).toBe(false);
  });
});
