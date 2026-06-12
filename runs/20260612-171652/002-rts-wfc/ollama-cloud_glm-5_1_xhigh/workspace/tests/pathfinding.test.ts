/** Pathfinding and map tests. */

import { describe, it, expect } from "vitest";
import { GameMap } from "../src/sim/map";
import { findPath, findNearestWalkable } from "../src/sim/pathfinding";

describe("A* pathfinding", () => {
  function makeOpenMap(w: number, h: number): GameMap {
    const map = new GameMap(w, h);
    for (let r = 0; r < h; r++)
      for (let c = 0; c < w; c++)
        map.tiles[r][c] = "grass";
    return map;
  }

  it("finds a path on an open map", () => {
    const map = makeOpenMap(10, 10);
    const path = findPath(map, { col: 0, row: 0 }, { col: 5, row: 5 });
    expect(path).not.toBeNull();
    if (path) {
      expect(path.length).toBeGreaterThan(0);
      const last = path[path.length - 1];
      expect(last.col).toBe(5);
      expect(last.row).toBe(5);
    }
  });

  it("returns null for unreachable targets", () => {
    const map = makeOpenMap(10, 10);
    // Wall of water blocking path
    for (let r = 0; r < 10; r++) map.tiles[r][5] = "water";

    const path = findPath(map, { col: 0, row: 5 }, { col: 9, row: 5 });
    expect(path).toBeNull();
  });

  it("does not cut corners through blocked diagonals", () => {
    const map = makeOpenMap(5, 5);
    map.tiles[1][0] = "water";
    map.tiles[0][1] = "water";

    const path = findPath(map, { col: 0, row: 0 }, { col: 1, row: 1 });
    // Should not be able to go directly diagonal through the corner
    expect(path).toBeNull();
  });

  it("finds nearest walkable tile for unwalkable targets", () => {
    const map = makeOpenMap(10, 10);
    map.tiles[5][5] = "water";

    const nearest = findNearestWalkable(map, { col: 5, row: 5 }, new Set());
    expect(nearest).not.toBeNull();
    if (nearest) {
      expect(map.isWalkable(nearest.col, nearest.row)).toBe(true);
    }
  });
});

describe("GameMap", () => {
  it("clones correctly", () => {
    const map = new GameMap(10, 10);
    for (let r = 0; r < 10; r++)
      for (let c = 0; c < 10; c++)
        map.tiles[r][c] = "grass";
    map.setTile(5, 5, "forest");

    const clone = map.clone();
    expect(clone.getTile(5, 5)).toBe("forest");
    clone.setTile(5, 5, "water");
    expect(map.getTile(5, 5)).toBe("forest");
    expect(clone.getTile(5, 5)).toBe("water");
  });

  it("depletes forest tiles", () => {
    const map = new GameMap(10, 10);
    map.tiles[5][5] = "forest";
    const harvested = map.harvestWood(5, 5, 10);
    expect(harvested).toBe(10);
    expect(map.getTile(5, 5)).toBe("chopped_forest");
  });

  it("depletes gold mines", () => {
    const map = new GameMap(10, 10);
    map.tiles[5][5] = "gold_mine";
    const id = map.addGoldMine(5, 5, 100);
    const harvested = map.harvestGold(id, 50);
    expect(harvested).toBe(50);
    const mine = map.goldMines.get(id);
    expect(mine?.remaining).toBe(50);
  });

  it("gold mine depletes when exhausted", () => {
    const map = new GameMap(10, 10);
    map.tiles[5][5] = "gold_mine";
    const id = map.addGoldMine(5, 5, 50);
    map.harvestGold(id, 50);
    expect(map.getTile(5, 5)).toBe("depleted_mine");
    expect(map.goldMines.has(id)).toBe(false);
  });
});