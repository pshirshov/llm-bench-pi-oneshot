/**
 * T8 movement-phase tests.
 *
 * Three mandatory assertions:
 *   (a) Two units initialised on/near the same tile separate to DISTINCT tiles.
 *   (b) A group of 5 units ordered to one target ALL arrive near it within K
 *       ticks and positions stabilise (no permanent jam / no oscillation).
 *   (c) Movement is DETERMINISTIC — identical world + orders + seed produce
 *       identical unit positions after N steps.
 */

import { describe, it, expect } from "vitest";
import { makeEntityId } from "../src/game/types.js";
import type { EntityId, Faction } from "../src/game/types.js";
import type { Unit } from "../src/sim/entity.js";
import type { World } from "../src/sim/world.js";
import { GameMap } from "../src/sim/gamemap.js";
import { createRng } from "../src/core/rng.js";
import { Grid } from "../src/core/grid.js";
import type { TileType } from "../src/wfc/tiles.js";
import { idle, moveTo } from "../src/sim/orders.js";
import { phaseMovement } from "../src/sim/movement.js";
import { stepWorld } from "../src/sim/simulation.js";
import { createWorld } from "../src/sim/world.js";

// ---------------------------------------------------------------------------
// Minimal world factory (no WFC, no buildings, open grass map)
// ---------------------------------------------------------------------------

/**
 * Builds a trivial W×H all-grass world with no buildings or starting entities.
 * Used to exercise the movement phase in isolation.
 */
function makeOpenWorld(w: number, h: number, seed: number = 1): World {
  const grid = new Grid<TileType>(w, h, "grass");
  const map = new GameMap(grid);

  const mkPlayer = () => ({
    gold: 0,
    wood: 0,
    supplyUsed: 0,
    supplyCap: 100,
  });

  const world: World = {
    map,
    units: new Map(),
    buildings: new Map(),
    projectiles: new Map(),
    players: { human: mkPlayer(), orc: mkPlayer() },
    playerFaction: "human" as Faction,
    aiDifficulty: 1,
    tick: 0,
    rng: createRng(seed),
    mapReport: {
      width: w,
      height: h,
      seed,
      levelIndex: 0,
      starts: [
        { x: 0, y: 0 },
        { x: w - 1, y: h - 1 },
      ] as [{ x: number; y: number }, { x: number; y: number }],
      resources: [
        { gold: 1, goldAmount: 1500, forest: 1 },
        { gold: 1, goldAmount: 1500, forest: 1 },
      ] as [unknown, unknown] as never,
      componentSize: w * h,
      startDistance: w + h,
      attempts: 1,
      carvedCorridor: false,
      adjustedResources: false,
    },
    nextEntityId: 1,
    nextId(): EntityId {
      return makeEntityId(this.nextEntityId++);
    },
    fog: undefined,
  };

  return world;
}

/**
 * Spawns a unit at fractional position (px, py) with `order` and registers it.
 */
function spawnUnit(
  world: World,
  px: number,
  py: number,
  order: Unit["order"] = idle(),
  faction: Faction = "human",
): Unit {
  const unit: Unit = {
    id: world.nextId(),
    owner: faction,
    kind: "worker",
    hp: 40,
    maxHp: 40,
    pos: { x: px, y: py },
    order,
    attackCooldown: 0,
  };
  world.units.set(unit.id, unit);
  world.players[faction].supplyUsed++;
  return unit;
}

/** Returns a deep-comparable snapshot of all unit positions (sorted by id). */
function posSnapshot(world: World): string {
  return JSON.stringify(
    [...world.units.values()]
      .sort((a, b) => a.id - b.id)
      .map((u) => ({ id: u.id, x: +u.pos.x.toFixed(6), y: +u.pos.y.toFixed(6) })),
  );
}

// ---------------------------------------------------------------------------
// (a) Two units on the same tile separate to DISTINCT tiles
// ---------------------------------------------------------------------------

describe("(a) separation: two units on the same tile resolve to distinct tiles", () => {
  it("two idle units placed on the same tile end up on different tiles after a few ticks", () => {
    const world = makeOpenWorld(20, 20, 42);

    // Both units start at the same position.
    const u1 = spawnUnit(world, 10.5, 10.5);
    const u2 = spawnUnit(world, 10.5, 10.5);

    // Run the separation-only part of the movement phase for up to 30 ticks.
    const MAX_TICKS = 30;
    let separated = false;
    for (let t = 0; t < MAX_TICKS; t++) {
      phaseMovement(world);
      const tx1 = Math.floor(u1.pos.x);
      const ty1 = Math.floor(u1.pos.y);
      const tx2 = Math.floor(u2.pos.x);
      const ty2 = Math.floor(u2.pos.y);
      if (tx1 !== tx2 || ty1 !== ty2) {
        separated = true;
        break;
      }
    }

    expect(separated, "units should separate to distinct tiles").toBe(true);

    // Also confirm neither unit is stuck at the exact same fractional position.
    expect(u1.pos.x === u2.pos.x && u1.pos.y === u2.pos.y).toBe(false);
  });

  it("two units placed very close together (same tile, offset) separate within 5 ticks", () => {
    const world = makeOpenWorld(20, 20, 7);

    const u1 = spawnUnit(world, 10.2, 10.2);
    const u2 = spawnUnit(world, 10.4, 10.4);

    for (let t = 0; t < 5; t++) {
      phaseMovement(world);
    }

    const dx = u1.pos.x - u2.pos.x;
    const dy = u1.pos.y - u2.pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    expect(dist).toBeGreaterThan(0.3);
  });
});

