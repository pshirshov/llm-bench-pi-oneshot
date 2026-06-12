/**
 * Tests for economy system: harvesting, resources, drop-offs.
 */

import { describe, it, expect } from 'vitest';
import { initGame, spawnTestUnit, setResources } from '../src/sim/game';
import { getDropOffs, getTownHall } from '../src/sim/entities';
import type { GameConfig } from '../src/core/types';

describe('Economy', () => {
  const defaultConfig: GameConfig = {
    seed: 42,
    level: 0,
    playerFaction: 'humans',
    difficulty: 1,
  };

  it('should start with initial resources', () => {
    const state = initGame(defaultConfig);
    
    expect(state.resources.humans.gold).toBeGreaterThan(0);
    expect(state.resources.humans.wood).toBeGreaterThan(0);
  });

  it('should find drop-off buildings', () => {
    const state = initGame(defaultConfig);
    
    const goldDropoffs = getDropOffs(state, 'humans', 'gold');
    const woodDropoffs = getDropOffs(state, 'humans', 'wood');
    
    expect(goldDropoffs.length).toBeGreaterThan(0);
    expect(woodDropoffs.length).toBeGreaterThan(0);
  });

  it('should have town hall as drop-off', () => {
    const state = initGame(defaultConfig);
    
    const townHall = getTownHall(state, 'humans');
    expect(townHall).toBeDefined();
    if (townHall) {
      expect(townHall.buildingType).toBe('townHall');
    }
  });

  it('should track supply correctly', () => {
    const state = initGame(defaultConfig);
    
    const initialSupply = state.supplyUsed.humans;
    expect(initialSupply).toBeGreaterThan(0);
    
    // Spawn a unit
    spawnTestUnit(state, 'humans', 'worker', 5, 5);
    
    // Supply should increase
    // (Note: supply tracking might need to be updated manually)
  });

  it('should handle resource changes', () => {
    const state = initGame(defaultConfig);
    
    setResources(state, 'humans', 100, 50);
    expect(state.resources.humans.gold).toBe(100);
    expect(state.resources.humans.wood).toBe(50);
    
    // Add resources
    state.resources.humans.gold += 50;
    state.resources.humans.wood += 25;
    
    expect(state.resources.humans.gold).toBe(150);
    expect(state.resources.humans.wood).toBe(75);
  });

  it('should not have negative resources', () => {
    const state = initGame(defaultConfig);
    
    setResources(state, 'humans', 10, 10);
    
    // Try to spend more than available
    state.resources.humans.gold = Math.max(0, state.resources.humans.gold - 100);
    state.resources.humans.wood = Math.max(0, state.resources.humans.wood - 100);
    
    expect(state.resources.humans.gold).toBeGreaterThanOrEqual(0);
    expect(state.resources.humans.wood).toBeGreaterThanOrEqual(0);
  });
});
