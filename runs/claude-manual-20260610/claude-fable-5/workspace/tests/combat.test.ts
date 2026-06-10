import { describe, expect, it } from 'vitest';
import {
  createGame,
  spawnBuilding,
  spawnUnit,
  trainUnit,
  canTrain,
  recomputeSupply,
} from '../src/game/commands';
import {
  BUILDING_STATS,
  BuildingType,
  computeDamage,
  Faction,
  UNIT_STATS,
  UnitType,
} from '../src/game/data';
import { applyDamageToUnit, applyDamageToBuilding } from '../src/game/sim';
import { GameState } from '../src/game/state';

function freshGame(): GameState {
  return createGame(1, 4242, Faction.Humans);
}

describe('combat damage math', () => {
  it('damage = attack - armor, with a minimum of 1', () => {
    expect(computeDamage(8, 2)).toBe(6);
    expect(computeDamage(14, 4)).toBe(10);
    expect(computeDamage(3, 10)).toBe(1); // floor at MIN_DAMAGE
    expect(computeDamage(1, 0)).toBe(1);
  });

  it('applies armor when units take damage', () => {
    const state = freshGame();
    const melee = spawnUnit(state, Faction.Orcs, UnitType.Melee, 10, 10);
    const before = melee.hp;
    applyDamageToUnit(state, melee, UNIT_STATS[UnitType.Heavy].damage, null);
    expect(melee.hp).toBe(before - computeDamage(14, UNIT_STATS[UnitType.Melee].armor));
  });

  it('applies building armor and floors at 1', () => {
    const state = freshGame();
    const hall = state.buildings.find((b) => b.faction === Faction.Humans)!;
    const before = hall.hp;
    applyDamageToBuilding(state, hall, 4); // armor 5 => minimum damage 1
    expect(hall.hp).toBe(before - 1);
  });

  it('idle military units retaliate against their attacker', () => {
    const state = freshGame();
    const victim = spawnUnit(state, Faction.Orcs, UnitType.Melee, 10, 10);
    const attacker = spawnUnit(state, Faction.Humans, UnitType.Melee, 11, 10);
    applyDamageToUnit(state, victim, 8, attacker.id);
    expect(victim.autoTargetId).toBe(attacker.id);
  });
});

describe('supply accounting', () => {
  it('starts with town hall supply and worker usage', () => {
    const state = freshGame();
    recomputeSupply(state);
    const p = state.players[0];
    expect(p.supplyCap).toBe(BUILDING_STATS[BuildingType.TownHall].supplyGranted);
    expect(p.supplyUsed).toBe(4); // four starting workers, 1 supply each
  });

  it('blocks training at the supply cap and resumes after a farm', () => {
    const state = freshGame();
    recomputeSupply(state);
    const p = state.players[0];
    p.gold = 100000;
    p.wood = 100000;
    const hall = state.buildings.find(
      (b) => b.faction === Faction.Humans && b.type === BuildingType.TownHall,
    )!;
    // Cap is 5, 4 used: exactly one more worker fits.
    expect(canTrain(state, hall, UnitType.Worker)).toBe(true);
    expect(trainUnit(state, hall, UnitType.Worker)).toBe(true);
    recomputeSupply(state);
    expect(p.supplyUsed).toBe(5); // queued units consume supply
    expect(canTrain(state, hall, UnitType.Worker)).toBe(false);
    expect(trainUnit(state, hall, UnitType.Worker)).toBe(false);

    // A constructed farm raises the cap and unblocks training.
    spawnBuilding(state, Faction.Humans, BuildingType.Farm, 1, 1, true);
    recomputeSupply(state);
    expect(p.supplyCap).toBe(
      BUILDING_STATS[BuildingType.TownHall].supplyGranted +
        BUILDING_STATS[BuildingType.Farm].supplyGranted,
    );
    expect(canTrain(state, hall, UnitType.Worker)).toBe(true);
  });

  it('heavy units cost 2 supply', () => {
    const state = freshGame();
    recomputeSupply(state);
    const used = state.players[0].supplyUsed;
    spawnUnit(state, Faction.Humans, UnitType.Heavy, 8, 8);
    recomputeSupply(state);
    expect(state.players[0].supplyUsed).toBe(used + UNIT_STATS[UnitType.Heavy].supplyCost);
  });

  it('training requires tech buildings (ranged needs a lumber mill)', () => {
    const state = freshGame();
    recomputeSupply(state);
    const p = state.players[0];
    p.gold = 100000;
    p.wood = 100000;
    const barracks = spawnBuilding(state, Faction.Humans, BuildingType.Barracks, 1, 1, true);
    recomputeSupply(state);
    expect(canTrain(state, barracks, UnitType.Ranged)).toBe(false);
    spawnBuilding(state, Faction.Humans, BuildingType.LumberMill, 5, 1, true);
    expect(canTrain(state, barracks, UnitType.Ranged)).toBe(true);
  });
});
