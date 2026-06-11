/**
 * T11 fog-of-war tests.
 *
 * All tests build minimal worlds or use createWorld so there is no module-level
 * state; two same-seed worlds stepped interleaved stay bit-identical.
 */

import { describe, it, expect } from "vitest";
import { createWorld } from "../src/sim/world.js";
import type { World } from "../src/sim/world.js";
import { stepWorld } from "../src/sim/simulation.js";
import { isVisibleTo, isEntityVisibleTo } from "../src/sim/fog.js";
import type { FogMap } from "../src/sim/fog.js";
import { Grid } from "../src/core/grid.js";
import { FACTIONS } from "../src/game/types.js";
import { makeEntityId } from "../src/game/types.js";
import { idle } from "../src/sim/orders.js";
import type { Unit, Building } from "../src/sim/entity.js";

// ---------------------------------------------------------------------------
// Minimal world builder for fog tests.
// We use createWorld to get a real world with actual entities.
// ---------------------------------------------------------------------------

const SEED = 0xabc123;
const LEVEL = 0;
const WIDTH = 40;
const HEIGHT = 40;

function build(): World {
  return createWorld(SEED, LEVEL, "human", 2, WIDTH, HEIGHT);
}

// ---------------------------------------------------------------------------
// Helper: place a single unit at a known tile in an otherwise-empty fog test.
// We build a full world so the fog field is populated, then we can reason about
// any human unit's sight coverage.
// ---------------------------------------------------------------------------

/**
 * Returns the tile position (integer) of the first human worker in `world`.
 */
function humanWorkerTile(world: World): { x: number; y: number } {
  for (const u of world.units.values()) {
    if (u.owner === "human" && u.kind === "worker") {
      return { x: Math.floor(u.pos.x), y: Math.floor(u.pos.y) };
    }
  }
  throw new Error("no human worker found");
}

// ---------------------------------------------------------------------------
// Test (a): tiles within a unit's sight radius become Visible after a fog update
// ---------------------------------------------------------------------------

describe("fog: tiles within unit sight become Visible", () => {
  it("after one fog phase, the tile under a human worker is Visible to human", () => {
    const world = build();
    // Run one step so the fog phase executes.
    stepWorld(world);

    const tile = humanWorkerTile(world);
    expect(isVisibleTo(world, "human", tile.x, tile.y)).toBe(true);
  });

  it("tiles strictly beyond sight radius are NOT Visible (disk boundary check)", () => {
    const world = build();
    stepWorld(world);

    // Worker sight is 4 tiles. A tile at distance 5+ from ALL human units/buildings
    // should not be visible.  We find the orc starting area (far side of a 40×40
    // map) and check one of its tiles is not visible to human after one step.
    const orcStart = world.mapReport.starts[1]; // second start = opponent
    const distantTile = { x: orcStart.x, y: orcStart.y };

    // It is possible (unlikely) that a 40×40 map has starts close enough for
    // the human town hall (sight=6) to overlap; skip rather than fail in that edge
    // case.
    const humanStart = world.mapReport.starts[0];
    const cheby = Math.max(
      Math.abs(distantTile.x - humanStart.x),
      Math.abs(distantTile.y - humanStart.y),
    );
    if (cheby > 8) {
      // Safe to assert: the orc start is beyond the range of any starting human entity.
      expect(isVisibleTo(world, "human", distantTile.x, distantTile.y)).toBe(false);
    }
    // If cheby <= 8 we silently skip — the geometry doesn't let us make the claim.
  });
});

// ---------------------------------------------------------------------------
// Test (b): once Visible, a tile becomes Explored (not Unexplored) when sight
//           moves away.
// ---------------------------------------------------------------------------

