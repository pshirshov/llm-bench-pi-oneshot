/**
 * Soak tests: long-running simulations to catch livelock, deadlock, memory leaks.
 */

import { describe, it, expect } from 'vitest';
import { initGame, gameTick } from '../src/sim/game';
import { createAIState, processAI } from '../src/ai/ai';
import type { GameConfig, Faction } from '../src/core/types';

describe('Soak Tests', () => {
  it('should run 2000+ ticks without exceptions', () => {
    const config: GameConfig = {
      seed: 42,
      level: 0,
      playerFaction: 'humans',
      difficulty: 1,
    };

    const state = initGame(config);
    const aiHumans = createAIState('humans', 1);
    const aiOrcs = createAIState('orcs', 1);

    for (let i = 0; i < 2000; i++) {
      processAI(state, aiHumans);
      processAI(state, aiOrcs);
      gameTick(state);
    }

    expect(state.tick).toBe(2000);
  });

  it('should maintain invariants over 2000 ticks', () => {
    const config: GameConfig = {
      seed: 42,
      level: 0,
      playerFaction: 'humans',
      difficulty: 1,
    };

    const state = initGame(config);
    const aiHumans = createAIState('humans', 1);
    const aiOrcs = createAIState('orcs', 1);

    for (let i = 0; i < 2000; i++) {
      processAI(state, aiHumans);
      processAI(state, aiOrcs);
      gameTick(state);

      // Check invariants every 10 ticks
      if (i % 10 === 0) {
        // I2: No negative resources
        for (const faction of ['humans', 'orcs'] as Faction[]) {
          expect(state.resources[faction].gold).toBeGreaterThanOrEqual(0);
          expect(state.resources[faction].wood).toBeGreaterThanOrEqual(0);
        }

        // No NaN values
        for (const entity of state.entities) {
          if (entity.alive) {
            expect(Number.isFinite(entity.x)).toBe(true);
            expect(Number.isFinite(entity.y)).toBe(true);
            expect(Number.isFinite(entity.hp)).toBe(true);
          }
        }
      }
    }
  });

  it('should handle multiple seeds without crashing', { timeout: 120000 }, () => {
    const seeds = [42, 123, 456];

    for (const seed of seeds) {
      const config: GameConfig = {
        seed,
        level: 0,
        playerFaction: 'humans',
        difficulty: 1,
      };

      const state = initGame(config);
      const ai = createAIState('orcs', 1);

      for (let i = 0; i < 200; i++) {
        processAI(state, ai);
        gameTick(state);
      }

      expect(state.tick).toBe(200);
    }
  });

  it('should run AI vs AI match to completion', () => {
    const config: GameConfig = {
      seed: 42,
      level: 0,
      playerFaction: 'humans',
      difficulty: 2,
    };

    const state = initGame(config);
    const aiHumans = createAIState('humans', 2);
    const aiOrcs = createAIState('orcs', 2);

    const maxTicks = 10 * 60 * 20; // 10 sim-minutes at 20 tps

    for (let i = 0; i < maxTicks; i++) {
      processAI(state, aiHumans);
      processAI(state, aiOrcs);
      gameTick(state);

      if (state.winner) break;
    }

    // Match should reach a conclusion or both sides should still have buildings
    const humansAlive = state.entities.some(e => e.alive && e.faction === 'humans' && e.entityType === 'building');
    const orcsAlive = state.entities.some(e => e.alive && e.faction === 'orcs' && e.entityType === 'building');
    expect(state.winner !== null || (humansAlive && orcsAlive)).toBe(true);
  }, 60000);

  it('should handle 100+ units stepping 1000 ticks (performance canary)', () => {
    const config: GameConfig = {
      seed: 42,
      level: 0,
      playerFaction: 'humans',
      difficulty: 1,
    };

    const state = initGame(config);

    // Spawn 100+ units
    for (let i = 0; i < 120; i++) {
      const x = 10 + (i % 20) * 2;
      const y = 10 + Math.floor(i / 20) * 2;
      state.entities.push({
        id: state.nextEntityId++,
        faction: i % 2 === 0 ? 'humans' : 'orcs',
        entityType: 'unit',
        unitType: 'melee',
        x,
        y,
        hp: 100,
        maxHp: 100,
        armor: 0,
        damage: 10,
        attackRange: 1,
        attackCooldown: 20,
        attackCooldownTimer: 0,
        moveSpeed: 2,
        sightRadius: 7,
        order: { type: 'idle' },
        path: [],
        pathIndex: 0,
        cargoGold: 0,
        cargoWood: 0,
        progressTicks: 0,
        progressTotal: 0,
        width: 1,
        height: 1,
        alive: true,
      });
    }

    const startTime = Date.now();
    for (let i = 0; i < 1000; i++) {
      gameTick(state);
    }
    const elapsed = Date.now() - startTime;

    expect(elapsed).toBeLessThan(10000); // Should complete in under 10 seconds
  });
});
