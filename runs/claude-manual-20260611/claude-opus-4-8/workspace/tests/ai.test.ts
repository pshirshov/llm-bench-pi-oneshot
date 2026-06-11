/**
 * T16 — scripted AI opponent acceptance tests.
 *
 * These run the FULL simulation headless (createWorld + stepWorld), with the AI
 * controlling one faction and NO human input, and assert the three behaviours
 * the spec requires of the AI opponent:
 *   (a) it expands its economy — worker count AND building count grow from the
 *       opening over a multi-minute run;
 *   (b) it dispatches at least one attack wave toward the player's base within
 *       the difficulty's window (military units receive an attackMove order
 *       targeting the player-base region);
 *   (c) a destroyed AI building triggers a rebuild — a build order for the lost
 *       building kind is issued (and the building reappears).
 *
 * Plus a determinism guard: two same-seed worlds stepped INTERLEAVED stay
 * bit-identical with the AI phase active (the AI must not introduce any
 * module-level state or unseeded randomness).
 *
 * Tick budgets are tuned so the whole file runs in a few seconds: difficulty 5
 * (earliest, ~1-minute first wave) is used for the wave + growth assertions to
 * keep the run short, and the rebuild assertion only needs the early economy.
 */

import { describe, it, expect } from "vitest";
import { createWorld } from "../src/sim/world.js";
import type { World } from "../src/sim/world.js";
import { stepWorld, SIM_HZ } from "../src/sim/simulation.js";
import type { Faction, UnitKind } from "../src/game/types.js";

const SEED = 0xabcde;
const LEVEL = 0;
const WIDTH = 48;
const HEIGHT = 48;

/** The AI-controlled faction for a given player faction (the opponent). */
function aiFactionFor(playerFaction: Faction): Faction {
  return playerFaction === "human" ? "orc" : "human";
}

/** Count of `faction` workers currently alive. */
function workerCount(world: World, faction: Faction): number {
  let n = 0;
  for (const u of world.units.values()) {
    if (u.owner === faction && u.kind === "worker") n++;
  }
  return n;
}

/** Count of `faction` military (non-worker) units currently alive. */
function militaryCount(world: World, faction: Faction): number {
  let n = 0;
  for (const u of world.units.values()) {
    if (u.owner === faction && u.kind !== "worker") n++;
  }
  return n;
}

/** Count of completed buildings owned by `faction`. */
function completedBuildingCount(world: World, faction: Faction): number {
  let n = 0;
  for (const b of world.buildings.values()) {
    if (b.owner === faction && b.buildProgress >= 1) n++;
  }
  return n;
}

/** Distinct completed building kinds owned by `faction`. */
function buildingKinds(world: World, faction: Faction): Set<string> {
  const s = new Set<string>();
  for (const b of world.buildings.values()) {
    if (b.owner === faction && b.buildProgress >= 1) s.add(b.kind);
  }
  return s;
}

/** The player faction's base center tile (Town Hall center, else its start). */
function playerBaseCenter(world: World): { x: number; y: number } {
  const pf = world.playerFaction;
  let hall: { x: number; y: number } | null = null;
  for (const b of world.buildings.values()) {
    if (b.owner === pf && b.kind === "townHall") {
      hall = { x: b.tile.x + b.footprint.w / 2, y: b.tile.y + b.footprint.h / 2 };
      break;
    }
  }
  if (hall !== null) return hall;
  const s = world.mapReport.starts[0];
  return { x: s.x, y: s.y };
}

/**
 * Plain serialisable snapshot of the simulation-mutable state, used to assert
 * two interleaved same-seed worlds stay identical with the AI active. Mirrors
 * the determinism snapshot used elsewhere; includes orders so an AI that issued
 * a divergent order would be caught.
 */
function snapshot(world: World): string {
  const units = [...world.units.values()]
    .map((u) => ({
      id: u.id,
      owner: u.owner,
      kind: u.kind,
      hp: u.hp,
      x: u.pos.x,
      y: u.pos.y,
      order: u.order,
    }))
    .sort((a, b) => a.id - b.id);
  const buildings = [...world.buildings.values()]
    .map((b) => ({ id: b.id, owner: b.owner, kind: b.kind, hp: b.hp, progress: b.buildProgress }))
    .sort((a, b) => a.id - b.id);
  return JSON.stringify({
    tick: world.tick,
    nextEntityId: world.nextEntityId,
    players: world.players,
    units,
    buildings,
  });
}