// ---------------------------------------------------------------------------
// (b) Group ordered to ONE point settles into a BOUNDED PACKED CLUSTER
// ---------------------------------------------------------------------------
//
// The earlier version of this test latched the first TRANSIENT instant at which
// every unit was within a fixed radius of the goal and checked stability while
// the formation was still relaxing outward — so it passed even against an
// implementation that piled every arrival onto the contested goal tile and let
// the separation pass shove the rest into an ever-growing 1.05-spaced line
// (worst-case radius growing ~linearly with N: a permanent jam).
//
// The hardened test instead runs each group to STEADY STATE first (until the
// per-tick maximum movement falls below EPS), then asserts at the settled state:
//   (a) every unit is within a √N-scaled radius of the goal;
//   (b) that settled radius does NOT grow unboundedly with N — checked at
//       N ∈ {5, 10, 20}, with the 20-unit radius required well under the old
//       jammed figure (which exceeded 13 in the worst case, ~8 even for the mild
//       streaming approach);
//   (c) the formation is STABLE (per-tick max movement < EPS — settled, not
//       oscillating).
// Units are spawned STACKED ON the goal tile: the worst case for the old
// idle-on-first-touch logic (every unit idles immediately and is then shoved
// outward), which this test must fail against and the slot-assignment fix must
// pass.

/**
 * Outcome of running a group to steady state under the HARDENED termination
 * predicate. A group is "settled" only when it has reached a TRUE FIXED POINT:
 * every targeted unit's order has cleared to `stop` AND the largest single-unit
 * displacement over the last tick is EXACTLY 0 (not merely below some epsilon).
 *
 * The earlier predicate (max per-tick move < 1e-3) was too weak: it latched the
 * transient BOTTOM of a separation-vs-slot-seek limit cycle — a unit can orbit
 * (or asymptotically creep toward) its slot with per-tick motion below 1e-3 while
 * still holding a `move` order. Requiring `allStop` AND `maxMove === 0` rejects
 * that transient and fires only at the genuine fixed point the fix guarantees.
 */
interface SteadyResult {
  /** Largest single-unit displacement on the final tick (0 ⇒ exactly fixed). */
  readonly maxMove: number;
  /** True iff EVERY unit's order is `stop` (none still in `move`). */
  readonly allStop: boolean;
  /** True iff the hardened predicate fired before `maxTicks` (vs ran out). */
  readonly settled: boolean;
  /** Tick at which the hardened predicate fired (or `maxTicks` if it didn't). */
  readonly ticks: number;
}

/**
 * Steps `phaseMovement` until EVERY unit's order is `stop` AND the per-tick max
 * displacement is exactly 0 (true fixed point), or `maxTicks` is reached.
 *
 * Crucially this never breaks on a non-zero max-move: a group whose motion has
 * merely decayed below 1e-3 but still contains a `move` unit (an orbit/creep) is
 * NOT considered settled — the loop runs on until that unit is pinned and all
 * motion ceases, exactly the termination the fix provides.
 */
function runToSteadyState(
  world: World,
  units: Unit[],
  maxTicks: number,
): SteadyResult {
  let maxMove = Number.POSITIVE_INFINITY;
  for (let t = 0; t < maxTicks; t++) {
    const before = units.map((u) => ({ x: u.pos.x, y: u.pos.y }));
    phaseMovement(world);
    maxMove = 0;
    for (let i = 0; i < units.length; i++) {
      const dx = units[i].pos.x - before[i].x;
      const dy = units[i].pos.y - before[i].y;
      maxMove = Math.max(maxMove, Math.sqrt(dx * dx + dy * dy));
    }
    const allStop = units.every((u) => u.order.kind === "stop");
    if (maxMove === 0 && allStop) {
      return { maxMove, allStop, settled: true, ticks: t + 1 };
    }
  }
  return {
    maxMove,
    allStop: units.every((u) => u.order.kind === "stop"),
    settled: false,
    ticks: maxTicks,
  };
}

