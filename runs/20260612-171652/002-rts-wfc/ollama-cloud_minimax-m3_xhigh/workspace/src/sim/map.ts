// Map data: tile grid, dimensions, start locations, mine & forest inventories.
import { TILE, TileType } from "./tiles.js";

export interface StartLocation {
  readonly x: number;
  readonly y: number;
}

export interface MineDeposit {
  readonly x: number;
  readonly y: number;
  gold: number;
}

export interface ForestDeposit {
  readonly x: number;
  readonly y: number;
  wood: number;
}

export class GameMap {
  public readonly width: number;
  public readonly height: number;
  public readonly tiles: TileType[];
  /** Per-tile "remaining gold" (only meaningful for gold-mine tiles). */
  public readonly mineGold: Int32Array;
  /** Per-tile "remaining wood" (only meaningful for forest tiles). */
  public readonly forestWood: Int32Array;

  constructor(width: number, height: number, tiles: TileType[]) {
    this.width = width;
    this.height = height;
    this.tiles = tiles;
    this.mineGold = new Int32Array(width * height);
    this.forestWood = new Int32Array(width * height);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  idx(x: number, y: number): number {
    return y * this.width + x;
  }

  get(x: number, y: number): TileType {
    if (!this.inBounds(x, y)) return TILE.ROCK;
    return this.tiles[this.idx(x, y)] as TileType;
  }

  set(x: number, y: number, t: TileType): void {
    if (!this.inBounds(x, y)) return;
    this.tiles[this.idx(x, y)] = t;
  }

  /** Read-only iteration helper. */
  forEachTile(cb: (t: TileType, x: number, y: number) => void): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        cb(this.get(x, y), x, y);
      }
    }
  }
}