describe("AI opponent: economy expansion", () => {
  it("grows worker count AND building count from the opening over a multi-minute run", () => {
    // Difficulty 5: fastest ramp, so a ~2-minute headless run shows clear growth.
    const world = createWorld(SEED, LEVEL, "human", 5, WIDTH, HEIGHT);
    const ai = aiFactionFor("human");

    const startWorkers = workerCount(world, ai);
    const startBuildings = completedBuildingCount(world, ai);
    expect(startWorkers).toBeGreaterThan(0);
    expect(startBuildings).toBe(1); // just the opening Town Hall

    // ~2 minutes of simulated time.
    const STEPS = 2 * 60 * SIM_HZ; // 3600 ticks
    for (let t = 0; t < STEPS; t++) stepWorld(world);

    const endWorkers = workerCount(world, ai);
    const endBuildings = completedBuildingCount(world, ai);

    // (a) ECONOMY GREW: more workers AND more buildings than at the start.
    expect(endWorkers).toBeGreaterThan(startWorkers);
    expect(endBuildings).toBeGreaterThan(startBuildings);

    // It followed the build order far enough to raise the military infrastructure.
    const kinds = buildingKinds(world, ai);
    expect(kinds.has("farm")).toBe(true);
    expect(kinds.has("barracks")).toBe(true);

    // And it is producing a standing army off that infrastructure.
    expect(militaryCount(world, ai)).toBeGreaterThan(0);
  });
});

describe("AI opponent: escalating attack waves", () => {
  it("dispatches military toward the player base within the difficulty window", () => {
    // Difficulty 5 launches the first wave ~1 minute in; cap the run at 3 minutes.
    const world = createWorld(SEED, LEVEL, "human", 5, WIDTH, HEIGHT);
    const ai = aiFactionFor("human");
    const base = playerBaseCenter(world);

    const MAX_STEPS = 3 * 60 * SIM_HZ; // 5400 ticks
    let waveTick = -1;
    let bestTowardBase = Number.POSITIVE_INFINITY;

    for (let t = 1; t <= MAX_STEPS && waveTick < 0; t++) {
      stepWorld(world);
      // A wave = an AI military unit ordered to attackMove toward the player base.
      for (const u of world.units.values()) {
        if (u.owner !== ai || u.kind === "worker") continue;
        if (u.order.kind !== "attackMove") continue;
        const tx = u.order.targetPos.x;
        const ty = u.order.targetPos.y;
        const d = Math.max(Math.abs(tx - base.x), Math.abs(ty - base.y));
        bestTowardBase = Math.min(bestTowardBase, d);
        // The wave target must be the player-base REGION (not a local skirmish):
        // attackMove waves are issued at the player Town Hall / start tile.
        if (d <= 6) {
          waveTick = t;
          break;
        }
      }
    }

    // (b) A wave was dispatched, and it targets the player-base region.
    expect(waveTick, "no AI attack wave reached the player base within 3 minutes").toBeGreaterThan(0);
    expect(bestTowardBase).toBeLessThanOrEqual(6);
    // First wave at difficulty 5 is ~1 min in; assert it is within a generous
    // upper window (well under the 3-minute cap) to confirm timely aggression.
    expect(waveTick).toBeLessThanOrEqual(2 * 60 * SIM_HZ);
  });

  it("first wave at difficulty 1 is later than at difficulty 5 (cadence scales)", () => {
    function firstWaveTick(difficulty: 1 | 5, maxSteps: number): number {
      const world = createWorld(SEED, LEVEL, "human", difficulty, WIDTH, HEIGHT);
      const ai = aiFactionFor("human");
      for (let t = 1; t <= maxSteps; t++) {
        stepWorld(world);
        for (const u of world.units.values()) {
          if (u.owner === ai && u.kind !== "worker" && u.order.kind === "attackMove") return t;
        }
      }
      return -1;
    }
    const d5 = firstWaveTick(5, 3 * 60 * SIM_HZ);
    expect(d5).toBeGreaterThan(0);
    // At d1 the first-wave GATE alone is 4 minutes; within a 3-minute run the AI
    // must NOT have launched yet, proving cadence scales with difficulty.
    const d1Early = firstWaveTick(1, 3 * 60 * SIM_HZ);
    expect(d1Early).toBe(-1);
    expect(d5).toBeLessThan(3 * 60 * SIM_HZ);
  });
});