/**
 * Steps `phaseMovement` until the per-tick max displacement drops below 1e-3 (the
 * LEGACY/weak steady-state predicate) or `maxTicks`. Used ONLY by the re-target
 * tests to reproduce the reviewer's exact trigger: stop A-settling at the moment
 * the weak predicate fired, which on the round-2 impl left a couple of units
 * still orbiting with a stale non-empty path — the precondition for stranding.
 * NOT a correctness predicate; the hardened `runToSteadyState` is.
 */
function runToWeakSteadyState(world: World, units: Unit[], maxTicks: number): void {
  for (let t = 0; t < maxTicks; t++) {
    const before = units.map((u) => ({ x: u.pos.x, y: u.pos.y }));
    phaseMovement(world);
    let mx = 0;
    for (let i = 0; i < units.length; i++) {
      const dx = units[i].pos.x - before[i].x;
      const dy = units[i].pos.y - before[i].y;
      mx = Math.max(mx, Math.sqrt(dx * dx + dy * dy));
    }
    if (mx < 1e-3) return;
  }
}

/** Largest centre-to-goal-centre distance over the group (the cluster radius). */
function maxRadiusFromGoal(
  units: Unit[],
  goal: { x: number; y: number },
): number {
  const gcx = goal.x + 0.5;
  const gcy = goal.y + 0.5;
  let r = 0;
  for (const u of units) {
    r = Math.max(r, Math.hypot(u.pos.x - gcx, u.pos.y - gcy));
  }
  return r;
}

describe("(b) group movement: N units ordered to one point settle into a bounded packed cluster", () => {
  /** Long enough for the largest group to reach steady state (~30 s). */
  const MAX_TICKS = 900;
  /**
   * Settled cluster radius must stay within this constant times √N. The fix
   * yields ≈ 0.6–0.9·√N; the jammed implementation exceeded 1.7·√N at N=20
   * (radius 7.98) and far more in the on-goal worst case, so this bound
   * discriminates the two.
   */
  const RADIUS_SQRT_N_BOUND = 1.5;

  for (const n of [5, 10, 20]) {
    it(`${n} units stacked on the goal settle within ~√${n} of it, stable and non-oscillating`, () => {
      const world = makeOpenWorld(40, 40, 123);
      const goal = { x: 24, y: 24 };

      // Worst case: every unit starts ON the goal tile centre, so each would go
      // idle on first touch under the old logic and be shoved outward.
      const units: Unit[] = [];
      for (let i = 0; i < n; i++) {
        units.push(spawnUnit(world, goal.x + 0.5, goal.y + 0.5, moveTo(goal)));
      }

      const result = runToSteadyState(world, units, MAX_TICKS);

      // (c) TRUE FIXED POINT: every unit reached `stop` (no orbit/creep left in
      // `move`) AND the final tick moved no unit at all (max-per-tick move == 0,
      // not merely < ε). This is the hardened termination invariant.
      expect(
        result.allStop,
        `every unit must reach a stop fixed point (none still in move) within ${MAX_TICKS} ticks`,
      ).toBe(true);
      expect(
        result.maxMove,
        `settled formation must be EXACTLY fixed (final per-tick max move ${result.maxMove.toExponential(2)} must be 0, not just < 1e-3 — no orbit)`,
      ).toBe(0);
      expect(
        result.settled,
        `group of ${n} should reach the hardened steady state before ${MAX_TICKS} ticks (took ${result.ticks})`,
      ).toBe(true);

      // (a)+(b) Bounded radius scaling ~√N (NOT ~N).
      const radius = maxRadiusFromGoal(units, goal);
      const bound = RADIUS_SQRT_N_BOUND * Math.sqrt(n);
      expect(
        radius,
        `settled cluster radius for ${n} units (${radius.toFixed(2)}) must stay within ${RADIUS_SQRT_N_BOUND}·√${n} = ${bound.toFixed(2)}`,
      ).toBeLessThanOrEqual(bound);

      // Every unit must have actually STOPPED (steady-state, no permanent jam).
      // We assert positions are distinct tiles too: a packed cluster, one unit
      // per tile, not a pile sharing the goal tile.
      const tileKeys = new Set(
        units.map((u) => `${Math.floor(u.pos.x)},${Math.floor(u.pos.y)}`),
      );
      expect(
        tileKeys.size,
        `all ${n} settled units should occupy distinct tiles (got ${tileKeys.size})`,
      ).toBe(n);
    });
  }

  it("20-unit settled radius is far below the old jammed figure (< 6 tiles)", () => {
    // Direct guard on the exact pathology the review flagged: the jammed
    // implementation settled 20 units into a line of radius ~8 (on-goal) to
    // ~13.8 (in the reviewer's probe). The packed-cluster fix keeps it well
    // under 6. This single absolute bound fails the old impl and passes the new.
    const world = makeOpenWorld(40, 40, 123);
    const goal = { x: 24, y: 24 };
    const units: Unit[] = [];
    for (let i = 0; i < 20; i++) {
      units.push(spawnUnit(world, goal.x + 0.5, goal.y + 0.5, moveTo(goal)));
    }

    const result = runToSteadyState(world, units, MAX_TICKS);
    const radius = maxRadiusFromGoal(units, goal);

    expect(result.allStop, "every unit must reach stop").toBe(true);
    expect(result.maxMove, "formation must be exactly fixed (max move == 0)").toBe(0);
    expect(
      radius,
      `20-unit settled cluster radius (${radius.toFixed(2)}) must be well under the old ~8–13.8 jam`,
    ).toBeLessThan(6);
  });

  it("a streaming approach (units converging from afar) also settles bounded and stable", () => {
    // A second geometry: a 5-wide block marching in from one corner. Confirms
    // the bound is not specific to the on-goal start.
    const world = makeOpenWorld(40, 40, 123);
    const goal = { x: 30, y: 30 };
    const n = 20;
    const units: Unit[] = [];
    let i = 0;
    for (let r = 0; i < n; r++) {
      for (let c = 0; c < 5 && i < n; c++, i++) {
        units.push(spawnUnit(world, 5.5 + c * 0.6, 5.5 + r * 0.6, moveTo(goal)));
      }
    }

    const result = runToSteadyState(world, units, MAX_TICKS);
    const radius = maxRadiusFromGoal(units, goal);

    expect(result.allStop, "every streaming unit must reach stop").toBe(true);
    expect(result.maxMove, "streaming group must be exactly fixed (max move == 0)").toBe(0);
    expect(
      radius,
      `streaming 20-unit settled radius (${radius.toFixed(2)}) must stay within 1.5·√20`,
    ).toBeLessThanOrEqual(1.5 * Math.sqrt(n));
  });
});

