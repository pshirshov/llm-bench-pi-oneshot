import { describe, expect, test } from 'vitest';
import { TICK_RATE } from '../src/sim/constants';
import { getTile } from '../src/sim/map/tiles';
import type { Building, Unit } from '../src/sim/types';
import { makeWorld, setResource, stepUntil } from './helpers';

function setupHarvestWorld(): { world: ReturnType<typeof makeWorld>; worker: Unit; hall: Building } {
  const world = makeWorld(24, 24);
  const hallId = world.spawnBuilding(1, 'townHall', { x: 3, y: 3 });
  const workerId = world.spawnUnit(1, 'worker', { x: 7, y: 5 });
  world.setStockpile(1, 0, 0);
  return { world, worker: world.units.get(workerId) ?? failUnit(), hall: world.requireBuilding(hallId) };
}

function failUnit(): Unit {
  throw new Error('missing worker');
}

describe('worker harvest loops', () => {
  test('worker gold loop completes three unattended round trips exactly', () => {
    const { world, worker } = setupHarvestWorld();
    setResource(world.map, { x: 10, y: 5 }, 'goldMine', 100);
    world.issueHarvest(worker.id, { x: 10, y: 5 });
    const delivered = stepUntil(world, () => world.player(1).gold === 30, TICK_RATE * 80);
    expect(delivered).toBe(true);
    expect(world.player(1).gold).toBe(30);
    expect(worker.order.kind).toBe('harvest');
  });

  test('wood depletion retargets the nearest reachable forest and keeps delivering', () => {
    const { world, worker } = setupHarvestWorld();
    setResource(world.map, { x: 10, y: 5 }, 'forest', 10);
    setResource(world.map, { x: 12, y: 5 }, 'forest', 40);
    world.issueHarvest(worker.id, { x: 10, y: 5 });
    const delivered = stepUntil(world, () => world.player(1).wood >= 20, TICK_RATE * 100);
    expect(delivered).toBe(true);
    expect(getTile(world.map, 10, 5).kind).toBe('grass');
    expect(worker.order.kind).toBe('harvest');
    expect(worker.order.kind === 'harvest' && worker.order.source).toEqual({ x: 12, y: 5 });
  });

  test('drop-off loss mid-carry reroutes to a surviving eligible drop-off', () => {
    const { world, worker, hall } = setupHarvestWorld();
    world.spawnBuilding(1, 'townHall', { x: 15, y: 3 });
    setResource(world.map, { x: 10, y: 5 }, 'goldMine', 100);
    world.issueHarvest(worker.id, { x: 10, y: 5 });
    expect(stepUntil(world, () => worker.cargo !== undefined, TICK_RATE * 20)).toBe(true);
    world.destroyEntity(hall.id);
    expect(stepUntil(world, () => world.player(1).gold === 10, TICK_RATE * 80)).toBe(true);
    expect(worker.cargo).toBeUndefined();
  });

  test('drop-off loss with no survivor leaves worker idle with cargo intact', () => {
    const { world, worker, hall } = setupHarvestWorld();
    setResource(world.map, { x: 10, y: 5 }, 'goldMine', 100);
    world.issueHarvest(worker.id, { x: 10, y: 5 });
    expect(stepUntil(world, () => worker.cargo !== undefined, TICK_RATE * 20)).toBe(true);
    world.destroyEntity(hall.id);
    expect(stepUntil(world, () => worker.order.kind === 'idle', TICK_RATE * 10)).toBe(true);
    expect(worker.cargo).toEqual({ kind: 'gold', amount: 10 });
  });

  test('mine exhaustion retargets another mine and never freezes mid-task', () => {
    const { world, worker } = setupHarvestWorld();
    setResource(world.map, { x: 10, y: 5 }, 'goldMine', 10);
    setResource(world.map, { x: 12, y: 5 }, 'goldMine', 40);
    world.issueHarvest(worker.id, { x: 10, y: 5 });
    const delivered = stepUntil(world, () => world.player(1).gold >= 20, TICK_RATE * 100);
    expect(delivered).toBe(true);
    expect(getTile(world.map, 10, 5).kind).toBe('depletedMine');
    expect(worker.order.kind).toBe('harvest');
  });

  test('exhausted mine with no replacement ends idle near drop-off', () => {
    const { world, worker } = setupHarvestWorld();
    setResource(world.map, { x: 10, y: 5 }, 'goldMine', 10);
    world.issueHarvest(worker.id, { x: 10, y: 5 });
    const idle = stepUntil(world, () => worker.order.kind === 'idle', TICK_RATE * 80);
    expect(idle).toBe(true);
    expect(worker.cargo).toBeUndefined();
    expect(world.player(1).gold).toBe(10);
  });
});
