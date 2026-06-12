/** Fog of war computation. */

import type { Faction } from "./types";
import { FOG_UNEXPLORED, FOG_EXPLORED, FOG_VISIBLE } from "./constants";

export type FogState = typeof FOG_UNEXPLORED | typeof FOG_EXPLORED | typeof FOG_VISIBLE;

export class FogOfWar {
  readonly width: number;
  readonly height: number;
  /** Per faction: 2D array of fog state (0=unexplored, 1=explored, 2=visible). */
  private data: Map<string, FogState[][]> = new Map();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  private getOrCreate(faction: Faction): FogState[][] {
    let grid = this.data.get(faction);
    if (!grid) {
      grid = [];
      for (let r = 0; r < this.height; r++) {
        grid[r] = new Array(this.width).fill(FOG_UNEXPLORED);
      }
      this.data.set(faction, grid);
    }
    return grid;
  }

  getTile(faction: Faction, col: number, row: number): FogState {
    const grid = this.data.get(faction);
    if (!grid || row < 0 || row >= this.height || col < 0 || col >= this.width) {
      return FOG_UNEXPLORED;
    }
    return grid[row][col];
  }

  /** Update fog based on visible tiles from sight positions. */
  update(faction: Faction, sightPositions: { x: number; y: number; sight: number }[]): void {
    const grid = this.getOrCreate(faction);
    // First, downgrade all visible to explored
    for (let r = 0; r < this.height; r++) {
      for (let c = 0; c < this.width; c++) {
        if (grid[r][c] === FOG_VISIBLE) {
          grid[r][c] = FOG_EXPLORED;
        }
      }
    }
    // Then upgrade tiles within sight range to visible
    for (const pos of sightPositions) {
      const radius = pos.sight;
      const minC = Math.max(0, Math.floor(pos.x - radius));
      const maxC = Math.min(this.width - 1, Math.ceil(pos.x + radius));
      const minR = Math.max(0, Math.floor(pos.y - radius));
      const maxR = Math.min(this.height - 1, Math.ceil(pos.y + radius));
      for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
          const dx = c + 0.5 - pos.x;
          const dy = r + 0.5 - pos.y;
          if (dx * dx + dy * dy <= radius * radius) {
            grid[r][c] = FOG_VISIBLE;
          }
        }
      }
    }
  }

  /** Serialize fog state for determinism tests. */
  serialize(faction: Faction): string {
    const grid = this.data.get(faction);
    if (!grid) return "";
    let s = "";
    for (let r = 0; r < this.height; r++) {
      for (let c = 0; c < this.width; c++) {
        s += grid[r][c];
      }
    }
    return s;
  }
}