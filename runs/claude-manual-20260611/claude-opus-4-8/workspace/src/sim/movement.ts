/**
 * T8 — Path-following movement + group separation.
 *
 * This module implements `phaseMovement`, which replaces the no-op stub in
 * `simulation.ts`. It is wired in as the `movement` entry in `SIM_PHASES`.
 *
 * ## Path following
 *   For each unit with a move/attackMove order (or any order requiring travel
 *   to a destination), we compute an A* path via `astar` if none is cached on
 *   `unit.path`, then advance the unit along it at `moveSpeed / SIM_HZ` tiles
 *   per tick.  Waypoints are popped as the unit centre passes within
 *   WAYPOINT_REACH of the waypoint's tile centre.  On arrival the path is
 *   cleared and the order is set to idle (stop), except for attackMove — where
 *   the combat phase takes over and we just stop moving.
 *
 * ## Blocked-next-step recomputation
 *   Before advancing we peek at the next waypoint.  If `isTileBlocked` reports
 *   it blocked (e.g. a building was erected since the path was computed), we
 *   discard the cached path so it is recomputed this tick.
 *
 * ## Group separation / collision avoidance
 *   After all units have moved, a pairwise separation pass nudges any two units
 *   whose centres are closer than SEPARATION_RADIUS apart.  The push is a
 *   half-step along the separation vector for each unit (equal and opposite),
 *   then clamped to map bounds.  Units are iterated in ascending EntityId order
 *   (stable); no randomness is required or used — the only RNG call in the
 *   module routes through `world.rng` and is commented to document the
 *   allowed exception point (currently unused — determinism is achieved via
 *   sorted-order iteration alone).
 *
 * ## Determinism
 *   - Unit iteration order: `world.units` is sorted by EntityId before every
 *     pass (path-following and separation).
 *   - No `Math.random` is called; any future jitter MUST go through
 *     `world.rng`.
 *
 * ## `neighborsWithin` interface
 *   A brute-force scan over `world.units` supplies neighbours for the
 *   separation pass.  T12 will swap this out for a spatial hash without
 *   changing the callers.
 */

import type { PointF, Unit } from "./entity.js";
import type { World } from "./world.js";
import type { Vec2 } from "../core/vec.js";
import { astar } from "./astar.js";
import { getUnitStats } from "./stats.js";
import { idle } from "./orders.js";
import { SIM_HZ } from "./simulation.js";

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

/**
 * A unit pops the current waypoint when its centre is within this many tiles
 * of the waypoint's tile centre.  Slightly above 0.5 so the unit doesn't have
 * to reach the exact centre before snapping to the next waypoint.
 */
const WAYPOINT_REACH = 0.6;

/**
 * Two units closer than this many tiles (centre-to-centre Euclidean) trigger
 * the separation push.  Set to just over 1 tile so units resolve when they
 * share a tile or overlap from diagonal clustering.
 */
const SEPARATION_RADIUS = 1.05;

/**
 * Each unit in an overlapping pair is nudged by at most this fraction of the
 * remaining overlap in one tick.  Keeping it below 0.5 prevents oscillation
 * (the pair can overshoot if both move toward each other).
 */
const SEPARATION_STRENGTH = 0.4;

/**
 * When a travelling `move` unit's centre comes within this many tiles of ITS OWN
 * assigned slot centre, it is IMMEDIATELY snapped exactly to the slot centre,
 * idled, and pinned — within the same tick, BEFORE the separation pass can
 * perturb it. This converts a unit's terminal state from a continuous-force
 * equilibrium (which can limit-cycle into an orbit) into a discrete fixed point:
 * a unit is either pathing toward its slot tile or snapped+settled, never
 * orbiting under separation forces. Set above one move step (≈0.1) so the unit
 * latches on the tick it first enters the arrival disk; the spec caps it at 0.35.
 */
const SLOT_ARRIVAL_RADIUS = 0.35;

/**
 * Minimum decrease in a `move` unit's BEST-SO-FAR centre-to-slot distance (tiles)
 * that counts as PROGRESS for the force-settle backstop: a tick is "progress"
 * only if it brings the unit at least this much closer to its slot than its best
 * previous approach. A tick that fails this advances the stall counter.
 *
 * Sized as a meaningful FRACTION OF ONE MOVE STEP (move step ≈ moveSpeed/SIM_HZ ≈
 * 0.1 tile/tick): a unit genuinely path-following toward its slot closes ≈0.1
 * tile/tick and clears this threshold every tick, so it is never force-settled
 * mid-approach; a unit walled off its slot — whether motionless, orbiting, or
 * asymptotically CREEPING toward a wrong force-equilibrium a tile or two short of
 * its slot (per-tick gain decaying through 1e-2…1e-4) — fails to accumulate this
 * much improvement and is settled after STALL_TICKS_TO_SETTLE ticks. A smaller
 * epsilon (e.g. 1e-3) would be defeated by the creep, which intermittently beats
 * it and keeps resetting the counter, leaving the unit in `move` indefinitely.
 */
const SLOT_PROGRESS_EPS = 0.03;

/**
 * Maximum Chebyshev radius the outward ring search walks from a shared goal
 * tile while looking for a free arrival slot.  A radius of R yields a
 * (2R+1)×(2R+1) block of candidate tiles, so the default comfortably holds the
 * largest groups the genre fields (a 21×21 block = 441 slots at R=10) while
 * bounding the search cost.  A unit that finds no free slot within this radius
 * falls back to the raw goal tile (degrading to the pre-slot behaviour).
 */
const MAX_SLOT_RING_RADIUS = 12;

/**
 * Maximum distance (tiles, centre-to-goal-centre) a stalled `move` unit may be
 * from its GOAL tile to qualify as "wedged at the arrival cluster" and settle in
 * place. Set to the slot-search radius: every arrival slot lives within
 * MAX_SLOT_RING_RADIUS of the goal, so a unit stalled inside that disk is part
 * of the converging cluster, while one stalled farther out is still mid-route
 * (e.g. two columns momentarily crossing) and must NOT be force-settled — it is
 * left to its normal path-following.
 */
