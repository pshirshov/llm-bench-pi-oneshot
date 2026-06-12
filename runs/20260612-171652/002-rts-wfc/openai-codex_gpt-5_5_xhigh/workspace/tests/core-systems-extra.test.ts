// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { TICK_RATE } from '../src/sim/constants';
import { Mulberry32, seedFromUrl } from '../src/sim/prng';
import { buildingStats, unitStats } from '../src/sim/stats';
import { World } from '../src/sim/world';
import { makeWorld, stepUntil } from './helpers';
import { InputController } from '../src/ui/input';
import { computeHudLayout } from '../src/ui/layout';

describe('additional core-system behavior', () => {
  test('seeded PRNG streams are reproducible and URL seed parsing is stable', () => {
    const a = new Mulberry32(123);
    const b = new Mulberry32(123);
    expect([a.next(), a.next(), a.int(10)]).toEqual([b.next(), b.next(), b.int(10)]);
    expect(seedFromUrl('?seed=987')).toBe(987);
  });

  test('fog marks friendly start visible and distant enemy unexplored after a tick', () => {
    const world = World.create(8080, 1, { aiEnabled: false });
    world.step(1);
    const own = world.map.starts[0];
    const enemy = world.map.starts[1];
    expect(world.canSee(1, own.x, own.y)).toBe(true);
    expect(world.canSee(1, enemy.x, enemy.y)).toBe(false);
  });

  test('supply-cap loss blocks new training while used exceeds cap', () => {
    const world = makeWorld(24, 24);
    const hall = world.spawnBuilding(1, 'townHall', { x: 2, y: 2 });
    const farm = world.spawnBuilding(1, 'farm', { x: 8, y: 2 });
    for (let i = 0; i < 8; i += 1) {
      world.spawnUnit(1, 'worker', { x: 4 + i, y: 8 });
    }
    expect(world.player(1).supplyCap).toBe(10);
    world.destroyEntity(farm);
    expect(world.player(1).supplyCap).toBe(6);
    expect(world.player(1).supplyUsed).toBe(8);
    expect(world.enqueueTraining(hall, 'worker')).toBe(false);
  });

  test('attack-move auto-acquires hostile targets entering sight', () => {
    const world = makeWorld();
    const archer = world.spawnUnit(1, 'ranged', { x: 5, y: 5 });
    world.spawnUnit(2, 'worker', { x: 8, y: 5 });
    world.issueAttackMove([archer], { x: 20, y: 5 });
    world.step(1);
    expect(world.projectiles.length).toBeGreaterThan(0);
  });

  test('Guard Tower static defense fires visible projectiles', () => {
    const world = makeWorld();
    world.spawnBuilding(1, 'guardTower', { x: 5, y: 5 });
    world.spawnUnit(2, 'melee', { x: 10, y: 6 });
    world.step(1);
    expect(world.projectiles.length).toBeGreaterThan(0);
  });

  test('queued training consumes exact stats-table duration before the unit appears', () => {
    const world = makeWorld();
    const hall = world.spawnBuilding(1, 'townHall', { x: 3, y: 3 });
    expect(world.enqueueTraining(hall, 'worker')).toBe(true);
    const count = world.units.size;
    world.step(unitStats('humans', 'worker').trainingTicks - 1);
    expect(world.units.size).toBe(count);
    world.step(1);
    expect(world.units.size).toBe(count + 1);
  });

  test('incomplete building HP reaches the stats-table maximum on construction completion', () => {
    const world = makeWorld(24, 24);
    const worker = world.spawnUnit(1, 'worker', { x: 4, y: 4 });
    const farm = world.issueBuild(worker, 'farm', { x: 7, y: 7 });
    if (farm === undefined) {
      throw new Error('farm placement failed');
    }
    expect(stepUntil(world, () => world.requireBuilding(farm).complete, buildingStats('farm').buildTicks + TICK_RATE * 10)).toBe(true);
    expect(world.requireBuilding(farm).hp).toBe(buildingStats('farm').hp);
  });
});

describe('minimap input', () => {
  test('clicking the minimap updates camera through injected client rectangle math', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    const world = makeWorld(64, 64);
    const camera = { x: 0, y: 0, zoom: 1 };
    const rect = { x: 100, y: 40, w: 1600, h: 1200 };
    const input = new InputController({ canvas, world, camera, rectSource: { getRect: () => rect } });
    input.bind();
    const minimap = computeHudLayout(canvas.width, canvas.height).minimap.rect;
    const screen = { x: minimap.x + minimap.w * 0.75, y: minimap.y + minimap.h * 0.75 };
    const client = { x: rect.x + (screen.x / canvas.width) * rect.w, y: rect.y + (screen.y / canvas.height) * rect.h };
    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: client.x, clientY: client.y, bubbles: true }));
    expect(camera.x).toBeGreaterThan(20);
    expect(camera.y).toBeGreaterThan(20);
    input.unbind();
  });
});
