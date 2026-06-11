/**
 * The fixed-timestep simulation step — the SPINE of the game loop.
 *
 * `stepWorld(world)` advances the simulation by EXACTLY one fixed tick. It is
 * deterministic given `world.rng`, mutates only `world`, and does no rendering,
 * DOM access, or wall-clock reads. The render/input loop calls it
 * `SIM_HZ` times per simulated second, decoupled from the frame rate.
 *
 * ── The phase seam ────────────────────────────────────────────────────────
 * A tick is a CLEARLY-ORDERED sequence of phase functions, each
 * `(world) => void`, run in array order. This is the extension point for the
 * rest of the simulation: T8 (movement), T9 (combat), T10 (economy),
 * T11 (fog), T16 (AI) REPLACE the matching no-op stub below (or insert before
 * `cleanup`) without changing any types or the step contract.
 *
 * Ordering rationale (do not reorder casually — later tasks rely on it):
 *   1. ai        — issue/adjust orders (the AI player acts first each tick).
 *   2. orders    — translate standing orders into movement/attack intents.
 *   3. movement  — integrate positions along A* paths; resolve unit avoidance.
 *   4. combat    — acquire targets, apply attacks, advance projectiles.
 *   5. economy   — harvesting, construction, training, supply accounting.
 *   6. fog       — recompute per-faction visibility from unit/building sight.
 *   7. cleanup   — remove dead entities (hp ≤ 0), free their occupancy/supply.
 *
 * Cleanup runs LAST so a unit killed this tick still participated in combat and
 * is only removed afterwards; downstream phases never observe a half-dead entity.
 */

import { getBuildingStats, getUnitStats } from "./stats.js";
import type { World } from "./world.js";
import { phaseMovement } from "./movement.js";
import { phaseCombat } from "./combat.js";
import { phaseEconomy as phaseEconomyImpl } from "./economy.js";
import { phaseFog as phaseFogImpl } from "./fog.js";

/** Fixed simulation rate in ticks per second (decoupled from render FPS). */
export const SIM_HZ = 30;

/** Seconds of simulated time per tick. */
export const SECONDS_PER_TICK = 1 / SIM_HZ;

/** One sub-system of a tick. Runs in `SIM_PHASES` order; mutates only `world`. */
export type SimPhase = (world: World) => void;

// ---------------------------------------------------------------------------
// Phase stubs.
//
// Each is a NO-OP placeholder a downstream task replaces with real logic. They
// are named (not anonymous) so a stack trace / profile shows which phase ran,
// and so a later task can find-and-replace one without touching the others.
// `cleanup` is the one phase implemented here, since dead-entity removal is a
// cross-cutting invariant the whole simulation relies on.
// ---------------------------------------------------------------------------

/** T16: AI player issues / revises orders for its faction. */
function phaseAi(_world: World): void {
  // no-op stub — replaced by T16.
}

/** T8/T9: resolve each unit's standing order into concrete per-tick intents. */
function phaseOrders(_world: World): void {
  // no-op stub — replaced by T8 (movement intents) / T9 (attack intents).
}

/** T8: integrate unit positions along their A* paths and resolve avoidance. */
// Imported from movement.ts; aliased here so SIM_PHASES references remain identical.
const phaseMovementPhase: (world: World) => void = phaseMovement;

// phaseCombat is imported from ./combat.ts (T9 implementation).

/** T10: harvesting, construction progress, training, supply accounting. */
const phaseEconomy: (world: World) => void = phaseEconomyImpl;

/** T11: recompute per-faction fog-of-war visibility. */
const phaseFog: (world: World) => void = phaseFogImpl;

/**
 * Removes every entity whose hp has dropped to 0 or below, reversing its
 * world-side effects: a dead building frees its tile occupancy and withdraws the
 * supply it provided; a dead unit returns the supply it consumed. Implemented
 * (not a stub) because the rest of the simulation assumes the entity tables hold
 * only live entities at the start of each tick.
 */
function phaseCleanup(world: World): void {
  for (const [id, unit] of world.units) {
    if (unit.hp <= 0) {
      world.units.delete(id);
      const player = world.players[unit.owner];
      player.supplyUsed -= getUnitStats(unit.owner, unit.kind).supplyCost;
      if (player.supplyUsed < 0) player.supplyUsed = 0;
    }
  }

  for (const [id, building] of world.buildings) {
    if (building.hp <= 0) {
      world.buildings.delete(id);
      world.map.vacate(building.tile, building.footprint);
      if (building.buildProgress >= 1) {
        const player = world.players[building.owner];
        player.supplyCap -= getBuildingStats(building.owner, building.kind).supplyProvided;
        if (player.supplyCap < 0) player.supplyCap = 0;
      }
    }
  }
}

/**
 * The ordered tick pipeline. Downstream tasks REPLACE an entry (same signature)
 * with their real phase, or splice a new phase in before `phaseCleanup`. Kept as
 * a mutable module array so the wiring is visible in one place and a test/tool
 * can introspect the active phase set.
 */
export const SIM_PHASES: SimPhase[] = [
  phaseAi,
  phaseOrders,
  phaseMovementPhase,
  phaseCombat,
  phaseEconomy,
  phaseFog,
  phaseCleanup,
];

/**
 * Advance the world by one fixed tick: bump the tick counter, then run every
 * phase in `SIM_PHASES` order. Deterministic given `world.rng`; mutates only
 * `world`.
 */
export function stepWorld(world: World): void {
  world.tick++;
  for (const phase of SIM_PHASES) {
    phase(world);
  }
}
