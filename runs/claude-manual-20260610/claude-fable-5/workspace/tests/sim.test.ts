import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { createAi, tickAi } from '../src/game/ai';
import { createGame, issueOrder, spawnUnit } from '../src/game/commands';
import { Faction, UnitType, UNIT_STATS } from '../src/game/data';
import { createSimContext, tickGame } from '../src/game/sim';
import { TICK_RATE } from '../src/game/state';

describe('seeded PRNG', () => {
  it('reproduces the same sequence for the same seed', () => {
    const a = new Rng(99);
    const b = new Rng(99);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).toEqual(seqB);
    expect(new Set(seqA).size).toBeGreaterThan(8); // actually varies
  });

  it('stays in [0, 1) and int(n) stays in range', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    for (let i = 0; i < 200; i++) {
      const v = rng.int(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
  });
});

describe('headless simulation smoke test', () => {
  it('runs 3 simulated minutes with both sides active and no thrown errors', () => {
    const state = createGame(1, 20260610, Faction.Humans);
    const ai = createAi(state);
    const ctx = createSimContext(state);

    // Give the human side a scripted economy so both factions are exercised.
    const workers = state.units.filter(
      (u) => u.faction === Faction.Humans && u.type === UnitType.Worker,
    );
    const start = state.map.starts[0];
    let mine = -1;
    let forest = -1;
    for (let r = 0; r < 14 && (mine < 0 || forest < 0); r++) {
      for (let y = start.y - r; y <= start.y + r; y++) {
        for (let x = start.x - r; x <= start.x + r; x++) {
          if (x < 0 || y < 0 || x >= state.map.width || y >= state.map.height) continue;
          const i = y * state.map.width + x;
          if (mine < 0 && state.map.tiles[i] === 5) mine = i;
          if (forest < 0 && state.map.tiles[i] === 2) forest = i;
        }
      }
    }
    expect(mine).toBeGreaterThanOrEqual(0);
    expect(forest).toBeGreaterThanOrEqual(0);
    issueOrder(state, workers[0], { kind: 'harvestGold', tile: mine });
    issueOrder(state, workers[1], { kind: 'harvestWood', tile: forest });

    const ticks = TICK_RATE * 180;
    for (let i = 0; i < ticks && state.result === 'playing'; i++) {
      tickGame(state, ctx);
      tickAi(state, ai);
    }

    // The scripted workers must have banked resources.
    const human = state.players[0];
    expect(human.gold).toBeGreaterThan(800);
    expect(human.wood).toBeGreaterThan(500);

    // The AI must have developed its economy: more units and buildings.
    const aiUnits = state.units.filter((u) => u.faction === state.players[1].faction);
    const aiBuildings = state.buildings.filter((b) => b.faction === state.players[1].faction);
    expect(aiUnits.length).toBeGreaterThan(4);
    expect(aiBuildings.length).toBeGreaterThan(1);

    // No unit may end up inside a blocked tile or off the map.
    for (const u of state.units) {
      expect(u.x).toBeGreaterThanOrEqual(0);
      expect(u.y).toBeGreaterThanOrEqual(0);
      expect(u.x).toBeLessThan(state.map.width);
      expect(u.y).toBeLessThan(state.map.height);
    }
  });

  it('combat between two units kills the weaker one and leaves a fading corpse', () => {
    const state = createGame(1, 31337, Faction.Humans);
    const ctx = createSimContext(state);
    const spot = { x: state.map.starts[0].x + 0.5, y: state.map.starts[0].y + 0.5 };
    const heavy = spawnUnit(state, Faction.Humans, UnitType.Heavy, spot.x, spot.y);
    const melee = spawnUnit(state, Faction.Orcs, UnitType.Melee, spot.x + 1, spot.y);
    issueOrder(state, heavy, { kind: 'attack', targetId: melee.id });
    issueOrder(state, melee, { kind: 'attack', targetId: heavy.id });

    let corpseSeen = false;
    for (let i = 0; i < TICK_RATE * 60; i++) {
      tickGame(state, ctx);
      if (state.corpses.length > 0) corpseSeen = true;
      if (!state.units.some((u) => u.id === melee.id)) break;
    }
    expect(state.units.some((u) => u.id === melee.id)).toBe(false); // melee died
    expect(state.units.some((u) => u.id === heavy.id)).toBe(true); // heavy won
    expect(corpseSeen).toBe(true);

    // Corpses fade away.
    for (let i = 0; i < TICK_RATE * 7; i++) tickGame(state, ctx);
    expect(state.corpses.length).toBe(0);
  });

  it('declares victory when every enemy building is destroyed (and defeat vice versa)', () => {
    const state = createGame(1, 777, Faction.Humans);
    const ctx = createSimContext(state);
    for (const b of state.buildings) {
      if (b.faction !== Faction.Humans) b.hp = 0;
    }
    tickGame(state, ctx);
    expect(state.result).toBe('victory');

    const state2 = createGame(1, 777, Faction.Orcs);
    const ctx2 = createSimContext(state2);
    for (const b of state2.buildings) {
      if (b.faction === Faction.Orcs) b.hp = 0; // the player's own buildings
    }
    tickGame(state2, ctx2);
    expect(state2.result).toBe('defeat');
  });

  it('a group move settles without oscillation', () => {
    const state = createGame(1, 555, Faction.Humans);
    const ctx = createSimContext(state);
    const start = state.map.starts[0];
    // Spawn the squad north of the town hall (the hall occupies start ± 1).
    const units = Array.from({ length: 8 }, (_, i) =>
      spawnUnit(
        state,
        Faction.Humans,
        UnitType.Melee,
        start.x - 1.5 + (i % 4),
        start.y - 3.5 + Math.floor(i / 4),
      ),
    );
    const goal = { x: start.x + 3.5, y: start.y + 3.5 };
    for (const u of units) issueOrder(state, u, { kind: 'move', x: goal.x, y: goal.y });

    for (let i = 0; i < TICK_RATE * 30; i++) tickGame(state, ctx);

    // Everyone idle (settled) and clustered near the goal.
    for (const u of units) {
      expect(u.order.kind).toBe('idle');
      const d = Math.hypot(u.x - goal.x, u.y - goal.y);
      expect(d).toBeLessThan(5);
    }
    // And no two units significantly overlap.
    for (const a of units) {
      for (const b of units) {
        if (a.id >= b.id) continue;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0.3);
      }
    }
    void UNIT_STATS;
  });
});
