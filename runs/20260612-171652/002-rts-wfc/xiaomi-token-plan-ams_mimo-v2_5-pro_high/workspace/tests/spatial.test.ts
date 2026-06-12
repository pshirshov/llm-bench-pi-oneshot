/**
 * Tests for spatial queries and range checks.
 */

import { describe, it, expect } from 'vitest';
import { initGame, spawnTestUnit } from '../src/sim/game';
import { getEntitiesInRange, buildingCenter } from '../src/sim/entities';
import type { GameConfig } from '../src/core/types';

describe('Spatial Queries', () => {
  const defaultConfig: GameConfig = {
    seed: 42,
    level: 0,
    playerFaction: 'humans',
    difficulty: 1,
  };

  it('should find entities within range', () => {
    const state = initGame(defaultConfig);
    
    // Spawn units at known positions
    spawnTestUnit(state, 'humans', 'worker', 10, 10);
    spawnTestUnit(state, 'humans', 'worker', 10.5, 10.5);
    spawnTestUnit(state, 'humans', 'worker', 20, 20);
    
    const nearby = getEntitiesInRange(state, { x: 10, y: 10 }, 2);
    
    expect(nearby.length).toBeGreaterThan(0);
    for (const entity of nearby) {
      const dx = entity.x - 10;
      const dy = entity.y - 10;
      const dist = Math.sqrt(dx * dx + dy * dy);
      expect(dist).toBeLessThanOrEqual(2);
    }
  });

  it('should filter by faction', () => {
    const state = initGame(defaultConfig);
    
    spawnTestUnit(state, 'humans', 'worker', 10, 10);
    spawnTestUnit(state, 'orcs', 'worker', 10.5, 10.5);
    
    const humanOnly = getEntitiesInRange(state, { x: 10, y: 10 }, 2, 'humans');
    
    for (const entity of humanOnly) {
      expect(entity.faction).toBe('humans');
    }
  });

  it('should return empty for no entities in range', () => {
    const state = initGame(defaultConfig);
    
    const far = getEntitiesInRange(state, { x: 1000, y: 1000 }, 1);
    
    expect(far.length).toBe(0);
  });

  it('should calculate building center correctly', () => {
    const state = initGame(defaultConfig);
    
    const townHall = state.entities.find(e => 
      e.entityType === 'building' && e.buildingType === 'townHall',
    );
    
    if (townHall) {
      const center = buildingCenter(townHall);
      
      expect(center.x).toBe(townHall.x + townHall.width / 2 - 0.5);
      expect(center.y).toBe(townHall.y + townHall.height / 2 - 0.5);
    }
  });
});