describe("AI opponent: rebuild on destruction", () => {
  it("re-issues a build order when its Barracks is destroyed", () => {
    const world = createWorld(SEED, LEVEL, "human", 4, WIDTH, HEIGHT);
    const ai = aiFactionFor("human");

    // Ramp until the AI has a completed Barracks.
    let barracksId = -1;
    for (let t = 1; t <= 3000 && barracksId < 0; t++) {
      stepWorld(world);
      for (const b of world.buildings.values()) {
        if (b.owner === ai && b.kind === "barracks" && b.buildProgress >= 1) {
          barracksId = b.id;
          break;
        }
      }
    }
    expect(barracksId, "AI never built a Barracks to destroy").toBeGreaterThan(0);

    // Destroy it (cleanup removes it next tick).
    world.buildings.get(barracksId as never)!.hp = 0;

    // (c) The AI must REBUILD: a fresh build order for a Barracks is issued and a
    // new Barracks construction site appears.
    let rebuildOrderIssued = false;
    let barracksPresentAgain = false;
    for (let t = 1; t <= 2000; t++) {
      stepWorld(world);
      for (const u of world.units.values()) {
        if (u.owner === ai && u.order.kind === "build" && u.order.buildingKind === "barracks") {
          rebuildOrderIssued = true;
        }
      }
      const hasBarracks = [...world.buildings.values()].some(
        (b) => b.owner === ai && b.kind === "barracks",
      );
      if (hasBarracks) {
        barracksPresentAgain = true;
        break;
      }
    }
    expect(rebuildOrderIssued).toBe(true);
    expect(barracksPresentAgain).toBe(true);
  });

  it("re-issues a build order when its Town Hall is destroyed", () => {
    const world = createWorld(SEED, LEVEL, "human", 4, WIDTH, HEIGHT);
    const ai = aiFactionFor("human");

    // Let the economy ramp a little so it can afford a rebuild.
    for (let t = 1; t <= 1500; t++) stepWorld(world);
    const hall = [...world.buildings.values()].find((b) => b.owner === ai && b.kind === "townHall");
    expect(hall).toBeDefined();
    hall!.hp = 0;

    let rebuildOrderIssued = false;
    for (let t = 1; t <= 2000 && !rebuildOrderIssued; t++) {
      stepWorld(world);
      for (const u of world.units.values()) {
        if (u.owner === ai && u.order.kind === "build" && u.order.buildingKind === "townHall") {
          rebuildOrderIssued = true;
          break;
        }
      }
    }
    expect(rebuildOrderIssued, "AI did not issue a Town Hall rebuild order").toBe(true);
  });
});

describe("AI opponent: determinism with the AI phase active", () => {
  it("two same-seed worlds stepped interleaved stay bit-identical", () => {
    const a = createWorld(SEED, LEVEL, "human", 3, WIDTH, HEIGHT);
    const b = createWorld(SEED, LEVEL, "human", 3, WIDTH, HEIGHT);

    expect(snapshot(a)).toBe(snapshot(b));

    // Interleave the two worlds' steps. If the AI held any module-level state or
    // drew unseeded randomness, the two would diverge.
    const N = 1200; // 40 s — enough for several think passes, worker training, build orders
    for (let i = 0; i < N; i++) {
      stepWorld(a);
      stepWorld(b);
    }

    expect(snapshot(a)).toBe(snapshot(b));
    expect(a.tick).toBe(N);
    expect(b.tick).toBe(N);

    // Sanity: the AI actually DID something in this window (so the determinism
    // check is non-vacuous — it exercised the AI's order-issuing paths).
    const ai = aiFactionFor("human");
    const grewOrActed =
      workerCount(a, ai) > 4 || completedBuildingCount(a, ai) > 1 || militaryCount(a, ai) > 0;
    expect(grewOrActed).toBe(true);
  });

  it("the same UnitKind army-composition choice is reproduced across identical worlds", () => {
    // A second determinism angle: build two worlds, advance both NON-interleaved
    // to the same tick, and assert their full unit-kind multisets match — catches
    // any divergence in the AI's army-mix selection (a Record iteration / RNG bug).
    const mk = (): World => createWorld(SEED, LEVEL, "human", 4, WIDTH, HEIGHT);
    const a = mk();
    const b = mk();
    const N = 2400; // 80 s
    for (let i = 0; i < N; i++) stepWorld(a);
    for (let i = 0; i < N; i++) stepWorld(b);

    const census = (w: World, faction: Faction): Record<UnitKind, number> => {
      const c: Record<UnitKind, number> = { worker: 0, infantry: 0, ranged: 0, heavy: 0 };
      for (const u of w.units.values()) if (u.owner === faction) c[u.kind]++;
      return c;
    };
    const ai = aiFactionFor("human");
    expect(census(a, ai)).toEqual(census(b, ai));
  });
});
