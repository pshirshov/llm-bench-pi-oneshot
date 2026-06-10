import { describe, expect, it } from 'vitest';
import { findPath, PathGrid } from '../src/game/path';

function grid(rows: string[]): PathGrid {
  const height = rows.length;
  const width = rows[0].length;
  const blocked = new Uint8Array(width * height);
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      if (row[x] === '#') blocked[y * width + x] = 1;
    }
  });
  return { width, height, blocked };
}

const at = (g: PathGrid, x: number, y: number): number => y * g.width + x;

describe('A* pathfinding', () => {
  it('finds the straight shortest path on open ground (octile cost)', () => {
    const g = grid(['.....', '.....', '.....']);
    const res = findPath(g, at(g, 0, 0), at(g, 4, 0));
    expect(res).not.toBeNull();
    expect(res!.path.length).toBe(4); // 4 steps right
    expect(res!.cost).toBeCloseTo(4);
  });

  it('uses diagonals when they are shorter', () => {
    const g = grid(['....', '....', '....', '....']);
    const res = findPath(g, at(g, 0, 0), at(g, 3, 3));
    expect(res).not.toBeNull();
    expect(res!.path.length).toBe(3); // 3 diagonal steps
    expect(res!.cost).toBeCloseTo(3 * Math.SQRT2);
  });

  it('routes around walls with the minimal detour', () => {
    const g = grid([
      '.....',
      '.###.',
      '.....',
    ]);
    const res = findPath(g, at(g, 0, 1), at(g, 4, 1));
    expect(res).not.toBeNull();
    // With corner cutting the detour would cost 2*sqrt2 + 2 ≈ 4.83; since the
    // diagonals at both wall ends clip blocked corners, the true optimum goes
    // fully around: 1 up + 4 across + 1 down = 6.
    expect(res!.cost).toBeCloseTo(6);
  });

  it('does not cut corners through blocked diagonals', () => {
    // The only diagonal "shortcut" passes between two blocked cells.
    const g = grid([
      '.#',
      '#.',
    ]);
    const res = findPath(g, at(g, 0, 0), at(g, 1, 1));
    expect(res).toBeNull(); // corner cutting forbidden => unreachable
  });

  it('walks around a corner instead of clipping it', () => {
    const g = grid([
      '..',
      '#.',
      '..',
    ]);
    const res = findPath(g, at(g, 0, 0), at(g, 0, 2));
    expect(res).not.toBeNull();
    // Must go (0,0)->(1,1)? No: (1,1) diagonal requires (0,1) or (1,0) open;
    // (0,1) is blocked, (1,0) open => allowed. Then (1,1)->(0,2) needs (0,1)
    // open => forbidden; so the path is via (1,0),(1,1),(1,2)? Verify cost:
    expect(res!.cost).toBeGreaterThan(2); // longer than the clipped 2-step line
    // And no step passes through the blocked cell.
    expect(res!.path).not.toContain(at(g, 0, 1));
  });

  it('returns null for fully unreachable targets', () => {
    const g = grid([
      '...#.',
      '...#.',
      '...#.',
    ]);
    expect(findPath(g, at(g, 0, 0), at(g, 4, 0))).toBeNull();
  });

  it('approach mode reaches a tile adjacent to a blocked goal', () => {
    const g = grid([
      '.....',
      '..#..',
      '.....',
    ]);
    const res = findPath(g, at(g, 0, 1), at(g, 2, 1), true);
    expect(res).not.toBeNull();
    const last = res!.path.length > 0 ? res!.path[res!.path.length - 1] : at(g, 0, 1);
    const lx = last % g.width;
    const ly = Math.floor(last / g.width);
    expect(Math.max(Math.abs(lx - 2), Math.abs(ly - 1))).toBe(1);
  });

  it('is deterministic: same grid, same endpoints, same path', () => {
    const g = grid([
      '........',
      '..##....',
      '..##....',
      '........',
    ]);
    const r1 = findPath(g, at(g, 0, 0), at(g, 7, 3));
    const r2 = findPath(g, at(g, 0, 0), at(g, 7, 3));
    expect(r1!.path).toEqual(r2!.path);
  });
});
