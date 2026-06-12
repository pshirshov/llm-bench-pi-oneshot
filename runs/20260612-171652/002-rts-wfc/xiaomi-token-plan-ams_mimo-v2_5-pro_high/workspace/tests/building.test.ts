/**
 * Tests for building system: placement, construction, repair.
 */

import { describe, it, expect } from 'vitest';
import { initGame } from '../src/sim/game';
import { isValidPlacement } from '../src/sim/orders';
import { FACTION_STATS } from '../src/core/stats';
import type { GameConfig, BuildingType } from '../src/core/types';

describe('Building System', () => {
  const defaultConfig: GameConfig = {
    seed: 42,
    level: 0,
    playerFaction: 'humans',
    difficulty: 1,
  };

  it('should validate placement correctly', () => {
    const state = initGame(defaultConfig);
    
    // Find a clear area
    const clearArea = findClearArea(state);
    expect(clearArea).not.toBeNull();
    
    if (clearArea) {
      const valid = isValidPlacement(state, clearArea.x, clearArea.y, 3, 3);
      expect(valid).toBe(true);
    }
  });

  it('should reject placement on water', () => {
    const state = initGame(defaultConfig);
    
    // Find a water tile
    const waterTile = state.map.tiles.findIndex(t => t === 'water');
    if (waterTile >= 0) {
      const x = waterTile % state.map.width;
      const y = Math.floor(waterTile / state.map.width);
      const valid = isValidPlacement(state, x, y, 3, 3);
      expect(valid).toBe(false);
    }
  });

  it('should reject placement on rock', () => {
    const state = initGame(defaultConfig);
    
    const rockTile = state.map.tiles.findIndex(t => t === 'rock');
    if (rockTile >= 0) {
      const x = rockTile % state.map.width;
      const y = Math.floor(rockTile / state.map.width);
      const valid = isValidPlacement(state, x, y, 3, 3);
      expect(valid).toBe(false);
    }
  });

  it('should reject placement on existing buildings', () => {
    const state = initGame(defaultConfig);
    
    // Find the town hall
    const townHall = state.entities.find(e => 
      e.entityType === 'building' && e.buildingType === 'townHall',
    );
    
    if (townHall) {
      const valid = isValidPlacement(state, townHall.x, townHall.y, 3, 3);
      expect(valid).toBe(false);
    }
  });

  it('should reject placement out of bounds', () => {
    const state = initGame(defaultConfig);
    
    expect(isValidPlacement(state, -1, -1, 3, 3)).toBe(false);
    expect(isValidPlacement(state, state.map.width, state.map.height, 3, 3)).toBe(false);
  });

  it('should have correct building stats', () => {
    const buildingTypes: BuildingType[] = ['townHall', 'farm', 'barracks', 'lumberMill', 'guardTower'];
    
    for (const buildingType of buildingTypes) {
      const stats = FACTION_STATS.humans.buildings[buildingType];
      
      expect(stats.hp).toBeGreaterThan(0);
      expect(stats.width).toBeGreaterThan(0);
      expect(stats.height).toBeGreaterThan(0);
    }
  });

  it('should have town hall as the largest building', () => {
    const townHall = FACTION_STATS.humans.buildings.townHall;
    const farm = FACTION_STATS.humans.buildings.farm;
    
    expect(townHall.width).toBeGreaterThanOrEqual(farm.width);
    expect(townHall.height).toBeGreaterThanOrEqual(farm.height);
  });
});

function findClearArea(state: ReturnType<typeof initGame>): { x: number; y: number } | null {
  for (let y = 5; y < state.map.height - 10; y++) {
    for (let x = 5; x < state.map.width - 10; x++) {
      if (isValidPlacement(state, x, y, 3, 3)) {
        return { x, y };
      }
    }
  }
  return null;
}
