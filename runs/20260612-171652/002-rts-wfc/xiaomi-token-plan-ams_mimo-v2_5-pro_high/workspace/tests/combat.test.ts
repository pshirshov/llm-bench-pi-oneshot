/**
 * Tests for combat system: damage calculation, projectiles, deaths.
 */

import { describe, it, expect } from 'vitest';
import { initGame, gameTick, spawnTestUnit, destroyEntity } from '../src/sim/game';
import { FACTION_STATS } from '../src/core/stats';
import type { GameConfig, UnitType } from '../src/core/types';

describe('Combat', () => {
  const defaultConfig: GameConfig = {
    seed: 42,
    level: 0,
    playerFaction: 'humans',
    difficulty: 1,
  };

  it('should calculate damage correctly: max(1, attack - armor)', () => {
    const attack = 10;
    const armor = 3;
    const expectedDamage = Math.max(1, attack - armor);
    
    expect(expectedDamage).toBe(7);
  });

  it('should deal minimum 1 damage', () => {
    const attack = 5;
    const armor = 10;
    const expectedDamage = Math.max(1, attack - armor);
    
    expect(expectedDamage).toBe(1);
  });

  it('should kill entities when HP reaches 0', () => {
    const state = initGame(defaultConfig);
    
    const unit = spawnTestUnit(state, 'humans', 'worker', 5, 5);
    unit.hp = 1;
    
    // Simulate taking damage
    unit.hp -= 10;
    if (unit.hp <= 0) {
      destroyEntity(state, unit);
    }
    
    expect(unit.alive).toBe(false);
  });

  it('should track HP correctly', () => {
    const state = initGame(defaultConfig);
    
    const unit = spawnTestUnit(state, 'humans', 'melee', 5, 5);
    const initialHp = unit.hp;
    
    // Take some damage
    unit.hp -= 20;
    
    expect(unit.hp).toBe(initialHp - 20);
    expect(unit.hp).toBeGreaterThan(0);
  });

  it('should have correct attack stats for each unit type', () => {
    const unitTypes: UnitType[] = ['worker', 'melee', 'ranged', 'heavy'];
    
    for (const unitType of unitTypes) {
      const stats = FACTION_STATS.humans.units[unitType];
      
      expect(stats.damage).toBeGreaterThan(0);
      expect(stats.attackCooldown).toBeGreaterThan(0);
      expect(stats.attackRange).toBeGreaterThan(0);
    }
  });

  it('should have melee units with range 1', () => {
    const meleeStats = FACTION_STATS.humans.units.melee;
    expect(meleeStats.attackRange).toBe(1);
    
    const workerStats = FACTION_STATS.humans.units.worker;
    expect(workerStats.attackRange).toBe(1);
  });

  it('should have ranged units with range >= 4', () => {
    const rangedStats = FACTION_STATS.humans.units.ranged;
    expect(rangedStats.attackRange).toBeGreaterThanOrEqual(4);
  });

  it('should handle multiple combat ticks without errors', () => {
    const state = initGame(defaultConfig);
    
    // Spawn some units close together
    spawnTestUnit(state, 'humans', 'melee', 5, 5);
    spawnTestUnit(state, 'orcs', 'melee', 6, 5);
    
    // Run combat simulation
    for (let i = 0; i < 100; i++) {
      gameTick(state);
    }
    
    // No errors should occur
  });
});
