import { describe, expect, it } from "vitest";
import { Grid } from "../src/core/grid.js";
import { computeDamage } from "../src/sim/combat.js";
import { applyDamage, enqueueTrain, updateProjectiles, updateUnit } from "../src/sim/behaviors.js";
import { createUnit, resetIds } from "../src/sim/entity.js";
import { GameMap } from "../src/sim/gamemap.js";
import { orderAttack } from "../src/sim/orders.js";
import { BuildingRole, Faction, UNIT_STATS, UnitRole } from "../src/sim/stats.js";
import { World } from "../src/sim/world.js";
import { TileType } from "../src/wfc/tiles.js";

function freshWorld(): World {
  resetIds();
  const tiles = new Grid<TileType>(24, 24, () => TileType.Grass);
  return new World(new GameMap(tiles), Faction.Human, 1);
}

describe("combat damage math", () => {
  it("subtracts armor from damage", () => {
    expect(computeDamage(10, 3)).toBe(7);
    expect(computeDamage(14, 4)).toBe(10);
  });

  it("never deals less than 1 (armor floor)", () => {
    expect(computeDamage(2, 5)).toBe(1);
    expect(computeDamage(5, 5)).toBe(1);
    expect(computeDamage(0, 100)).toBe(1);
  });

  it("ranged attacks spawn a projectile that deals armor-adjusted damage on impact", () => {
    const world = freshWorld();
    world.spatial.clear();
    const archer = createUnit(Faction.Human, UnitRole.Ranged, { x: 5, y: 5 });
    const target = createUnit(Faction.Orc, UnitRole.Infantry, { x: 8, y: 5 }); // within range 5
    world.addUnit(archer);
    world.addUnit(target);
    for (const u of world.units.values()) world.spatial.insert(u.id, u.pos);

    orderAttack(world, archer, target.id);
    updateUnit(world, archer, 1 / 30); // in range -> fires
    expect(world.projectiles.length).toBe(1);

    const before = target.hp;
    // Advance the projectile until it impacts.
    for (let i = 0; i < 200 && world.projectiles.length > 0; i++) updateProjectiles(world, 1 / 30);
    const expected = computeDamage(UNIT_STATS[UnitRole.Ranged].damage, UNIT_STATS[UnitRole.Infantry].armor);
    expect(target.hp).toBe(before - expected);
  });

  it("removes a unit when its HP reaches zero and leaves a corpse", () => {
    const world = freshWorld();
    const u = createUnit(Faction.Orc, UnitRole.Infantry, { x: 5, y: 5 });
    world.addUnit(u);
    expect(world.units.size).toBe(1);
    applyDamage(world, u, u.maxHp); // exactly lethal
    expect(world.units.size).toBe(0);
    expect(world.corpses.length).toBe(1);
  });
});

describe("supply accounting", () => {
  it("derives cap from buildings and used from living units", () => {
    const world = freshWorld();
    world.spawnBuilding(Faction.Human, BuildingRole.TownHall, { tx: 5, ty: 5 }, true);
    world.recomputeSupply();
    const fs = world.factions[Faction.Human];
    // Town hall provides 5 supply.
    expect(fs.supplyCap).toBe(5);
    expect(fs.supplyUsed).toBe(0);

    for (let i = 0; i < 3; i++) {
      world.addUnit(createUnit(Faction.Human, UnitRole.Worker, { x: 10 + i, y: 10 }));
    }
    world.recomputeSupply();
    expect(fs.supplyUsed).toBe(3);
  });

  it("blocks training at the supply cap", () => {
    const world = freshWorld();
    world.spawnBuilding(Faction.Human, BuildingRole.TownHall, { tx: 5, ty: 5 }, true);
    const fs = world.factions[Faction.Human];
    fs.gold = 1000;
    fs.wood = 1000;
    // Fill supply to the cap of 5.
    for (let i = 0; i < 5; i++) {
      world.addUnit(createUnit(Faction.Human, UnitRole.Worker, { x: 10, y: 10 + i }));
    }
    world.recomputeSupply();
    const result = world.canTrain(Faction.Human, UnitRole.Worker);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("Not enough supply");
  });

  it("enqueueing a unit deducts its cost and reserves supply", () => {
    const world = freshWorld();
    const hall = world.spawnBuilding(Faction.Human, BuildingRole.TownHall, { tx: 5, ty: 5 }, true);
    const fs = world.factions[Faction.Human];
    fs.gold = 1000;
    fs.wood = 1000;
    world.recomputeSupply();

    const res = enqueueTrain(world, hall, UnitRole.Worker);
    expect(res.ok).toBe(true);
    expect(fs.gold).toBe(1000 - UNIT_STATS[UnitRole.Worker].goldCost);
    expect(hall.trainingQueue).toEqual([UnitRole.Worker]);

    // Reserved supply shows up after recompute even before the unit exists.
    world.recomputeSupply();
    expect(fs.supplyUsed).toBe(UNIT_STATS[UnitRole.Worker].supplyCost);
  });

  it("refuses to train without the prerequisite building", () => {
    const world = freshWorld();
    const hall = world.spawnBuilding(Faction.Human, BuildingRole.TownHall, { tx: 5, ty: 5 }, true);
    world.factions[Faction.Human].gold = 1000;
    world.factions[Faction.Human].wood = 1000;
    world.recomputeSupply();
    // Town hall cannot train infantry (needs Barracks).
    const res = enqueueTrain(world, hall, UnitRole.Infantry);
    expect(res.ok).toBe(false);
  });
});