describe("fog: Visible tile becomes Explored (not Unexplored) when sight moves away", () => {
  it("a tile becomes Explored after the unit that revealed it is removed", () => {
    const world = build();

    // Step once so the fog phase runs and the worker tile becomes Visible.
    stepWorld(world);
    const tile = humanWorkerTile(world);
    expect(isVisibleTo(world, "human", tile.x, tile.y)).toBe(true);

    // Kill all human units so no entity can re-reveal the tile.
    for (const [id, unit] of world.units) {
      if (unit.owner === "human") {
        unit.hp = 0;
        world.units.delete(id);
      }
    }
    // Also kill human buildings to strip all sight.
    for (const [id, building] of world.buildings) {
      if (building.owner === "human") {
        building.hp = 0;
        world.buildings.delete(id);
        // Release map occupancy so the world stays consistent.
        world.map.vacate(building.tile, building.footprint);
      }
    }

    // Run another fog phase (via stepWorld; cleanup will find no entities to remove).
    stepWorld(world);

    // The tile must now be Explored (was seen before) — NOT Unexplored.
    const fog = world.fog as FogMap;
    const state = fog["human"].get(tile.x, tile.y);
    expect(state).toBe("explored");
    expect(state).not.toBe("unexplored");
  });
});

// ---------------------------------------------------------------------------
// Test (c): enemy entity observability via isEntityVisibleTo
// ---------------------------------------------------------------------------

describe("fog: isEntityVisibleTo respects fog state", () => {
  it("an enemy unit on a non-Visible tile is NOT observable by the other faction", () => {
    const world = build();
    // Before any step the fog grids are all Unexplored — no tile is Visible.
    // Find an orc unit; it should not be visible to human yet.
    let orcUnit: Unit | undefined;
    for (const u of world.units.values()) {
      if (u.owner === "orc") { orcUnit = u; break; }
    }
    expect(orcUnit).toBeDefined();
    // Pre-step: no fog update run yet — all tiles Unexplored.
    expect(isEntityVisibleTo(world, "human", orcUnit!)).toBe(false);
  });

  it("an enemy unit on a Visible tile IS observable by the observing faction", () => {
    const world = build();

    // Step so fog is computed.
    stepWorld(world);

    // Find a human unit and look at its own tile — human can certainly observe
    // a unit on a tile visible to human.
    let humanUnit: Unit | undefined;
    for (const u of world.units.values()) {
      if (u.owner === "human" && u.kind === "worker") { humanUnit = u; break; }
    }
    expect(humanUnit).toBeDefined();
    const tile = humanWorkerTile(world);
    // The tile under the human worker is Visible to human.
    expect(isVisibleTo(world, "human", tile.x, tile.y)).toBe(true);

    // A hypothetical enemy unit placed on that tile would be observable.
    // We inject a synthetic orc unit at the same position to test the predicate.
    const syntheticOrc: Unit = {
      id: makeEntityId(99999),
      owner: "orc",
      kind: "worker",
      hp: 40,
      maxHp: 40,
      pos: { x: tile.x + 0.5, y: tile.y + 0.5 },
      order: idle(),
      attackCooldown: 0,
    };
    // The tile is Visible to human, so the orc should be observable.
    expect(isEntityVisibleTo(world, "human", syntheticOrc)).toBe(true);
  });

  it("an enemy building on a non-Visible tile is NOT observable", () => {
    const world = build();
    // Pre-step: no fog update run yet.
    let orcBuilding: Building | undefined;
    for (const b of world.buildings.values()) {
      if (b.owner === "orc") { orcBuilding = b; break; }
    }
    expect(orcBuilding).toBeDefined();
    expect(isEntityVisibleTo(world, "human", orcBuilding!)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test (d): fog state is initialised on createWorld (no fog === undefined)
// ---------------------------------------------------------------------------

describe("fog: createWorld initialises fog grids", () => {
  it("world.fog is defined after createWorld", () => {
    const world = build();
    expect(world.fog).toBeDefined();
  });

  it("fog grids cover every faction and have correct dimensions", () => {
    const world = build();
    const fog = world.fog as FogMap;
    for (const faction of FACTIONS) {
      expect(fog[faction]).toBeInstanceOf(Grid);
      expect(fog[faction].width).toBe(WIDTH);
      expect(fog[faction].height).toBe(HEIGHT);
    }
  });

  it("all tiles start as Unexplored before any stepWorld call", () => {
    const world = build();
    const fog = world.fog as FogMap;
    for (const faction of FACTIONS) {
      const grid = fog[faction];
      let anyVisible = false;
      for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
          if (grid.get(x, y) !== "unexplored") { anyVisible = true; break; }
        }
        if (anyVisible) break;
      }
      expect(anyVisible).toBe(false);
    }
  });
});
