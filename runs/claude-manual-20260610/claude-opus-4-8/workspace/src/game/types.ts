import type { BuildingRole } from "../sim/stats.js";

/** Active building-placement state while the player positions a new structure. */
export interface PlacementState {
  role: BuildingRole;
  /** Id of the worker that will construct it. */
  builderId: number;
}

/** Screen-space drag-selection rectangle. */
export interface DragBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type GameSpeed = 1 | 2;