const WEDGE_GOAL_RADIUS = MAX_SLOT_RING_RADIUS;

/**
 * A stalled `move` unit must show no progress for this many CONSECUTIVE ticks
 * before it is settled in place. The delay distinguishes a unit permanently
 * jammed against the already-settled cluster from one momentarily halted inside
 * a column that is still flowing toward the goal (which resumes within a tick or
 * two and must NOT be dropped early — doing so would freeze the approach queue
 * into a long tail instead of a packed disk). At SIM_HZ=30 this is ~0.3 s.
 */
const STALL_TICKS_TO_SETTLE = 10;

/**
 * Minimum decrease (tiles) in an in-transit `move` unit's distance to its CURRENT
 * head waypoint that counts as progress for the re-path backstop. Sized like
 * SLOT_PROGRESS_EPS: a fraction of one move step (≈0.1 tile/tick), so a unit
 * genuinely closing on its waypoint clears it every tick and is never re-pathed,
 * while one held against a pinned-unit body (its centre pinned at a separation
 * equilibrium a fixed offset short of the blocked waypoint) fails to and stalls.
 */
const TRANSIT_PROGRESS_EPS = 0.03;

/**
 * Consecutive no-progress ticks toward its head waypoint after which an
 * in-transit `move` unit is RE-PATHED around currently-pinned tiles. Larger than
 * STALL_TICKS_TO_SETTLE so transient separation jostle while two streams cross
 * (which resolves on its own within a few ticks) does not trigger a re-path; a
 * genuine wall by a settled cluster persists well past this. At SIM_HZ=30 this is
 * ~0.5 s. A re-path is cheap and idempotent (if the unit is not actually walled,
 * A* with pinned tiles blocked returns an equivalent route), so erring large is
 * safe.
 */
const TRANSIT_STALL_TICKS_TO_REPATH = 15;

// ---------------------------------------------------------------------------
// Neighbour query — T12 replaces the body with a spatial hash, keep signature.
// ---------------------------------------------------------------------------

/**
 * Returns every unit in `world.units` whose centre is within `r` Euclidean
 * tiles of `pos`, EXCLUDING the unit at `pos` itself (matched by identity via
 * the caller's own unit reference in the separation pass).
 *
 * Brute-force O(n) scan; T12 swaps this for a spatial hash without changing
 * the call sites.
 */
