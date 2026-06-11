import { describe, it, expect } from "vitest";
import { createRng, seedFromUrl } from "../src/core/rng.js";
import { Grid } from "../src/core/grid.js";
import { vec, vecEquals, vecAdd, manhattan, chebyshev } from "../src/core/vec.js";

// ---------------------------------------------------------------------------
// (a) mulberry32 reproducibility — same seed ⇒ identical sequence
// ---------------------------------------------------------------------------
describe("RNG reproducibility", () => {
  it("produces the same sequence for the same seed", () => {
    const r1 = createRng(42);
    const r2 = createRng(42);
    const n = 20;
    const seq1 = Array.from({ length: n }, () => r1.next());
    const seq2 = Array.from({ length: n }, () => r2.next());
    expect(seq1).toEqual(seq2);
  });

  it("produces different sequences for different seeds", () => {
    const r1 = createRng(1);
    const r2 = createRng(2);
    const seq1 = Array.from({ length: 10 }, () => r1.next());
    const seq2 = Array.from({ length: 10 }, () => r2.next());
    expect(seq1).not.toEqual(seq2);
  });

  it("int(max) stays within [0, max)", () => {
    const r = createRng(7);
    for (let i = 0; i < 100; i++) {
      const v = r.int(10);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
    }
  });

  it("range(min, max) stays within [min, max]", () => {
    const r = createRng(13);
    for (let i = 0; i < 100; i++) {
      const v = r.range(5, 10);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThanOrEqual(10);
    }
  });

  it("seed property reflects the construction seed", () => {
    const r = createRng(0xdeadbeef);
    expect(r.seed).toBe(0xdeadbeef);
  });
});

// ---------------------------------------------------------------------------
// (b) Forked streams are independent AND each deterministic
// ---------------------------------------------------------------------------
describe("RNG fork", () => {
  it("forked streams are independent of each other", () => {
    const parent = createRng(100);
    const forkA = parent.fork("wfc");
    const forkB = parent.fork("sim");

    const seqA = Array.from({ length: 10 }, () => forkA.next());
    const seqB = Array.from({ length: 10 }, () => forkB.next());

    // The two labelled forks must diverge.
    expect(seqA).not.toEqual(seqB);
  });

  it("advancing a fork does not affect the parent stream", () => {
    const parent1 = createRng(200);
    const parent2 = createRng(200);

    // On parent1, create a fork and exhaust it.
    const fork = parent1.fork("drain");
    for (let i = 0; i < 50; i++) fork.next();

    // parent1 and parent2 should still produce the same next value.
    const p1 = parent1.next();
    const p2 = parent2.next();
    expect(p1).toBe(p2);
  });

  it("the same fork label on the same parent seed yields the same child sequence", () => {
    const r1 = createRng(300);
    const r2 = createRng(300);

    const f1 = r1.fork("mapgen");
    const f2 = r2.fork("mapgen");

    const s1 = Array.from({ length: 15 }, () => f1.next());
    const s2 = Array.from({ length: 15 }, () => f2.next());
    expect(s1).toEqual(s2);
  });

  it("numeric and string labels produce independent (non-equal) streams", () => {
    const parent = createRng(400);
    const fA = parent.fork(0);
    const fB = parent.fork(1);

    const sA = Array.from({ length: 10 }, () => fA.next());
    const sB = Array.from({ length: 10 }, () => fB.next());
    expect(sA).not.toEqual(sB);
  });
});

// ---------------------------------------------------------------------------
// (c) ?seed= URL parsing
// ---------------------------------------------------------------------------
describe("seedFromUrl", () => {
  it("parses a valid ?seed= integer", () => {
    const { seed, rng } = seedFromUrl("?seed=12345");
    expect(seed).toBe(12345);
    expect(rng.seed).toBe(12345);
  });

  it("two RNGs from the same ?seed= produce the same sequence", () => {
    const { rng: r1 } = seedFromUrl("?seed=99999");
    const { rng: r2 } = seedFromUrl("?seed=99999");
    const s1 = Array.from({ length: 10 }, () => r1.next());
    const s2 = Array.from({ length: 10 }, () => r2.next());
    expect(s1).toEqual(s2);
  });

  it("missing ?seed= produces a non-zero seed (random fallback)", () => {
    // We can't assert the exact seed but we can assert it's a uint32.
    const { seed } = seedFromUrl("");
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(4294967295);
  });

  it("an invalid ?seed= string falls back to a random seed", () => {
    // 'abc' is not a number — the implementation should produce a valid uint32.
    const { seed } = seedFromUrl("?seed=abc");
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(4294967295);
  });
});

