/**
 * T12 spatial-hash tests.
 *
 * Required assertions:
 *   (a) `queryRadius` returns EXACTLY the entities within range and excludes
 *       those just outside.
 *   (b) Results MATCH a brute-force O(n²) reference on a seeded random
 *       population — same set, same deterministic ascending-EntityId order.
 *   (c) After entities MOVE and the hash is rebuilt, queries reflect new
 *       positions.
 *
 * Additional assertions:
 *   (d) Empty map — queryRadius returns [].
 *   (e) Entity exactly at the query boundary (d == r) is included (≤ check).
 *   (f) Cross-cell query covering multiple hash cells collects all entities.
 */

import { describe, it, expect } from "vitest";
import { SpatialHash } from "../src/sim/spatial.js";
import { makeEntityId } from "../src/game/types.js";
import type { EntityId } from "../src/game/types.js";
import { createRng } from "../src/core/rng.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a ReadonlyMap<EntityId, {pos}> from a flat array of [id, x, y]. */
function makeUnits(entries: [number, number, number][]): ReadonlyMap<EntityId, { pos: { x: number; y: number } }> {
  const m = new Map<EntityId, { pos: { x: number; y: number } }>();
  for (const [id, x, y] of entries) {
    m.set(makeEntityId(id), { pos: { x, y } });
  }
  return m;
}

/**
 * Brute-force reference: return all ids in `units` whose position is within
 * Euclidean distance `r` of `pos`, in ascending numeric id order.
 */
