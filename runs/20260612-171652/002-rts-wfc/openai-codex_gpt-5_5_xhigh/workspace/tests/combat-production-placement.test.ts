import { describe, expect, test } from 'vitest';
import { TICK_RATE } from '../src/sim/constants';
import { getTile } from '../src/sim/map/tiles';
import { validatePlacement } from '../src/sim/placement';
import { BUILDING_STATS, UNIT_STATS, buildingStats, costTotal, unitStats } from '../src/sim/stats';
import { computeDamage } from '../src/sim/systems/combat';
import type { Faction, UnitKind } from '../src/sim/types';
import { distance } from '../src/sim/utils';
import { makeWorld, setBlock, setResource, stepUntil } from './helpers';

const factions: Faction[] = ['humans', 'orcs'];

describe('stats sanity and combat', () => {
  test('unit and building stats satisfy genre sanity constraints for both factions', () => {
    for (const faction of factions) {
      const stats = UNIT_STATS[faction];
      expect(stats.heavy.hp).toBeGreaterThan(stats.melee.hp);
      expect(stats.melee.hp).toBeGreaterThan(stats.ranged.hp);
      expect(stats.ranged.hp).toBeGreaterThan(stats.worker.hp);
      expect(Math.min(...Object.values(BUILDING_STATS).map(item => item.hp))).toBeGreaterThan(Math.max(...Object.values(stats).map(item => item.hp)));
      expect(stats.heavy.damage).toBeGreaterThanOrEqual(stats.melee.damage);
      expect(stats.melee.damage).toBeGreaterThan(stats.worker.damage);
      expect(stats.worker.range).toBe(1);
      expect(stats.melee.range).toBe(1);
      expect(stats.heavy.range).toBe(1);
      expect(stats.ranged.range).toBeGreaterThanOrEqual(4);
      expect(BUILDING_STATS.guardTower.range).toBeGreaterThanOrEqual(stats.ranged.range);
      for (const unit of Object.values(stats)) {
        expect(unit.sight).toBeGreaterThanOrEqual(unit.range);
        const attacks = Math.ceil(unit.hp / Math.max(1, unit.damage - unit.armor));
        expect(attacks).toBeGreaterThanOrEqual(4);
        expect(attacks).toBeLessThanOrEqual(30);
      }
      const speeds = Object.values(stats).map(item => item.moveSpeed);
      expect(Math.max(...speeds)).toBeLessThanOrEqual(Math.min(...speeds) * 1.5);
      for (const speed of speeds) {
        expect(1 / speed).toBeGreaterThanOrEqual(0.3);
        expect(1 / speed).toBeLessThanOrEqual(1.2);
      }
      expect(costTotal(stats.heavy.cost)).toBeGreaterThan(Math.max(costTotal(stats.worker.cost), costTotal(stats.melee.cost), costTotal(stats.ranged.cost)));
      expect(stats.heavy.trainingTicks).toBeGreaterThan(Math.max(stats.worker.trainingTicks, stats.melee.trainingTicks, stats.ranged.trainingTicks));
    }
  });

  test('damage uses max(1, attack minus armor), death removes units and releases supply', () => {
    expect(computeDamage(3, 9)).toBe(1);
    expect(computeDamage(10, 3)).toBe(7);
    const world = makeWorld();
    const id = world.spawnUnit(1, 'worker', { x: 5, y: 5 });
    expect(world.player(1).supplyUsed).toBe(1);
    world.damageEntity(id, 1000);
    expect(world.units.has(id)).toBe(false);
    expect(world.player(1).supplyUsed).toBe(0);
  });

  test('ranged attacks create a projectile that applies damage on arrival', () => {
    const world = makeWorld();
    const archer = world.spawnUnit(1, 'ranged', { x: 5, y: 5 });
    const target = world.spawnUnit(2, 'worker', { x: 8, y: 5 });
    const hp = unitStats('orcs', 'worker').hp;
    world.issueAttack(archer, target);
    world.step(2);
    expect(world.projectiles.length).toBeGreaterThan(0);
    expect(stepUntil(world, () => world.projectiles.length === 0, TICK_RATE * 3)).toBe(true);
    expect(world.units.get(target)?.hp).toBeLessThan(hp);
  });
});

