import { describe, it, expect } from "vitest";
import { createWorld, STARTING_GOLD, STARTING_WOOD, STARTING_WORKERS } from "../src/sim/world.js";
import type { World } from "../src/sim/world.js";
import { tilesForFootprint } from "../src/sim/gamemap.js";
import { stepWorld, SIM_HZ } from "../src/sim/simulation.js";
import { generateMap } from "../src/wfc/mapgen.js";
import { FACTIONS } from "../src/game/types.js";
import type { Faction } from "../src/game/types.js";
import { chebyshev, vec } from "../src/core/vec.js";
import { getBuildingStats } from "../src/sim/stats.js";
import type { Building, Footprint, Unit } from "../src/sim/entity.js";

const SEED = 0xc0ffee;
const LEVEL = 0;
const WIDTH = 40;
const HEIGHT = 40;
const DIFFICULTY = 2;

/**
 * Chebyshev radius within which a starting gold mine must remain. mapgen
 * guarantees a gold mine within RESOURCE_REACH=10 *land* (4-connected BFS) steps
 * of each start; Chebyshev distance never exceeds land distance, so the same
 * mine is within this Chebyshev bound. The starting-mine assertion uses it to
 * confirm the Town-Hall placement fix did not bulldoze the economy's mine.
 */
const STARTING_MINE_MAX_CHEBYSHEV = 10;

function build(): World {
  return createWorld(SEED, LEVEL, "human", DIFFICULTY, WIDTH, HEIGHT);
}

/** All buildings owned by `faction`. */
function buildingsOf(world: World, faction: Faction): Building[] {
  return [...world.buildings.values()].filter((b) => b.owner === faction);
}

/** All units owned by `faction`. */
function unitsOf(world: World, faction: Faction): Unit[] {
  return [...world.units.values()].filter((u) => u.owner === faction);
}

/**
 * The tile kinds on which a building may NOT stand (impassable terrain or a
 * resource tile). A Town Hall footprint must contain NONE of these — the exact
 * invariant `GameMap.canPlaceBuilding` enforces at placement time. Asserting it
 * on the footprint terrain is non-vacuous (unlike checking `canPlaceBuilding` on
 * an already-occupied anchor, which is trivially false) and FAILS against the
 * old centre-and-clamp placement, which dropped 4×4 footprints onto
 * forest / gold mine / rock at corner starts.
 */
const NON_BUILDABLE_TILES = new Set(["water", "rock", "goldMine", "forest"]);

/** Asserts every tile under `hall`'s footprint is clear, buildable terrain. */
function expectFootprintBuildable(world: World, hall: Building): void {
  for (const t of tilesForFootprint(hall.tile, hall.footprint)) {
    expect(world.map.inBounds(t.x, t.y)).toBe(true);
    const kind = world.map.tileAt(t.x, t.y);
    // Message names the offending tile so a regression is diagnosable.
    expect(
      NON_BUILDABLE_TILES.has(kind),
      `hall footprint tile (${t.x},${t.y}) is non-buildable '${kind}'`,
    ).toBe(false);
  }
}

/** True iff a LIVE gold mine sits within `radius` Chebyshev tiles of `start`. */
function liveMineWithin(world: World, start: { x: number; y: number }, radius: number): boolean {
  for (let y = start.y - radius; y <= start.y + radius; y++) {
    for (let x = start.x - radius; x <= start.x + radius; x++) {
      if (!world.map.inBounds(x, y)) continue;
      if (chebyshev(start, vec(x, y)) > radius) continue;
      if (world.map.tileAt(x, y) === "goldMine" && world.map.goldAt(x, y) > 0) return true;
    }
  }
  return false;
}

/** The start tile assigned to `faction` (player → starts[0], opponent → starts[1]). */
function startOf(world: World, faction: Faction): { x: number; y: number } {
  return world.mapReport.starts[faction === world.playerFaction ? 0 : 1];
}

/**
 * Plain, fully-serialisable snapshot of the parts of a World that the
 * simulation may legitimately change tick-to-tick. Used for determinism
 * comparison: it deliberately excludes closures (`nextId`) and re-derives a
 * terrain census so two independently-built worlds can be compared by value.
 */
function snapshotWorld(world: World): string {
  const units = [...world.units.values()]
    .map((u) => ({
      id: u.id,
      owner: u.owner,
      kind: u.kind,
      hp: u.hp,
      x: u.pos.x,
      y: u.pos.y,
      order: u.order,
      cooldown: u.attackCooldown,
    }))
    .sort((a, b) => a.id - b.id);

  const buildings = [...world.buildings.values()]
    .map((b) => ({
      id: b.id,
      owner: b.owner,
      kind: b.kind,
      hp: b.hp,
      tile: b.tile,
      progress: b.buildProgress,
    }))
    .sort((a, b) => a.id - b.id);

  // Terrain census: count every tile kind across the whole map.
  const census: Record<string, number> = {};
  const map = world.map;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = map.tileAt(x, y);
      census[t] = (census[t] ?? 0) + 1;
    }
  }

  return JSON.stringify({
    tick: world.tick,
    nextEntityId: world.nextEntityId,
    players: world.players,
    units,
    buildings,
    census,
    starts: world.mapReport.starts,
  });
}

