/**
 * T17 GameSession tests — headless (no DOM, no rAF).
 *
 * Covers the three load-bearing properties of the session:
 *   (a) WIN/LOSE: destroying ALL of one faction's buildings makes
 *       `checkEndCondition` return that side's result — 'defeat' when the PLAYER
 *       has none, 'victory' when the ENEMY has none.
 *   (b) FIXED-TIMESTEP + speed + pause: the speed multiplier scales how many
 *       `stepWorld` steps a fixed real-dt sequence drains (speed 2 ≈ 2× speed 1),
 *       a paused session drains ZERO steps, and sub-step dt accumulates across
 *       frames instead of being dropped.
 *   (c) DETERMINISM: two same-seed sessions fed the same `frame(dt)` sequence end
 *       with bit-identical Worlds.
 *
 * Step counting uses `world.tick`: `stepWorld` increments it by exactly one per
 * call (asserted by sim.test.ts), so the tick delta IS the number of fixed steps
 * a `frame()` ran — a direct observation, no mocking.
 */

import { describe, it, expect } from "vitest";
import { GameSession } from "../src/game/session.js";
import type { SessionViewport } from "../src/game/session.js";
import { SIM_HZ } from "../src/sim/simulation.js";
import type { World } from "../src/sim/world.js";
import type { Building } from "../src/sim/entity.js";
import type { Faction } from "../src/game/types.js";
import { campaignLevel } from "../src/game/campaign.js";

const SEED = 0xc0ffee;
const LEVEL = 0;
const PLAYER: Faction = "human";
const DIFFICULTY = 2;

/** Wall-clock ms of one fixed step (mirrors the session's internal constant). */
const MS_PER_STEP = 1000 / SIM_HZ;

function makeSession(): GameSession {
  return new GameSession(SEED, LEVEL, PLAYER, DIFFICULTY);
}

/** All buildings owned by `faction`. */
function buildingsOf(world: World, faction: Faction): Building[] {
  return [...world.buildings.values()].filter((b) => b.owner === faction);
}

/**
 * Removes every building owned by `faction` from the world directly (vacating
 * its footprint), with NO `stepWorld` in between. Direct removal isolates the
 * end-condition predicate from the simulation's reaction: routing destruction
 * through `stepWorld` would let the AI phase place a replacement construction
 * site the SAME tick its last building dies (the AI's rebuild-on-destruction
 * behaviour), so the AI faction would never be observed building-less. This
 * helper tests exactly what the acceptance criterion states — "destroying ALL
 * of one faction's buildings" — without that confound.
 */
function destroyAllBuildings(world: World, faction: Faction): void {
  for (const b of buildingsOf(world, faction)) {
    world.buildings.delete(b.id);
    world.map.vacate(b.tile, b.footprint);
  }
}

/**
 * Plain serialisable snapshot of the mutable simulation state, for determinism
 * comparison. Excludes closures (`nextId`) and re-derives only value data.
 */
function snapshotWorld(world: World): string {
  const units = [...world.units.values()]
    .map((u) => ({
      id: u.id,
      owner: u.owner,
      kind: u.kind,
      hp: u.hp,
      x: u.pos.x,
      y: u.pos.y,
      order: u.order,
      cooldown: u.attackCooldown,
    }))
    .sort((a, b) => a.id - b.id);

  const buildings = [...world.buildings.values()]
    .map((b) => ({
      id: b.id,
      owner: b.owner,
      kind: b.kind,
      hp: b.hp,
      tile: b.tile,
      progress: b.buildProgress,
    }))
    .sort((a, b) => a.id - b.id);

  return JSON.stringify({
    tick: world.tick,
    nextEntityId: world.nextEntityId,
    players: world.players,
    units,
    buildings,
  });
}

// ===========================================================================
// (a) Win / lose
// ===========================================================================