// ---------------------------------------------------------------------------
// (b2) Re-target: a settled group ordered to a NEW goal fully relocates
// ---------------------------------------------------------------------------
//
// The round-2 implementation left a stale cached A* path on each unit when a
// fresh `move` order was issued, so a unit that had settled (or was still
// orbiting) at goal A followed that stale path and STRANDED near A instead of
// re-pathing to goal B (the reviewer saw 2/12 stranded). The fix clears all
// arrival/slot/pin/stall state on a re-target so every unit re-resolves a slot
// at B and re-paths. These tests settle a group at A, re-order it to B, and
// assert: (1) every unit reaches the hardened fixed point (all `stop`, max-move
// == 0) at B; (2) NONE remain stranded near A; (3) the relocated cluster is
// bounded ~√N around B with distinct tiles.

describe("(b2) re-target: a group settled at A and re-ordered to B fully relocates", () => {
  const MAX_TICKS = 1500;

  for (const n of [12, 20]) {
    it(`${n} units settled at A then ordered to B all relocate to B (none stranded at A)`, () => {
      const world = makeOpenWorld(60, 60, 123);
      const goalA = { x: 15, y: 15 };
      const goalB = { x: 45, y: 45 };

      const units: Unit[] = [];
      for (let i = 0; i < n; i++) {
        units.push(spawnUnit(world, goalA.x + 0.5, goalA.y + 0.5, moveTo(goalA)));
      }

      // Settle at A under the WEAK predicate (per-tick max move < 1e-3) — the
      // exact point the reviewer re-targeted from. On the round-2 impl this fires
      // while a couple of units are still ORBITING with a stale non-empty path;
      // re-targeting then strands them. The fix must relocate every unit anyway.
      runToWeakSteadyState(world, units, MAX_TICKS);

      // Re-target every unit to B. A fresh move order must clear ALL prior
      // arrival/slot/pin/stall state (including any surviving cached path) so each
      // unit re-paths to B instead of following a stale path back toward A.
      for (const u of units) u.order = moveTo(goalB);

      const settledB = runToSteadyState(world, units, MAX_TICKS);

      // (1) Hardened fixed point at B.
      expect(
        settledB.allStop,
        `after re-target every unit must reach stop (none left in move) within ${MAX_TICKS} ticks`,
      ).toBe(true);
      expect(
        settledB.maxMove,
        `re-located formation must be exactly fixed (max-per-tick move == 0)`,
      ).toBe(0);

      // (2) NONE stranded near A: every unit must be far from A and near B.
      const nearA = units.filter(
        (u) => Math.hypot(u.pos.x - (goalA.x + 0.5), u.pos.y - (goalA.y + 0.5)) < 10,
      ).length;
      expect(nearA, `no unit may remain stranded near A (got ${nearA})`).toBe(0);

      const radiusB = maxRadiusFromGoal(units, goalB);
      const boundB = 1.5 * Math.sqrt(n);
      expect(
        radiusB,
        `all ${n} units must cluster within ${boundB.toFixed(2)} of B (got radius ${radiusB.toFixed(2)})`,
      ).toBeLessThanOrEqual(boundB);

      // (3) Distinct tiles at B (packed cluster, one unit per tile).
      const tilesB = new Set(
        units.map((u) => `${Math.floor(u.pos.x)},${Math.floor(u.pos.y)}`),
      );
      expect(
        tilesB.size,
        `all ${n} relocated units should occupy distinct tiles (got ${tilesB.size})`,
      ).toBe(n);
    });
  }

  it("re-target is deterministic: two identical settle-A-then-B runs match exactly", () => {
    const build = () => {
      const world = makeOpenWorld(60, 60, 123);
      const goalA = { x: 15, y: 15 };
      const goalB = { x: 45, y: 45 };
      const units: Unit[] = [];
      for (let i = 0; i < 16; i++) {
        units.push(spawnUnit(world, goalA.x + 0.5, goalA.y + 0.5, moveTo(goalA)));
      }
      runToWeakSteadyState(world, units, MAX_TICKS);
      for (const u of units) u.order = moveTo(goalB);
      runToSteadyState(world, units, MAX_TICKS);
      return world;
    };
    expect(posSnapshot(build())).toBe(posSnapshot(build()));
  });
});