describe("createWorld", () => {
  it("builds a valid World: each faction has a Town Hall + workers and starting resources", () => {
    const world = build();

    // SIM rate is the fixed-timestep contract.
    expect(SIM_HZ).toBe(30);

    // Both factions exist with the expected opening.
    for (const faction of FACTIONS) {
      const halls = buildingsOf(world, faction).filter((b) => b.kind === "townHall");
      expect(halls).toHaveLength(1);
      const hall = halls[0];
      // Town Hall starts fully built and at full hp.
      expect(hall.buildProgress).toBe(1);
      expect(hall.hp).toBe(hall.maxHp);
      expect(hall.hp).toBeGreaterThan(0);

      const workers = unitsOf(world, faction).filter((u) => u.kind === "worker");
      expect(workers).toHaveLength(STARTING_WORKERS);
      // Workers spawned at full hp, idle, off the Town Hall footprint, walkable.
      for (const w of workers) {
        expect(w.hp).toBe(w.maxHp);
        expect(w.order.kind).toBe("stop");
        const tx = Math.floor(w.pos.x);
        const ty = Math.floor(w.pos.y);
        expect(world.map.isTileBlocked(tx, ty)).toBe(false);
      }

      // Starting resources set per faction; supply cap reflects the Town Hall.
      expect(world.players[faction].gold).toBe(STARTING_GOLD);
      expect(world.players[faction].wood).toBe(STARTING_WOOD);
      expect(world.players[faction].supplyUsed).toBe(STARTING_WORKERS);
      expect(world.players[faction].supplyCap).toBeGreaterThan(0);
    }

    // Town Hall PLACEMENT INVARIANT (the criticism-loop fix): each hall sits on
    // clear, buildable ground — EVERY footprint tile is non-impassable,
    // non-goldMine, non-forest — and the whole footprint is occupied by the hall
    // (blocks A*). The buildable check fails against the old centre-and-clamp
    // placement (which dropped corner halls onto forest / gold mine / rock); the
    // occupancy check confirms the footprint registered on the map.
    for (const faction of FACTIONS) {
      const hall = buildingsOf(world, faction).find((b) => b.kind === "townHall")!;
      expectFootprintBuildable(world, hall);
      for (const t of tilesForFootprint(hall.tile, hall.footprint)) {
        expect(world.map.isTileBlocked(t.x, t.y)).toBe(true);
        expect(world.map.occupant(t.x, t.y)).toBe(hall.id);
      }

      // The fix must not have bulldozed the economy's starting gold mine: a live
      // mine still exists within harvest range of the start.
      expect(
        liveMineWithin(world, startOf(world, faction), STARTING_MINE_MAX_CHEBYSHEV),
        `${faction}: no live gold mine within ${STARTING_MINE_MAX_CHEBYSHEV} of its start`,
      ).toBe(true);
    }

    // The map is the SAME one generateMap produces for this seed (seeded world).
    const expected = generateMap(WIDTH, HEIGHT, SEED, LEVEL);
    expect(world.mapReport.starts).toEqual(expected.report.starts);
    expect(world.map.tileAt(expected.starts[0].x, expected.starts[0].y)).toBe(
      expected.grid.get(expected.starts[0].x, expected.starts[0].y),
    );
  });
});

describe("stepWorld", () => {
  it("advances many ticks without throwing and increments world.tick by exactly one per call", () => {
    const world = build();
    expect(world.tick).toBe(0);

    const STEPS = 300;
    for (let i = 0; i < STEPS; i++) {
      const before = world.tick;
      expect(() => stepWorld(world)).not.toThrow();
      expect(world.tick).toBe(before + 1);
    }
    expect(world.tick).toBe(STEPS);

    // With only no-op phases (besides cleanup), no entity should have died, so
    // the opening forces are intact after 300 ticks.
    for (const faction of FACTIONS) {
      expect(unitsOf(world, faction).filter((u) => u.kind === "worker")).toHaveLength(
        STARTING_WORKERS,
      );
      expect(buildingsOf(world, faction).filter((b) => b.kind === "townHall")).toHaveLength(1);
    }
  });

  it("cleanup phase removes a unit whose hp drops to 0 and refunds its supply", () => {
    const world = build();
    const victim = unitsOf(world, "human").find((u) => u.kind === "worker")!;
    const supplyBefore = world.players.human.supplyUsed;

    victim.hp = 0;
    stepWorld(world);

    expect(world.units.has(victim.id)).toBe(false);
    expect(world.players.human.supplyUsed).toBe(supplyBefore - 1);
  });
});

