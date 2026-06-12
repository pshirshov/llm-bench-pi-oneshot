/**
 * Tests for stats sanity: ordering constraints and bands.
 */

import { describe, it, expect } from 'vitest';
import { FACTION_STATS } from '../src/core/stats';
import type { Faction, UnitType, BuildingType } from '../src/core/types';

describe('Stats Sanity', () => {
  const factions: Faction[] = ['humans', 'orcs'];
  const unitTypes: UnitType[] = ['worker', 'melee', 'ranged', 'heavy'];
  const buildingTypes: BuildingType[] = ['townHall', 'farm', 'barracks', 'lumberMill', 'guardTower'];

  for (const faction of factions) {
    describe(faction, () => {
      it('HP ordering: heavy > melee > ranged > worker', () => {
        const stats = FACTION_STATS[faction].units;
        expect(stats.heavy.hp).toBeGreaterThan(stats.melee.hp);
        expect(stats.melee.hp).toBeGreaterThan(stats.ranged.hp);
        expect(stats.ranged.hp).toBeGreaterThan(stats.worker.hp);
      });

      it('every building out-HPs every unit', () => {
        const unitStats = FACTION_STATS[faction].units;
        const buildingStats = FACTION_STATS[faction].buildings;
        
        for (const unitType of unitTypes) {
          for (const buildingType of buildingTypes) {
            expect(buildingStats[buildingType].hp).toBeGreaterThan(unitStats[unitType].hp);
          }
        }
      });

      it('damage ordering: heavy >= melee > worker', () => {
        const stats = FACTION_STATS[faction].units;
        expect(stats.heavy.damage).toBeGreaterThanOrEqual(stats.melee.damage);
        expect(stats.melee.damage).toBeGreaterThan(stats.worker.damage);
      });

      it('attack range: melee and worker = 1, ranged >= 4', () => {
        const stats = FACTION_STATS[faction].units;
        expect(stats.melee.attackRange).toBe(1);
        expect(stats.worker.attackRange).toBe(1);
        expect(stats.ranged.attackRange).toBeGreaterThanOrEqual(4);
      });

      it('guard tower range >= ranged unit range', () => {
        const towerRange = FACTION_STATS[faction].buildings.guardTower.sightRadius;
        const rangedRange = FACTION_STATS[faction].units.ranged.attackRange;
        expect(towerRange).toBeGreaterThanOrEqual(rangedRange);
      });

      it('sight radius >= attack range for every combatant', () => {
        const stats = FACTION_STATS[faction].units;
        for (const unitType of unitTypes) {
          if (stats[unitType].attackRange > 0) {
            expect(stats[unitType].sightRadius).toBeGreaterThanOrEqual(stats[unitType].attackRange);
          }
        }
      });

      it('all unit move speeds within 1.5x band', () => {
        const stats = FACTION_STATS[faction].units;
        const speeds = unitTypes.map(t => stats[t].moveSpeed);
        const min = Math.min(...speeds);
        const max = Math.max(...speeds);
        expect(max).toBeLessThanOrEqual(min * 1.5);
      });

      it('each unit crosses one tile in 0.3–1.2 s at 1x game speed', () => {
        const stats = FACTION_STATS[faction].units;
        for (const unitType of unitTypes) {
          const timePerTile = 1 / stats[unitType].moveSpeed;
          expect(timePerTile).toBeGreaterThanOrEqual(0.3);
          expect(timePerTile).toBeLessThanOrEqual(1.2);
        }
      });

      it('mirror-match decisiveness: 4-30 attacks to kill own mirror', () => {
        const stats = FACTION_STATS[faction].units;
        for (const unitType of unitTypes) {
          if (stats[unitType].damage <= 0) continue;
          const effectiveDamage = Math.max(1, stats[unitType].damage - stats[unitType].armor);
          const attacksToKill = Math.ceil(stats[unitType].hp / effectiveDamage);
          expect(attacksToKill).toBeGreaterThanOrEqual(4);
          expect(attacksToKill).toBeLessThanOrEqual(30);
        }
      });

      it('gold+wood cost and training time increase with unit power', () => {
        const stats = FACTION_STATS[faction].units;
        // Heavy should be the most expensive
        const heavyCost = stats.heavy.goldCost + stats.heavy.woodCost;
        const meleeCost = stats.melee.goldCost + stats.melee.woodCost;
        const rangedCost = stats.ranged.goldCost + stats.ranged.woodCost;
        const workerCost = stats.worker.goldCost + stats.worker.woodCost;
        
        expect(heavyCost).toBeGreaterThan(meleeCost);
        expect(heavyCost).toBeGreaterThan(rangedCost);
        expect(heavyCost).toBeGreaterThan(workerCost);
      });

      it('training time increases with unit power', () => {
        const stats = FACTION_STATS[faction].units;
        expect(stats.heavy.trainTime).toBeGreaterThan(stats.melee.trainTime);
        expect(stats.heavy.trainTime).toBeGreaterThan(stats.ranged.trainTime);
        expect(stats.heavy.trainTime).toBeGreaterThan(stats.worker.trainTime);
      });
    });
  }
});