function bruteForceQuery(
  units: ReadonlyMap<EntityId, { pos: { x: number; y: number } }>,
  pos: { x: number; y: number },
  r: number,
): EntityId[] {
  const r2 = r * r;
  const result: EntityId[] = [];
  for (const [id, u] of units) {
    const dx = u.pos.x - pos.x;
    const dy = u.pos.y - pos.y;
    if (dx * dx + dy * dy <= r2) {
      result.push(id);
    }
  }
  return result.sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SpatialHash", () => {
  // ── (d) Empty map ──────────────────────────────────────────────────────────
  it("returns [] when the hash is empty", () => {
    const hash = new SpatialHash(4);
    hash.rebuild(new Map());
    expect(hash.queryRadius({ x: 5, y: 5 }, 3)).toEqual([]);
  });

  // ── (a) Exact inclusion / exclusion near boundary ─────────────────────────
  it("(a) includes entities within range and excludes those just outside", () => {
    // Place 4 units at known distances from query point (5, 5):
    //   id=1: (5, 5)     → d=0    included at r=2
    //   id=2: (6, 5)     → d=1    included at r=2
    //   id=3: (7, 5)     → d=2    included at r=2  (exactly at boundary)
    //   id=4: (7.01, 5)  → d=2.01 excluded at r=2
    const units = makeUnits([
      [1, 5,    5   ],
      [2, 6,    5   ],
      [3, 7,    5   ],
      [4, 7.01, 5   ],
    ]);
    const hash = new SpatialHash(4);
    hash.rebuild(units);

    const result = hash.queryRadius({ x: 5, y: 5 }, 2);

    // Exactly ids 1, 2, 3 are ≤ 2 tiles away; id 4 is just outside.
    expect(result).toEqual([
      makeEntityId(1),
      makeEntityId(2),
      makeEntityId(3),
    ]);

    // id 4 must NOT appear.
    expect(result).not.toContain(makeEntityId(4));
  });

  // ── (e) Boundary entity (d == r) is included ──────────────────────────────
  it("(e) includes an entity placed exactly at distance r", () => {
    // id=1 is at Euclidean distance exactly r=3 (a 3-4-5 right triangle scaled).
    // pos = (8, 9), query = (5, 5), r = 5  →  dx=3, dy=4, d=5 exactly.
    const units = makeUnits([[1, 8, 9]]);
    const hash = new SpatialHash(4);
    hash.rebuild(units);

    expect(hash.queryRadius({ x: 5, y: 5 }, 5)).toEqual([makeEntityId(1)]);
    // At r=4.99 it should be excluded.
    expect(hash.queryRadius({ x: 5, y: 5 }, 4.99)).toEqual([]);
  });

  // ── (b) Results match brute-force reference on a seeded population ─────────
  it("(b) matches brute-force reference (same set, same order) on seeded random population", () => {
    // Generate 200 units at random positions in a 64×64 world.
    const rng = createRng(0xdeadbeef);
    const entries: [number, number, number][] = [];
    for (let i = 1; i <= 200; i++) {
      const x = rng.next() * 64;
      const y = rng.next() * 64;
      entries.push([i, x, y]);
    }
    const units = makeUnits(entries);

    const hash = new SpatialHash(4);
    hash.rebuild(units);

    // Run several queries at different positions and radii.
    const queryPoints: Array<[{ x: number; y: number }, number]> = [
      [{ x: 10,  y: 10  }, 5  ],
      [{ x: 32,  y: 32  }, 8  ],
      [{ x: 0,   y: 0   }, 3  ],
      [{ x: 63,  y: 63  }, 6  ],
      [{ x: 20,  y: 40  }, 10 ],
    ];

    for (const [pos, r] of queryPoints) {
      const hashResult = hash.queryRadius(pos, r);
      const brute = bruteForceQuery(units, pos, r);
      expect(hashResult).toEqual(brute);
    }
  });

  // ── (c) After entities move and hash is rebuilt, queries reflect new positions
  it("(c) reflects updated positions after rebuild following a move", () => {
    // id=1 starts at (2, 2) — outside radius-2 query centered at (8, 8)
    // id=2 starts at (8, 8) — inside
    const units = new Map<EntityId, { pos: { x: number; y: number } }>([
      [makeEntityId(1), { pos: { x: 2, y: 2 } }],
      [makeEntityId(2), { pos: { x: 8, y: 8 } }],
    ]);

    const hash = new SpatialHash(4);
    hash.rebuild(units);

    // Before move: only id=2 in range.
    expect(hash.queryRadius({ x: 8, y: 8 }, 2)).toEqual([makeEntityId(2)]);

    // Simulate id=1 moving to (8.5, 8.5) — now inside the radius.
    units.get(makeEntityId(1))!.pos = { x: 8.5, y: 8.5 };

    // Hash not yet rebuilt — old result holds.
    expect(hash.queryRadius({ x: 8, y: 8 }, 2)).toEqual([makeEntityId(2)]);

    // Rebuild — hash now sees the new positions.
    hash.rebuild(units);
    const after = hash.queryRadius({ x: 8, y: 8 }, 2);
    expect(after).toContain(makeEntityId(1));
    expect(after).toContain(makeEntityId(2));
    // Still sorted ascending.
    expect(after).toEqual([makeEntityId(1), makeEntityId(2)]);
  });

  // ── (f) Cross-cell query collects entities in multiple hash cells ──────────
  it("(f) cross-cell query correctly spans multiple hash cells", () => {
    // cellSize=4 → cells at x=[0,4), [4,8), [8,12) …
    // Place one entity in each of four distinct cells around (8, 8):
    //   id=1: (2, 2)   cell (0,0)
    //   id=2: (6, 2)   cell (1,0)
    //   id=3: (2, 6)   cell (0,1)
    //   id=4: (6, 6)   cell (1,1)
    // Query at (4, 4), radius=4: all four units are within √(dx²+dy²)≤4.
    const units = makeUnits([
      [1, 2, 2],
      [2, 6, 2],
      [3, 2, 6],
      [4, 6, 6],
    ]);
    const hash = new SpatialHash(4);
    hash.rebuild(units);

    const result = hash.queryRadius({ x: 4, y: 4 }, 3.5);
    // All four are within distance √((4-2)²+(4-2)²)=√8≈2.83 ≤ 3.5.
    expect(result).toEqual([
      makeEntityId(1),
      makeEntityId(2),
      makeEntityId(3),
      makeEntityId(4),
    ]);
  });
});
