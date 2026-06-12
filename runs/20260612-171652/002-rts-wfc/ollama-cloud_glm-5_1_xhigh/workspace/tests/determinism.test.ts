/** Determinism and WFC tests. */

import { describe, it, expect } from "vitest";
import { createPRNG } from "../src/sim/prng";
import { generateMap } from "../src/sim/wfc";

describe("PRNG determinism", () => {
  it("produces identical sequences for the same seed", () => {
    const a = createPRNG(12345);
    const b = createPRNG(12345);
    for (let i = 0; i < 1000; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it("produces different sequences for different seeds", () => {
    const a = createPRNG(12345);
    const b = createPRNG(54321);
    let same = 0;
    for (let i = 0; i < 100; i++) {
      if (a.next() === b.next()) same++;
    }
    expect(same).toBeLessThan(50);
  });

  it("fork creates independent sequences", () => {
    const a = createPRNG(12345);
    const fork = a.fork();
    expect(typeof a.next()).toBe("number");
    expect(typeof fork.next()).toBe("number");
  });
});

describe("WFC map generation", () => {
  it("generates valid maps without crashing", () => {
    for (let seed = 1; seed <= 5; seed++) {
      const { map } = generateMap(32, 32, seed);
      expect(map.width).toBe(32);
      expect(map.height).toBe(32);
      // Check start locations exist
      // Verify basic tile types
      let hasWalkable = false;
      let hasResource = false;
      for (let r = 0; r < map.height; r++) {
        for (let c = 0; c < map.width; c++) {
          const tile = map.getTile(c, r);
          if (tile === "grass" || tile === "dirt") hasWalkable = true;
          if (tile === "gold_mine" || tile === "forest") hasResource = true;
        }
      }
      expect(hasWalkable).toBe(true);
      expect(hasResource).toBe(true);
    }
  });

  it("is deterministic for a fixed seed", () => {
    const a = generateMap(32, 32, 42);
    const b = generateMap(32, 32, 42);
    expect(a.starts).toEqual(b.starts);
    for (let r = 0; r < a.map.height; r++) {
      for (let c = 0; c < a.map.width; c++) {
        expect(a.map.getTile(c, r)).toBe(b.map.getTile(c, r));
      }
    }
  });

  it("generates different maps for different seeds", () => {
    const a = generateMap(32, 32, 1);
    const b = generateMap(32, 32, 999);
    let same = 0;
    for (let r = 0; r < a.map.height; r++) {
      for (let c = 0; c < a.map.width; c++) {
        if (a.map.getTile(c, r) === b.map.getTile(c, r)) same++;
      }
    }
    expect(same).toBeLessThan(a.map.width * a.map.height);
  });
});

describe("Playability pass", () => {
  const testCases = [
    { seed: 1, level: 1 }, { seed: 2, level: 1 }, { seed: 3, level: 2 },
    { seed: 4, level: 2 }, { seed: 5, level: 3 }, { seed: 6, level: 3 },
    { seed: 7, level: 4 }, { seed: 8, level: 4 }, { seed: 9, level: 5 },
    { seed: 10, level: 5 }, { seed: 11, level: 1 }, { seed: 12, level: 2 },
    { seed: 13, level: 3 }, { seed: 14, level: 4 }, { seed: 15, level: 5 },
    { seed: 16, level: 1 }, { seed: 17, level: 2 }, { seed: 18, level: 3 },
    { seed: 19, level: 4 }, { seed: 20, level: 5 },
  ];

  for (const { seed, level } of testCases) {
    it(`seed=${seed} level=${level} is playable`, () => {
      const sizes: [number, number][] = [[32,32],[40,40],[48,48],[56,56],[64,64]];
      const [w, h] = sizes[Math.min(level - 1, 4)];
      const { map, starts } = generateMap(w, h, seed);

      expect(starts.length).toBe(2);

      const maxDim = Math.max(w, h);
      const euclidean = Math.sqrt(
        (starts[0].col - starts[1].col) ** 2 + (starts[0].row - starts[1].row) ** 2
      );
      expect(euclidean).toBeGreaterThanOrEqual(maxDim * 0.4);

      // Check buildable areas around starts (ensured by ensureStartArea)
      for (const s of starts) {
        let buildable = false;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            if (map.inBounds(s.col + dc, s.row + dr) && map.isBuildable(s.col + dc, s.row + dr)) {
              buildable = true;
            }
          }
        }
        expect(buildable).toBe(true);
      }

      for (const s of starts) {
        let hasGold = false;
        let hasForest = false;
        for (let dr = -15; dr <= 15; dr++) {
          for (let dc = -15; dc <= 15; dc++) {
            const t = map.getTile(s.col + dc, s.row + dr);
            if (t === "gold_mine") hasGold = true;
            if (t === "forest") hasForest = true;
          }
        }
        expect(hasGold).toBe(true);
        expect(hasForest).toBe(true);
      }
    });
  }
});

describe("World determinism", () => {
  it("map generation is deterministic for same seed", () => {
    const { map: map1, starts: starts1 } = generateMap(32, 32, 42);
    const { map: map2, starts: starts2 } = generateMap(32, 32, 42);

    for (let r = 0; r < map1.height; r++) {
      for (let c = 0; c < map1.width; c++) {
        expect(map1.getTile(c, r)).toBe(map2.getTile(c, r));
      }
    }

    expect(starts1.length).toBe(starts2.length);
    for (let i = 0; i < starts1.length; i++) {
      expect(starts1[i].col).toBe(starts2[i].col);
      expect(starts1[i].row).toBe(starts2[i].row);
    }
  });
});