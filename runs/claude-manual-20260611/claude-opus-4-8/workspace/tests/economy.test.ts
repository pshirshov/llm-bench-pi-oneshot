/**
 * T10 economy phase tests.
 *
 * Covers:
 *  (a) Supply used/cap accounting — Town Hall + Farm set cap; training a unit
 *      raises supplyUsed.
 *  (b) Training BLOCKED when supplyUsed would exceed supplyCap.
 *  (c) Training deducts gold/wood + reserves supply; CANCEL refunds both.
 *  (d) A forest tile depletes to dirt after its wood is harvested and the
 *      worker deposits the wood to the player total.
 *  (e) Prerequisite enforcement blocks training a ranged unit with no Lumber
 *      Mill, and allows it once one exists.
 */

import { describe, it, expect } from "vitest";
import { vec } from "../src/core/vec.js";
import { makeEntityId } from "../src/game/types.js";
import type { Faction } from "../src/game/types.js";
import type { Building, Unit } from "../src/sim/entity.js";
import { phaseEconomy } from "../src/sim/economy.js";
import { getBuildingStats, getUnitStats } from "../src/sim/stats.js";
import { idle } from "../src/sim/orders.js";
import { GameMap } from "../src/sim/gamemap.js";
import { Grid } from "../src/core/grid.js";
import type { TileType } from "../src/wfc/tiles.js";
import { createRng } from "../src/core/rng.js";
import type { World } from "../src/sim/world.js";
import type { PlayerState } from "../src/sim/world.js";

// ---------------------------------------------------------------------------
// Minimal world factory for unit tests
// ---------------------------------------------------------------------------

function makeGrid(w: number, h: number, fill: TileType = "grass"): Grid<TileType> {
  const g = new Grid<TileType>(w, h, fill);
  return g;
}

function makePlayer(overrides?: Partial<PlayerState>): PlayerState {
  return {
    gold: 1000,
    wood: 1000,
    supplyUsed: 0,
    supplyCap: 10,
    ...overrides,
  };
}

function makeWorld(
  gridW = 20,
  gridH = 20,
  gridFill: TileType = "grass",
): World {
  const grid = makeGrid(gridW, gridH, gridFill);
  const map = new GameMap(grid);
  const players: Record<Faction, PlayerState> = {
    human: makePlayer(),
    orc: makePlayer(),
  };
  const world: World = {
    map,
    units: new Map(),
    buildings: new Map(),
    projectiles: new Map(),
    players,
    playerFaction: "human",
    aiDifficulty: 1,
    tick: 0,
    rng: createRng(42),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mapReport: { starts: [vec(0, 0), vec(19, 19)] } as any,
    nextEntityId: 1,
    nextId() {
      return makeEntityId(this.nextEntityId++);
    },
  };
  return world;
}

function placeBuilding(
  world: World,
  kind: Building["kind"],
  faction: Faction,
  tile = vec(0, 0),
  buildProgress = 1,
): Building {
  const stats = getBuildingStats(faction, kind);
  const b: Building = {
    id: world.nextId(),
    owner: faction,
    kind,
    hp: buildProgress >= 1 ? stats.hp : Math.max(1, Math.round(buildProgress * stats.hp)),
    maxHp: stats.hp,
    tile,
    footprint: stats.footprint,
    buildProgress,
    trainQueue: [],
  };
  world.buildings.set(b.id, b);
  world.map.occupy(tile, stats.footprint, b.id);
  if (buildProgress >= 1) {
    world.players[faction].supplyCap += stats.supplyProvided;
  }
  return b;
}

function placeUnit(
  world: World,
  kind: Unit["kind"],
  faction: Faction,
  pos = { x: 10.5, y: 10.5 },
): Unit {
  const stats = getUnitStats(faction, kind);
  const u: Unit = {
    id: world.nextId(),
    owner: faction,
    kind,
    hp: stats.hp,
    maxHp: stats.hp,
    pos,
    order: idle(),
    attackCooldown: 0,
  };
  world.units.set(u.id, u);
  world.players[faction].supplyUsed += stats.supplyCost;
  return u;
}

// ---------------------------------------------------------------------------
// (a) Supply used/cap accounting
// ---------------------------------------------------------------------------

