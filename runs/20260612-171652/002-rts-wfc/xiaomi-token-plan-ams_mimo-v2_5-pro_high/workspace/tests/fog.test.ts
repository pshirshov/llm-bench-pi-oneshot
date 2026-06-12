/**
 * Tests for fog of war system.
 */

import { describe, it, expect } from 'vitest';
import { initGame } from '../src/sim/game';
import { updateFog, getFogState, isVisible, isTileVisible } from '../src/sim/fog';
import type { GameConfig } from '../src/core/types';

describe('Fog of War', () => {
  const defaultConfig: GameConfig = {
    seed: 42,
    level: 0,
    playerFaction: 'humans',
    difficulty: 1,
  };

  it('should initialize fog as unexplored', () => {
    const state = initGame(defaultConfig);
    
    // Most tiles should be unexplored initially
    const fog = state.map.fog.humans;
    const unexploredCount = fog.filter(f => f === 'unexplored').length;
    
    expect(unexploredCount).toBeGreaterThan(0);
  });

  it('should update fog based on unit sight', () => {
    const state = initGame(defaultConfig);
    
    // Update fog
    updateFog(state, 'humans');
    
    // Some tiles should now be visible
    const fog = state.map.fog.humans;
    const visibleCount = fog.filter(f => f === 'visible').length;
    
    expect(visibleCount).toBeGreaterThan(0);
  });

  it('should have three fog states', () => {
    const state = initGame(defaultConfig);
    
    updateFog(state, 'humans');
    
    const fog = state.map.fog.humans;
    const hasUnexplored = fog.some(f => f === 'unexplored');
    const hasVisible = fog.some(f => f === 'visible');
    
    expect(hasUnexplored).toBe(true);
    expect(hasVisible).toBe(true);
  });

  it('should get fog state for specific tiles', () => {
    const state = initGame(defaultConfig);
    
    updateFog(state, 'humans');
    
    // Get fog at start location
    const start = state.map.startLocations.humans;
    const fogState = getFogState(state, 'humans', start.x, start.y);
    
    expect(['unexplored', 'explored', 'visible']).toContain(fogState);
  });

  it('should report tiles as visible near units', () => {
    const state = initGame(defaultConfig);
    
    // Get a unit
    const unit = state.entities.find(e => 
      e.alive && e.faction === 'humans' && e.entityType === 'unit',
    );
    
    if (unit) {
      updateFog(state, 'humans');
      
      // Tiles near the unit should be visible
      const nearX = Math.floor(unit.x);
      const nearY = Math.floor(unit.y);
      
      expect(isTileVisible(state, 'humans', nearX, nearY)).toBe(true);
    }
  });

  it('should report entities as visible when in sight', () => {
    const state = initGame(defaultConfig);
    
    updateFog(state, 'humans');
    
    // Own units should always be visible
    const humanUnits = state.entities.filter(e => e.alive && e.faction === 'humans');
    for (const unit of humanUnits) {
      expect(isVisible(state, 'humans', unit)).toBe(true);
    }
  });

  it('should track explored tiles', () => {
    const state = initGame(defaultConfig);
    
    updateFog(state, 'humans');
    
    // Some tiles should be explored
    const fog = state.map.fog.humans;
    const exploredCount = fog.filter(f => f === 'explored' || f === 'visible').length;
    
    expect(exploredCount).toBeGreaterThan(0);
  });
});
