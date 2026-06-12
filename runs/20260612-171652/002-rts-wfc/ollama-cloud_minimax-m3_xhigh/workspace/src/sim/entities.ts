// Entity model: unit, building, projectile.

import { Faction, UnitKind, BuildingKind } from "./stats.js";
import { UnitOrderState } from "./orders.js";

export interface UnitEntity {
  readonly id: number;
  readonly kind: "unit";
  readonly faction: Faction;
  readonly unitKind: UnitKind;
  /** Tile coordinate (integer). */
  x: number;
  y: number;
  /** Sub-tile offset within the current tile, 0..1. */
  subX: number;
  subY: number;
  /** Current HP. */
  hp: number;
  /** Order state machine. */
  orderState: UnitOrderState;
  /** Target entity id (if attack-move / attack / auto-acquire). */
  target: number | null;
  /** Walk goal as sub-tile coordinates. */
  moveGoal: { x: number; y: number } | null;
  /** Damage done so we can attribute kills. */
  damageDealt: number;
  /** Corpse fade timer (sim-seconds). */
  corpseTimer: number;
}

export interface BuildingEntity {
  readonly id: number;
  readonly kind: "building";
  readonly faction: Faction;
  readonly buildingKind: BuildingKind;
  /** Top-left tile coordinate. */
  readonly x: number;
  readonly y: number;
  /** Current HP. */
  hp: number;
  /** Max HP. */
  readonly maxHp: number;
  /** Construction state: 0..1, where 1 = complete. */
  construction: number;
  /** Active training queue. */
  trainQueue: Array<{ unit: UnitKind; progress: number; total: number }>;
  /** Owner-supplied build-in-progress reference: id of the worker constructing. */
  builtBy: number | null;
  /** Corpse fade timer. */
  corpseTimer: number;
}

export interface ProjectileEntity {
  readonly id: number;
  readonly kind: "projectile";
  readonly faction: Faction;
  /** Source unit id. */
  readonly source: number;
  /** Target unit/building id. */
  readonly target: number;
  x: number;
  y: number;
  /** Speed in tiles per sim-second. */
  readonly speed: number;
  /** Damage to apply on arrival. */
  readonly damage: number;
  /** Has it hit. */
  hit: boolean;
}

export type Entity = UnitEntity | BuildingEntity | ProjectileEntity;

export function isUnit(e: Entity): e is UnitEntity {
  return e.kind === "unit";
}

export function isBuilding(e: Entity): e is BuildingEntity {
  return e.kind === "building";
}

export function isProjectile(e: Entity): e is ProjectileEntity {
  return e.kind === "projectile";
}
