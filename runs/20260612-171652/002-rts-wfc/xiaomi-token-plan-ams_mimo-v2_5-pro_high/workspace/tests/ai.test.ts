/**
 * Tests for AI opponent: behavior, progression, rebuilding.
 */

import { describe, it, expect } from 'vitest';
import { initGame, gameTick } from '../src/sim/game';
import { createAIState, processAI } from '../src/ai/ai';
import { hasBuildings } from '../src/sim/entities';
import type { GameConfig } from '../src/core/types';

describe('AI', () => {
  const defaultConfig: GameConfig = {
    seed: 42,
    level: 0,
    playerFaction: 'humans',
    difficulty: 1,
  };

  it('should initialize AI state', () => {
    const ai = createAIState('orcs', 1);
    
    expect(ai.faction).toBe('orcs');
    expect(ai.difficulty).toBe(1);
    expect(ai.lastWaveTick).toBe(0);
    expect(ai.waveNumber).toBe(0);
  });

  it('should process AI without errors', () => {
    const state = initGame(defaultConfig);
    const ai = createAIState('orcs', 1);
    
    // Run AI for some ticks
    for (let i = 0; i < 100; i++) {
      processAI(state, ai);
      gameTick(state);
    }
    
    // No errors should occur
  });

  it('should have AI faction with buildings', () => {
    const state = initGame(defaultConfig);
    
    expect(hasBuildings(state, 'orcs')).toBe(true);
  });

  it('should have AI faction with workers', () => {
    const state = initGame(defaultConfig);
    
    const workers = state.entities.filter(e => 
      e.alive && e.faction === 'orcs' && e.entityType === 'unit' && e.unitType === 'worker',
    );
    
    expect(workers.length).toBeGreaterThan(0);
  });

  it('should maintain AI state across ticks', () => {
    const state = initGame(defaultConfig);
    const ai = createAIState('orcs', 1);
    
    // Run for a while
    for (let i = 0; i < 500; i++) {
      processAI(state, ai);
      gameTick(state);
    }
    
    // AI should still have buildings
    expect(hasBuildings(state, 'orcs')).toBe(true);
  });
});