describe("GameSession.checkEndCondition", () => {
  it("returns null while both factions still hold buildings", () => {
    const s = makeSession();
    expect(buildingsOf(s.world, "human").length).toBeGreaterThan(0);
    expect(buildingsOf(s.world, "orc").length).toBeGreaterThan(0);
    expect(s.checkEndCondition()).toBe(null);
    expect(s.result).toBe(null);
  });

  it("returns 'defeat' when the PLAYER faction loses all its buildings", () => {
    const s = makeSession();
    destroyAllBuildings(s.world, PLAYER);

    expect(buildingsOf(s.world, PLAYER)).toHaveLength(0);
    expect(buildingsOf(s.world, "orc").length).toBeGreaterThan(0);
    expect(s.checkEndCondition()).toBe("defeat");
    // Result latches: a later call (even after more buildings change) is stable.
    expect(s.result).toBe("defeat");
    expect(s.checkEndCondition()).toBe("defeat");
  });

  it("returns 'victory' when the ENEMY faction loses all its buildings", () => {
    const s = makeSession();
    const enemy = s.enemyFaction;
    expect(enemy).toBe("orc");
    destroyAllBuildings(s.world, enemy);

    expect(buildingsOf(s.world, enemy)).toHaveLength(0);
    expect(buildingsOf(s.world, PLAYER).length).toBeGreaterThan(0);
    expect(s.checkEndCondition()).toBe("victory");
    expect(s.result).toBe("victory");
  });

  it("a decided match stops stepping: frame() runs zero further steps", () => {
    const s = makeSession();
    destroyAllBuildings(s.world, s.enemyFaction);
    expect(s.checkEndCondition()).toBe("victory");

    const tickAtDecision = s.world.tick;
    // A large dt that would otherwise drain MANY steps must drain none.
    s.frame(10_000);
    expect(s.world.tick).toBe(tickAtDecision);
  });
});

// ===========================================================================
// (a2) D3 — the match world uses the CAMPAIGN LEVEL's dimensions, not 48×48
// ===========================================================================

describe("GameSession map dimensions follow the campaign level (D3)", () => {
  /** A minimal viewport so the constructor's width/height go in the 6th/7th slot. */
  const VIEWPORT: SessionViewport = { tileSize: 24, viewportW: 800, viewportH: 600 };

  /** Builds a session exactly as `main.ts` does: forwarding `level.width/height`. */
  function sessionForLevel(levelIndex: number): GameSession {
    const level = campaignLevel(levelIndex);
    return new GameSession(
      SEED,
      levelIndex,
      PLAYER,
      level.aiDifficulty,
      VIEWPORT,
      level.width,
      level.height,
    );
  }

  it("level 0 (Greenfields) yields a 32×32 world map", () => {
    const s = sessionForLevel(0);
    expect(campaignLevel(0).width).toBe(32);
    expect(s.world.map.width).toBe(32);
    expect(s.world.map.height).toBe(32);
  });

  // 96×96 WFC generation costs several seconds; give it a generous per-test
  // budget (the default 5 s timeout is too tight), mirroring campaign.test.ts.
  it("level 4 (Ironhold) yields a 96×96 world map — size escalation is realized in play", () => {
    const s = sessionForLevel(4);
    expect(campaignLevel(4).name).toBe("Ironhold");
    expect(campaignLevel(4).width).toBe(96);
    expect(s.world.map.width).toBe(96);
    expect(s.world.map.height).toBe(96);
  }, 60_000);

  it("regression guard: a session built WITHOUT explicit dimensions still defaults to 48×48", () => {
    // The default arg path (no width/height) must keep the historical 48×48 size,
    // so existing 4-arg / 5-arg callers and tests are unaffected by D3.
    const s = new GameSession(SEED, 0, PLAYER, 1);
    expect(s.world.map.width).toBe(48);
    expect(s.world.map.height).toBe(48);
  });
});

// ===========================================================================
// (b) Fixed-timestep loop: speed + pause + accumulation
// ===========================================================================

