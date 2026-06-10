import { describe, expect, it } from "vitest";
import { FIXED_DT } from "../src/sim/config.js";
import { createGame } from "../src/sim/setup.js";
import { stepWorld } from "../src/sim/simulation.js";
import { Faction, UnitRole } from "../src/sim/stats.js";

function countRole(world: ReturnType<typeof createGame>["world"], faction: Faction, role: UnitRole): number {
  let n = 0;
  for (const u of world.units.values()) if (u.faction === faction && u.role === role) n++;
  return n;
}

describe("simulation integration", () => {
  it("sets up both bases with town halls and starting workers", () => {
    const { world } = createGame({
      seed: 7,
      width: 32,
      height: 32,
      playerFaction: Faction.Human,
      difficulty: 2,
    });
    expect(world.hasBuilding(Faction.Human, "townhall" as never)).toBe(true);
    expect(world.hasBuilding(Faction.Orc, "townhall" as never)).toBe(true);
    expect(countRole(world, Faction.Human, UnitRole.Worker)).toBe(4);
    expect(countRole(world, Faction.Orc, UnitRole.Worker)).toBe(4);
  });

  it("runs a couple of minutes without errors and grows the economy", () => {
    const { world } = createGame({
      seed: 13,
      width: 40,
      height: 40,
      playerFaction: Faction.Human,
      difficulty: 3,
    });
    const player = world.factions[Faction.Human];
    const startGold = player.gold;
    const startWood = player.wood;

    for (let i = 0; i < FIXED_DT_STEPS(120); i++) stepWorld(world, FIXED_DT);

    expect(world.units.size).toBeGreaterThan(0);
    // Player workers auto-harvest, so both stockpiles should have grown.
    expect(player.gold).toBeGreaterThan(startGold);
    expect(player.wood).toBeGreaterThan(startWood);
    // The AI trains workers and follows its build order.
    expect(countRole(world, Faction.Orc, UnitRole.Worker)).toBeGreaterThanOrEqual(4);
  });

  it("is deterministic: identical seeds yield identical state after stepping", () => {
    const cfg = {
      seed: 555,
      width: 32,
      height: 32,
      playerFaction: Faction.Human as Faction,
      difficulty: 2,
    };
    const a = createGame(cfg).world;
    const b = createGame(cfg).world;
    for (let i = 0; i < FIXED_DT_STEPS(45); i++) {
      stepWorld(a, FIXED_DT);
      stepWorld(b, FIXED_DT);
    }
    expect(a.factions[Faction.Human].gold).toBeCloseTo(b.factions[Faction.Human].gold, 5);
    expect(a.factions[Faction.Orc].gold).toBeCloseTo(b.factions[Faction.Orc].gold, 5);
    expect(a.units.size).toBe(b.units.size);
    expect(a.buildings.size).toBe(b.buildings.size);
  });
});

function FIXED_DT_STEPS(seconds: number): number {
  return Math.round(seconds / FIXED_DT);
}