describe('production, repair, and placement', () => {
  test('supply cap blocks training, Farm completion unblocks it, and training completes', () => {
    const world = makeWorld(24, 24);
    const hall = world.spawnBuilding(1, 'townHall', { x: 3, y: 3 });
    const workers = Array.from({ length: 6 }, (_, index) => world.spawnUnit(1, 'worker', { x: 8 + index, y: 5 }));
    expect(world.enqueueTraining(hall, 'worker')).toBe(false);
    const farmId = world.issueBuild(workers[0], 'farm', { x: 8, y: 8 });
    if (farmId === undefined) {
      throw new Error('farm was not placed');
    }
    expect(stepUntil(world, () => world.requireBuilding(farmId).complete, buildingStats('farm').buildTicks + TICK_RATE * 10)).toBe(true);
    expect(world.player(1).supplyCap).toBe(10);
    expect(world.enqueueTraining(hall, 'worker')).toBe(true);
    const count = world.units.size;
    world.step(unitStats('humans', 'worker').trainingTicks + TICK_RATE);
    expect(world.units.size).toBe(count + 1);
  });

  test('surrounded production spawns at the nearest free walkable tile', () => {
    const world = makeWorld(24, 24);
    const barracks = world.spawnBuilding(1, 'barracks', { x: 8, y: 8 });
    world.player(1).supplyCap = 100;
    for (let y = 7; y <= 11; y += 1) {
      for (let x = 7; x <= 11; x += 1) {
        const inside = x >= 8 && x <= 10 && y >= 8 && y <= 10;
        if (!inside) {
          world.spawnUnit(1, 'worker', { x, y });
        }
      }
    }
    const before = world.units.size;
    expect(world.enqueueTraining(barracks, 'melee')).toBe(true);
    world.step(unitStats('humans', 'melee').trainingTicks + TICK_RATE);
    expect(world.units.size).toBe(before + 1);
    const newest = Math.max(...Array.from(world.units.keys()));
    const spawned = world.units.get(newest);
    expect(spawned).toBeDefined();
    expect(spawned !== undefined && distance(spawned.tile, { x: 9, y: 9 })).toBeGreaterThan(2);
  });

  test('Worker repair restores a damaged building to full HP at a resource cost', () => {
    const world = makeWorld(24, 24);
    const hall = world.spawnBuilding(1, 'townHall', { x: 5, y: 5 });
    const worker = world.spawnUnit(1, 'worker', { x: 4, y: 5 });
    world.damageEntity(hall, 120);
    const beforeWood = world.player(1).wood;
    world.issueRepair(worker, hall);
    expect(stepUntil(world, () => world.requireBuilding(hall).hp === buildingStats('townHall').hp, TICK_RATE * 30)).toBe(true);
    expect(world.player(1).wood).toBeLessThan(beforeWood);
    expect(world.units.get(worker)?.order.kind).toBe('idle');
  });

  test('placement rejects terrain, resources, buildings, and units; accepted placement constructs', () => {
    const world = makeWorld(24, 24);
    const worker = world.spawnUnit(1, 'worker', { x: 4, y: 4 });
    setBlock(world.map, { x: 10, y: 10 });
    setResource(world.map, { x: 12, y: 10 }, 'goldMine');
    world.spawnBuilding(1, 'townHall', { x: 2, y: 2 });
    world.spawnUnit(1, 'worker', { x: 14, y: 10 });
    expect(validatePlacement({ map: world.map, buildings: world.buildings.values(), units: world.units.values() }, 'farm', { x: 10, y: 10 }).reason).toBe('terrain');
    expect(validatePlacement({ map: world.map, buildings: world.buildings.values(), units: world.units.values() }, 'farm', { x: 12, y: 10 }).reason).toBe('terrain');
    expect(getTile(world.map, 12, 10).kind).toBe('goldMine');
    expect(validatePlacement({ map: world.map, buildings: world.buildings.values(), units: world.units.values() }, 'farm', { x: 2, y: 2 }).reason).toBe('building');
    expect(validatePlacement({ map: world.map, buildings: world.buildings.values(), units: world.units.values() }, 'farm', { x: 14, y: 10 }).reason).toBe('unit');
    expect(validatePlacement({ map: world.map, buildings: world.buildings.values(), units: world.units.values() }, 'farm', { x: 16, y: 10 }).ok).toBe(true);
    const farm = world.issueBuild(worker, 'farm', { x: 16, y: 10 });
    expect(farm).toBeDefined();
  });

  test('unit stats table exposes all mirrored unit classes', () => {
    const kinds: UnitKind[] = ['worker', 'melee', 'ranged', 'heavy'];
    for (const faction of factions) {
      expect(kinds.map(kind => UNIT_STATS[faction][kind].label).every(Boolean)).toBe(true);
    }
  });
});
