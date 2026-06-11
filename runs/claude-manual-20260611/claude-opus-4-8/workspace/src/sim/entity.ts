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
   * Resolved arrival reservation for a `move` order, owned by the movement
   * phase. When several units are ordered to the SAME goal tile, only one can
   * stand on it; the movement phase assigns each unit a DISTINCT nearby free
   * tile (`slot`) — found by an outward ring search from the shared goal — and
   * the unit travels to and settles on its own slot, so a group packs into a
   * bounded cluster instead of being shoved into an ever-growing line. `goal`
   * records which goal tile produced the slot, so a re-issued move order to a
   * different tile invalidates the reservation. Undefined ⇒ no reservation yet
   * (assigned lazily, cleared when the order stops referencing that goal).
   */
  arrival?: { readonly goal: Vec2; readonly slot: Vec2 };

  /**
   * Consecutive ticks this `move` unit has failed to make PROGRESS TOWARD ITS
   * SLOT (its centre-to-slot distance has not strictly decreased by more than a
   * small epsilon) while inside the arrival disk — movement-phase scratch state.
   * Keyed on slot-distance, NOT instantaneous speed, so it catches BOTH a unit
   * jammed motionless against the settled cluster AND one trapped in a
   * separation-vs-slot-seek LIMIT CYCLE (orbiting its slot at non-zero speed but
   * never closing on it). A unit is force-settled in place once the count crosses
   * a threshold. Reset to 0 whenever the unit's slot-distance improves or it stops
   * being a travelling `move` unit. Paired with `slotBestDist`.
   */
  stallTicks?: number;

  /**
   * The smallest centre-to-slot distance this `move` unit has achieved so far on
   * its current approach — movement-phase scratch state paired with `stallTicks`.
   * Used by the progress-based force-settle backstop: a tick that strictly beats
   * this value (by > ε) counts as progress and resets the stall counter; a tick
   * that does not (orbit or jam) advances it. Cleared when the unit settles or
   * re-targets so the next approach starts fresh.
   */
  slotBestDist?: number;

  /**
   * The integer waypoint (`path[0]`) whose approach-progress is currently being
   * tracked for the IN-TRANSIT re-path backstop, paired with `wpBestDist` /
   * `wpStallTicks`. Movement-phase scratch state. When the head waypoint changes
   * (the unit popped one — i.e. it advanced, which IS progress) the progress
   * window resets. Distinct from the slot/goal tracking (`slotBestDist`): this
   * detects a unit physically WALLED mid-route by a settled (pinned) cluster —
   * whose tile bodies A* ignores — so it can be re-pathed AROUND the cluster,
   * whereas `slotBestDist` detects a unit jammed AT its own arrival cluster (to be
   * settled in place). Undefined ⇒ no waypoint currently tracked.
   */
  wpTarget?: Vec2;

  /**
   * Smallest centre-to-current-waypoint distance achieved since `wpTarget` was
   * last (re)set — movement-phase scratch state paired with `wpTarget` /
   * `wpStallTicks`. A tick that strictly beats it (by > ε) is transit progress and
   * resets `wpStallTicks`; any other tick advances it.
   */
  wpBestDist?: number;

  /**
   * Consecutive ticks this in-transit `move` unit has failed to make progress
   * toward its current head waypoint (`wpTarget`) — movement-phase scratch state.
   * Once it crosses a threshold the unit is RE-PATHED with A* treating currently
   * PINNED tiles as blocked, so it routes around a settled cluster its cached
   * (unit-blind) A* path runs straight through. Reset to 0 on transit progress,
   * on a waypoint change, or when the unit stops being an in-transit `move` unit.
   */
  wpStallTicks?: number;

  /**
   * Set once this `move` unit has SETTLED on its arrival slot (snapped exactly to
   * the slot centre and idled). A pinned unit is a true fixed point: it is NEVER
   * displaced by the separation pass again (it only CONTRIBUTES a push to
   * in-transit neighbours), so an arrived group holds exactly-fixed positions
   * with max per-tick movement == 0 — no orbit, no oscillation. Cleared by a
   * fresh `move` order (re-target) so the unit re-paths to the new goal.
   */
  pinned?: boolean;

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

  /**
   * Remaining attack cooldown ticks for combat-capable buildings (guard towers).
   * Undefined / 0 ⇒ ready to fire. Stored on the entity so two different world
   * instances sharing the same EntityId counter never cross-contaminate cooldown
   * state (a module-level side-table keyed by EntityId would break determinism
   * for same-seed worlds stepped interleaved).
   */
  attackCooldown?: number;
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
