/**
 * Tests for determinism: same seed + same orders = same state.
 */

import { describe, it, expect } from 'vitest';
import { initGame, gameTick, serializeState } from '../src/sim/game';
import type { GameConfig, Faction } from '../src/core/types';

describe('Determinism', () => {
  it('should produce identical state from same seed and orders', () => {
    const config: GameConfig = {
      seed: 42,
      level: 0,
      playerFaction: 'humans',
      difficulty: 1,
    };

    const state1 = initGame(config);
    const state2 = initGame(config);

    // Step both simulations
    for (let i = 0; i < 1000; i++) {
      gameTick(state1);
      gameTick(state2);
    }

    const serialized1 = serializeState(state1);
    const serialized2 = serializeState(state2);

    expect(serialized1).toBe(serialized2);
  });

  it('should produce different maps for different seeds', () => {
    const config1: GameConfig = { seed: 42, level: 0, playerFaction: 'humans', difficulty: 1 };
    const config2: GameConfig = { seed: 43, level: 0, playerFaction: 'humans', difficulty: 1 };

    const state1 = initGame(config1);
    const state2 = initGame(config2);

    // Check that maps are different
    const map1 = state1.map.tiles.join(',');
    const map2 = state2.map.tiles.join(',');

    expect(map1).not.toBe(map2);
  });

  it('should produce identical maps for same seed across different initializations', () => {
    const config: GameConfig = { seed: 12345, level: 0, playerFaction: 'humans', difficulty: 1 };

    const state1 = initGame(config);
    const state2 = initGame(config);

    const map1 = state1.map.tiles.join(',');
    const map2 = state2.map.tiles.join(',');

    expect(map1).toBe(map2);
  });

  it('should have no NaN or non-finite values in state', () => {
    const config: GameConfig = { seed: 42, level: 0, playerFaction: 'humans', difficulty: 1 };
    const state = initGame(config);

    // Step for a while
    for (let i = 0; i < 500; i++) {
      gameTick(state);
    }

    // Check resources
    for (const faction of ['humans', 'orcs'] as Faction[]) {
      expect(Number.isFinite(state.resources[faction].gold)).toBe(true);
      expect(Number.isFinite(state.resources[faction].wood)).toBe(true);
      expect(state.resources[faction].gold).toBeGreaterThanOrEqual(0);
      expect(state.resources[faction].wood).toBeGreaterThanOrEqual(0);
    }

    // Check entities
    for (const entity of state.entities) {
      expect(Number.isFinite(entity.x)).toBe(true);
      expect(Number.isFinite(entity.y)).toBe(true);
      expect(Number.isFinite(entity.hp)).toBe(true);
      expect(entity.hp).toBeGreaterThanOrEqual(0);
    }
  });
});
