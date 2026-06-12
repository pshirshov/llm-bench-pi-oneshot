/** Game map: tile grid, dimensions, start locations, gold mines. */

import type { TileCoord, Vec2, EntityId } from "./types";
import { isWalkable, isBuildable, isHarvestable, depletedForm } from "./tile";
import type { TileType } from "./types";

export class GameMap {
  readonly width: number;
  readonly height: number;
  tiles: TileType[][];
  goldMines: Map<EntityId, { col: number; row: number; remaining: number; id: EntityId }>;
  nextMineId: EntityId;

  constructor(width: number, height: number, tiles?: TileType[][]) {
    this.width = width;
    this.height = height;
    this.goldMines = new Map();
    this.nextMineId = -1;
    if (tiles) {
      this.tiles = tiles;
    } else {
      this.tiles = [];
      for (let r = 0; r < height; r++) {
        this.tiles[r] = [];
        for (let c = 0; c < width; c++) {
          this.tiles[r][c] = "grass";
        }
      }
    }
  }

  inBounds(col: number, row: number): boolean {
    return col >= 0 && col < this.width && row >= 0 && row < this.height;
  }

  getTile(col: number, row: number): TileType {
    if (!this.inBounds(col, row)) return "rock";
    return this.tiles[row][col];
  }

  setTile(col: number, row: number, t: TileType): void {
    if (this.inBounds(col, row)) {
      this.tiles[row][col] = t;
    }
  }

  isWalkable(col: number, row: number): boolean {
    if (!this.inBounds(col, row)) return false;
    return isWalkable(this.tiles[row][col]);
  }

  isBuildable(col: number, row: number): boolean {
    if (!this.inBounds(col, row)) return false;
    return isBuildable(this.tiles[row][col]);
  }

  isHarvestable(col: number, row: number): boolean {
    if (!this.inBounds(col, row)) return false;
    return isHarvestable(this.tiles[row][col]);
  }

  /** Register a gold mine. Called during map generation. */
  addGoldMine(col: number, row: number, capacity: number): EntityId {
    const id = this.nextMineId--;
    this.goldMines.set(id, { col, row, remaining: capacity, id });
    this.tiles[row][col] = "gold_mine";
    return id;
  }

  /** Reduce gold in a mine by amount, return actual amount harvested. */
  harvestGold(mineId: EntityId, amount: number): number {
    const mine = this.goldMines.get(mineId);
    if (!mine) return 0;
    const harvested = Math.min(amount, mine.remaining);
    mine.remaining -= harvested;
    if (mine.remaining <= 0) {
      this.tiles[mine.row][mine.col] = "depleted_mine";
      this.goldMines.delete(mineId);
    }
    return harvested;
  }

  /** Deplete a forest tile. Returns true if tile was harvested to depletion. */
  harvestWood(col: number, row: number, amount: number): number {
    if (!this.inBounds(col, row)) return 0;
    const t = this.tiles[row][col];
    if (t !== "forest") return 0;
    // Forest tiles are depleted in one trip for simplicity
    // (each forest tile yields HARVEST_STATS.woodPerTrip on harvest, then depletes)
    this.tiles[row][col] = depletedForm("forest");
    return amount;
  }

  /** Check if a tile is occupied by a building footprint. */
  isOccupiedByBuilding(col: number, row: number, buildings: { col: number; row: number; type: string; width: number; height: number; isComplete: boolean }[]): boolean {
    for (const b of buildings) {
      if (col >= b.col && col < b.col + b.width && row >= b.row && row < b.row + b.height) {
        return true;
      }
    }
    return false;
  }

  /** 8-directional neighbors. */
  neighbors(col: number, row: number): TileCoord[] {
    const dirs: [number, number][] = [
      [-1, -1], [0, -1], [1, -1],
      [-1, 0],           [1, 0],
      [-1, 1],  [0, 1],  [1, 1],
    ];
    const result: TileCoord[] = [];
    for (const [dc, dr] of dirs) {
      const nc = col + dc;
      const nr = row + dr;
      if (this.inBounds(nc, nr)) {
        result.push({ col: nc, row: nr });
      }
    }
    return result;
  }

  /** Euclidean distance between two tile coords. */
  static dist(a: TileCoord, b: TileCoord): number {
    const dx = a.col - b.col;
    const dy = a.row - b.row;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** Convert tile center to world position. */
  static tileCenter(col: number, row: number): Vec2 {
    return { x: col + 0.5, y: row + 0.5 };
  }

  /** Convert world position to tile coord. */
  static posToTile(pos: Vec2): TileCoord {
    return { col: Math.floor(pos.x), row: Math.floor(pos.y) };
  }

  clone(): GameMap {
    const m = new GameMap(this.width, this.height);
    for (let r = 0; r < this.height; r++) {
      for (let c = 0; c < this.width; c++) {
        m.tiles[r][c] = this.tiles[r][c];
      }
    }
    for (const [id, mine] of this.goldMines) {
      m.goldMines.set(id, { ...mine });
    }
    m.nextMineId = this.nextMineId;
    return m;
  }
}