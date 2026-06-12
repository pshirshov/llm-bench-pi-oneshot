/**
 * D1 regression: the starting-base carve fallback must not bulldoze a SECOND
 * (non-nearest) gold mine under the Town Hall pad.
 *
 * `carveBuildableAnchor` previously excluded only the single NEAREST gold mine
 * from the carved footprint, so a 4×4 Town Hall pad straddling TWO mines
 * grass-converted (and zeroed) the non-nearest one. The fix avoids ALL nearby
 * gold-mine tiles, preferring a strictly mine-free pad and only overlapping the
 * fewest mines when no mine-free anchor exists in range.
 *
 * These tests drive the (now exported) carve directly on a hand-built GameMap so
 * the straddle scenario is constructed deterministically rather than fished out
 * of a random WFC seed.
 */

import { describe, it, expect } from "vitest";
import { Grid } from "../src/core/grid.js";
import { vec } from "../src/core/vec.js";
import { GameMap, GOLD_MINE_INITIAL_AMOUNT } from "../src/sim/gamemap.js";
import type { TileType } from "../src/wfc/tiles.js";
import { carveBuildableAnchor } from "../src/sim/world.js";
import type { Footprint } from "../src/sim/entity.js";

/** The Town Hall footprint (4×4) — the size that can straddle two mines. */
const TOWN_HALL_FOOTPRINT: Footprint = { w: 4, h: 4 };

/** Builds a GameMap of the given size filled with grass, with mines at `mines`. */
function gridWithMines(w: number, h: number, mines: readonly (readonly [number, number])[]): GameMap {
  const grid = new Grid<TileType>(w, h, "grass");
  for (const [mx, my] of mines) grid.set(mx, my, "goldMine");
  return new GameMap(grid);
}

/** Counts gold-mine tiles remaining on the map (terrain census). */
function mineCount(map: GameMap): number {
  let n = 0;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.tileAt(x, y) === "goldMine") n++;
    }
  }
  return n;
}

/** True iff the footprint anchored at `tile` covers (mx, my). */
function footprintCovers(
  tile: { x: number; y: number },
  fp: Footprint,
  mx: number,
  my: number,
): boolean {
  return mx >= tile.x && mx < tile.x + fp.w && my >= tile.y && my < tile.y + fp.h;
}

describe("D1 — carve fallback preserves a second (non-nearest) gold mine", () => {
  // The reproducing geometry (found by exhaustive search over small grids):
  // a corner start at (0,0), the NEAREST mine at (1,0), and a SECOND mine at
  // (1,1). The old "avoid only the nearest" carve picked anchor (0,1), whose 4×4
  // footprint covers (1,1) — destroying the non-nearest mine. A mine-free 4×4 pad
  // DOES exist in range (e.g. anchor (2,0)), so a correct carve preserves BOTH.
  const START = vec(0, 0);
  const NEAREST_MINE: readonly [number, number] = [1, 0];
  const SECOND_MINE: readonly [number, number] = [1, 1];

  it("the old single-mine carve anchor (0,1) WOULD have destroyed the second mine", () => {
    // Pin the defect: anchor (0,1) — what avoiding only the nearest mine yields —
    // straddles the second mine. This is the failure the fix removes.
    const oldAnchor = vec(0, 1);
    expect(footprintCovers(oldAnchor, TOWN_HALL_FOOTPRINT, NEAREST_MINE[0], NEAREST_MINE[1])).toBe(
      false,
    );
    expect(footprintCovers(oldAnchor, TOWN_HALL_FOOTPRINT, SECOND_MINE[0], SECOND_MINE[1])).toBe(
      true,
    );
  });

  it("carves a mine-free pad that destroys ZERO mines when two mines sit beside the start", () => {
    const map = gridWithMines(8, 8, [NEAREST_MINE, SECOND_MINE]);
    expect(mineCount(map)).toBe(2);

    const anchor = carveBuildableAnchor(map, START, TOWN_HALL_FOOTPRINT);

    // The carved pad covers NEITHER gold mine, and both survive with full gold.
    for (const [mx, my] of [NEAREST_MINE, SECOND_MINE]) {
      expect(footprintCovers(anchor, TOWN_HALL_FOOTPRINT, mx, my)).toBe(false);
      expect(map.tileAt(mx, my)).toBe("goldMine");
      expect(map.goldAt(mx, my)).toBe(GOLD_MINE_INITIAL_AMOUNT);
    }
    // No mine was destroyed by the carve.
    expect(mineCount(map)).toBe(2);
    // The pad is now clear, buildable ground (4×4 grass).
    expect(map.canPlaceBuilding(anchor, TOWN_HALL_FOOTPRINT)).toBe(true);
  });

  it("is deterministic: identical inputs carve the identical anchor", () => {
    const mines: readonly (readonly [number, number])[] = [NEAREST_MINE, SECOND_MINE];
    const a = carveBuildableAnchor(gridWithMines(8, 8, mines), START, TOWN_HALL_FOOTPRINT);
    const b = carveBuildableAnchor(gridWithMines(8, 8, mines), START, TOWN_HALL_FOOTPRINT);
    expect(a).toEqual(b);
  });

  it("destroys the MINIMUM possible mines when no mine-free pad fits in range", () => {
    // A 4×4 hole-free field of gold mines: every in-bounds 4×4 footprint covers
    // 16 mines, so no mine-free pad exists. The carve must still return a pad
    // (the safety net) and destroy only the unavoidable minimum.
    const mines: [number, number][] = [];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) mines.push([x, y]);
    }
    const map = gridWithMines(8, 8, mines);
    const before = mineCount(map);
    expect(before).toBe(64);

    const anchor = carveBuildableAnchor(map, vec(3, 3), TOWN_HALL_FOOTPRINT);
    const destroyed = before - mineCount(map);

    // A full 4×4 of mines is unavoidable here: exactly 16 destroyed, the minimum
    // a 4×4 footprint can cover when every tile is a mine.
    expect(destroyed).toBe(16);
    expect(map.canPlaceBuilding(anchor, TOWN_HALL_FOOTPRINT)).toBe(true);
  });
});