// ---------------------------------------------------------------------------
// (c) Determinism: same world + seed => identical positions after N steps
// ---------------------------------------------------------------------------

describe("(c) determinism: identical seed + orders => identical unit positions", () => {
  /** Number of steps to compare. */
  const N = 120; // 4 simulated seconds

  it("two independently-built worlds with the same seed produce identical positions after N steps", () => {
    // Use a full createWorld so we exercise the real world RNG path.
    const seed = 0xbeef;
    const buildA = () => {
      const w = createWorld(seed, 0, "human", 2, 24, 24);
      // Add a few extra units with move orders so movement logic is exercised.
      const units = [...w.units.values()];
      for (const u of units.slice(0, 3)) {
        u.order = moveTo({ x: 12, y: 12 });
      }
      return w;
    };

    const worldA = buildA();
    const worldB = buildA();

    // Confirm they start equal.
    expect(posSnapshot(worldA)).toBe(posSnapshot(worldB));

    for (let i = 0; i < N; i++) {
      stepWorld(worldA);
      stepWorld(worldB);
    }

    expect(
      posSnapshot(worldA),
      "positions must be identical after N steps with the same seed",
    ).toBe(posSnapshot(worldB));
    expect(worldA.tick).toBe(N);
    expect(worldB.tick).toBe(N);
  });

  it("movement phase alone is deterministic across two identical open worlds", () => {
    const buildC = () => {
      const w = makeOpenWorld(20, 20, 99);
      // 4 units moving toward the same target.
      const goal = { x: 15, y: 15 };
      spawnUnit(w, 2.5, 2.5, moveTo(goal));
      spawnUnit(w, 3.0, 2.5, moveTo(goal));
      spawnUnit(w, 2.5, 3.0, moveTo(goal));
      spawnUnit(w, 3.0, 3.0, moveTo(goal));
      return w;
    };

    const wc1 = buildC();
    const wc2 = buildC();

    expect(posSnapshot(wc1)).toBe(posSnapshot(wc2));

    for (let i = 0; i < N; i++) {
      phaseMovement(wc1);
      phaseMovement(wc2);
    }

    expect(posSnapshot(wc1)).toBe(posSnapshot(wc2));
  });
});

// ---------------------------------------------------------------------------
// Additional: single unit moves to target and goes idle
// ---------------------------------------------------------------------------

describe("single unit path-following", () => {
  it("a unit with a move order reaches the target tile and becomes idle", () => {
    const world = makeOpenWorld(20, 20, 5);
    const goal = { x: 15, y: 15 };
    const unit = spawnUnit(world, 2.5, 2.5, moveTo(goal));

    // moveSpeed=3 tiles/s, SIM_HZ=30 → 0.1 tiles/tick
    // Euclidean distance ≈ 18 tiles; needs ~180 ticks with margin.
    const MAX_TICKS = 400;
    let arrived = false;
    for (let t = 0; t < MAX_TICKS; t++) {
      phaseMovement(world);
      // The movement phase clears the order to idle when the path is exhausted.
      if (unit.order.kind === "stop") {
        arrived = true;
        break;
      }
    }

    expect(arrived, "unit should reach the target tile and go idle").toBe(true);
    // Confirm the unit ended up near the goal.
    const dx = unit.pos.x - (goal.x + 0.5);
    const dy = unit.pos.y - (goal.y + 0.5);
    expect(Math.sqrt(dx * dx + dy * dy)).toBeLessThan(2.0);
    expect(unit.order.kind).toBe("stop");
  });
});

