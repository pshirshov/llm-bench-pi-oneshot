import { describe, expect, it } from 'vitest';
import { findPath, pathDistance, type Grid } from '../src/pathfinding';

function grid(width: number, height: number, blocked: readonly string[]): Grid {
  const blockedSet = new Set(blocked);
  return {
    width,
    height,
    isPassable(x: number, y: number): boolean {
      return x >= 0 && y >= 0 && x < width && y < height && !blockedSet.has(`${x},${y}`);
    },
  };
}

describe('A* pathfinding', () => {
  it('BA: finds an octile-shortest route on open terrain', () => {
    const path = findPath(grid(6, 6, []), { x: 0, y: 0 }, { x: 3, y: 4 });

    expect(path[0]).toEqual({ x: 0, y: 0 });
    expect(path[path.length - 1]).toEqual({ x: 3, y: 4 });
    expect(pathDistance(path)).toBeCloseTo(3 * Math.SQRT2 + 1, 6);
    expect(path.length).toBe(5);
  });

  it('BA: refuses diagonal movement through blocked corners', () => {
    const path = findPath(grid(3, 3, ['1,0', '0,1']), { x: 0, y: 0 }, { x: 2, y: 2 });

    expect(path).toEqual([]);
  });

  it('BA: returns an empty path when the goal cannot be reached', () => {
    const path = findPath(grid(5, 5, ['0,2', '1,2', '2,2', '3,2', '4,2']), { x: 0, y: 0 }, { x: 4, y: 4 });

    expect(path).toHaveLength(0);
  });
});
