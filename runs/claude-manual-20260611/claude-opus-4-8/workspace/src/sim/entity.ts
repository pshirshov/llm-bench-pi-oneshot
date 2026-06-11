/**
 * Domain-typed simulation entities: Unit, Building, Projectile.
 *
 * These are the live, MUTABLE per-tick records the simulation advances. They are
 * deliberately plain data (no methods): every behaviour lives in the phase
 * functions of `simulation.ts`, so the entities stay trivially cloneable and the
 * world stays serialisable/deterministic.
 *
 * maxHp and other immutable baselines come from the stats tables
 * (`UNIT_STATS` / `BUILDING_STATS`, keyed `faction:kind`) — entities never carry
 * their own copy of the stat constants, only the dynamic state (current hp,
 * cooldowns, orders, carried resources, build/train progress).
 *
 * Downstream tasks (T8 movement, T9 combat, T10 economy) READ and WRITE these
 * fields but should NOT need to change their shape; optional fields are present
 * up front so later phases can fill them without a type migration.
 */

import type { Vec2 } from "../core/vec.js";
import type {
  BuildingKind,
  EntityId,
  Faction,
  ResourceKind,
  UnitKind,
} from "../game/types.js";
import type { Order } from "./orders.js";

// ---------------------------------------------------------------------------
// Shared value shapes
// ---------------------------------------------------------------------------

/**
 * A floating-point world position in TILE coordinates (not pixels). Distinct
 * from the integer `Vec2` used for tile indices / paths: units move smoothly
 * between tiles, so their position is fractional.
 */
export interface PointF {
  x: number;
  y: number;
}

/**
 * Resource a Worker is currently carrying back to a drop-off building. Only
 * gold and wood are carryable (supply is not a physical resource).
 */
export interface CarriedResource {
  readonly kind: Extract<ResourceKind, "gold" | "wood">;
  /** Units of the resource being carried. */
  amount: number;
}

/** A queued training job inside a Building's `trainQueue`. */
export interface TrainJob {
  readonly unitKind: UnitKind;
  /** Ticks of training already elapsed for the job at the head of the queue. */
  progress: number;
  /** Total ticks required (cached from stats at enqueue time). */
  readonly trainTime: number;
}

// ---------------------------------------------------------------------------
// Unit
// ---------------------------------------------------------------------------

/**
 * A mobile entity (worker / infantry / ranged / heavy). Position is fractional
 * tile coordinates; `path` is the remaining list of integer waypoints produced
 * by A* and consumed by the movement phase.
 */
export interface Unit {
  readonly id: EntityId;
  readonly owner: Faction;
  readonly kind: UnitKind;

  hp: number;
  readonly maxHp: number;

  /** Fractional tile position (centre of the unit). */
  pos: PointF;

  /** The standing order driving this unit's behaviour. */
  order: Order;

  /**
   * Remaining A* waypoints (integer tile centres), in travel order. The
   * movement phase pops the head as the unit reaches it. Undefined / empty ⇒
   * not currently following a path.
   */
  path?: Vec2[];

  /**
   * The entity this unit is currently engaging / harvesting / repairing, when
   * its order references another entity. Cached so the relevant phase need not
   * re-read the order each tick.
   */
  target?: EntityId;

  /** Ticks remaining before this unit may attack again (0 ⇒ ready). */
  attackCooldown: number;

  /** Resource currently carried by a worker, if any. */
  carrying?: CarriedResource;
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

/** Tile footprint of a building: width × height in tiles. */
export interface Footprint {
  readonly w: number;
  readonly h: number;
}

/**
 * A static entity occupying a rectangular tile footprint. `tile` is the
 * top-left tile of that footprint; `footprint` its extent. A building with
 * `buildProgress < 1` is still under construction (a worker raises it over
 * time) and does not yet provide supply or train units.
 */
export interface Building {
  readonly id: EntityId;
  readonly owner: Faction;
  readonly kind: BuildingKind;

  hp: number;
  readonly maxHp: number;

  /** Top-left tile of the footprint. */
  readonly tile: Vec2;
  readonly footprint: Footprint;

  /**
   * Construction completeness in [0, 1]. 1 ⇒ fully built and operational;
   * anything less ⇒ under construction (raised by a worker, T10).
   */
  buildProgress: number;

  /** FIFO queue of units being trained (T10 advances the head each tick). */
  trainQueue: TrainJob[];

  /**
   * Where freshly-trained units walk to after spawning. Undefined ⇒ they idle
   * at the building exit.
   */
  rallyPoint?: Vec2;
}

// ---------------------------------------------------------------------------
// Projectile
// ---------------------------------------------------------------------------

/**
 * An in-flight ranged attack (arrow / spear). Spawned by the combat phase when
 * a ranged unit or guard tower fires; it travels toward `target` and applies
 * `damage` on arrival. The combat phase (T9) owns the integration + impact
 * behaviour — this is only the data shape so the World can hold projectiles now.
 */
export interface Projectile {
  readonly id: EntityId;
  readonly owner: Faction;

  /** Current fractional tile position. */
  pos: PointF;

  /** Per-tick velocity in tiles (set toward the target at spawn). */
  vel: PointF;

  /**
   * Homing target. When the target dies before impact the combat phase falls
   * back to the last-known `targetPos`.
   */
  target?: EntityId;
  /** Last-known target position; impact point if the target is gone. */
  targetPos: PointF;

  /** Damage applied on impact (before the defender's armor reduction). */
  readonly damage: number;
}
