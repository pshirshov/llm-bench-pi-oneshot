import { describe, expect, it } from "vitest";
import { Rng } from "../src/core/rng.js";
import { runWfc } from "../src/wfc/wfc.js";
import { ADJACENCY, ALL_TILES, canBeAdjacent, TileType } from "../src/wfc/tiles.js";
import { generateMap } from "../src/wfc/mapgen.js";

describe("WFC adjacency rules", () => {
  it("are symmetric", () => {
    for (const a of ALL_TILES) {
      for (const b of ALL_TILES) {
        expect(canBeAdjacent(a, b)).toBe(canBeAdjacent(b, a));
      }
    }
  });

  it("forbid water touching forest, rock or gold mines", () => {
    expect(canBeAdjacent(TileType.Water, TileType.Forest)).toBe(false);
    expect(canBeAdjacent(TileType.Water, TileType.Rock)).toBe(false);
    expect(canBeAdjacent(TileType.Water, TileType.GoldMine)).toBe(false);
    // Water borders only water and dirt.
    expect(canBeAdjacent(TileType.Water, TileType.Water)).toBe(true);
    expect(canBeAdjacent(TileType.Water, TileType.Dirt)).toBe(true);
  });

  it("keep gold mines in grass/dirt clearings", () => {
    expect(ADJACENCY[TileType.GoldMine].has(TileType.Grass)).toBe(true);
    expect(ADJACENCY[TileType.GoldMine].has(TileType.Dirt)).toBe(true);
    expect(ADJACENCY[TileType.GoldMine].has(TileType.Forest)).toBe(false);
  });
});

describe("WFC collapse", () => {
  it("collapses every cell to a single valid tile that satisfies adjacency constraints", () => {
    const result = runWfc(24, 24, new Rng(12345));
    expect(result).not.toBeNull();
    const grid = result!.grid;
    // Every cell is a valid tile type.
    for (const cell of grid.cells) {
      expect(ALL_TILES.includes(cell)).toBe(true);
    }
    // Every orthogonally-adjacent pair respects the adjacency table.
    let checked = 0;
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const t = grid.get(x, y);
        if (x + 1 < grid.width) {
          expect(canBeAdjacent(t, grid.get(x + 1, y))).toBe(true);
          checked++;
        }
        if (y + 1 < grid.height) {
          expect(canBeAdjacent(t, grid.get(x, y + 1))).toBe(true);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("is deterministic for a fixed seed", () => {
    const a = runWfc(20, 20, new Rng(777));
    const b = runWfc(20, 20, new Rng(777));
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.grid.cells).toEqual(b!.grid.cells);
  });

  it("produces different maps for different seeds", () => {
    const a = runWfc(20, 20, new Rng(1));
    const b = runWfc(20, 20, new Rng(2));
    expect(a!.grid.cells).not.toEqual(b!.grid.cells);
  });
});

describe("playable map generation", () => {
  it("is deterministic in the seed (terrain and start locations)", () => {
    const a = generateMap(42, 32, 32);
    const b = generateMap(42, 32, 32);
    expect(a.tiles.cells).toEqual(b.tiles.cells);
    expect(a.starts).toEqual(b.starts);
  });

  it("guarantees two distinct, separated starts with gold and forest in reach", () => {
    const m = generateMap(99, 48, 48);
    const [s0, s1] = m.starts;
    const sep = Math.hypot(s0.tx - s1.tx, s0.ty - s1.ty);
    expect(sep).toBeGreaterThan(10);

    const countNear = (cx: number, cy: number, pred: (t: TileType) => boolean): number => {
      let n = 0;
      for (let dy = -11; dy <= 11; dy++) {
        for (let dx = -11; dx <= 11; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (!m.tiles.inBounds(x, y)) continue;
          if (dx * dx + dy * dy > 121) continue;
          if (pred(m.tiles.get(x, y))) n++;
        }
      }
      return n;
    };
    for (const s of m.starts) {
      expect(countNear(s.tx, s.ty, (t) => t === TileType.GoldMine)).toBeGreaterThanOrEqual(1);
      expect(countNear(s.tx, s.ty, (t) => t === TileType.Forest)).toBeGreaterThanOrEqual(10);
    }
  });
});
