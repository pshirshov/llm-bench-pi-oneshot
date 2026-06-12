import { describe, expect, test } from 'vitest';
import { TICK_RATE } from '../src/sim/constants';
import type { Unit } from '../src/sim/types';
import { distance } from '../src/sim/utils';
import { makeWorld, setBlock } from './helpers';

function addChoke(world: ReturnType<typeof makeWorld>): void {
  for (let y = 0; y < world.map.height; y += 1) {
    if (y !== 10 && y !== 11) {
      setBlock(world.map, { x: 12, y });
    }
  }
}

function units(world: ReturnType<typeof makeWorld>): Unit[] {
  return Array.from(world.units.values());
}

describe('movement robustness', () => {
  test('12 units pass through a 2-tile chokepoint, arrive, and settle without stacking', () => {
    const world = makeWorld(28, 22);
    addChoke(world);
    const ids: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      ids.push(world.spawnUnit(1, 'melee', { x: 3 + (i % 4), y: 7 + Math.floor(i / 4) }));
    }
    world.issueMove(ids, { x: 21, y: 10 });
    for (let tick = 0; tick < TICK_RATE * 60; tick += 1) {
      world.step(1);
      world.assertInvariants();
    }
    expect(units(world).every(unit => distance(unit.tile, { x: 21, y: 10 }) <= 5)).toBe(true);
    expect(units(world).every(unit => unit.order.kind === 'idle')).toBe(true);
    const before = units(world).map(unit => ({ id: unit.id, x: unit.x, y: unit.y }));
    world.step(TICK_RATE * 5);
    for (const snapshot of before) {
      const unit = world.units.get(snapshot.id);
      expect(unit?.x).toBe(snapshot.x);
      expect(unit?.y).toBe(snapshot.y);
    }
    assertNoStacks(world);
  });

  test('unreachable move order terminates at nearest reachable point', () => {
    const world = makeWorld(16, 16);
    for (let y = 4; y <= 6; y += 1) {
      for (let x = 4; x <= 6; x += 1) {
        if (x !== 5 || y !== 5) {
          setBlock(world.map, { x, y });
        }
      }
    }
    const id = world.spawnUnit(1, 'worker', { x: 10, y: 10 });
    const unit = world.units.get(id);
    if (unit === undefined) {
      throw new Error('missing unit');
    }
    world.issueMove([id], { x: 5, y: 5 });
    for (let tick = 0; tick < TICK_RATE * 25; tick += 1) {
      world.step(1);
      world.assertInvariants();
    }
    expect(unit.order.kind).toBe('idle');
    expect(distance(unit.tile, { x: 5, y: 5 })).toBeLessThan(5);
  });

  test('moving units do not pass through or shove idle units, including head-on corridor conflict', () => {
    const world = makeWorld(12, 11);
    for (let y = 0; y < 11; y += 1) {
      if (y !== 5) {
        for (let x = 0; x < 12; x += 1) {
          setBlock(world.map, { x, y });
        }
      }
    }
    const idleId = world.spawnUnit(1, 'worker', { x: 5, y: 5 });
    const moverId = world.spawnUnit(1, 'worker', { x: 2, y: 5 });
    const enemyMoverId = world.spawnUnit(1, 'worker', { x: 9, y: 5 });
    const idle = world.units.get(idleId);
    if (idle === undefined) {
      throw new Error('missing idle unit');
    }
    world.issueMove([moverId], { x: 8, y: 5 });
    world.issueMove([enemyMoverId], { x: 1, y: 5 });
    for (let tick = 0; tick < TICK_RATE * 40; tick += 1) {
      world.step(1);
      world.assertInvariants();
      expect(idle.x).toBe(5.5);
      expect(idle.y).toBe(5.5);
    }
    expect(Array.from(world.units.values()).every(unit => unit.order.kind === 'idle')).toBe(true);
  });
});

function assertNoStacks(world: ReturnType<typeof makeWorld>): void {
  const all = units(world);
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      expect(distance({ x: all[i].x, y: all[i].y }, { x: all[j].x, y: all[j].y })).toBeGreaterThanOrEqual(0.5);
    }
  }
}