function neighborsWithin(world: World, pos: PointF, r: number): Unit[] {
  const r2 = r * r;
  const result: Unit[] = [];
  for (const other of world.units.values()) {
    const dx = other.pos.x - pos.x;
    const dy = other.pos.y - pos.y;
    if (dx * dx + dy * dy < r2) {
      result.push(other);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Target-position extraction
// ---------------------------------------------------------------------------

/**
 * Returns the integer tile goal for orders that require travelling to a
 * destination, or `null` for orders with no movement target (stop, hold,
 * attack-entity, train).
 *
 * For `build` / `repair` / `harvest` the target tile is the order's position
 * (the unit must walk to it).  The movement phase handles getting there;
 * later phases (T9 / T10) handle what happens on arrival.
 */
function orderDestination(
  unit: Unit,
  world: World,
): { x: number; y: number } | null {
  const o = unit.order;
  switch (o.kind) {
    case "move":
      // A `move` unit travels to its RESOLVED arrival slot (a distinct, free
      // tile assigned by the slot pre-pass so a group ordered to one point
      // packs into a bounded cluster instead of piling onto the contested goal
      // tile). The pre-pass guarantees `arrival` is set for every live `move`
      // unit; the `?? floored goal` is a defensive fallback only.
      return unit.arrival !== undefined
        ? { x: unit.arrival.slot.x, y: unit.arrival.slot.y }
        : { x: Math.floor(o.targetPos.x), y: Math.floor(o.targetPos.y) };
    case "attackMove":
      return { x: Math.floor(o.targetPos.x), y: Math.floor(o.targetPos.y) };
    case "harvest":
    case "repair": {
      // Walk toward the target entity.  For harvest the target is a building
      // or resource tile; for repair it is a friendly building.  We use
      // stopAdjacent in both cases because the target tile may itself be
      // blocked (it is a building footprint).
      const target =
        world.buildings.get(o.targetId) ?? world.units.get(o.targetId);
      if (target === undefined) {
        // Entity gone — clear the order.
        unit.order = idle();
        unit.path = undefined;
        return null;
      }
      if ("tile" in target) {
        return { x: target.tile.x, y: target.tile.y };
      }
      return {
        x: Math.floor(target.pos.x),
        y: Math.floor(target.pos.y),
      };
    }
    case "build":
      return { x: Math.floor(o.pos.x), y: Math.floor(o.pos.y) };
    case "attack": {
      // Walk toward the attacked entity; T9 takes over when in range.
      const target =
        world.buildings.get(o.targetId) ?? world.units.get(o.targetId);
      if (target === undefined) {
        unit.order = idle();
        unit.path = undefined;
        return null;
      }
      if ("tile" in target) {
        return { x: target.tile.x, y: target.tile.y };
      }
      return {
        x: Math.floor(target.pos.x),
        y: Math.floor(target.pos.y),
      };
    }
    case "stop":
    case "hold":
    case "train":
      return null;
    default: {
      // Exhaustiveness guard — TypeScript will warn if a new OrderKind is added
      // without updating this switch.
      const _exhaustive: never = o;
      return _exhaustive;
    }
  }
}

/**
 * Returns true iff this order type requires the unit to stop adjacent to the
 * goal tile rather than stand on it (the goal itself is blocked — a building
 * footprint or resource tile).
 */
function needsStopAdjacent(unit: Unit): boolean {
  const k = unit.order.kind;
  return k === "harvest" || k === "repair" || k === "build" || k === "attack";
}

// ---------------------------------------------------------------------------
// Group arrival — destination-slot assignment
// ---------------------------------------------------------------------------
//
// The defect this section fixes: when N units are ordered to ONE goal tile,
// each unit would empty its path AT that tile and go idle. Only one unit can
// occupy the tile; the rest, pinned nowhere, were shoved outward by the
// pairwise separation pass into a loose blob whose radius GREW ~linearly with
// N (a permanent jam, not a settled cluster).
//
// The fix assigns every `move` unit a DISTINCT arrival slot — a free standable
// tile found by an outward ring search from the shared goal, claimed in a fixed
// (ascending-EntityId) order so the result is deterministic and groups pack
// densely (slot count ≈ N ⇒ packed radius ≈ √N). Each unit travels to and
// settles on its OWN slot. A settled unit is PINNED to its slot centre and is
// excluded from receiving separation pushes, so it is never shoved outward.

/**
 * The integer goal tile a `move` order points at (its target position floored).
 * For non-`move` orders this returns null — only `move` orders participate in
 * slot assignment; every other order keeps the existing arrival semantics.
 */
function moveGoalTile(unit: Unit): Vec2 | null {
  const o = unit.order;
  if (o.kind !== "move") return null;
  return { x: Math.floor(o.targetPos.x), y: Math.floor(o.targetPos.y) };
}

/**
 * True iff `unit` has SETTLED on its assigned arrival slot — a true fixed point.
 * Settling is an explicit, latched state (`unit.pinned`), set the moment the unit
 * is snapped to its slot centre and idled (by `snapIfArrived` on slot arrival, or
 * by `settleWedgedUnits` as a backstop). Once latched the unit is excluded from
 * separation displacement, so its position stays EXACTLY fixed (no drift back out
 * of an epsilon ball, hence no orbit). A pinned unit always carries a live
 * `arrival` reservation and an idle (`stop`) order; the asserts document that
 * invariant. Cleared only by a fresh `move` order (re-target).
 */
function isSettledAtSlot(unit: Unit): boolean {
  if (unit.pinned !== true) return false;
  // Invariant: a pinned unit holds its reservation and is idle.
  if (unit.arrival === undefined || unit.order.kind !== "stop") {
    throw new Error(
      `pinned unit ${unit.id} lost its settled invariant ` +
        `(arrival=${unit.arrival !== undefined}, order=${unit.order.kind})`,
    );
  }
  return true;
}

/**
 * True iff the unit still legitimately holds its arrival reservation, so the
 * tile must stay claimed by the slot pre-pass:
 *   - it has a live `move` order to the SAME goal that produced the slot
 *     (still travelling to or already standing on the slot), OR
 *   - it has settled (idle) on the slot.
 * Any other state (a fresh move to a different goal, an attack/harvest/hold
 * order, or an idle unit that is NOT on its slot) releases the reservation.
 */
function holdsArrival(unit: Unit): boolean {
  if (unit.arrival === undefined) return false;
  const goal = moveGoalTile(unit);
  if (goal !== null) {
    return goal.x === unit.arrival.goal.x && goal.y === unit.arrival.goal.y;
  }
  return isSettledAtSlot(unit);
}

/**
 * Clears ALL stale arrival/slot/pin/stall state for any unit whose CURRENT
 * `move` goal no longer matches the goal its reservation was built for — i.e. a
 * RE-TARGET. Run once per tick, BEFORE slot resolution, so a re-issued move order
 * (including one given to a unit that had already settled+pinned at a previous
 * goal) fully re-resolves: the unit drops its old slot, cached A* path, stall
 * counters, and pin, then `resolveArrivalSlots` assigns it a fresh slot near the
 * NEW goal and `stepUnit` re-paths to it.
 *
 * Without this, a unit re-targeted while holding a cached `path` to the old goal
 * keeps following that stale path (the path-invalidation check only fires on a
 * BLOCKED next tile, not a changed destination) and strands at the old location.
 *
 * The reset is keyed purely on the discrete order/goal mismatch, so it is
 * deterministic and independent of unit positions.
 */
function clearRetargetedState(units: Unit[]): void {
  for (const u of units) {
    const goal = moveGoalTile(u);
    if (goal === null) continue; // not a move order — handled by holdsArrival
    const stale =
      u.arrival !== undefined &&
      (u.arrival.goal.x !== goal.x || u.arrival.goal.y !== goal.y);
    // A fresh move order also means a previously-settled unit must un-pin and
    // re-path even if it currently has no reservation (defensive: pin without
    // arrival should never occur, but a stale pin must never survive a re-target).
    if (stale || u.pinned === true) {
      u.arrival = undefined;
      u.path = undefined;
      u.pinned = false;
      u.stallTicks = 0;
      u.slotBestDist = undefined;
      u.wpTarget = undefined;
      u.wpBestDist = undefined;
      u.wpStallTicks = 0;
    }
  }
}

/**
 * Assigns each `move` unit a distinct, free, standable arrival slot for its
 * goal tile, run once per tick BEFORE path-following.
 *
 * Determinism & packing: units are processed in the caller's order (ascending
 * EntityId). The set of already-claimed tiles seeds from every unit that still
 * legitimately holds a reservation (`holdsArrival`), so settled units keep their
 * resting tile and re-assignment is stable across ticks. A unit needing a slot
 * takes the nearest UNCLAIMED standable tile via an outward Chebyshev-ring scan
 * from its goal (ring 0 = the goal tile itself, so the first/lowest-id unit gets
 * the exact goal). Claimed tiles accumulate as we go, so N units claim N
 * distinct tiles packed around the goal — a cluster of radius ≈ √N, not a line.
 *
 * @param units units in ascending-EntityId order (the deterministic key).
 */
function resolveArrivalSlots(units: Unit[], world: World): void {
  const map = world.map;
  const stride = map.width;
  const claimed = new Set<number>();

  // Seed claims from units that still hold a valid reservation; drop stale ones.
  for (const u of units) {
    if (u.arrival !== undefined && !holdsArrival(u)) {
      u.arrival = undefined;
    }
    if (u.arrival !== undefined) {
      claimed.add(u.arrival.slot.y * stride + u.arrival.slot.x);
    }
  }

  // A tile is a usable slot iff in bounds, standable (not impassable terrain or
  // a building), and not already claimed by another unit this tick.
  const slotFree = (x: number, y: number): boolean => {
    if (!map.inBounds(x, y)) return false;
    if (map.isTileBlocked(x, y)) return false;
    return !claimed.has(y * stride + x);
  };

  for (const u of units) {
    const goal = moveGoalTile(u);
    if (goal === null) continue; // not a move order — no slot needed
    if (u.arrival !== undefined && holdsArrival(u)) continue; // already reserved

    const chosen = nearestFreeSlot(goal, slotFree);
    // Fall back to the raw goal tile when the whole search radius is claimed or
    // blocked (degrades to pre-slot behaviour rather than failing). Claim it so
    // the unit still pins there and pathing has a concrete destination.
    const slot = chosen ?? goal;
    claimed.add(slot.y * stride + slot.x);
    u.arrival = { goal, slot };
  }
}

/**
 * Returns the nearest tile to `goal` (by growing Chebyshev rings, then
 * row-major within a ring) for which `free` holds, or null if none within
 * MAX_SLOT_RING_RADIUS. Ring 0 is the goal tile itself. The fixed scan order
 * makes the choice deterministic.
 */
function nearestFreeSlot(
  goal: Vec2,
  free: (x: number, y: number) => boolean,
): Vec2 | null {
  if (free(goal.x, goal.y)) return { x: goal.x, y: goal.y };
  for (let r = 1; r <= MAX_SLOT_RING_RADIUS; r++) {
    for (let y = goal.y - r; y <= goal.y + r; y++) {
      for (let x = goal.x - r; x <= goal.x + r; x++) {
        // Perimeter cells only (those first reached at radius r).
        const onRing =
          x === goal.x - r || x === goal.x + r || y === goal.y - r || y === goal.y + r;
        if (!onRing) continue;
        if (free(x, y)) return { x, y };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Core movement step for one unit
// ---------------------------------------------------------------------------

/**
 * Settles a travelling `move` unit onto its arrival slot as a TRUE FIXED POINT:
 * snaps its centre EXACTLY to the slot tile centre, clears the path, idles it,
 * and pins it. Once pinned the unit is never displaced by separation again, so
 * its position holds exactly (max per-tick move == 0). Returns true iff it
 * snapped.
 *
 * Called from `stepUnit` the instant the unit's centre enters the arrival disk
 * (within SLOT_ARRIVAL_RADIUS of its own slot), which happens during the SAME
 * tick's path-following, BEFORE the separation pass — so the unit transitions
 * directly from "pathing toward its slot tile" to "snapped+settled" and never
 * spends a tick as a near-the-slot `move` unit that separation can push into an
 * orbit.
 *
 * @param force when true, snap even if the unit is outside SLOT_ARRIVAL_RADIUS
 *   (used by the path-exhausted arrival site: the unit reached its slot TILE so
 *   it must settle there regardless of residual sub-tile offset).
 */
function snapToSlot(unit: Unit, force: boolean): boolean {
  if (unit.order.kind !== "move" || unit.arrival === undefined) return false;
  const cx = unit.arrival.slot.x + 0.5;
  const cy = unit.arrival.slot.y + 0.5;
  if (!force) {
    const dx = unit.pos.x - cx;
    const dy = unit.pos.y - cy;
    if (dx * dx + dy * dy > SLOT_ARRIVAL_RADIUS * SLOT_ARRIVAL_RADIUS) return false;
  }
  unit.pos = { x: cx, y: cy };
  unit.path = [];
  unit.order = idle();
  unit.pinned = true;
  unit.stallTicks = 0;
  unit.slotBestDist = undefined;
  unit.wpTarget = undefined;
  unit.wpBestDist = undefined;
  unit.wpStallTicks = 0;
  return true;
}

/**
 * Advances `unit` by one tick along its cached path (or a newly-computed one).
 * Mutates `unit.pos`, `unit.path`, and `unit.order` only.
 */
function stepUnit(unit: Unit, world: World): void {
  const dest = orderDestination(unit, world);
  if (dest === null) {
    // No movement required; clear any stale path.
    unit.path = undefined;
    return;
  }

  const map = world.map;
  const startTileX = Math.floor(unit.pos.x);
  const startTileY = Math.floor(unit.pos.y);

  // ── Ensure a valid path exists ───────────────────────────────────────────

  // If the next waypoint is now blocked, discard the cached path so it is
  // recomputed below.
  if (unit.path !== undefined && unit.path.length > 0) {
    const next = unit.path[0];
    if (map.isTileBlocked(next.x, next.y)) {
      unit.path = undefined;
    }
  }

  if (unit.path === undefined) {
    const start = { x: startTileX, y: startTileY };
    const goal = { x: dest.x, y: dest.y };

    // Already at the goal tile?
    if (start.x === goal.x && start.y === goal.y) {
      unit.path = [];
    } else {
      const stopAdjacent = needsStopAdjacent(unit);
      const computed = astar(
        map.width,
        map.height,
        (x, y) => map.isTileBlocked(x, y),
        start,
        goal,
        { stopAdjacent },
      );
      // null means unreachable — leave path empty so we don't keep retrying
      // every tick (path will be recomputed if the order changes).
      unit.path = computed ?? [];
    }
  }

  const path = unit.path;

  // Nothing to do (already at goal or no path found).
  if (path.length === 0) {
    // Arrived at (or already standing on) the slot TILE — settle there as a true
    // fixed point: snap exactly to the slot centre, idle, and pin. `force` snaps
    // regardless of residual sub-tile offset since the discrete tile is reached.
    // (attackMove keeps its order; combat T9 takes over — snapToSlot no-ops it.)
    if (!snapToSlot(unit, true) && unit.order.kind === "move") {
      // No reservation (defensive: pre-pass guarantees one) — still idle.
      unit.order = idle();
    }
    return;
  }

  // ── Advance along the path ────────────────────────────────────────────────

  const stats = getUnitStats(unit.owner, unit.kind);
  let remaining = stats.moveSpeed / SIM_HZ; // tiles to travel this tick

  while (remaining > 0 && path.length > 0) {
    const wp = path[0];
    // Tile centre in fractional coordinates.
    const wpCX = wp.x + 0.5;
    const wpCY = wp.y + 0.5;

    const dx = wpCX - unit.pos.x;
    const dy = wpCY - unit.pos.y;
    const distToWp = Math.sqrt(dx * dx + dy * dy);

    if (distToWp <= WAYPOINT_REACH) {
      // Snap to the waypoint tile centre and pop it.
      unit.pos = { x: wpCX, y: wpCY };
      path.shift();
      // remaining stays — we consumed negligible distance reaching this wp.
    } else if (distToWp <= remaining) {
      // Can reach the waypoint within this tick's budget.
      unit.pos = { x: wpCX, y: wpCY };
      remaining -= distToWp;
      path.shift();
    } else {
      // Move as far as `remaining` allows in the direction of the waypoint.
      const factor = remaining / distToWp;
      unit.pos = {
        x: unit.pos.x + dx * factor,
        y: unit.pos.y + dy * factor,
      };
      remaining = 0;
    }
  }

  // Settle the instant the unit's centre enters its slot's arrival disk, even if
  // a waypoint formally remains — this is what prevents the orbit: the unit is
  // pinned BEFORE the separation pass can perturb it, rather than left as a
  // near-the-slot `move` unit oscillating under continuous forces. Falls through
  // when still outside the disk (keep path-following next tick).
  if (snapToSlot(unit, false)) return;

  // If the path was exhausted this tick, settle on the reached slot tile.
  if (path.length === 0) {
    if (!snapToSlot(unit, true) && unit.order.kind === "move") {
      unit.order = idle();
    }
  }
}

// ---------------------------------------------------------------------------
// Group separation pass
// ---------------------------------------------------------------------------

/**
 * Resolves inter-unit crowding via a pairwise separation step.
 *
 * For each unit pair whose Euclidean centre-to-centre distance is below
 * SEPARATION_RADIUS, both units are pushed apart by SEPARATION_STRENGTH of
 * the overlap, along the separation vector.  If the separation vector is
 * zero-length (units are exactly on top of each other), an axis-slide fallback
 * based on the units' sorted EntityId indices provides a deterministic
 * non-zero nudge without calling Math.random.
 *
 * Iteration order is ascending EntityId (stable, deterministic).  Position
 * updates accumulate in a temporary delta array and are applied atomically
 * after all pairs have been evaluated, so the pass is order-independent.
 *
 * Settled units (resting on their assigned arrival slot) are PINNED: they are
 * snapped exactly to their slot centre and never receive a separation push, so
 * an arrived group holds its packed cluster instead of being shoved outward.
 * A pinned unit still CONTRIBUTES a push to any non-settled neighbour, so units
 * still in transit steer around the resting cluster rather than through it.
 */
function separationPass(units: Unit[], world: World): void {
  const n = units.length;
  if (n < 2) return;

  const map = world.map;

  // Pin settled units to their slot centre up front (removes residual fractional
  // drift) and record which units are pinned — pinned units neither move nor
  // accumulate a push below.
  const pinned = new Array<boolean>(n);
  for (let i = 0; i < n; i++) {
    const u = units[i];
    if (isSettledAtSlot(u)) {
      pinned[i] = true;
      // arrival is defined whenever isSettledAtSlot is true.
      const slot = u.arrival as { goal: Vec2; slot: Vec2 };
      u.pos = { x: slot.slot.x + 0.5, y: slot.slot.y + 0.5 };
    } else {
      pinned[i] = false;
    }
  }

  // Per-unit accumulated delta (flat array: [dx0, dy0, dx1, dy1, …]).
  const delta = new Float64Array(n * 2);

  for (let i = 0; i < n; i++) {
    const a = units[i];
    const candidates = neighborsWithin(world, a.pos, SEPARATION_RADIUS);
    for (const b of candidates) {
      if (b === a) continue;
      // Find b's index in the sorted array to avoid double-counting.
      // Only process pairs where i < j (b's index > i).
      // We do a linear scan — n is small in practice; T12 improves this.
      let j = -1;
      for (let k = i + 1; k < n; k++) {
        if (units[k] === b) {
          j = k;
          break;
        }
      }
      if (j === -1) continue; // b's index ≤ i: already handled

      // Two pinned units never push each other (their slots are distinct tiles;
      // a fixed-cluster pair must not jitter).
      if (pinned[i] && pinned[j]) continue;

      const dx = b.pos.x - a.pos.x;
      const dy = b.pos.y - a.pos.y;
      const d2 = dx * dx + dy * dy;
      const d = Math.sqrt(d2);
      const overlap = SEPARATION_RADIUS - d;
      if (overlap <= 0) continue;

      let nx: number;
      let ny: number;

      if (d < 1e-9) {
        // Units exactly coincident — axis-slide fallback based on sorted index.
        // i < j always here, so unit[i] goes right/up and unit[j] goes left/down.
        nx = (i & 1) === 0 ? 1.0 : 0.0;
        ny = (i & 1) === 0 ? 0.0 : 1.0;
      } else {
        nx = dx / d;
        ny = dy / d;
      }

      const push = overlap * SEPARATION_STRENGTH;
      // Push a away from b (negative direction) and b away from a (positive),
      // but only move the unit if it is NOT pinned. A pinned partner acts as a
      // fixed wall the moving unit is pushed off of.
      if (!pinned[i]) {
        delta[i * 2] -= nx * push;
        delta[i * 2 + 1] -= ny * push;
      }
      if (!pinned[j]) {
        delta[j * 2] += nx * push;
        delta[j * 2 + 1] += ny * push;
      }
    }
  }

  // Apply deltas, clamping positions to map bounds.
  for (let i = 0; i < n; i++) {
    if (pinned[i]) continue;
    const u = units[i];
    const ddx = delta[i * 2];
    const ddy = delta[i * 2 + 1];
    if (ddx === 0 && ddy === 0) continue;
    u.pos = {
      x: Math.max(0.5, Math.min(map.width - 0.5, u.pos.x + ddx)),
      y: Math.max(0.5, Math.min(map.height - 0.5, u.pos.y + ddy)),
    };
  }
}

// ---------------------------------------------------------------------------
// Wedged-unit settling (guarantees group termination)
// ---------------------------------------------------------------------------

/**
 * Force-settle BACKSTOP: drops to a true fixed point any `move` unit that, while
 * inside the arrival disk, is no longer making PROGRESS TOWARD ITS SLOT — whether
 * it is motionless (jammed against the settled cluster) or moving without closing
 * the gap (trapped in a separation-vs-slot-seek LIMIT CYCLE, i.e. orbiting). The
 * primary snap (`snapToSlot` in `stepUnit`) settles every unit that actually
 * reaches within SLOT_ARRIVAL_RADIUS of its slot; this catches the residual cases
 * where pinned neighbours physically wall off the last tile so the unit can never
 * close that final gap.
 *
 * Detection is keyed on slot-distance, NOT instantaneous speed: a tick that
 * strictly beats the unit's best-so-far slot-distance (`slotBestDist`) by more
 * than SLOT_PROGRESS_EPS counts as progress and resets the stall counter; any
 * other tick (zero motion OR orbital motion that does not close the gap) advances
 * it. After STALL_TICKS_TO_SETTLE consecutive non-progress ticks the unit is
 * re-homed onto the nearest UNCLAIMED free tile to the GOAL (compact fill — keeps
 * the cluster packed rather than leaving a tail), snapped exactly there, idled,
 * and PINNED. Each settle releases the old slot and pins a compact one, so the
 * non-settled count is monotonically non-increasing and the group reaches a
 * fully-idle, exactly-fixed steady state (max per-tick move == 0).
 *
 * The arrival-disk gate (goal-distance ≤ WEDGE_GOAL_RADIUS) keeps a unit still
 * legitimately en route — momentarily stalled far from the goal as two columns
 * cross — from being frozen mid-route; only units within the converging cluster
 * accumulate toward a force-settle.
 */
function settleWedgedUnits(units: Unit[], world: World): void {
  const map = world.map;
  const stride = map.width;

  // Tiles already spoken for: every live reservation's slot.
  const claimed = new Set<number>();
  for (const u of units) {
    if (u.arrival !== undefined && holdsArrival(u)) {
      claimed.add(u.arrival.slot.y * stride + u.arrival.slot.x);
    }
  }

  const free = (x: number, y: number): boolean => {
    if (!map.inBounds(x, y)) return false;
    if (map.isTileBlocked(x, y)) return false;
    return !claimed.has(y * stride + x);
  };

  for (const u of units) {
    // Only travelling `move` units that have a reservation but are not yet
    // pinned can be wedged; everything else clears its progress tracking.
    const eligible =
      u.order.kind === "move" && u.arrival !== undefined && u.pinned !== true;
    if (!eligible) {
      u.stallTicks = 0;
      u.slotBestDist = undefined;
      continue;
    }

    const arrival = u.arrival as { goal: Vec2; slot: Vec2 };

    // Distance to THIS unit's own slot centre — the progress metric.
    const sdx = u.pos.x - (arrival.slot.x + 0.5);
    const sdy = u.pos.y - (arrival.slot.y + 0.5);
    const slotDist = Math.sqrt(sdx * sdx + sdy * sdy);

    // Strict improvement in slot-distance resets the stall counter (progress).
    if (u.slotBestDist === undefined || slotDist < u.slotBestDist - SLOT_PROGRESS_EPS) {
      u.slotBestDist = slotDist;
      u.stallTicks = 0;
      continue;
    }

    // No progress, but still outside the arrival disk ⇒ legitimately en route
    // (e.g. columns crossing); do not accumulate toward a settle.
    const gdx = u.pos.x - (arrival.goal.x + 0.5);
    const gdy = u.pos.y - (arrival.goal.y + 0.5);
    if (gdx * gdx + gdy * gdy > WEDGE_GOAL_RADIUS * WEDGE_GOAL_RADIUS) {
      u.stallTicks = 0;
      continue;
    }

    // Stalled/orbiting inside the cluster: accumulate; settle once sustained.
    u.stallTicks = (u.stallTicks ?? 0) + 1;
    if (u.stallTicks < STALL_TICKS_TO_SETTLE) continue;

    // Re-home onto the nearest unclaimed free tile to the GOAL (compact fill).
    const dest = nearestFreeSlot(arrival.goal, free);
    if (dest === null) continue; // nothing free in range — keep trying next tick

    claimed.delete(arrival.slot.y * stride + arrival.slot.x);
    claimed.add(dest.y * stride + dest.x);
    u.arrival = { goal: arrival.goal, slot: dest };
    u.pos = { x: dest.x + 0.5, y: dest.y + 0.5 };
    u.path = [];
    u.order = idle();
    u.pinned = true;
    u.stallTicks = 0;
    u.slotBestDist = undefined;
    u.wpTarget = undefined;
    u.wpBestDist = undefined;
    u.wpStallTicks = 0;
  }
}

// ---------------------------------------------------------------------------
// In-transit re-path around settled (pinned) clusters
// ---------------------------------------------------------------------------
//
// The defect this section fixes: A* is UNIT-BLIND — `isTileBlocked` reports only
// terrain and building occupancy, never unit bodies. A SETTLED (pinned) cluster
// therefore does not appear as an obstacle to A*, yet its units never move
// (separation excludes pinned units), so they physically wall the tiles they
// stand on. A unit whose cached path runs straight THROUGH such a cluster is
// pushed back by separation to a fixed equilibrium just short of the first pinned
// tile and stays there forever in `order=move`: the next waypoint is never
// terrain-blocked (so the path is never recomputed) and the force-settle backstop
// only fires near the GOAL (so a unit walled mid-route never settles either).
//
// The fix detects an in-transit unit that has made no progress toward its current
// head waypoint for several ticks and RE-PATHS it with A* treating currently
// pinned tiles as blocked, so it routes AROUND the cluster. If no such route
// exists (the cluster fully walls the destination) the unit settles on the
// nearest reachable free tile instead of livelocking. This keys on WAYPOINT
// progress, orthogonal to the slot/goal force-settle (which keys on slot
// progress), so a unit converging on its OWN arrival slot still snaps+pins via
// the existing path — the group fixed point is untouched.

/**
 * The set of tiles (flat `y*stride+x` keys) currently occupied by a SETTLED
 * (pinned) unit body. Deterministic: pinned units rest on integer slot tiles.
 * These are the tiles A* must treat as blocked when re-pathing an in-transit unit
 * around a settled cluster.
 */
function pinnedTileSet(units: Unit[], stride: number): Set<number> {
  const pinned = new Set<number>();
  for (const u of units) {
    if (u.pinned === true && u.arrival !== undefined) {
      pinned.add(u.arrival.slot.y * stride + u.arrival.slot.x);
    }
  }
  return pinned;
}

/**
 * Re-paths any in-transit `move` unit walled mid-route by a settled (pinned)
 * cluster. Run once per tick BEFORE the per-unit step so the fresh path is
 * followed the same tick.
 *
 * For each non-pinned `move` unit with a non-empty cached path, tracks progress
 * toward its current head waypoint (`wpTarget`). A tick that strictly closes that
 * distance (or a waypoint pop, which IS progress) resets the stall counter; a
 * tick that does not advances it. After TRANSIT_STALL_TICKS_TO_REPATH consecutive
 * non-progress ticks the unit is re-pathed with A* over a passability predicate
 * that blocks terrain/buildings AND currently-pinned tiles:
 *   - a route found ⇒ replace the cached path and reset the trackers;
 *   - no route (cluster fully walls the destination) ⇒ settle on the nearest
 *     reachable free tile (snap + idle + pin) so the unit terminates instead of
 *     livelocking.
 *
 * Determinism: the pinned-tile set, the A* search, and the fallback ring search
 * are all EntityId-stable and RNG-free.
 */
function repathTransitStalls(units: Unit[], world: World): void {
  const map = world.map;
  const stride = map.width;
  let pinned: Set<number> | null = null; // built lazily on first stalled unit

  for (const u of units) {
    // Only an in-transit (not yet pinned) `move` unit with a real path can be
    // walled mid-route; everything else clears its transit progress tracking.
    const inTransit =
      u.order.kind === "move" &&
      u.pinned !== true &&
      u.path !== undefined &&
      u.path.length > 0;
    if (!inTransit) {
      u.wpTarget = undefined;
      u.wpBestDist = undefined;
      u.wpStallTicks = 0;
      continue;
    }

    const head = (u.path as Vec2[])[0];

    // Fresh waypoint (popped one ⇒ advanced ⇒ progress): reset the window.
    if (u.wpTarget === undefined || u.wpTarget.x !== head.x || u.wpTarget.y !== head.y) {
      u.wpTarget = { x: head.x, y: head.y };
      u.wpBestDist = Math.hypot(u.pos.x - (head.x + 0.5), u.pos.y - (head.y + 0.5));
      u.wpStallTicks = 0;
      continue;
    }

    const distToHead = Math.hypot(u.pos.x - (head.x + 0.5), u.pos.y - (head.y + 0.5));
    if (u.wpBestDist === undefined || distToHead < u.wpBestDist - TRANSIT_PROGRESS_EPS) {
      u.wpBestDist = distToHead;
      u.wpStallTicks = 0;
      continue;
    }

    u.wpStallTicks = (u.wpStallTicks ?? 0) + 1;
    if (u.wpStallTicks < TRANSIT_STALL_TICKS_TO_REPATH) continue;

    // Stalled long enough — re-path around currently-pinned tiles.
    if (pinned === null) pinned = pinnedTileSet(units, stride);
    repathAroundPinned(u, world, pinned);

    // Reset the transit window; the next waypoint (old or new) starts fresh.
    u.wpTarget = undefined;
    u.wpBestDist = undefined;
    u.wpStallTicks = 0;
  }
}

/**
 * Re-routes a single in-transit unit around the pinned-tile set, or settles it on
 * the nearest reachable free tile when no route exists. The unit's own start tile
 * is forced standable (it stands there; only OTHER pinned bodies block).
 */
function repathAroundPinned(unit: Unit, world: World, pinned: Set<number>): void {
  const map = world.map;
  const stride = map.width;
  const dest = orderDestination(unit, world);
  if (dest === null) return; // order changed under us — nothing to do

  const startX = Math.floor(unit.pos.x);
  const startY = Math.floor(unit.pos.y);
  const start = { x: startX, y: startY };
  const goal = { x: dest.x, y: dest.y };

  if (start.x === goal.x && start.y === goal.y) {
    unit.path = [];
    return;
  }

  // Blocked iff terrain/building blocked OR a pinned body sits there — except the
  // unit's OWN start tile, which it occupies and must be able to leave from.
  const blocked = (x: number, y: number): boolean => {
    if (x === startX && y === startY) return false;
    if (map.isTileBlocked(x, y)) return true;
    return pinned.has(y * stride + x);
  };

  const stopAdjacent = needsStopAdjacent(unit);
  const route = astar(map.width, map.height, blocked, start, goal, { stopAdjacent });
  if (route !== null) {
    // A route exists (possibly []=already adjacent) — follow it. Even an empty
    // route is fine: stepUnit will then settle the unit on its slot tile.
    unit.path = route;
    return;
  }

  // No route around the cluster — the destination is fully walled. Settle on the
  // nearest free, non-pinned tile to the unit's current position so it terminates
  // (a true fixed point) rather than livelocking against the wall.
  settleAtNearestFree(unit, world, pinned);
}

/**
 * Settles `unit` on the nearest standable, unclaimed, non-pinned tile to its
 * current position (preferring its own current tile): snaps to that tile centre,
 * clears the path, idles, and pins. Used as the walled-off fallback for an
 * in-transit unit whose destination the pinned cluster fully encloses.
 *
 * The chosen tile is registered as the unit's arrival slot so the settled-state
 * invariants (`isSettledAtSlot`) hold and separation pins it thereafter.
 */
function settleAtNearestFree(unit: Unit, world: World, pinned: Set<number>): void {
  const map = world.map;
  const stride = map.width;

  // Tiles already taken: every live reservation's slot plus every pinned body.
  const taken = new Set<number>(pinned);
  for (const u of world.units.values()) {
    if (u !== unit && u.arrival !== undefined && holdsArrival(u)) {
      taken.add(u.arrival.slot.y * stride + u.arrival.slot.x);
    }
  }

  const free = (x: number, y: number): boolean => {
    if (!map.inBounds(x, y)) return false;
    if (map.isTileBlocked(x, y)) return false; // impassable terrain / building
    return !taken.has(y * stride + x);
  };

  const here = { x: Math.floor(unit.pos.x), y: Math.floor(unit.pos.y) };
  const dest = nearestFreeSlot(here, free);
  if (dest === null) return; // nothing free nearby — keep trying next tick

  // Preserve the unit's goal for the reservation; fall back to the resting tile.
  const goal = moveGoalTile(unit) ?? dest;
  unit.arrival = { goal, slot: dest };
  unit.pos = { x: dest.x + 0.5, y: dest.y + 0.5 };
  unit.path = [];
  unit.order = idle();
  unit.pinned = true;
  unit.stallTicks = 0;
  unit.slotBestDist = undefined;
  unit.wpTarget = undefined;
  unit.wpBestDist = undefined;
  unit.wpStallTicks = 0;
}

// ---------------------------------------------------------------------------
// Phase entry point
// ---------------------------------------------------------------------------

/**
 * The movement phase: replaces the no-op stub in `simulation.ts`.
 *
 * 0. Clear stale slot/path/pin/stall state for any RE-TARGETED unit (its current
 *    `move` goal differs from the goal its reservation was built for), so a
 *    re-issued order — including one given to an already-settled unit — re-paths
 *    to the new goal instead of following its cached path back to the old one.
 * 1. Collect all living units in ascending EntityId order (deterministic).
 * 2. Assign each `move` unit a distinct arrival slot (group-arrival packing).
 * 3. Re-path any in-transit unit walled mid-route by a settled (pinned) cluster
 *    (A* is unit-blind), routing it AROUND or settling it if fully walled — so a
 *    traveller never livelocks against a pinned cluster its cached path crosses.
 * 4. Advance each unit along its A* path; SNAP+settle+pin the instant it reaches
 *    its slot's arrival disk (a true fixed point, set before separation runs).
 * 5. Run the pairwise separation pass (pinned settled units hold their slots).
 * 6. Force-settle any unit wedged/orbiting at the cluster (progress-based) so the
 *    group provably terminates: every unit ends `stop`, max per-tick move == 0.
 */
export function phaseMovement(world: World): void {
  // Sort by EntityId (numeric) for a deterministic, stable iteration order.
  const units: Unit[] = [...world.units.values()].sort((a, b) => a.id - b.id);

  // Step 0: a re-issued move order to a NEW goal must fully reset the unit so it
  // re-resolves a slot and re-paths; otherwise it would follow its stale cached
  // path and strand at the previous goal.
  clearRetargetedState(units);

  // Step 1: assign/refresh arrival slots so a group ordered to one tile spreads
  // onto distinct nearby tiles before any of them path-follow.
  resolveArrivalSlots(units, world);

  // Step 2: re-path any in-transit unit walled mid-route by a settled (pinned)
  // cluster. A* is unit-blind, so a cached path can run straight through a pinned
  // cluster whose bodies never move; this detects the resulting stall and routes
  // the unit AROUND (or settles it if fully walled), BEFORE the step below so the
  // fresh path is followed this tick.
  repathTransitStalls(units, world);

  // Step 3: path-following (snaps each unit to a pinned fixed point on arrival).
  for (const unit of units) {
    stepUnit(unit, world);
  }

  // Step 4: group separation. Pinned units are walls: they never move, only push
  // in-transit neighbours — so a settled cluster holds EXACTLY-fixed positions.
  separationPass(units, world);

  // Step 5: force-settle backstop. A `move` unit can be walled off the last tile
  // of its slot by pinned neighbours — A* ignores unit bodies, so it keeps a path
  // it can never traverse and either jams or ORBITS its slot under separation.
  // Keyed on progress-toward-slot (not speed), this catches both and snaps the
  // unit to a compact free tile, pinning it, so the group fully terminates.
  settleWedgedUnits(units, world);
}
