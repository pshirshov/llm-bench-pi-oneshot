/**
 * Tests for campaign system: levels, progression, seeds.
 */

import { describe, it, expect } from 'vitest';
import { CAMPAIGN_DATA, createLevelConfig, getLevelSeed, getNextLevel, isLevelUnlocked } from '../src/campaign/levels';
import { initGame, gameTick } from '../src/sim/game';

describe('Campaign', () => {
  it('should have 5 campaign levels', () => {
    expect(CAMPAIGN_DATA.length).toBe(5);
  });

  it('should have first level unlocked', () => {
    expect(CAMPAIGN_DATA[0].unlocked).toBe(true);
  });

  it('should create level config', () => {
    const config = createLevelConfig(42, 0, 'humans');
    
    expect(config.seed).toBe(42);
    expect(config.level).toBe(0);
    expect(config.playerFaction).toBe('humans');
    expect(config.difficulty).toBe(1);
  });

  it('should get correct level seed', () => {
    const seed1 = getLevelSeed(42, 0);
    const seed2 = getLevelSeed(42, 1);
    
    expect(seed1).not.toBe(seed2);
  });

  it('should get next level', () => {
    expect(getNextLevel(0)).toBe(1);
    expect(getNextLevel(1)).toBe(2);
    expect(getNextLevel(4)).toBe(4); // Last level
  });

  it('should check level unlock status', () => {
    expect(isLevelUnlocked(0, [])).toBe(true);
    expect(isLevelUnlocked(1, [])).toBe(false);
    expect(isLevelUnlocked(1, [0])).toBe(true);
    expect(isLevelUnlocked(2, [0, 1])).toBe(true);
  });

  it('should initialize all campaign levels', { timeout: 120000 }, () => {
    for (let level = 0; level < 5; level++) {
      const config = createLevelConfig(42, level, 'humans');
      const state = initGame(config);
      
      expect(state.map.level).toBe(level);
      expect(state.map.width).toBeGreaterThan(0);
      expect(state.map.height).toBeGreaterThan(0);
    }
  });

  it('should step each campaign level without errors', { timeout: 120000 }, () => {
    for (let level = 0; level < 5; level++) {
      const config = createLevelConfig(42, level, 'humans');
      const state = initGame(config);
      
      for (let i = 0; i < 100; i++) {
        gameTick(state);
      }
      
      expect(state.tick).toBe(100);
    }
  });
});
