/**
 * Tests for game simulation: initialization, tick processing, win/lose.
 */

import { describe, it, expect } from 'vitest';
import { initGame, gameTick, spawnTestUnit, spawnTestBuilding, setResources, destroyEntity } from '../src/sim/game';
import { hasBuildings } from '../src/sim/entities';
import type { GameConfig } from '../src/core/types';

describe('Game Simulation', () => {
  const defaultConfig: GameConfig = {
    seed: 42,
    level: 0,
    playerFaction: 'humans',
    difficulty: 1,
  };

  it('should initialize with correct starting state', () => {
    const state = initGame(defaultConfig);
    
    expect(state.tick).toBe(0);
    expect(state.winner).toBeNull();
    expect(state.resources.humans.gold).toBeGreaterThan(0);
    expect(state.resources.humans.wood).toBeGreaterThan(0);
    expect(state.supplyUsed.humans).toBeGreaterThan(0);
  });

  it('should have both factions with buildings', () => {
    const state = initGame(defaultConfig);
    
    expect(hasBuildings(state, 'humans')).toBe(true);
    expect(hasBuildings(state, 'orcs')).toBe(true);
  });

  it('should increment tick on each gameTick', () => {
    const state = initGame(defaultConfig);
    
    gameTick(state);
    expect(state.tick).toBe(1);
    
    gameTick(state);
    expect(state.tick).toBe(2);
  });

  it('should not tick when paused', () => {
    const state = initGame(defaultConfig);
    state.paused = true;
    
    gameTick(state);
    expect(state.tick).toBe(0);
  });

  it('should not tick when game is over', () => {
    const state = initGame(defaultConfig);
    state.winner = 'humans';
    
    gameTick(state);
    expect(state.tick).toBe(0);
  });

  it('should spawn test units', () => {
    const state = initGame(defaultConfig);
    const unit = spawnTestUnit(state, 'humans', 'worker', 10, 10);
    
    expect(unit.id).toBeGreaterThan(0);
    expect(unit.faction).toBe('humans');
    expect(unit.unitType).toBe('worker');
    expect(unit.x).toBe(10);
    expect(unit.y).toBe(10);
    expect(unit.alive).toBe(true);
  });

  it('should spawn test buildings', () => {
    const state = initGame(defaultConfig);
    const building = spawnTestBuilding(state, 'humans', 'farm', 5, 5);
    
    expect(building.entityType).toBe('building');
    expect(building.buildingType).toBe('farm');
    expect(building.alive).toBe(true);
  });

  it('should set resources', () => {
    const state = initGame(defaultConfig);
    setResources(state, 'humans', 1000, 500);
    
    expect(state.resources.humans.gold).toBe(1000);
    expect(state.resources.humans.wood).toBe(500);
  });

  it('should destroy entities', () => {
    const state = initGame(defaultConfig);
    const unit = spawnTestUnit(state, 'humans', 'worker', 10, 10);
    
    destroyEntity(state, unit);
    
    expect(unit.alive).toBe(false);
  });

  it('should trigger win/lose when all buildings destroyed', () => {
    const state = initGame(defaultConfig);
    
    // Destroy all human buildings
    const humanBuildings = state.entities.filter(e => 
      e.faction === 'humans' && e.entityType === 'building',
    );
    for (const building of humanBuildings) {
      destroyEntity(state, building);
    }
    
    gameTick(state);
    expect(state.winner).toBe('orcs');
  });

  it('should handle multiple ticks without errors', () => {
    const state = initGame(defaultConfig);
    
    // Run for 1000 ticks
    for (let i = 0; i < 1000; i++) {
      gameTick(state);
    }
    
    expect(state.tick).toBe(1000);
  });
});
