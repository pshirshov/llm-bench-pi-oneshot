/** Stats sanity tests. */

import { describe, it, expect } from "vitest";
import { UNIT_STATS, BUILDING_STATS } from "../src/sim/stats";

describe("Stats sanity", () => {
  it("HP ordering: heavy > melee > ranged > Worker", () => {
    expect(UNIT_STATS.heavy.hp).toBeGreaterThan(UNIT_STATS.melee.hp);
    expect(UNIT_STATS.melee.hp).toBeGreaterThan(UNIT_STATS.ranged.hp);
    expect(UNIT_STATS.ranged.hp).toBeGreaterThan(UNIT_STATS.worker.hp);
  });

  it("Every building out-HPs every unit", () => {
    const unitHPs = Object.values(UNIT_STATS).map(s => s.hp);
    const buildingHPs = Object.values(BUILDING_STATS).map(s => s.hp);
    for (const bh of buildingHPs) {
      for (const uh of unitHPs) {
        expect(bh).toBeGreaterThan(uh);
      }
    }
  });

  it("Damage ordering: heavy >= melee > Worker", () => {
    expect(UNIT_STATS.heavy.attack).toBeGreaterThanOrEqual(UNIT_STATS.melee.attack);
    expect(UNIT_STATS.melee.attack).toBeGreaterThan(UNIT_STATS.worker.attack);
  });

  it("Attack range: melee/Worker = 1, ranged >= 4, tower >= ranged", () => {
    expect(UNIT_STATS.worker.attackRange).toBe(1);
    expect(UNIT_STATS.melee.attackRange).toBe(1);
    expect(UNIT_STATS.ranged.attackRange).toBeGreaterThanOrEqual(4);
    expect(BUILDING_STATS.guard_tower.attackRange).toBeGreaterThanOrEqual(UNIT_STATS.ranged.attackRange);
  });

  it("Sight radius >= attack range for combatants", () => {
    for (const type of ["melee", "ranged", "heavy"] as const) {
      expect(UNIT_STATS[type].sight).toBeGreaterThanOrEqual(UNIT_STATS[type].attackRange);
    }
    expect(BUILDING_STATS.guard_tower.sight).toBeGreaterThanOrEqual(BUILDING_STATS.guard_tower.attackRange);
  });

  it("Move speeds within 1.5x band", () => {
    const speeds = Object.values(UNIT_STATS).map(s => s.moveSpeed);
    const maxSpeed = Math.max(...speeds);
    const minSpeed = Math.min(...speeds);
    expect(maxSpeed / minSpeed).toBeLessThanOrEqual(1.5);
  });

  it("Each unit crosses one tile in 0.3-1.2s at 1x speed", () => {
    for (const type of Object.keys(UNIT_STATS) as (keyof typeof UNIT_STATS)[]) {
      const speed = UNIT_STATS[type].moveSpeed;
      const timePerTile = 1 / speed;
      expect(timePerTile).toBeGreaterThanOrEqual(0.3);
      expect(timePerTile).toBeLessThanOrEqual(1.2);
    }
  });

  it("Mirror-match kills in 4-30 attacks", () => {
    for (const type of Object.keys(UNIT_STATS) as (keyof typeof UNIT_STATS)[]) {
      const stats = UNIT_STATS[type];
      const dmg = Math.max(1, stats.attack - stats.armor);
      const hitsToKill = stats.hp / dmg;
      expect(hitsToKill).toBeGreaterThanOrEqual(4);
      expect(hitsToKill).toBeLessThanOrEqual(30);
    }
  });

  it("Cost and training time increase with unit power", () => {
    const heavyCost = UNIT_STATS.heavy.goldCost + UNIT_STATS.heavy.woodCost;
    const meleeCost = UNIT_STATS.melee.goldCost + UNIT_STATS.melee.woodCost;
    const rangedCost = UNIT_STATS.ranged.goldCost + UNIT_STATS.ranged.woodCost;
    const workerCost = UNIT_STATS.worker.goldCost + UNIT_STATS.worker.woodCost;

    expect(heavyCost).toBeGreaterThan(meleeCost);
    expect(heavyCost).toBeGreaterThan(rangedCost);
    expect(heavyCost).toBeGreaterThan(workerCost);
    expect(meleeCost).toBeGreaterThan(workerCost);

    expect(UNIT_STATS.heavy.trainTime).toBeGreaterThan(UNIT_STATS.melee.trainTime);
    expect(UNIT_STATS.melee.trainTime).toBeGreaterThan(UNIT_STATS.worker.trainTime);
  });
});