describe("GameSession fixed-timestep loop", () => {
  it("a paused session drains ZERO steps regardless of dt", () => {
    const s = makeSession();
    s.inputContext().paused = true;

    const tick0 = s.world.tick;
    s.frame(MS_PER_STEP * 100);
    s.frame(MS_PER_STEP * 100);
    expect(s.world.tick).toBe(tick0);
    expect(s.paused).toBe(true);
  });

  it("speed 2 drains ~2× the steps of speed 1 for the same dt sequence", () => {
    const slow = makeSession();
    const fast = makeSession();
    fast.inputContext().speed = 2;
    expect(slow.speed).toBe(1);
    expect(fast.speed).toBe(2);

    // Feed both an identical sequence of frames. Each frame is well above one
    // fixed step but below the per-frame step cap, so neither session clamps.
    const FRAME_MS = MS_PER_STEP * 3;
    const FRAMES = 20;
    for (let i = 0; i < FRAMES; i++) {
      slow.frame(FRAME_MS);
      fast.frame(FRAME_MS);
    }

    const slowSteps = slow.world.tick;
    const fastSteps = fast.world.tick;
    expect(slowSteps).toBeGreaterThan(0);
    // 2× the scaled time drains ~2× the steps. `MS_PER_STEP` is 1000/30 ms, so no
    // integer dt is an exact multiple of a step; the per-frame accumulator
    // remainder makes the ratio land within ±1 step of exactly 2× over the run
    // (the spec asks for "~2×", not bit-exact). Bound it tightly around 2×.
    expect(fastSteps).toBeGreaterThanOrEqual(slowSteps * 2 - 1);
    expect(fastSteps).toBeLessThanOrEqual(slowSteps * 2 + 1);
  });

  it("drains floor(scaledTime / step) steps and carries the sub-step remainder", () => {
    const s = makeSession();

    // 2.5 steps of real time in one frame ⇒ 2 steps run, 0.5 step carried.
    s.frame(MS_PER_STEP * 2.5);
    expect(s.world.tick).toBe(2);

    // Another 2.5 steps: carried 0.5 + 2.5 = 3.0 ⇒ 3 steps this frame (total 5).
    s.frame(MS_PER_STEP * 2.5);
    expect(s.world.tick).toBe(5);
  });

  it("sub-step dt accumulates across frames instead of being dropped", () => {
    const s = makeSession();
    const half = MS_PER_STEP / 2;

    // A frame shorter than one step runs nothing yet (it accumulates).
    s.frame(half);
    expect(s.world.tick).toBe(0);

    // The next half-step completes one whole step.
    s.frame(half);
    expect(s.world.tick).toBe(1);
  });

  it("clamps catch-up to the per-frame step budget (no spiral of death)", () => {
    const s = makeSession();
    // An enormous dt (e.g. a backgrounded tab) must not drain unbounded steps.
    s.frame(MS_PER_STEP * 10_000);
    // Budget is 8 steps/frame; the surplus lag is discarded, not queued.
    expect(s.world.tick).toBeLessThanOrEqual(8);
    expect(s.world.tick).toBeGreaterThan(0);

    // The next frame must NOT replay the discarded backlog — at most the budget.
    const after = s.world.tick;
    s.frame(0);
    expect(s.world.tick).toBe(after);
  });
});

// ===========================================================================
// (c) Determinism
// ===========================================================================

describe("GameSession determinism", () => {
  it("same seed + same frame(dt) sequence ⇒ identical World", () => {
    const a = makeSession();
    const b = makeSession();

    // Equal before any frame.
    expect(snapshotWorld(a.world)).toBe(snapshotWorld(b.world));

    // An irregular dt sequence (mix of whole + fractional steps) to exercise the
    // accumulator path, fed identically to both sessions.
    const seq = [16, 33, 8, 50, 16, 16, 100, 4, 16, 33];
    for (let rep = 0; rep < 6; rep++) {
      for (const dt of seq) {
        a.frame(dt);
        b.frame(dt);
      }
    }

    expect(a.world.tick).toBeGreaterThan(0);
    expect(a.world.tick).toBe(b.world.tick);
    expect(snapshotWorld(a.world)).toBe(snapshotWorld(b.world));
  });
});
