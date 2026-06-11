/**
 * Tests for combat damage math and supply accounting.
 */
import { describe, it, expect } from 'vitest';
import { calcDamage, applyDamage, isInAttackRange } from '../src/combat/combat.js';
import { Entity, Faction, GameState, TILE_SIZE } from '../src/engine/types.js';
import { getStats } from '../src/entities/stats.js';
import { createEntity, deductCost } from '../src/entities/manager.js';

function makeTestState(): GameState {
  const tiles = [];
  for (let y = 0; y < 16; y++) {
    tiles[y] = [];
    for (let x = 0; x < 16; x++) {
      tiles[y][x] = { type: 'grass', resource: 0, fog: 2, lastSeen: 'grass', lastSeenEntity: null };
    }
  }

  return {
    seed: 42,
    mapWidth: 16,
    mapHeight: 16,
    tiles,
    entities: [],
    projectiles: [],
    nextEntityId: 1,
    nextProjectileId: 1,
    gameTime: 0,
    paused: false,
    speed: 1,
    playerFaction: 'humans',
    aiFaction: 'orcs',
    resources: { humans: [1000, 1000, 0, 20], orcs: [1000, 1000, 0, 20] },
    selectedEntityIds: [],
    level: 0,
    gameOver: false,
    winner: null
  };
}

function makeTestEntity(type: 'worker' | 'melee' | 'ranged' | 'heavy', faction: Faction, x: number, y: number): Entity {
  const stats = getStats(type, faction);
  return {
    id: Math.floor(Math.random() * 10000),
    type,
    faction,
    x,
    y,
    tileX: Math.floor(x / TILE_SIZE),
    tileY: Math.floor(y / TILE_SIZE),
    hp: stats.hp,
    maxHp: stats.maxHp,
    stats,
    state: 'idle',
    targetX: null,
    targetY: null,
    attackTarget: null,
    attackCooldownLeft: 0,
    path: [],
    pathIndex: 0,
    carrying: null,
    carryAmount: 0,
    harvestTileX: null,
    harvestTileY: null,
    buildingType: null,
    buildProgress: 0,
    trainQueue: [],
    deathTimer: 0,
    visible: true
  };
}

describe('Combat Damage Math', () => {
  it('calculates basic damage (attacker damage minus defender armor)', () => {
    const attacker = makeTestEntity('melee', 'humans', 100, 100);
    const defender = makeTestEntity('melee', 'orcs', 120, 100);

    const damage = calcDamage(attacker, defender);
    // Footman: 12 damage, Grunt: 2 armor -> 10
    expect(damage).toBe(10);
  });

  it('enforces minimum damage of 1', () => {
    const attacker = makeTestEntity('worker', 'humans', 100, 100);
    const defender = makeTestEntity('heavy', 'orcs', 120, 100);

    const damage = calcDamage(attacker, defender);
    // Peasant: 5 damage, Ogre: 4 armor -> 1
    expect(damage).toBe(1);
  });

  it('heavy unit deals high damage', () => {
    const attacker = makeTestEntity('heavy', 'humans', 100, 100);
    const defender = makeTestEntity('worker', 'orcs', 120, 100);

    const damage = calcDamage(attacker, defender);
    // Knight: 25 damage, Peon: 0 armor -> 25
    expect(damage).toBe(25);
  });

  it('ranged unit has correct damage', () => {
    const attacker = makeTestEntity('ranged', 'humans', 100, 100);
    const defender = makeTestEntity('melee', 'orcs', 120, 100);

    const damage = calcDamage(attacker, defender);
    // Archer: 15 damage, Grunt: 2 armor -> 13
    expect(damage).toBe(13);
  });

  it('applyDamage reduces HP correctly', () => {
    const entity = makeTestEntity('melee', 'humans', 100, 100);
    const initialHp = entity.hp;

    const died = applyDamage(entity, 10);
    expect(entity.hp).toBe(initialHp - 10);
    expect(died).toBe(false);
  });

  it('applyDamage returns true when HP reaches zero', () => {
    const entity = makeTestEntity('worker', 'humans', 100, 100);
    entity.hp = 5;

    const died = applyDamage(entity, 10);
    expect(entity.hp).toBe(-5);
    expect(died).toBe(true);
  });

  it('melee range check works for adjacent units', () => {
    const attacker = makeTestEntity('melee', 'humans', 100, 100);
    const target = makeTestEntity('melee', 'orcs', 132, 100); // 1 tile away
    const tiles = makeTestState().tiles;

    const inRange = isInAttackRange(attacker, target, tiles);
    expect(inRange).toBe(true);
  });

  it('melee range check fails for distant units', () => {
    const attacker = makeTestEntity('melee', 'humans', 100, 100);
    const target = makeTestEntity('melee', 'orcs', 300, 100); // Far away
    const tiles = makeTestState().tiles;

    const inRange = isInAttackRange(attacker, target, tiles);
    expect(inRange).toBe(false);
  });
});

describe('Supply Accounting', () => {
  it('initial supply is correct', () => {
    const state = makeTestState();
    const [, , supplyUsed, supplyCap] = state.resources['humans'];
    expect(supplyUsed).toBe(0);
    expect(supplyCap).toBe(20);
  });

  it('training a unit increases supply used', () => {
    const state = makeTestState();
    deductCost('worker', 'humans', state);
    expect(state.resources['humans'][2]).toBe(1);
  });

  it('supply cap increases with town hall and farms', () => {
    const state = makeTestState();
    const initialCap = state.resources['humans'][3];

    createEntity('farm', 'humans', 5, 5, state);
    expect(state.resources['humans'][3]).toBe(initialCap + 6);
  });

  it('building a farm does not use supply', () => {
    const state = makeTestState();
    const initialUsed = state.resources['humans'][2];

    createEntity('farm', 'humans', 5, 5, state);
    expect(state.resources['humans'][2]).toBe(initialUsed);
  });
});
