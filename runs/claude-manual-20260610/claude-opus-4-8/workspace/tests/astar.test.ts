import { describe, expect, it } from "vitest";
import { findPath } from "../src/sim/astar.js";

const open = (): ((x: number, y: number) => boolean) => () => false;

describe("A* pathfinding", () => {
  it("returns an empty path when already at the goal", () => {
    const path = findPath(10, 10, open(), { tx: 3, ty: 3 }, { tx: 3, ty: 3 });
    expect(path).toEqual([]);
  });

  it("finds the shortest diagonal path on an open grid", () => {
    const path = findPath(10, 10, open(), { tx: 0, ty: 0 }, { tx: 9, ty: 9 });
    expect(path).not.toBeNull();
    // Pure diagonal: 9 steps, ending on the goal.
    expect(path!.length).toBe(9);
    expect(path![path!.length - 1]).toEqual({ tx: 9, ty: 9 });
  });

  it("does not cut corners through a blocked diagonal", () => {
    // Block the tile east of the start; the NE diagonal must not be cut.
    const blocked = (x: number, y: number): boolean => x === 1 && y === 0;
    const path = findPath(10, 10, blocked, { tx: 0, ty: 0 }, { tx: 1, ty: 1 });
    expect(path).not.toBeNull();
    // Must route orthogonally (0,0)->(0,1)->(1,1): two steps, not a single diagonal.
    expect(path!.length).toBe(2);
    // The blocked tile is never entered.
    for (const step of path!) {
      expect(step).not.toEqual({ tx: 1, ty: 0 });
    }
  });

  it("returns null when the goal is unreachable", () => {
    // A full vertical wall at x=5 splits the grid.
    const wall = (x: number, _y: number): boolean => x === 5;
    const path = findPath(10, 10, wall, { tx: 0, ty: 0 }, { tx: 9, ty: 9 });
    expect(path).toBeNull();
  });

  it("returns null when the goal tile itself is blocked (non-adjacent mode)", () => {
    const blocked = (x: number, y: number): boolean => x === 9 && y === 9;
    const path = findPath(10, 10, blocked, { tx: 0, ty: 0 }, { tx: 9, ty: 9 });
    expect(path).toBeNull();
  });

  it("can stop adjacent to a blocked target", () => {
    const blocked = (x: number, y: number): boolean => x === 9 && y === 9;
    const path = findPath(10, 10, blocked, { tx: 0, ty: 0 }, { tx: 9, ty: 9 }, {
      stopAdjacent: true,
    });
    expect(path).not.toBeNull();
    const last = path![path!.length - 1]!;
    const adj = Math.abs(last.tx - 9) <= 1 && Math.abs(last.ty - 9) <= 1;
    expect(adj).toBe(true);
  });
});