// ===========================================================================
// COMPREHENSIVE ADVERSARIAL MOVEMENT STRESS-TEST
// ===========================================================================
//
// Consolidates every scenario prior review rounds surfaced, so no fix regresses
// another:
//   S1. Groups of N∈{5,10,20} to one tile (incl. all-stacked-on-goal): every
//       unit `stop`, max-per-tick move == 0 HELD over +500 tail ticks, bounded
//       radius ~√N, distinct tiles.
//   S2. Re-target a settled group A→B at multiple A/B positions and sizes: all
//       relocate to B, ZERO stranded at A.
//   S3. Transit PAST a settled cluster (round-4 regression): a lone unit ordered
//       straight through a settled 9-unit cluster REACHES its goal within a
//       bounded number of ticks (never livelocks); plus a fully-WALLING ring case
//       where it must instead SETTLE (stop) near the cluster, still never frozen
//       in `move`.
//   S4. Determinism: two same-seed worlds bit-identical after N full stepWorld
//       steps (covered by the (c) suite above; reasserted here via phaseMovement
//       on the transit scenario).
//   S5. Single-unit pathing + passing AROUND a terrain wall still work.

/**
 * Steps `phaseMovement` until every unit's order is `stop` and the per-tick max
 * displacement is exactly 0 (the hardened fixed point), returns the tick it
 * settled, or -1 if it did not within `maxTicks`.
 */
function settleClusterTicks(world: World, units: Unit[], maxTicks: number): number {
  const r = runToSteadyState(world, units, maxTicks);
  return r.settled ? r.ticks : -1;
}

/** Spawns `n` units stacked on `goal`'s centre with a move order to `goal`. */
function spawnStackedGroup(world: World, n: number, goal: { x: number; y: number }): Unit[] {
  const units: Unit[] = [];
  for (let i = 0; i < n; i++) {
    units.push(spawnUnit(world, goal.x + 0.5, goal.y + 0.5, moveTo(goal)));
  }
  return units;
}

/** Largest single-tick displacement across `units` over `ticks` more phases. */
function maxMoveOverTail(world: World, units: Unit[], ticks: number): number {
  let worst = 0;
  for (let t = 0; t < ticks; t++) {
    const before = units.map((u) => ({ x: u.pos.x, y: u.pos.y }));
    phaseMovement(world);
    for (let i = 0; i < units.length; i++) {
      worst = Math.max(
        worst,
        Math.hypot(units[i].pos.x - before[i].x, units[i].pos.y - before[i].y),
      );
    }
  }
  return worst;
}

describe("STRESS S1: groups to one tile reach an EXACT, STABLE fixed point", () => {
  const MAX_TICKS = 900;
  const TAIL_TICKS = 500;

  for (const n of [5, 10, 20]) {
    it(`${n} stacked units settle, then hold max-move==0 + all-stop over +${TAIL_TICKS} tail ticks`, () => {
      const world = makeOpenWorld(40, 40, 123);
      const goal = { x: 20, y: 20 };
      const units = spawnStackedGroup(world, n, goal);

      const ticks = settleClusterTicks(world, units, MAX_TICKS);
      expect(ticks, `group of ${n} must reach the hardened fixed point`).toBeGreaterThan(0);

      // Tail: the formation must remain EXACTLY fixed and fully stopped.
      const tailMax = maxMoveOverTail(world, units, TAIL_TICKS);
      expect(
        tailMax,
        `settled formation must not move at all over +${TAIL_TICKS} ticks (got ${tailMax.toExponential(2)})`,
      ).toBe(0);
      expect(
        units.every((u) => u.order.kind === "stop"),
        "every unit must remain stopped through the tail",
      ).toBe(true);

      // Bounded radius ~√N and distinct tiles.
      const radius = maxRadiusFromGoal(units, goal);
      expect(
        radius,
        `radius ${radius.toFixed(2)} must stay within 1.5·√${n}`,
      ).toBeLessThanOrEqual(1.5 * Math.sqrt(n));
      const tiles = new Set(units.map((u) => `${Math.floor(u.pos.x)},${Math.floor(u.pos.y)}`));
      expect(tiles.size, `all ${n} units occupy distinct tiles`).toBe(n);
    });
  }
});

