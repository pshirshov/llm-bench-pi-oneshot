import type { Grid } from "../core/grid.js";
import { tileKey } from "../core/vec.js";
import { TILE_PROPS, TileType } from "../wfc/tiles.js";
import { HARVEST } from "./stats.js";

/**
 * The simulation's terrain model: tile types, depletable resource amounts, and
 * which tiles are occupied by buildings. Movement passability is derived from
 * terrain plus building occupancy.
 */
export class GameMap {
  readonly width: number;
  readonly height: number;
  readonly tiles: Grid<TileType>;
  /** Building id occupying each tile, or -1. */
  private readonly occupancy: Int32Array;
  /** Remaining gold per gold-mine tile, keyed by tileKey. */
  private readonly goldRemaining = new Map<number, number>();
  /** Remaining wood per forest tile, keyed by tileKey. */
  private readonly woodRemaining = new Map<number, number>();

  constructor(tiles: Grid<TileType>) {
    this.tiles = tiles;
    this.width = tiles.width;
    this.height = tiles.height;
    this.occupancy = new Int32Array(tiles.width * tiles.height).fill(-1);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const t = tiles.get(x, y);
        if (t === TileType.GoldMine) {
          this.goldRemaining.set(tileKey(x, y), HARVEST.goldMineAmount);
        } else if (t === TileType.Forest) {
          this.woodRemaining.set(tileKey(x, y), HARVEST.forestTileWood);
        }
      }
    }
  }

  terrainAt(x: number, y: number): TileType {
    return this.tiles.get(x, y);
  }

  /** A tile a land unit can stand on / path through. */
  isPassable(x: number, y: number): boolean {
    if (!this.tiles.inBounds(x, y)) return false;
    if (!TILE_PROPS[this.tiles.get(x, y)].passable) return false;
    return this.occupancy[y * this.width + x] === -1;
  }

  buildingIdAt(x: number, y: number): number {
    if (!this.tiles.inBounds(x, y)) return -1;
    return this.occupancy[y * this.width + x] as number;
  }

  /** Whether a building footprint may be placed here (all tiles buildable & free). */
  canPlace(tx: number, ty: number, w: number, h: number): boolean {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const x = tx + dx;
        const y = ty + dy;
        if (!this.tiles.inBounds(x, y)) return false;
        if (!TILE_PROPS[this.tiles.get(x, y)].buildable) return false;
        if (this.occupancy[y * this.width + x] !== -1) return false;
      }
    }
    return true;
  }

  occupy(tx: number, ty: number, w: number, h: number, id: number): void {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        this.occupancy[(ty + dy) * this.width + (tx + dx)] = id;
      }
    }
  }

  free(tx: number, ty: number, w: number, h: number): void {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        this.occupancy[(ty + dy) * this.width + (tx + dx)] = -1;
      }
    }
  }

  goldAt(x: number, y: number): number {
    return this.goldRemaining.get(tileKey(x, y)) ?? 0;
  }

  woodAt(x: number, y: number): number {
    return this.woodRemaining.get(tileKey(x, y)) ?? 0;
  }

  isGoldMine(x: number, y: number): boolean {
    return this.tiles.inBounds(x, y) && this.tiles.get(x, y) === TileType.GoldMine;
  }

  isForest(x: number, y: number): boolean {
    return this.tiles.inBounds(x, y) && this.tiles.get(x, y) === TileType.Forest;
  }

  /** Mine up to `want` gold from a tile. Returns the amount actually removed. */
  mineGold(x: number, y: number, want: number): number {
    const key = tileKey(x, y);
    const have = this.goldRemaining.get(key) ?? 0;
    const taken = Math.min(have, want);
    const left = have - taken;
    this.goldRemaining.set(key, left);
    // Gold mines persist as terrain even when exhausted (genre convention).
    return taken;
  }

  /**
   * Chop up to `want` wood from a forest tile. Returns the amount removed.
   * When a forest tile is exhausted it becomes Dirt and turns passable.
   */
  chopWood(x: number, y: number, want: number): number {
    const key = tileKey(x, y);
    const have = this.woodRemaining.get(key) ?? 0;
    const taken = Math.min(have, want);
    const left = have - taken;
    if (left <= 0) {
      this.woodRemaining.delete(key);
      this.tiles.set(x, y, TileType.Dirt);
    } else {
      this.woodRemaining.set(key, left);
    }
    return taken;
  }
}
