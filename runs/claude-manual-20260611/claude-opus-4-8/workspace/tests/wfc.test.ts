import { describe, it, expect } from "vitest";
import { createRng } from "../src/core/rng.js";
import type { Grid } from "../src/core/grid.js";
import { solve } from "../src/wfc/wfc.js";
import {
  ADJACENCY,
  TILE_TYPES,
  adjacencySymmetryViolations,
} from "../src/wfc/tiles.js";
import type { TileType } from "../src/wfc/tiles.js";

/** True iff tile `a` is permitted orthogonally adjacent to tile `b`. */
function adjacent(a: TileType, b: TileType): boolean {
  return ADJACENCY[a].includes(b);
}

/**
 * Returns the first orthogonally-adjacent output pair that VIOLATES the
 * adjacency table, or null if every orthogonal pair is legal.
 */
function firstAdjacencyViolation(
  g: Grid<TileType>,
): { a: TileType; b: TileType; x: number; y: number } | null {
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      const a = g.get(x, y);
      if (x + 1 < g.width) {
        const b = g.get(x + 1, y);
        if (!adjacent(a, b)) return { a, b, x, y };
      }
      if (y + 1 < g.height) {
        const b = g.get(x, y + 1);
        if (!adjacent(a, b)) return { a, b, x, y };
      }
    }
  }
  return null;
}

function flatten(g: Grid<TileType>): TileType[] {
  const out: TileType[] = [];
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) out.push(g.get(x, y));
  }
  return out;
}

// ---------------------------------------------------------------------------
// (a) The adjacency table is SYMMETRIC: ∀ A allows B ⟺ B allows A.
// ---------------------------------------------------------------------------
describe("WFC adjacency table", () => {
  it("is symmetric for every tile pair", () => {
    expect(adjacencySymmetryViolations()).toEqual([]);
  });

  it("never permits goldMine next to water (forbidden-adjacency spot check)", () => {
    // (e) concrete forbidden adjacency, asserted directly on the rule table.
    expect(adjacent("goldMine", "water")).toBe(false);
    expect(adjacent("water", "goldMine")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (b) Propagation correctness: every orthogonal output pair is legal,
//     across several map sizes.
// ---------------------------------------------------------------------------
describe("WFC solve — propagation correctness", () => {
  const sizes: ReadonlyArray<readonly [number, number]> = [
    [8, 8],
    [16, 12],
    [24, 24],
    [32, 20],
  ];

  for (const [w, h] of sizes) {
    it(`produces only legal orthogonal adjacencies on ${w}x${h}`, () => {
      const g = solve(w, h, createRng(12345));
      expect(g).not.toBeNull();
      const grid = g!;
      expect(grid.width).toBe(w);
      expect(grid.height).toBe(h);
      // Every emitted tile is a known tile type.
      for (const t of flatten(grid)) {
        expect(TILE_TYPES).toContain(t);
      }
      // No orthogonally-adjacent pair violates the adjacency table.
      expect(firstAdjacencyViolation(grid)).toBeNull();
    });
  }

  it("never places a goldMine next to water in a solved grid", () => {
    // (e) the same forbidden adjacency, now checked on real solver output.
    const grid = solve(28, 28, createRng(99))!;
    expect(grid).not.toBeNull();
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        if (grid.get(x, y) !== "goldMine") continue;
        for (const [dx, dy] of [
          [0, -1],
          [1, 0],
          [0, 1],
          [-1, 0],
        ] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (grid.inBounds(nx, ny)) {
            expect(grid.get(nx, ny)).not.toBe("water");
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// (c) DETERMINISM: same seed twice ⇒ identical grids.
// ---------------------------------------------------------------------------
describe("WFC solve — determinism", () => {
  it("yields identical grids for the same seed", () => {
    const a = solve(20, 20, createRng(0xc0ffee))!;
    const b = solve(20, 20, createRng(0xc0ffee))!;
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(flatten(a)).toEqual(flatten(b));
  });

  // ---------------------------------------------------------------------------
  // (d) DIFFERENT seeds ⇒ (generally) different grids.
  // ---------------------------------------------------------------------------
  it("yields different grids for different seeds", () => {
    const a = solve(20, 20, createRng(1))!;
    const b = solve(20, 20, createRng(2))!;
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(flatten(a)).not.toEqual(flatten(b));
  });
});