describe("STRESS S2: re-target a settled group A→B (multiple positions/sizes) — none stranded at A", () => {
  const MAX_TICKS = 1500;

  // Several A/B geometries and sizes; each must fully relocate with zero stranded.
  const cases: { a: { x: number; y: number }; b: { x: number; y: number }; n: number }[] = [
    { a: { x: 15, y: 15 }, b: { x: 45, y: 45 }, n: 12 },
    { a: { x: 45, y: 15 }, b: { x: 15, y: 45 }, n: 16 },
    { a: { x: 30, y: 10 }, b: { x: 30, y: 50 }, n: 20 },
    { a: { x: 10, y: 30 }, b: { x: 50, y: 30 }, n: 8 },
  ];

  for (const { a, b, n } of cases) {
    it(`${n} units settled at (${a.x},${a.y}) relocate to (${b.x},${b.y}) with none stranded`, () => {
      const world = makeOpenWorld(60, 60, 123);
      const units = spawnStackedGroup(world, n, a);

      // Settle at A under the weak predicate — the exact re-target trigger point.
      runToWeakSteadyState(world, units, MAX_TICKS);
      for (const u of units) u.order = moveTo(b);

      const res = runToSteadyState(world, units, MAX_TICKS);
      expect(res.allStop, "every unit must reach stop at B").toBe(true);
      expect(res.maxMove, "relocated formation must be exactly fixed").toBe(0);

      const nearA = units.filter(
        (u) => Math.hypot(u.pos.x - (a.x + 0.5), u.pos.y - (a.y + 0.5)) < 10,
      ).length;
      expect(nearA, `no unit may remain stranded near A (got ${nearA})`).toBe(0);

      const radiusB = maxRadiusFromGoal(units, b);
      expect(radiusB, `cluster at B within 1.5·√${n}`).toBeLessThanOrEqual(1.5 * Math.sqrt(n));
      const tilesB = new Set(units.map((u) => `${Math.floor(u.pos.x)},${Math.floor(u.pos.y)}`));
      expect(tilesB.size, `all ${n} units on distinct tiles at B`).toBe(n);
    });
  }
});

describe("STRESS S3: a unit in transit PAST a settled cluster reaches its goal (no livelock)", () => {
  // The round-4 regression: a lone unit ordered straight through a settled 9-unit
  // cluster used to halt at a separation equilibrium just short of the cluster and
  // stay in `order=move` forever (A* is unit-blind; the pinned bodies wall the
  // path; the slot force-settle only fires near the goal). The dynamic re-path
  // must route it AROUND the cluster to the goal.
  it("lone traveller crosses a settled 9-unit cluster and reaches the far goal", () => {
    const world = makeOpenWorld(60, 60, 123);
    const cluster = { x: 30, y: 30 };
    const clusterUnits = spawnStackedGroup(world, 9, cluster);
    const settled = settleClusterTicks(world, clusterUnits, 2000);
    expect(settled, "the 9-unit cluster must settle first").toBeGreaterThan(0);

    // Sanity: the cluster really does sit astride the straight line y≈30 the
    // traveller's naive path would take (otherwise the test would not exercise
    // the regression).
    const onRow = clusterUnits.some((u) => Math.floor(u.pos.y) === 30 && Math.floor(u.pos.x) < 32);
    expect(onRow, "cluster must occupy tiles on the traveller's straight-line path").toBe(true);

    const goal = { x: 57, y: 30 };
    const traveller = spawnUnit(world, 2.5, 30.5, moveTo(goal));

    const BUDGET = 600; // open 60×60 map: routing around a 3×3 block is ~270 ticks
    let arrivedTick = -1;
    for (let t = 0; t < BUDGET; t++) {
      phaseMovement(world);
      const d = Math.hypot(traveller.pos.x - (goal.x + 0.5), traveller.pos.y - (goal.y + 0.5));
      if (traveller.order.kind === "stop" && d < 2.0) {
        arrivedTick = t + 1;
        break;
      }
    }

    expect(
      arrivedTick,
      `traveller must reach its goal within ${BUDGET} ticks (livelock ⇒ -1)`,
    ).toBeGreaterThan(0);
    // Ends STOPPED near the goal — not frozen mid-route in `move`.
    expect(traveller.order.kind, "traveller must end stopped, not stuck in move").toBe("stop");
    const dGoal = Math.hypot(traveller.pos.x - (goal.x + 0.5), traveller.pos.y - (goal.y + 0.5));
    expect(dGoal, "traveller must end near the goal").toBeLessThan(2.0);
    // The settled cluster must still be exactly fixed and stopped afterward.
    expect(clusterUnits.every((u) => u.order.kind === "stop"), "cluster stays settled").toBe(true);
  });

  it("traveller transit is deterministic across two identical runs", () => {
    const build = () => {
      const world = makeOpenWorld(60, 60, 123);
      const cluster = { x: 30, y: 30 };
      const clusterUnits = spawnStackedGroup(world, 9, cluster);
      settleClusterTicks(world, clusterUnits, 2000);
      spawnUnit(world, 2.5, 30.5, moveTo({ x: 57, y: 30 }));
      for (let t = 0; t < 600; t++) phaseMovement(world);
      return world;
    };
    expect(posSnapshot(build())).toBe(posSnapshot(build()));
  });

  it("a unit fully ENCLOSED by a pinned ring (no route out) SETTLES (stop), never frozen in move", () => {
    // The hardest walled case, exercising the no-route fallback directly: 8
    // settled units form a solid ring around the centre tile; a traveller sitting
    // on that centre is ordered OUT. Every escape tile is a pinned body, so A*
    // (with pinned tiles blocked) returns null — the unit must terminate by
    // settling in place rather than spinning forever in `move`.
    const world = makeOpenWorld(40, 40, 123);
    const ringTiles = [
      { x: 19, y: 19 }, { x: 20, y: 19 }, { x: 21, y: 19 },
      { x: 19, y: 20 }, { x: 21, y: 20 },
      { x: 19, y: 21 }, { x: 20, y: 21 }, { x: 21, y: 21 },
    ];
    const ring: Unit[] = [];
    for (const t of ringTiles) ring.push(spawnUnit(world, t.x + 0.5, t.y + 0.5, moveTo(t)));
    // Each unit starts on its own goal tile, so the ring settles within a couple
    // of ticks; assert it is fully pinned before trapping the traveller.
    for (let i = 0; i < 50; i++) {
      phaseMovement(world);
      if (ring.every((u) => u.order.kind === "stop")) break;
    }
    expect(ring.every((u) => u.order.kind === "stop"), "ring must be fully settled").toBe(true);

    const traveller = spawnUnit(world, 20.5, 20.5, moveTo({ x: 5, y: 5 }));

    const BUDGET = 1200;
    let stoppedTick = -1;
    for (let t = 0; t < BUDGET; t++) {
      phaseMovement(world);
      if (traveller.order.kind === "stop") {
        stoppedTick = t + 1;
        break;
      }
    }
    expect(
      stoppedTick,
      `enclosed traveller must SETTLE (stop) within ${BUDGET} ticks (no route out)`,
    ).toBeGreaterThan(0);
    expect(traveller.order.kind, "must end stopped, never frozen in move").toBe("stop");
    expect(traveller.pinned, "must pin at its resting tile").toBe(true);

    // It must hold that fixed point: no further motion, still stopped.
    const tail = maxMoveOverTail(world, [traveller, ...ring], 200);
    expect(tail, "walled-then-settled traveller must stay exactly fixed").toBe(0);
  });
});

