/**
 * Boot smoke tests: each campaign level can be created headlessly
 * and stepped 600 ticks without exceptions.
 */

import { describe, it, expect } from 'vitest';
import { initGame, gameTick } from '../src/sim/game';
import { createLevelConfig } from '../src/campaign/levels';

describe('Boot Smoke Tests', () => {
  for (let level = 0; level < 5; level++) {
    it(`should boot level ${level} and run 600 ticks without exceptions`, { timeout: 60000 }, () => {
      const config = createLevelConfig(42, level, 'humans');
      const state = initGame(config);
      
      for (let i = 0; i < 600; i++) {
        gameTick(state);
      }
      
      expect(state.tick).toBe(600);
    });
  }
});
