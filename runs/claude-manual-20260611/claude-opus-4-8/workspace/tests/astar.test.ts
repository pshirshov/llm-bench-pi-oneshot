import { describe, it, expect } from "vitest";
import { astar, octileDistance } from "../src/sim/astar.js";
import type { Vec2 } from "../src/core/vec.js";

const SQRT2 = Math.SQRT2;

/** Open grid: nothing is ever blocked. */
const openGrid = (): ((x: number, y: number) => boolean) => () => false;

/** Build an isBlocked predicate from an explicit set of "#" cells in an ASCII map. */
function blockedFromMap(rows: string[]): { width: number; height: number; isBlocked: (x: number, y: number) => boolean } {
  const height = rows.length;
  const width = rows[0].length;
  const isBlocked = (x: number, y: number): boolean => rows[y][x] === "#";
  return { width, height, isBlocked };
}

/** Total octile cost of a path (sum of per-step costs). */
function pathCost(path: Vec2[]): number {
  let cost = 0;
  for (let i = 1; i < path.length; i++) {
    const dx = Math.abs(path[i].x - path[i - 1].x);
    const dy = Math.abs(path[i].y - path[i - 1].y);
    cost += dx === 1 && dy === 1 ? SQRT2 : 1;
  }
  return cost;
}

/** True if any single step in the path is diagonal. */
function hasDiagonalStep(path: Vec2[], from: Vec2, to: Vec2): boolean {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const isDiag = Math.abs(a.x - b.x) === 1 && Math.abs(a.y - b.y) === 1;
    if (!isDiag) continue;
    const matchFwd = a.x === from.x && a.y === from.y && b.x === to.x && b.y === to.y;
    const matchRev = a.x === to.x && a.y === to.y && b.x === from.x && b.y === from.y;
    if (matchFwd || matchRev) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// (a) Shortest diagonal path on an open grid is octile-optimal.
// ---------------------------------------------------------------------------
describe("astar — octile-optimal length", () => {
  it("(0,0)->(4,4) on an open grid costs exactly 4·√2 over 5 tiles", () => {
    const path = astar(10, 10, openGrid(), { x: 0, y: 0 }, { x: 4, y: 4 });
    expect(path).not.toBeNull();
    const p = path as Vec2[];
    // Path includes both endpoints: 4 diagonal steps ⇒ 5 tiles.
    expect(p).toHaveLength(5);
    // First tile is start, last is goal.
    expect(p[0]).toEqual({ x: 0, y: 0 });
    expect(p[p.length - 1]).toEqual({ x: 4, y: 4 });
    // Geometric optimum: 4 diagonal moves.
    expect(pathCost(p)).toBeCloseTo(4 * SQRT2, 10);
    // Equals the admissible heuristic ⇒ truly optimal.
    expect(pathCost(p)).toBeCloseTo(octileDistance(0, 0, 4, 4), 10);
  });

  it("a pure cardinal run (0,0)->(0,5) costs exactly 5 over 6 tiles", () => {
    const path = astar(10, 10, openGrid(), { x: 0, y: 0 }, { x: 0, y: 5 });
    expect(path).not.toBeNull();
    const p = path as Vec2[];
    expect(p).toHaveLength(6);
    expect(pathCost(p)).toBeCloseTo(5, 10);
  });

  it("a mixed run (0,0)->(5,2): 2 diagonal + 3 cardinal = 2·√2 + 3", () => {
    const path = astar(10, 10, openGrid(), { x: 0, y: 0 }, { x: 5, y: 2 });
    expect(path).not.toBeNull();
    const p = path as Vec2[];
    expect(pathCost(p)).toBeCloseTo(2 * SQRT2 + 3, 10);
    expect(pathCost(p)).toBeCloseTo(octileDistance(0, 0, 5, 2), 10);
  });
});

// ---------------------------------------------------------------------------
// (b) No corner-cutting: a path may not slip diagonally between two blockers.
// ---------------------------------------------------------------------------
describe("astar — no corner-cutting", () => {
  it("a two-blocker pinch traps the start (no diagonal squeeze-out) ⇒ null", () => {
    // Start S=(0,0). Block BOTH cardinals (1,0) and (0,1). The only candidate
    // escape is the (0,0)->(1,1) diagonal, but it shares two blocked cardinals,
    // so corner-cutting forbids it. With no legal first move, G is unreachable.
    //   col:   0 1 2
    // row0:    S # .
    // row1:    # . .
    // row2:    . . G
    const map = blockedFromMap([
      "S#.",
      "#..",
      "..G",
    ]);
    const path = astar(map.width, map.height, map.isBlocked, { x: 0, y: 0 }, { x: 2, y: 2 });
    // If corner-cutting were (incorrectly) allowed, (1,1) would be reachable and
    // a path would exist. The correct no-corner-cutting solver returns null.
    expect(path).toBeNull();
  });

  it("routes around a single diagonal pinch instead of squeezing through", () => {
    // S=(0,0), G=(2,2). Block ONLY (1,0) (one shared cardinal of the
    // (0,0)->(1,1) diagonal). Corner-cutting that step is illegal, but (0,1)
    // is open so the unit can still reach G via cardinals/other diagonals.
    //   col:   0 1 2
    // row0:    S # .
    // row1:    . . .
    // row2:    . . G
    const map = blockedFromMap([
      "S#.",
      "...",
      "..G",
    ]);
    const path = astar(map.width, map.height, map.isBlocked, { x: 0, y: 0 }, { x: 2, y: 2 });
    expect(path).not.toBeNull();
    const p = path as Vec2[];
    // The forbidden squeeze (0,0)<->(1,1) must not be used (its (1,0) cardinal
    // is blocked). Going down to (0,1) first IS allowed.
    expect(hasDiagonalStep(p, { x: 0, y: 0 }, { x: 1, y: 1 })).toBe(false);
    // Path is still valid and reaches the goal.
    expect(p[p.length - 1]).toEqual({ x: 2, y: 2 });
    // Every step is a legal 8-move (no step jumps more than 1 in each axis).
    for (let i = 1; i < p.length; i++) {
      expect(Math.abs(p[i].x - p[i - 1].x)).toBeLessThanOrEqual(1);
      expect(Math.abs(p[i].y - p[i - 1].y)).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// (c) Unreachable goal walled off ⇒ null.
// ---------------------------------------------------------------------------
describe("astar — unreachable", () => {
  it("returns null when the goal is fully walled off", () => {
    // G sits in a pocket surrounded by walls. No 8-connected route reaches it.
    //   col:   0 1 2 3 4
    // row0:    S . . . .
    // row1:    . . # # #
    // row2:    . . # G #
    // row3:    . . # # #
    const map = blockedFromMap([
      "S....",
      "..###",
      "..#G#",
      "..###",
    ]);
    const path = astar(map.width, map.height, map.isBlocked, { x: 0, y: 0 }, { x: 3, y: 2 });
    expect(path).toBeNull();
  });

  it("returns null when the goal tile itself is blocked (no stopAdjacent)", () => {
    const map = blockedFromMap(["S.#"]);
    const path = astar(map.width, map.height, map.isBlocked, { x: 0, y: 0 }, { x: 2, y: 0 });
    expect(path).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (d) start === goal ⇒ [].
// ---------------------------------------------------------------------------
describe("astar — already at goal", () => {
  it("returns [] when start equals goal", () => {
    const path = astar(10, 10, openGrid(), { x: 3, y: 4 }, { x: 3, y: 4 });
    expect(path).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (e) stopAdjacent to a blocked goal yields a tile adjacent to it.
// ---------------------------------------------------------------------------
describe("astar — stopAdjacent", () => {
  it("stops on an 8-adjacent tile when the goal is blocked", () => {
    // Goal G=(4,2) is a blocked "mine". Start far away on an otherwise open grid.
    const goal: Vec2 = { x: 4, y: 2 };
    const isBlocked = (x: number, y: number): boolean => x === goal.x && y === goal.y;
    const path = astar(8, 6, isBlocked, { x: 0, y: 0 }, goal, { stopAdjacent: true });
    expect(path).not.toBeNull();
    const p = path as Vec2[];
    const last = p[p.length - 1];
    // The final tile must NOT be the blocked goal itself...
    expect(last).not.toEqual(goal);
    // ...but it MUST be 8-adjacent to it.
    const dx = Math.abs(last.x - goal.x);
    const dy = Math.abs(last.y - goal.y);
    expect(dx).toBeLessThanOrEqual(1);
    expect(dy).toBeLessThanOrEqual(1);
    expect(dx + dy).toBeGreaterThan(0);
  });

  it("returns null in stopAdjacent mode when every neighbour of the goal is blocked too", () => {
    // Goal pocket: G blocked and ringed by blocked cells ⇒ no adjacent standable tile.
    const map = blockedFromMap([
      "S....",
      "..###",
      "..#G#",
      "..###",
    ]);
    const path = astar(map.width, map.height, map.isBlocked, { x: 0, y: 0 }, { x: 3, y: 2 }, { stopAdjacent: true });
    expect(path).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Budget exhaustion ⇒ null (bonus coverage of the budget knob).
// ---------------------------------------------------------------------------
describe("astar — budget", () => {
  it("returns null when the expansion budget is too small to reach a far goal", () => {
    const path = astar(50, 50, openGrid(), { x: 0, y: 0 }, { x: 49, y: 49 }, { budget: 3 });
    expect(path).toBeNull();
  });

  it("still solves a near goal within a small budget", () => {
    const path = astar(50, 50, openGrid(), { x: 0, y: 0 }, { x: 1, y: 0 }, { budget: 5 });
    expect(path).not.toBeNull();
    expect((path as Vec2[])[path!.length - 1]).toEqual({ x: 1, y: 0 });
  });
});
