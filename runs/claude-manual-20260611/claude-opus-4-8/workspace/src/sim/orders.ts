/**
 * Unit orders for the simulation.
 *
 * The `Order` discriminated union is the single source of "what a unit is
 * currently trying to do". It was defined alongside the core domain types
 * (src/game/types.ts) so both the sim and the UI/AI layers share ONE shape;
 * this module re-exports it and adds typed constructor helpers so call sites
 * never hand-build order objects (which would bypass exhaustiveness checks).
 *
 * Idle: the union's `stop` variant IS the idle state — a unit with no active
 * task. `idle()` is provided as a readable alias so call sites that mean
 * "do nothing" read clearly, without forking the union into a separate `idle`
 * variant that the movement/combat phases would have to special-case.
 *
 * The order constructors take integer tile targets (`Vec2`); movement converts
 * those to fractional positions when steering.
 */

import type { Vec2 } from "../core/vec.js";
import type { BuildingKind, EntityId, Order } from "../game/types.js";

export type { Order } from "../game/types.js";
export type { OrderKind } from "../game/types.js";

/** A unit with nothing to do. Implemented as the union's `stop` variant. */
export function idle(): Order {
  return { kind: "stop" };
}

/** Explicit stop (clears path/target). Identical to `idle`; named for intent. */
export function stop(): Order {
  return { kind: "stop" };
}

/** Hold position: stay put but still auto-acquire targets (combat phase, T9). */
export function hold(): Order {
  return { kind: "hold" };
}

/** Move to a tile, then go idle. */
export function moveTo(target: Vec2): Order {
  return { kind: "move", targetPos: { x: target.x, y: target.y } };
}

/** Attack a specific entity until it dies (then idle). */
export function attack(targetId: EntityId): Order {
  return { kind: "attack", targetId };
}

/** Move toward a tile, engaging any hostile encountered en route. */
export function attackMove(target: Vec2): Order {
  return { kind: "attackMove", targetPos: { x: target.x, y: target.y } };
}

/** Harvest from a resource entity (gold mine) or chop a forest node. */
export function harvest(targetId: EntityId): Order {
  return { kind: "harvest", targetId };
}

/** Repair a friendly building or mechanical unit. */
export function repair(targetId: EntityId): Order {
  return { kind: "repair", targetId };
}

/** Construct a building of `buildingKind` with its top-left at `tile`. */
export function build(buildingKind: BuildingKind, tile: Vec2): Order {
  return { kind: "build", buildingKind, pos: { x: tile.x, y: tile.y } };
}

/** True iff the order is the idle/stop variant. */
export function isIdle(order: Order): boolean {
  return order.kind === "stop";
}