describe("determinism", () => {
  it("two worlds from the same seed are deeply equal after N steps", () => {
    const a = build();
    const b = build();

    // Equal at construction.
    expect(snapshotWorld(a)).toBe(snapshotWorld(b));

    const N = 250;
    for (let i = 0; i < N; i++) {
      stepWorld(a);
      stepWorld(b);
    }

    // Still bit-for-bit equal after N identical steps.
    expect(snapshotWorld(a)).toBe(snapshotWorld(b));
    expect(a.tick).toBe(N);
    expect(b.tick).toBe(N);
  });

  it("different seeds produce different maps (sanity: the seed actually drives generation)", () => {
    const a = createWorld(1, LEVEL, "human", DIFFICULTY, WIDTH, HEIGHT);
    const c = createWorld(2, LEVEL, "human", DIFFICULTY, WIDTH, HEIGHT);
    // Starts (or terrain) should differ for distinct seeds on a non-trivial map.
    const differ =
      JSON.stringify(a.mapReport.starts) !== JSON.stringify(c.mapReport.starts) ||
      snapshotWorld(a) !== snapshotWorld(c);
    expect(differ).toBe(true);
  });
});

// ===========================================================================
// Town-Hall placement invariant across seeds (criticism-loop regression guard).
//
// The defect: corner starts ((0,0)/(39,39) from the graph-diameter selection)
// let the old centre-and-clamp anchor drop the 4×4 Town Hall footprint onto raw
// WFC terrain — forest / gold mine / rock / water — with a live ~1500-gold mine
// under the pad. These assertions hold for the fixed placement and FAIL for the
// old one, and they run across several seeds (corner starts on the 40×40 maps)
// for BOTH factions.
// ===========================================================================
describe("Town Hall placement is on buildable terrain across seeds", () => {
  const PLACEMENT_SEEDS: readonly number[] = [0, 3, 42, 100, 999];

  for (const seed of PLACEMENT_SEEDS) {
    it(`seed ${seed}: both halls sit on clear ground with the starting mine preserved`, () => {
      const world = createWorld(seed, LEVEL, "human", DIFFICULTY, WIDTH, HEIGHT);

      for (const faction of FACTIONS) {
        const hall = buildingsOf(world, faction).find((b) => b.kind === "townHall")!;

        // Footprint matches the stat table (4×4 Town Hall).
        const fp: Footprint = getBuildingStats(faction, "townHall").footprint;
        expect(hall.footprint.w).toBe(fp.w);
        expect(hall.footprint.h).toBe(fp.h);

        // (1) Every footprint tile is clear, buildable terrain (the core fix).
        expectFootprintBuildable(world, hall);

        // (2) The footprint is fully in bounds and occupied by the hall.
        for (const t of tilesForFootprint(hall.tile, hall.footprint)) {
          expect(world.map.inBounds(t.x, t.y)).toBe(true);
          expect(world.map.occupant(t.x, t.y)).toBe(hall.id);
        }

        // (3) No worker spawned on top of the hall footprint.
        const fpKeys = new Set(
          tilesForFootprint(hall.tile, hall.footprint).map((t) => t.y * world.map.width + t.x),
        );
        for (const w of unitsOf(world, faction).filter((u) => u.kind === "worker")) {
          const k = Math.floor(w.pos.y) * world.map.width + Math.floor(w.pos.x);
          expect(fpKeys.has(k)).toBe(false);
        }

        // (4) A live starting gold mine remains within harvest range of the start.
        expect(
          liveMineWithin(world, startOf(world, faction), STARTING_MINE_MAX_CHEBYSHEV),
          `${faction} seed ${seed}: starting gold mine missing within range`,
        ).toBe(true);
      }
    });
  }

  it("hall placement is deterministic in the seed", () => {
    for (const seed of PLACEMENT_SEEDS) {
      const a = createWorld(seed, LEVEL, "human", DIFFICULTY, WIDTH, HEIGHT);
      const b = createWorld(seed, LEVEL, "human", DIFFICULTY, WIDTH, HEIGHT);
      for (const faction of FACTIONS) {
        const ha = buildingsOf(a, faction).find((x) => x.kind === "townHall")!;
        const hb = buildingsOf(b, faction).find((x) => x.kind === "townHall")!;
        expect(ha.tile).toEqual(hb.tile);
      }
    }
  });
});
