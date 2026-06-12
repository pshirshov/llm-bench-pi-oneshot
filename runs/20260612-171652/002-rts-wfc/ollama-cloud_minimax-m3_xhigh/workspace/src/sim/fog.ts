// Fog of war: three states per tile per faction.

import { GameMap } from "./map.js";

export const FOG = {
  UNEXPLORED: 0,
  EXPLORED: 1,
  VISIBLE: 2,
} as const;

export type FogState = (typeof FOG)[keyof typeof FOG];

export class FogGrid {
  /** Per-faction fog grids: a Uint8Array of size width*height. */
  private readonly grids: Map<string, Uint8Array> = new Map();

  constructor(public readonly map: GameMap) {}

  get(faction: string): Uint8Array {
    let g = this.grids.get(faction);
    if (!g) {
      g = new Uint8Array(this.map.width * this.map.height);
      this.grids.set(faction, g);
    }
    return g;
  }

  set(faction: string, x: number, y: number, v: FogState): void {
    if (!this.map.inBounds(x, y)) return;
    this.get(faction)[y * this.map.width + x] = v;
  }

  at(faction: string, x: number, y: number): FogState {
    if (!this.map.inBounds(x, y)) return FOG.UNEXPLORED;
    return this.get(faction)[y * this.map.width + x] as FogState;
  }
}
