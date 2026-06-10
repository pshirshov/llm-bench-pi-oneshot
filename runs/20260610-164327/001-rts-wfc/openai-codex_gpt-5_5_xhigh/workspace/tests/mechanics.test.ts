import { describe, expect, it } from 'vitest';
import { UNIT_STATS } from '../src/data';
import { calculateSupply, canReserveSupply, computeDamage } from '../src/mechanics';
import { GameSimulation } from '../src/simulation';

describe('combat and supply mechanics', () => {
  it('BA: applies armor reduction with a minimum damage floor', () => {
    expect(computeDamage(9, 2)).toBe(7);
    expect(computeDamage(3, 99)).toBe(1);
    expect(computeDamage(16, 0)).toBe(16);
  });

  it('BG: counts living units, completed supply buildings, and queued training', () => {
    const sim = new GameSimulation({ campaignSeed: 101, level: 1, playerFaction: 'humans' });
    const supplyBefore = sim.getSupply(0);
    const townHall = sim.buildingsForSide(0).find((entity) => entity.type === 'townHall');
    if (townHall === undefined) {
      throw new Error('test setup expected a starting town hall');
    }

    expect(supplyBefore.used).toBe(5);
    expect(supplyBefore.cap).toBe(10);
    expect(sim.queueTraining(townHall.id, 'worker').ok).toBe(true);
    expect(sim.getSupply(0).used).toBe(6);
    expect(calculateSupply(sim.players[0], sim.entities.values())).toEqual(sim.getSupply(0));
  });

  it('BG: blocks training when reserved supply reaches the cap', () => {
    const sim = new GameSimulation({ campaignSeed: 202, level: 1, playerFaction: 'orcs' });
    const townHall = sim.buildingsForSide(0).find((entity) => entity.type === 'townHall');
    if (townHall === undefined) {
      throw new Error('test setup expected a starting hall');
    }
    sim.players[0].resources.gold = 10_000;
    sim.players[0].resources.wood = 10_000;

    for (let i = 0; i < 5; i += 1) {
      expect(sim.queueTraining(townHall.id, 'worker').ok).toBe(true);
    }
    expect(sim.getSupply(0)).toEqual({ used: 10, cap: 10 });
    expect(canReserveSupply(sim.players[0], sim.entities.values(), 'worker')).toBe(false);
    expect(sim.queueTraining(townHall.id, 'worker')).toEqual({ ok: false, reason: 'Supply cap reached. Build more Farms.' });
    expect(UNIT_STATS.worker.supplyCost).toBe(1);
  });
});
