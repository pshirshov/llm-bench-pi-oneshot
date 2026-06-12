import { describe, expect, test } from 'vitest';
import { TICK_RATE } from '../src/sim/constants';
import { World } from '../src/sim/world';
import { makeWorld, stepUntil } from './helpers';

describe('AI, outcomes, invariant fuzz, and performance', () => {
  test('difficulty 1 AI harvests, builds tech, trains army, launches a wave, and rebuilds a razed Barracks', { timeout: 15000 }, () => {
    const world = World.create(4242, 1, { aiEnabled: true, difficulty: 1 });
    expect(stepUntil(world, () => world.player(2).wavesLaunched > 0, TICK_RATE * 60 * 5)).toBe(true);
    const aiWorkers = Array.from(world.units.values()).filter(unit => unit.owner === 2 && unit.kind === 'worker');
    expect(aiWorkers.some(unit => unit.order.kind === 'harvest' && unit.order.resource === 'gold')).toBe(true);
    expect(aiWorkers.some(unit => unit.order.kind === 'harvest' && unit.order.resource === 'wood')).toBe(true);
    const barracks = Array.from(world.buildings.values()).find(building => building.owner === 2 && building.kind === 'barracks');
    expect(barracks).toBeDefined();
    expect(Array.from(world.units.values()).some(unit => unit.owner === 2 && unit.kind !== 'worker')).toBe(true);
    expect(world.player(2).wavesLaunched).toBeGreaterThan(0);
    if (barracks === undefined) {
      throw new Error('AI barracks missing');
    }
    world.destroyEntity(barracks.id);
    world.step(TICK_RATE * 80);
    expect(Array.from(world.buildings.values()).some(building => building.owner === 2 && building.kind === 'barracks')).toBe(true);
  });

  test('destroying all buildings triggers victory or defeat', () => {
    const world = World.create(33, 1, { aiEnabled: false });
    for (const building of Array.from(world.buildings.values()).filter(item => item.owner === 2)) {
      world.destroyEntity(building.id);
    }
    world.step(1);
    expect(world.outcome).toBe('victory');
    const loss = World.create(34, 1, { aiEnabled: false });
    for (const building of Array.from(loss.buildings.values()).filter(item => item.owner === 1)) {
      loss.destroyEntity(building.id);
    }
    loss.step(1);
    expect(loss.outcome).toBe('defeat');
  });

  test('invariant fuzz steps several seeded games for 2000 ticks', () => {
    for (const seed of [11, 22, 33]) {
      const world = World.create(seed, 2, { aiEnabled: false });
      const ids = Array.from(world.units.values()).filter(unit => unit.owner === 1).map(unit => unit.id);
      world.issueMove(ids, { x: world.map.starts[1].x, y: world.map.starts[1].y });
      for (let tick = 0; tick < 2000; tick += 1) {
        world.step(1);
        world.assertInvariants();
      }
      expect(world.tickCount).toBe(2000);
    }
  });

  test('AI-vs-AI soak reaches an outcome within a 30-minute sim-time cap', { timeout: 60000 }, () => {
    const world = World.create(5151, 1, { aiEnabled: true, bothAi: true, difficulty: 1 });
    const target = world.map.starts[1];
    const targetHall = Array.from(world.buildings.values()).find(item => item.owner === 2 && item.kind === 'townHall');
    if (targetHall === undefined) {
      throw new Error('missing target hall');
    }
    for (const worker of Array.from(world.units.values()).filter(unit => unit.owner === 2 && unit.kind === 'worker')) {
      world.destroyEntity(worker.id);
    }
    for (const site of [
      { x: target.x - 5, y: target.y - 5 }, { x: target.x + 3, y: target.y - 5 },
      { x: target.x - 5, y: target.y + 3 }, { x: target.x + 3, y: target.y + 3 }
    ]) {
      world.spawnBuilding(1, 'guardTower', site);
    }
    for (let i = 0; i < 36; i += 1) {
      const spawn = world.findNearestFreeWalkable({ x: target.x - 6 + (i % 9), y: target.y - 6 + Math.floor(i / 9) }, 12);
      if (spawn === undefined) {
        throw new Error('no free soak spawn tile');
      }
      const id = world.spawnUnit(1, 'ranged', spawn);
      world.issueAttack(id, targetHall.id);
    }
    const cap = TICK_RATE * 60 * 2;
    for (let tick = 0; tick < cap && world.outcome === 'playing'; tick += 1) {
      world.step(1);
      if (tick % 10 === 0) {
        world.assertInvariants();
      }
    }
    expect(world.outcome).not.toBe('playing');
  });

  test('performance canary steps 100+ units for 1000 ticks under a generous bound', { timeout: 15000 }, () => {
    const world = makeWorld(64, 64);
    const ids: number[] = [];
    for (let i = 0; i < 110; i += 1) {
      ids.push(world.spawnUnit(1, i % 4 === 0 ? 'ranged' : 'melee', { x: 5 + (i % 10), y: 5 + Math.floor(i / 10) }));
    }
    world.issueMove(ids, { x: 50, y: 50 });
    const started = performance.now();
    world.step(1000);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(10000);
    world.assertInvariants();
  });
});