describe("supply accounting", () => {
  it("supplyCap equals sum of supplyProvided for completed Town Hall and Farm", () => {
    const world = makeWorld();
    // Start from zero cap.
    world.players.human.supplyCap = 0;

    const hallStats = getBuildingStats("human", "townHall");
    const farmStats = getBuildingStats("human", "farm");

    placeBuilding(world, "townHall", "human", vec(0, 0));
    placeBuilding(world, "farm", "human", vec(5, 5));

    // Run one tick so recomputeSupply fires.
    phaseEconomy(world);

    expect(world.players.human.supplyCap).toBe(
      hallStats.supplyProvided + farmStats.supplyProvided,
    );
  });

  it("supplyUsed reflects live units after economy phase", () => {
    const world = makeWorld();
    world.players.human.supplyUsed = 0;

    // Place 2 workers.
    placeUnit(world, "worker", "human");
    placeUnit(world, "worker", "human");

    const workerCost = getUnitStats("human", "worker").supplyCost;

    phaseEconomy(world);

    expect(world.players.human.supplyUsed).toBe(workerCost * 2);
  });

  it("an under-construction building does NOT contribute supply until complete", () => {
    const world = makeWorld();
    world.players.human.supplyCap = 0;

    const hallStats = getBuildingStats("human", "townHall");

    // Town Hall at 50% progress — should not grant supply yet.
    placeBuilding(world, "townHall", "human", vec(0, 0), 0.5);

    phaseEconomy(world);

    expect(world.players.human.supplyCap).toBe(0);

    // Complete the building.
    const hall = [...world.buildings.values()][0];
    hall.buildProgress = 1;
    hall.hp = hall.maxHp;

    phaseEconomy(world);

    expect(world.players.human.supplyCap).toBe(hallStats.supplyProvided);
  });

  it("training a worker increases supplyUsed by the worker supply cost", () => {
    const world = makeWorld();
    world.players.human.supplyCap = 10;
    world.players.human.supplyUsed = 0;
    world.players.human.gold = 5000;
    world.players.human.wood = 5000;

    const hall = placeBuilding(world, "townHall", "human", vec(0, 0));
    // Override supply cap set by placeBuilding to a fixed value.
    world.players.human.supplyCap = 10;

    // Issue train order.
    hall.order = { kind: "train", unitKind: "worker" };

    const workerStats = getUnitStats("human", "worker");
    const goldBefore = world.players.human.gold;

    phaseEconomy(world);

    // After one tick the job is enqueued (order processed) and gold/supply reserved.
    expect(world.players.human.gold).toBe(goldBefore - workerStats.goldCost);
    expect(world.players.human.supplyUsed).toBe(workerStats.supplyCost);
    expect(hall.trainQueue.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// (b) Training blocked at supply cap
// ---------------------------------------------------------------------------

describe("training blocked at supply cap", () => {
  it("does not enqueue a unit when supplyUsed would exceed supplyCap", () => {
    const world = makeWorld();
    world.players.human.gold = 5000;
    world.players.human.wood = 5000;

    // Town Hall provides 5 supply; place 5 workers to fill the cap exactly.
    const hall = placeBuilding(world, "townHall", "human", vec(0, 0));
    const hallStats = getBuildingStats("human", "townHall");
    // Fill supply with actual units.
    for (let i = 0; i < hallStats.supplyProvided; i++) {
      placeUnit(world, "worker", "human", { x: 11.5 + i * 0.1, y: 11.5 });
    }

    // supplyCap and supplyUsed are now both hallStats.supplyProvided (5).
    // (recomputeSupplyCap will set supplyCap=5; placeUnit incremented supplyUsed by 1 each time)
    hall.order = { kind: "train", unitKind: "worker" };

    const goldBefore = world.players.human.gold;
    phaseEconomy(world);

    // Order should be cleared (blocked), queue still empty, no gold deducted.
    expect(hall.trainQueue.length).toBe(0);
    expect(world.players.human.gold).toBe(goldBefore);
    expect(hall.order?.kind ?? "stop").toBe("stop");
  });

  it("allows training once supply is freed (unit dies removed from world)", () => {
    const world = makeWorld();
    world.players.human.gold = 5000;
    world.players.human.wood = 5000;

    // Town Hall provides 5 supply; place 5 workers to fill the cap.
    const hall = placeBuilding(world, "townHall", "human", vec(0, 0));
    const hallStats = getBuildingStats("human", "townHall");
    const fillerUnits: Unit[] = [];
    for (let i = 0; i < hallStats.supplyProvided; i++) {
      fillerUnits.push(placeUnit(world, "worker", "human", { x: 11.5 + i * 0.1, y: 11.5 }));
    }

    hall.order = { kind: "train", unitKind: "worker" };
    phaseEconomy(world);
    // Still blocked — supply full.
    expect(hall.trainQueue.length).toBe(0);

    // Remove one unit to free a supply slot.
    const removed = fillerUnits[0];
    world.units.delete(removed.id);
    world.players.human.supplyUsed -= getUnitStats("human", "worker").supplyCost;

    hall.order = { kind: "train", unitKind: "worker" };
    phaseEconomy(world);

    // Now it should enqueue.
    expect(hall.trainQueue.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// (c) Training deducts resources and cancel refunds
// ---------------------------------------------------------------------------

describe("training cost deduction and cancel refund", () => {

  it("deducts gold and wood on enqueue and reserves supply", () => {
    const world = makeWorld();
    world.players.human.supplyUsed = 0;
    world.players.human.gold = 1000;
    world.players.human.wood = 1000;

    // Town Hall for supply (supplyProvided=5 → supplyCap=5 after recompute).
    placeBuilding(world, "townHall", "human", vec(8, 8));
    const barracks = placeBuilding(world, "barracks", "human", vec(0, 0));

    const infantryStats = getUnitStats("human", "infantry");

    barracks.order = { kind: "train", unitKind: "infantry" };
    phaseEconomy(world);

    expect(world.players.human.gold).toBe(1000 - infantryStats.goldCost);
    expect(world.players.human.wood).toBe(1000 - infantryStats.woodCost);
    expect(world.players.human.supplyUsed).toBe(infantryStats.supplyCost);
    expect(barracks.trainQueue.length).toBe(1);
  });

  it("cancel (order→stop) refunds gold, wood, and supply for all queued jobs", () => {
    const world = makeWorld();
    world.players.human.supplyUsed = 0;
    world.players.human.gold = 2000;
    world.players.human.wood = 2000;

    // Town Hall + Farm for enough supply for 2 infantry (each costs 1 supply, cap=9).
    placeBuilding(world, "townHall", "human", vec(8, 8));
    placeBuilding(world, "farm", "human", vec(13, 8));
    const barracks = placeBuilding(world, "barracks", "human", vec(0, 0));

    const infantryStats = getUnitStats("human", "infantry");

    // Enqueue two infantry.
    barracks.order = { kind: "train", unitKind: "infantry" };
    phaseEconomy(world);
    barracks.order = { kind: "train", unitKind: "infantry" };
    phaseEconomy(world);

    expect(barracks.trainQueue.length).toBe(2);
    const goldAfterEnqueue = world.players.human.gold;
    const woodAfterEnqueue = world.players.human.wood;
    const supplyAfterEnqueue = world.players.human.supplyUsed;

    // Cancel by setting hold order (explicit cancel signal).
    barracks.order = { kind: "hold" };
    phaseEconomy(world);

    expect(barracks.trainQueue.length).toBe(0);
    // Each job refunds its cost.
    expect(world.players.human.gold).toBe(goldAfterEnqueue + infantryStats.goldCost * 2);
    expect(world.players.human.wood).toBe(woodAfterEnqueue + infantryStats.woodCost * 2);
    expect(world.players.human.supplyUsed).toBe(supplyAfterEnqueue - infantryStats.supplyCost * 2);
  });
});

// ---------------------------------------------------------------------------
// (d) Forest tile depletes to dirt; worker deposits wood
// ---------------------------------------------------------------------------

describe("forest harvesting and depletion", () => {
  it("forest tile becomes dirt after wood is harvested and worker deposits to player", () => {
    // Arrange: worker at (9.5, 8.5), forest at (8, 8), Town Hall at (10, 8).
    // The worker is Chebyshev-1 from the forest AND Chebyshev-1 from the Town
    // Hall's tile at (10, 8), so no movement phase is needed — the gather cycle
    // runs entirely via the economy phase.
    const world = makeWorld(20, 20, "grass");

    // Place a forest tile at (8, 8).
    world.map.terrain.set(8, 8, "forest");

    // Town Hall at (10, 8) — 4×4 occupies (10–13, 8–11). Grass tiles only.
    placeBuilding(world, "townHall", "human", vec(10, 8));

    // Place a worker at (9.5, 8.5) — adjacent to both forest (8,8) and Town Hall (10,8).
    const worker = placeUnit(world, "worker", "human", { x: 9.5, y: 8.5 });
    worker.order = { kind: "harvest", targetId: makeEntityId(999) };

    const woodBefore = world.players.human.wood;

    // Run enough ticks for: approach detection (1 tick), gather (GATHER_TICKS),
    // return detection (1 tick), deposit (1 tick).  200 ticks is generous.
    let forestGone = false;
    let woodDeposited = false;

    for (let t = 0; t < 200; t++) {
      phaseEconomy(world);

      if (world.map.tileAt(8, 8) === "dirt") {
        forestGone = true;
      }
      if (world.players.human.wood > woodBefore) {
        woodDeposited = true;
      }
      if (forestGone && woodDeposited) break;
    }

    expect(forestGone).toBe(true);
    expect(woodDeposited).toBe(true);
    expect(world.players.human.wood).toBeGreaterThan(woodBefore);
  });
});

// ---------------------------------------------------------------------------
// (d2) D2 — harvest order honors its targetId (clicked resource), not nearest
// ---------------------------------------------------------------------------

describe("harvest order targetId is honored (D2)", () => {
  /** Encodes a tile as the input layer does: y * map.width + x. */
  function encodeTile(world: World, x: number, y: number): number {
    return y * world.map.width + x;
  }

  it("a worker harvests the FAR resource named by targetId, not the nearer one", () => {
    const world = makeWorld(20, 20, "grass");

    // A near forest at (6, 10) and a far one at (18, 2). The worker sits beside
    // the near forest, so pure proximity would pick (6, 10). (Forests are used
    // rather than gold mines because GameMap seeds a tile's gold only for
    // goldMine tiles present at construction; terrain set afterward reads as a
    // depleted mine. Forest is a live resource the moment its tile is forest, so
    // it exercises the same targetId-vs-proximity selection deterministically.)
    world.map.terrain.set(6, 10, "forest");
    world.map.terrain.set(18, 2, "forest");

    const worker = placeUnit(world, "worker", "human", { x: 7.5, y: 10.5 });
    // targetId names the FAR forest at (18, 2).
    const farId = encodeTile(world, 18, 2);
    worker.order = { kind: "harvest", targetId: makeEntityId(farId) };

    // One economy tick bootstraps the harvest cycle and records the chosen tile.
    phaseEconomy(world);

    expect(worker.harvestState).toBeDefined();
    expect(worker.harvestState!.resourceTile).toEqual(vec(18, 2));
    // And explicitly NOT the nearer resource.
    expect(worker.harvestState!.resourceTile).not.toEqual(vec(6, 10));
  });

  it("falls back to the NEAREST resource when targetId does not name a live tile", () => {
    const world = makeWorld(20, 20, "grass");
    world.map.terrain.set(6, 10, "forest"); // near
    world.map.terrain.set(18, 2, "forest"); // far

    const worker = placeUnit(world, "worker", "human", { x: 7.5, y: 10.5 });
    // targetId 999 decodes to (x=19, y=49) on a width-20 map → out of bounds,
    // i.e. not a live resource tile, so the proximity fallback must engage.
    worker.order = { kind: "harvest", targetId: makeEntityId(999) };

    phaseEconomy(world);

    expect(worker.harvestState).toBeDefined();
    // The near forest (6,10) is closer than the far one (18,2) to (7.5,10.5).
    expect(worker.harvestState!.resourceTile).toEqual(vec(6, 10));
  });
});

// ---------------------------------------------------------------------------
// (e) Prerequisite enforcement for ranged units
// ---------------------------------------------------------------------------

describe("training prerequisites", () => {
  it("blocks training ranged unit when Lumber Mill is absent", () => {
    const world = makeWorld();
    world.players.human.supplyUsed = 0;
    world.players.human.gold = 5000;
    world.players.human.wood = 5000;

    // Town Hall for supply, Barracks only (no Lumber Mill).
    placeBuilding(world, "townHall", "human", vec(8, 8));
    const barracks = placeBuilding(world, "barracks", "human", vec(0, 0));

    const goldBefore = world.players.human.gold;
    barracks.order = { kind: "train", unitKind: "ranged" };
    phaseEconomy(world);

    // Should NOT enqueue — no Lumber Mill.
    expect(barracks.trainQueue.length).toBe(0);
    expect(world.players.human.gold).toBe(goldBefore);
  });

  it("allows training ranged unit once Lumber Mill is built", () => {
    const world = makeWorld();
    world.players.human.supplyUsed = 0;
    world.players.human.gold = 5000;
    world.players.human.wood = 5000;

    // Town Hall for supply, Barracks + Lumber Mill.
    placeBuilding(world, "townHall", "human", vec(8, 8));
    const barracks = placeBuilding(world, "barracks", "human", vec(0, 0));
    placeBuilding(world, "lumberMill", "human", vec(4, 4));

    const goldBefore = world.players.human.gold;
    const rangedStats = getUnitStats("human", "ranged");

    barracks.order = { kind: "train", unitKind: "ranged" };
    phaseEconomy(world);

    // Should enqueue — both prerequisites met.
    expect(barracks.trainQueue.length).toBe(1);
    expect(world.players.human.gold).toBe(goldBefore - rangedStats.goldCost);
  });

  it("blocks training heavy unit without LumberMill, allows once present", () => {
    const world = makeWorld();
    world.players.human.supplyUsed = 0;
    world.players.human.gold = 5000;
    world.players.human.wood = 5000;

    // Town Hall for supply, Barracks only — no Lumber Mill.
    placeBuilding(world, "townHall", "human", vec(8, 8));
    const barracks = placeBuilding(world, "barracks", "human", vec(0, 0));

    barracks.order = { kind: "train", unitKind: "heavy" };
    phaseEconomy(world);
    expect(barracks.trainQueue.length).toBe(0);

    // Add Lumber Mill — now heavy should be trainable.
    placeBuilding(world, "lumberMill", "human", vec(4, 4));

    const heavyStats = getUnitStats("human", "heavy");
    const goldBefore = world.players.human.gold;

    barracks.order = { kind: "train", unitKind: "heavy" };
    phaseEconomy(world);
    expect(barracks.trainQueue.length).toBe(1);
    expect(world.players.human.gold).toBe(goldBefore - heavyStats.goldCost);
  });
});

// ---------------------------------------------------------------------------
// Bonus: training completion spawns a unit
// ---------------------------------------------------------------------------

describe("training completion", () => {
  it("spawns a unit adjacent to the building after trainTime ticks", () => {
    const world = makeWorld();
    world.players.human.supplyUsed = 0;
    world.players.human.gold = 5000;
    world.players.human.wood = 5000;

    // Town Hall naturally provides supply (supplyProvided=5).
    const hall = placeBuilding(world, "townHall", "human", vec(6, 6));
    // Also place a farm to ensure enough supply headroom.
    placeBuilding(world, "farm", "human", vec(11, 6));

    const workerStats = getUnitStats("human", "worker");
    const unitCountBefore = world.units.size;

    // Issue train order.
    hall.order = { kind: "train", unitKind: "worker" };
    phaseEconomy(world);

    // Queue has one job.
    expect(hall.trainQueue.length).toBe(1);

    // Advance until trainTime ticks (need to step enough for the job to complete).
    for (let t = 0; t < workerStats.trainTime + 5; t++) {
      phaseEconomy(world);
    }

    // A new unit should have spawned.
    expect(world.units.size).toBe(unitCountBefore + 1);
    // trainQueue should be empty.
    expect(hall.trainQueue.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (f) Interleaved same-seed worlds are bit-identical (determinism regression)
//
// This test reproduces the class of defect where module-level Maps keyed by
// EntityId cause cross-world contamination when two worlds with the same seed
// (and therefore the same EntityId sequence) are stepped interleaved.
// ---------------------------------------------------------------------------

/**
 * Deep-serialize a world's economy-visible state into a plain JSON string for
 * bit-identical comparison.  Captures player resources, every unit's position,
 * carrying, order, harvestState, buildState, and every relevant tile.
 */
function snapshotEconomyState(world: World): string {
  const unitSnapshots: unknown[] = [...world.units.values()]
    .sort((a, b) => a.id - b.id)
    .map((u) => ({
      id: u.id,
      pos: { x: u.pos.x, y: u.pos.y },
      order: u.order,
      carrying: u.carrying ?? null,
      harvestState: u.harvestState ?? null,
      buildState: u.buildState ?? null,
    }));

  const buildingSnapshots: unknown[] = [...world.buildings.values()]
    .sort((a, b) => a.id - b.id)
    .map((b) => ({
      id: b.id,
      buildProgress: b.buildProgress,
      hp: b.hp,
      trainQueue: b.trainQueue,
    }));

  return JSON.stringify({
    gold: world.players.human.gold,
    wood: world.players.human.wood,
    supplyUsed: world.players.human.supplyUsed,
    supplyCap: world.players.human.supplyCap,
    units: unitSnapshots,
    buildings: buildingSnapshots,
    // Spot-check terrain mutations at known tile coordinates.
    tile_8_8: world.map.tileAt(8, 8),
  });
}

describe("interleaved same-seed worlds are bit-identical (determinism regression)", () => {
  it("two same-seed worlds with harvesting worker stepped interleaved produce identical state", () => {
    // Build two identical worlds A and B.  They share the same EntityId
    // sequence (both start at nextEntityId=1), so workers and buildings get
    // the same ids.  Stepping them interleaved exposes module-level Map
    // contamination: A's tick writes Map[id], then B's tick reads back A's
    // value instead of its own.

    function buildWorld(): World {
      const w = makeWorld(20, 20, "grass");
      // Forest at (8,8) for wood harvesting.
      w.map.terrain.set(8, 8, "forest");

      // Town Hall at (10, 14) — provides drop-off + supply.
      placeBuilding(w, "townHall", "human", vec(10, 14));

      // Worker at (9.5, 8.5) — adjacent to forest (8,8).  The town hall at
      // (10,14) is within 20 tiles so the return leg is reachable.
      const worker = placeUnit(w, "worker", "human", { x: 9.5, y: 8.5 });
      worker.order = { kind: "harvest", targetId: makeEntityId(999) };

      return w;
    }

    const worldA = buildWorld();
    const worldB = buildWorld();

    // Sanity: snapshots identical before any ticks.
    expect(snapshotEconomyState(worldA)).toBe(snapshotEconomyState(worldB));

    const N_TICKS = 100;
    for (let t = 0; t < N_TICKS; t++) {
      // Interleaved: A then B each tick.
      phaseEconomy(worldA);
      phaseEconomy(worldB);
    }

    // After N interleaved ticks both worlds must be in identical state.
    const snapA = snapshotEconomyState(worldA);
    const snapB = snapshotEconomyState(worldB);
    expect(snapA).toBe(snapB);
  });

  it("two same-seed worlds with building worker stepped interleaved produce identical state", () => {
    function buildWorld(): World {
      const w = makeWorld(20, 20, "grass");
      // Town Hall for supply (required by the player).
      placeBuilding(w, "townHall", "human", vec(10, 14));
      // Provide enough resources to build a farm.
      w.players.human.gold = 5000;
      w.players.human.wood = 5000;

      // Worker at (5.5, 5.5) — will be ordered to build a farm at (4, 4).
      const worker = placeUnit(w, "worker", "human", { x: 5.5, y: 5.5 });
      worker.order = {
        kind: "build",
        buildingKind: "farm",
        pos: vec(4, 4),
      };
      return w;
    }

    const worldA = buildWorld();
    const worldB = buildWorld();

    expect(snapshotEconomyState(worldA)).toBe(snapshotEconomyState(worldB));

    const N_TICKS = 100;
    for (let t = 0; t < N_TICKS; t++) {
      phaseEconomy(worldA);
      phaseEconomy(worldB);
    }

    const snapA = snapshotEconomyState(worldA);
    const snapB = snapshotEconomyState(worldB);
    expect(snapA).toBe(snapB);
  });
});
