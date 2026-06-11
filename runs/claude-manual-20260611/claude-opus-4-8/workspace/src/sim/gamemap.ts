/**
 * The tile world: terrain, building occupancy, and resource state.
 *
 * `GameMap` wraps the WFC-generated terrain grid and tracks two mutable layers
 * the raw terrain cannot express:
 *   1. OCCUPANCY — which tiles are covered by a building, so A* and placement
 *      see them as blocked even though the underlying terrain is walkable.
 *   2. RESOURCE STATE — remaining gold in each gold-mine tile. (Forest wood is
 *      the tile itself; depletion is a T10 concern that flips the tile to dirt,
 *      so no separate forest amount is tracked here.)
 *
 * Passability (`isTileBlocked`) is the single predicate A* binds to: a tile is
 * blocked iff its terrain is impassable (water / rock) OR a building occupies it.
 * Units do NOT block tiles here (they steer around each other in the movement
 * phase); tile-blocking is reserved for static obstacles.
 */

import { Grid } from "../core/grid.js";
import { vec } from "../core/vec.js";
import type { Vec2 } from "../core/vec.js";
import type { EntityId } from "../game/types.js";
import type { Footprint } from "./entity.js";
import type { TileType } from "../wfc/tiles.js";

/** Terrain tiles that block movement regardless of occupancy. */
const IMPASSABLE_TERRAIN: ReadonlySet<TileType> = new Set<TileType>([
  "water",
  "rock",
]);

/** Starting gold contained in a single gold-mine tile. */
export const GOLD_MINE_INITIAL_AMOUNT = 1500;

/** True iff this terrain tile blocks movement on its own (no building needed). */
export function isImpassableTerrain(t: TileType): boolean {
  return IMPASSABLE_TERRAIN.has(t);
}

/** The list of tiles a footprint anchored at top-left `tile` covers. */
export function tilesForFootprint(tile: Vec2, footprint: Footprint): Vec2[] {
  const out: Vec2[] = [];
  for (let dy = 0; dy < footprint.h; dy++) {
    for (let dx = 0; dx < footprint.w; dx++) {
      out.push(vec(tile.x + dx, tile.y + dy));
    }
  }
  return out;
}

/**
 * The tile world. Terrain is fixed at construction; occupancy and gold amounts
 * mutate as the game runs. Held by `World.map`.
 */
export class GameMap {
  readonly terrain: Grid<TileType>;
  readonly width: number;
  readonly height: number;

  /**
   * Per-tile owning building id, or -1 when no building occupies the tile.
   * An Int32Array keyed by `y * width + x` keeps occupancy lookups O(1) and
   * allocation-free on the hot pathfinding path.
   */
  private readonly occupancy: Int32Array;

  /**
   * Remaining gold per tile, keyed `y * width + x`; 0 for non-mine tiles and
   * for exhausted mines. Initialised from the terrain (every `goldMine` tile
   * starts at GOLD_MINE_INITIAL_AMOUNT).
   */
  private readonly goldRemaining: Int32Array;

  constructor(terrain: Grid<TileType>) {
    this.terrain = terrain;
    this.width = terrain.width;
    this.height = terrain.height;
    const size = this.width * this.height;
    this.occupancy = new Int32Array(size).fill(-1);
    this.goldRemaining = new Int32Array(size);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (terrain.get(x, y) === "goldMine") {
          this.goldRemaining[this.index(x, y)] = GOLD_MINE_INITIAL_AMOUNT;
        }
      }
    }
  }

  private index(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  tileAt(x: number, y: number): TileType {
    return this.terrain.get(x, y);
  }

  /**
   * A* passability predicate: blocked iff out of bounds, impassable terrain, or
   * occupied by a building. Bound directly as the `isBlocked` callback of A*.
   */
  isTileBlocked(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return true;
    if (isImpassableTerrain(this.terrain.get(x, y))) return true;
    return this.occupancy[this.index(x, y)] !== -1;
  }

  /** The id of the building occupying (x, y), or undefined if none. */
  occupant(x: number, y: number): EntityId | undefined {
    if (!this.inBounds(x, y)) return undefined;
    const id = this.occupancy[this.index(x, y)];
    return id === -1 ? undefined : (id as EntityId);
  }

  /**
   * True iff a building with `footprint` may be placed with its top-left at
   * `tile`: every covered tile must be in bounds, on passable (non-impassable)
   * terrain, free of an existing building, and not a resource tile (a building
   * may not be raised on a gold mine or forest).
   */
  canPlaceBuilding(tile: Vec2, footprint: Footprint): boolean {
    for (const t of tilesForFootprint(tile, footprint)) {
      if (!this.inBounds(t.x, t.y)) return false;
      const terrain = this.terrain.get(t.x, t.y);
      if (isImpassableTerrain(terrain)) return false;
      if (terrain === "goldMine" || terrain === "forest") return false;
      if (this.occupancy[this.index(t.x, t.y)] !== -1) return false;
    }
    return true;
  }

  /**
   * Converts every in-bounds tile of `footprint` (top-left `tile`) to clear,
   * buildable ground (grass), overwriting whatever terrain was there (forest /
   * gold mine / rock / water). Used as the deterministic last-resort guarantee
   * that a starting Town Hall has a buildable footprint when the surrounding WFC
   * terrain leaves no naturally-clear rectangle. Occupancy is untouched.
   *
   * Caller responsibility: do NOT pass a footprint that covers a gold mine the
   * economy must keep — this bulldozes resource tiles. `goldRemaining` for any
   * overwritten mine tile is zeroed so the converted tile no longer reads as a
   * mine, keeping `goldAt` consistent with the new terrain.
   */
  clearForBuilding(tile: Vec2, footprint: Footprint): void {
    for (const t of tilesForFootprint(tile, footprint)) {
      if (!this.inBounds(t.x, t.y)) continue;
      this.terrain.set(t.x, t.y, "grass");
      this.goldRemaining[this.index(t.x, t.y)] = 0;
    }
  }

  /** Marks every tile of `footprint` (top-left `tile`) as occupied by `id`. */
  occupy(tile: Vec2, footprint: Footprint, id: EntityId): void {
    for (const t of tilesForFootprint(tile, footprint)) {
      if (this.inBounds(t.x, t.y)) {
        this.occupancy[this.index(t.x, t.y)] = id;
      }
    }
  }

  /** Clears occupancy for every tile of `footprint` (used when a building dies). */
  vacate(tile: Vec2, footprint: Footprint): void {
    for (const t of tilesForFootprint(tile, footprint)) {
      if (this.inBounds(t.x, t.y)) {
        this.occupancy[this.index(t.x, t.y)] = -1;
      }
    }
  }

  /** Remaining gold in the mine tile at (x, y); 0 if not a (live) mine. */
  goldAt(x: number, y: number): number {
    if (!this.inBounds(x, y)) return 0;
    return this.goldRemaining[this.index(x, y)];
  }

  /**
   * Removes up to `amount` gold from the mine at (x, y), returning the amount
   * actually extracted (clamped to what remains). When a mine hits 0 its tile
   * is converted to dirt so it stops reading as a mine.
   */
  extractGold(x: number, y: number, amount: number): number {
    if (!this.inBounds(x, y) || amount <= 0) return 0;
    const i = this.index(x, y);
    const have = this.goldRemaining[i];
    const taken = Math.min(have, amount);
    this.goldRemaining[i] = have - taken;
    if (this.goldRemaining[i] === 0 && this.terrain.get(x, y) === "goldMine") {
      this.terrain.set(x, y, "dirt");
    }
    return taken;
  }
}