// ---------------------------------------------------------------------------
// (d) Grid bounds + neighbor correctness
// ---------------------------------------------------------------------------
describe("Grid", () => {
  it("get/set and inBounds work correctly", () => {
    const g = new Grid<number>(3, 2, 0);
    expect(g.inBounds(0, 0)).toBe(true);
    expect(g.inBounds(2, 1)).toBe(true);
    expect(g.inBounds(3, 0)).toBe(false);
    expect(g.inBounds(0, 2)).toBe(false);
    expect(g.inBounds(-1, 0)).toBe(false);

    g.set(1, 1, 42);
    expect(g.get(1, 1)).toBe(42);
    expect(g.get(0, 0)).toBe(0);
  });

  it("get out of bounds throws RangeError", () => {
    const g = new Grid<number>(3, 3, 0);
    expect(() => g.get(5, 0)).toThrow(RangeError);
  });

  it("factory initializer receives correct (x, y) coordinates", () => {
    const g = new Grid<string>(3, 3, (x, y) => `${x},${y}`);
    expect(g.get(0, 0)).toBe("0,0");
    expect(g.get(2, 1)).toBe("2,1");
    expect(g.get(1, 2)).toBe("1,2");
  });

  it("neighbors4 of a corner cell returns 2 neighbors", () => {
    const g = new Grid<number>(4, 4, 0);
    const neighbors = g.neighbors4(0, 0);
    expect(neighbors).toHaveLength(2);
    // Should contain (1,0) and (0,1)
    expect(neighbors.some((v) => v.x === 1 && v.y === 0)).toBe(true);
    expect(neighbors.some((v) => v.x === 0 && v.y === 1)).toBe(true);
  });

  it("neighbors4 of an interior cell returns 4 neighbors", () => {
    const g = new Grid<number>(5, 5, 0);
    const neighbors = g.neighbors4(2, 2);
    expect(neighbors).toHaveLength(4);
  });

  it("neighbors8 of a corner cell returns 3 neighbors", () => {
    const g = new Grid<number>(4, 4, 0);
    const neighbors = g.neighbors8(0, 0);
    expect(neighbors).toHaveLength(3);
  });

  it("neighbors8 of an interior cell returns 8 neighbors", () => {
    const g = new Grid<number>(5, 5, 0);
    const neighbors = g.neighbors8(2, 2);
    expect(neighbors).toHaveLength(8);
  });

  it("map transforms each cell and returns a new Grid", () => {
    const g = new Grid<number>(2, 2, (x, y) => x + y);
    const doubled = g.map((v) => v * 2);
    expect(doubled.get(0, 0)).toBe(0);
    expect(doubled.get(1, 0)).toBe(2);
    expect(doubled.get(0, 1)).toBe(2);
    expect(doubled.get(1, 1)).toBe(4);
    // Original unchanged
    expect(g.get(1, 1)).toBe(2);
  });

  it("clone produces an independent copy", () => {
    const g = new Grid<number>(2, 2, 7);
    const c = g.clone();
    c.set(0, 0, 99);
    expect(g.get(0, 0)).toBe(7);
    expect(c.get(0, 0)).toBe(99);
  });

  it("fill overwrites all cells", () => {
    const g = new Grid<number>(3, 3, 1);
    g.fill(5);
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        expect(g.get(x, y)).toBe(5);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Vec2 helpers
// ---------------------------------------------------------------------------
describe("Vec2 helpers", () => {
  it("vec creates a Vec2 with correct coordinates", () => {
    const v = vec(3, 7);
    expect(v.x).toBe(3);
    expect(v.y).toBe(7);
  });

  it("vecEquals returns true for equal vectors", () => {
    expect(vecEquals(vec(1, 2), vec(1, 2))).toBe(true);
    expect(vecEquals(vec(1, 2), vec(2, 1))).toBe(false);
  });

  it("vecAdd sums coordinates", () => {
    const result = vecAdd(vec(3, 4), vec(-1, 2));
    expect(result).toEqual({ x: 2, y: 6 });
  });

  it("manhattan distance is correct", () => {
    expect(manhattan(vec(0, 0), vec(3, 4))).toBe(7);
    expect(manhattan(vec(1, 1), vec(1, 1))).toBe(0);
  });

  it("chebyshev distance is correct", () => {
    expect(chebyshev(vec(0, 0), vec(3, 4))).toBe(4);
    expect(chebyshev(vec(0, 0), vec(4, 4))).toBe(4);
  });
});