describe("STRESS S5: single-unit pathing and passing AROUND a terrain wall", () => {
  it("a single unit routes around a long terrain wall to reach its goal", () => {
    const world = makeOpenWorld(40, 40, 123);
    // A vertical rock wall at x=20 spanning y=0..34, leaving a gap at the bottom.
    for (let y = 0; y <= 34; y++) world.map.terrain.set(20, y, "rock");

    const goal = { x: 35, y: 5 };
    const unit = spawnUnit(world, 5.5, 5.5, moveTo(goal));

    const BUDGET = 1200;
    let arrived = false;
    for (let t = 0; t < BUDGET; t++) {
      phaseMovement(world);
      if (unit.order.kind === "stop") {
        arrived = true;
        break;
      }
    }
    expect(arrived, "unit must route around the wall and stop at the goal").toBe(true);
    expect(
      Math.hypot(unit.pos.x - (goal.x + 0.5), unit.pos.y - (goal.y + 0.5)),
      "unit must end at the goal",
    ).toBeLessThan(2.0);
    // It must have actually crossed to the far side of the wall.
    expect(unit.pos.x, "unit must be on the far side of the wall (x>20)").toBeGreaterThan(20);
  });

  it("two units swapping past each other both reach their (distinct) goals", () => {
    // Passing-around sanity: two units crossing in opposite directions must both
    // settle at their distinct destinations without deadlocking on each other.
    const world = makeOpenWorld(40, 40, 123);
    const goalA = { x: 30, y: 10 };
    const goalB = { x: 10, y: 10 };
    const a = spawnUnit(world, 10.5, 10.5, moveTo(goalA));
    const b = spawnUnit(world, 30.5, 10.5, moveTo(goalB));

    const BUDGET = 800;
    for (let t = 0; t < BUDGET; t++) {
      phaseMovement(world);
      if (a.order.kind === "stop" && b.order.kind === "stop") break;
    }
    expect(a.order.kind, "unit A must reach its goal and stop").toBe("stop");
    expect(b.order.kind, "unit B must reach its goal and stop").toBe("stop");
    expect(Math.hypot(a.pos.x - (goalA.x + 0.5), a.pos.y - (goalA.y + 0.5))).toBeLessThan(2.0);
    expect(Math.hypot(b.pos.x - (goalB.x + 0.5), b.pos.y - (goalB.y + 0.5))).toBeLessThan(2.0);
  });
});
