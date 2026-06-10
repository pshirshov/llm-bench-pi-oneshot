import { describe, it, expect } from 'vitest';
import { findPath, buildWalkGrid } from '../src/pathfind';

describe('A* pathfinding', () => {
  function makeGridFromTiles(tiles: any[][]): boolean[][] {
    return buildWalkGrid(tiles as any, tiles[0].length, tiles.length);
  }

  it('finds a direct shortest path on open field', () => {
    const tiles: any[][] = Array.from({ length: 12 }, () =>
      Array.from({ length: 12 }, () => 'grass')
    );
    const grid = makeGridFromTiles(tiles);
    const path = findPath(grid, { x: 1.5, y: 1.5 }, { x: 9.5, y: 9.5 }, 12, 12);
    expect(path).not.toBeNull();
    const pathArr = path ?? [];
    expect(pathArr.length).toBeGreaterThan(3);
    // last point approx goal
    const last = pathArr[pathArr.length - 1];
    expect(Math.abs(last.x - 9.5)).toBeLessThan(0.6);
    expect(Math.abs(last.y - 9.5)).toBeLessThan(0.6);
  });

  it('avoids water and rock, does not corner cut', () => {
    const tiles: any[][] = Array.from({ length: 10 }, () =>
      Array.from({ length: 10 }, () => 'grass')
    );
    // block a diagonal corridor
    tiles[4][4] = 'water';
    tiles[4][5] = 'water';
    tiles[5][4] = 'water';
    tiles[5][5] = 'rock';

    const grid = makeGridFromTiles(tiles);
    const path = findPath(grid, { x: 2, y: 2 }, { x: 7, y: 7 }, 10, 10);
    expect(path).not.toBeNull();
    // Verify no path goes through blocked tiles
    if (path) {
      for (let i = 0; i < path.length; i++) {
        const p = path[i];
        const tx = Math.floor(p.x);
        const ty = Math.floor(p.y);
        expect(['water', 'rock'].includes(tiles[ty][tx] as any)).toBe(false);
      }
    }
  });

  it('returns null for unreachable goal', () => {
    const tiles: any[][] = Array.from({ length: 8 }, () =>
      Array.from({ length: 8 }, () => 'grass')
    );
    for (let x=0; x<8; x++) tiles[3][x] = 'water'; // wall
    const grid = makeGridFromTiles(tiles);
    const path = findPath(grid, { x: 1, y: 1 }, { x: 4, y: 5 }, 8, 8);
    expect(path).toBeNull();
  });

  it('produces 8-directional moves without illegal corner cuts', () => {
    const tiles: any[][] = Array.from({ length: 6 }, (_, y) =>
      Array.from({ length: 6 }, (_, x) => (x === 2 && y === 2 ? 'rock' : 'grass'))
    );
    const grid = makeGridFromTiles(tiles);
    const path = findPath(grid, { x: 0.5, y: 0.5 }, { x: 5.5, y: 5.5 }, 6, 6);
    expect(path).not.toBeNull();
    // check that any diagonal step had supporting cardinals
    if (path && path.length >= 2) {
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1];
        const b = path[i];
        const dx = Math.round(b.x - a.x);
        const dy = Math.round(b.y - a.y);
        if (Math.abs(dx) === 1 && Math.abs(dy) === 1) {
          // both straight steps must be possible in original grid
          const mx = Math.round(a.x + dx);
          const my = Math.round(a.y);
          const nx = Math.round(a.x);
          const ny = Math.round(a.y + dy);
          if (mx >= 0 && mx < 6 && my >= 0 && my < 6) expect(grid[my][mx]).toBe(true);
          if (nx >= 0 && nx < 6 && ny >= 0 && ny < 6) expect(grid[ny][nx]).toBe(true);
        }
      }
    }
  });
});
