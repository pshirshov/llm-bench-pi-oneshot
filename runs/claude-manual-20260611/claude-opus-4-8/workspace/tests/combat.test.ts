/**
 * T9 combat-phase tests.
 *
 * Required assertions (per the acceptance criteria):
 *   (a) damage = max(1, dmg-armor) for several pairs INCLUDING the min-1 floor.
 *   (b) A unit reduced to ≤ 0 HP is marked dead and removed by cleanup.
 *   (c) A ranged attack SPAWNS a projectile that applies armor-adjusted damage on impact.
 *   (d) Auto-acquire: an idle unit acquires a hostile that enters its sight radius.
 *   (e) Attack cooldown is respected (no double-hit within cooldown).
 *
 * Additional assertions cover:
 *   - Melee attacks apply damage directly (no projectile).
 *   - Guard Tower fires a projectile and respects its cooldown.
 *   - A unit with an `attack` order that targets a dead entity goes idle.
 */

import { describe, it, expect } from "vitest";
import { makeEntityId } from "../src/game/types.js";
import type { EntityId, Faction } from "../src/game/types.js";
import type { Building, Unit } from "../src/sim/entity.js";
import type { World } from "../src/sim/world.js";
import { GameMap } from "../src/sim/gamemap.js";
import { createRng } from "../src/core/rng.js";
import { Grid } from "../src/core/grid.js";
import type { TileType } from "../src/wfc/tiles.js";
import { idle, attack, attackMove } from "../src/sim/orders.js";
import { phaseCombat, computeDamage } from "../src/sim/combat.js";
import { stepWorld } from "../src/sim/simulation.js";

// ---------------------------------------------------------------------------
// Minimal world factory (open grass map, no WFC)
// ---------------------------------------------------------------------------

function makeOpenWorld(w: number = 20, h: number = 20): World {
  const grid = new Grid<TileType>(w, h, "grass");
  const map = new GameMap(grid);

  const mkPlayer = () => ({
    gold: 0,
    wood: 0,
    supplyUsed: 0,
    supplyCap: 100,
  });

  const world: World = {
    map,
    units: new Map(),
    buildings: new Map(),
    projectiles: new Map(),
    players: { human: mkPlayer(), orc: mkPlayer() },
    playerFaction: "human" as Faction,
    aiDifficulty: 1,
    tick: 0,
    rng: createRng(1),
    mapReport: {
      width: w,
      height: h,
      seed: 1,
      levelIndex: 0,
      starts: [
        { x: 0, y: 0 },
        { x: w - 1, y: h - 1 },
      ] as [{ x: number; y: number }, { x: number; y: number }],
      resources: [] as never,
      componentSize: w * h,
      startDistance: w + h,
      attempts: 1,
      carvedCorridor: false,
      adjustedResources: false,
    },
    nextEntityId: 1,
    nextId(): EntityId {
      return makeEntityId(this.nextEntityId++);
    },
    fog: undefined,
  };

  return world;
}

/** Spawn a unit of given kind at fractional (px, py), with optional order. */
function spawnUnit(
  world: World,
  kind: Unit["kind"],
  faction: Faction,
  px: number,
  py: number,
  order: Unit["order"] = idle(),
  hp?: number,
): Unit {
  const maxHp = kind === "worker" ? 40 : kind === "infantry" ? 60 : kind === "ranged" ? 40 : 120;
  const unit: Unit = {
    id: world.nextId(),
    owner: faction,
    kind,
    hp: hp ?? maxHp,
    maxHp,
    pos: { x: px, y: py },
    order,
    attackCooldown: 0,
  };
  world.units.set(unit.id, unit);
  world.players[faction].supplyUsed++;
  return unit;
}

/** Spawn a guard tower building at given tile. */
function spawnGuardTower(world: World, faction: Faction, tx: number, ty: number): Building {
  const building: Building = {
    id: world.nextId(),
    owner: faction,
    kind: "guardTower",
    hp: 400,
    maxHp: 400,
    tile: { x: tx, y: ty },
    footprint: { w: 2, h: 2 },
    buildProgress: 1,
    trainQueue: [],
    attackCooldown: 0,
  };
  world.buildings.set(building.id, building);
  // Occupy the tiles.
  world.map.occupy(building.tile, building.footprint, building.id);
  return building;
}

// ---------------------------------------------------------------------------
// (a) Damage formula: max(1, dmg - armor)
// ---------------------------------------------------------------------------

describe("(a) damage formula: max(1, dmg − armor)", () => {
  it("normal case: dmg=10, armor=2 ⇒ 8", () => {
    expect(computeDamage(10, 2)).toBe(8);
  });

  it("zero armor: dmg=9, armor=0 ⇒ 9", () => {
    expect(computeDamage(9, 0)).toBe(9);
  });

  it("armor equals damage: dmg=5, armor=5 ⇒ 1 (min-1 floor)", () => {
    expect(computeDamage(5, 5)).toBe(1);
  });

  it("armor exceeds damage: dmg=2, armor=5 ⇒ 1 (min-1 floor)", () => {
    expect(computeDamage(2, 5)).toBe(1);
  });

  it("large damage dominates: dmg=18, armor=4 ⇒ 14", () => {
    expect(computeDamage(18, 4)).toBe(14);
  });

  it("min-1 floor when dmg=1, armor=10 ⇒ 1", () => {
    expect(computeDamage(1, 10)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// (b) A unit reduced to ≤ 0 HP is marked dead and removed by cleanup
// ---------------------------------------------------------------------------

describe("(b) death: a unit at ≤ 0 hp is removed by the cleanup phase", () => {
  it("an infantry with 1 hp dies when hit by a worker in melee range", () => {
    // Worker: damage=5, range=1. Infantry armor=2 ⇒ damage dealt=3.
    // But we set infantry hp=1 so one hit kills it.
    const world = makeOpenWorld();
    const attacker = spawnUnit(world, "worker", "human", 5.5, 5.5, idle());
    const target = spawnUnit(world, "infantry", "orc", 6.5, 5.5, idle(), 1 /* hp=1 */);

    // Give attacker an attack order on the target.
    attacker.order = attack(target.id);

    // Run one full step (combat + cleanup phases run).
    stepWorld(world);

    // The target had 1 hp; worker deals max(1, 5-2)=3. Target hp ≤ 0.
    // Cleanup removes it.
    expect(world.units.has(target.id)).toBe(false);
  });

  it("supply is refunded when a unit dies", () => {
    const world = makeOpenWorld();
    const attacker = spawnUnit(world, "infantry", "human", 5.5, 5.5, idle());
    const target = spawnUnit(world, "worker", "orc", 6.5, 5.5, idle(), 1 /* hp=1 */);

    const supplyBefore = world.players.orc.supplyUsed;
    attacker.order = attack(target.id);

    stepWorld(world);

    // Worker hp=1, infantry damage=10, infantry armor=2, but infantry attacks orc
    // worker (armor=0): deals max(1,10-0)=10 ≥ 1 hp → dead.
    expect(world.units.has(target.id)).toBe(false);
    expect(world.players.orc.supplyUsed).toBe(supplyBefore - 1);
  });
});

// ---------------------------------------------------------------------------
// (c) Ranged attack spawns a projectile that applies armor-adjusted damage on impact
// ---------------------------------------------------------------------------

describe("(c) ranged attacks: projectile spawned, armor-adjusted damage on impact", () => {
  it("a ranged unit in range spawns a projectile on first attack", () => {
    const world = makeOpenWorld();
    // Ranged: range=5, damage=9, attackCooldown=25. Archer armor=0.
    // Place them 3 tiles apart (within range 5).
    const archer = spawnUnit(world, "ranged", "human", 5.5, 5.5, idle());
    const target = spawnUnit(world, "infantry", "orc", 8.5, 5.5, idle()); // 3 tiles away

    archer.order = attack(target.id);

    // No projectiles before attack.
    expect(world.projectiles.size).toBe(0);

    // Run combat phase once (don't use stepWorld so cleanup doesn't run).
    phaseCombat(world);

    // A projectile must have been spawned.
    expect(world.projectiles.size).toBe(1);
    const proj = [...world.projectiles.values()][0];
    expect(proj.owner).toBe("human");
    expect(proj.damage).toBe(9); // ranged damage
    expect(proj.target).toBe(target.id);
  });

  it("projectile applies armor-adjusted damage on impact and is removed", () => {
    const world = makeOpenWorld();
    // Infantry armor=2. Ranged damage=9 ⇒ dealt=max(1,9-2)=7.
    const archer = spawnUnit(world, "ranged", "human", 5.5, 5.5, idle());
    const infantry = spawnUnit(world, "infantry", "orc", 7.5, 5.5, idle());
    const hpBefore = infantry.hp; // 60

    archer.order = attack(infantry.id);

    // Fire one shot.
    phaseCombat(world);
    expect(world.projectiles.size).toBe(1);

    // Advance ticks until projectile arrives (travels 2 tiles at ~0.267 tiles/tick ≈ ~8 ticks).
    let arrived = false;
    for (let i = 0; i < 60; i++) {
      phaseCombat(world);
      if (world.projectiles.size === 0) {
        arrived = true;
        break;
      }
    }

    expect(arrived).toBe(true);
    // Damage = max(1, 9-2) = 7.
    expect(infantry.hp).toBe(hpBefore - 7);
  });

  it("projectile does not apply damage to a target that died before impact", () => {
    const world = makeOpenWorld();
    const archer = spawnUnit(world, "ranged", "human", 5.5, 5.5, idle());
    const target = spawnUnit(world, "infantry", "orc", 7.5, 5.5, idle());

    archer.order = attack(target.id);
    phaseCombat(world); // spawns projectile

    // Kill the target entity (simulate death before impact).
    world.units.delete(target.id);

    // Advance until projectile is gone.
    for (let i = 0; i < 60; i++) {
      phaseCombat(world);
      if (world.projectiles.size === 0) break;
    }

    // No crash; projectile removed; target (already deleted) not re-added.
    expect(world.projectiles.size).toBe(0);
    expect(world.units.has(target.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (d) Auto-acquire: an idle unit acquires a hostile that enters its sight
// ---------------------------------------------------------------------------

describe("(d) auto-acquire: idle unit acquires a nearby hostile", () => {
  it("an idle unit gains a target when a hostile is within its sight radius", () => {
    const world = makeOpenWorld();
    // Worker sight=4. Place a hostile worker 3 tiles away (within sight=4).
    const idler = spawnUnit(world, "worker", "human", 5.5, 5.5, idle());
    const hostile = spawnUnit(world, "worker", "orc", 8.5, 5.5, idle()); // 3 tiles away

    // Before combat phase: idler has no target.
    expect(idler.target).toBeUndefined();

    phaseCombat(world);

    // After combat phase: idler acquired the hostile.
    expect(idler.target).toBe(hostile.id);
  });

  it("an idle unit does NOT acquire a friendly unit", () => {
    const world = makeOpenWorld();
    const idler = spawnUnit(world, "worker", "human", 5.5, 5.5, idle());
    const friendly = spawnUnit(world, "worker", "human", 6.5, 5.5, idle());

    phaseCombat(world);

    // No hostile within sight — target stays undefined.
    expect(idler.target).toBeUndefined();
    // The friendly unit is also not targeted.
    expect(friendly.target).toBeUndefined();
  });

  it("an idle unit does NOT acquire a hostile outside its sight radius", () => {
    const world = makeOpenWorld();
    // Worker sight=4. Place hostile 6 tiles away (outside sight).
    const idler = spawnUnit(world, "worker", "human", 5.5, 5.5, idle());
    spawnUnit(world, "worker", "orc", 12.5, 5.5, idle()); // 7 tiles away

    phaseCombat(world);

    expect(idler.target).toBeUndefined();
  });

  it("an attackMove unit auto-acquires a hostile en route", () => {
    const world = makeOpenWorld();
    // Infantry sight=5. Place attacker 3 tiles from a hostile.
    const unit = spawnUnit(world, "infantry", "human", 5.5, 5.5, attackMove({ x: 15, y: 5 }));
    const hostile = spawnUnit(world, "infantry", "orc", 8.5, 5.5, idle());

    expect(unit.target).toBeUndefined();

    phaseCombat(world);

    expect(unit.target).toBe(hostile.id);
  });
});

// ---------------------------------------------------------------------------
// (e) Attack cooldown: no double-hit within cooldown
// ---------------------------------------------------------------------------

describe("(e) attack cooldown is respected — no double-hit within cooldown", () => {
  it("a melee unit attacks once then waits for cooldown before attacking again", () => {
    const world = makeOpenWorld();
    // Infantry: damage=10, armor=2. Worker hp=40, armor=0. Damage dealt=10/tick.
    // Infantry attackCooldown=20 ticks.
    const attacker = spawnUnit(world, "infantry", "human", 5.5, 5.5, idle());
    const target = spawnUnit(world, "worker", "orc", 6.5, 5.5, idle(), 40);

    attacker.order = attack(target.id);

    // Tick 1: attack fires (cooldown=0 ⇒ ready). hp should drop by max(1,10-0)=10.
    phaseCombat(world);
    expect(target.hp).toBe(30);
    // Cooldown is now reset to 20.
    expect(attacker.attackCooldown).toBe(20);

    // Tick 2–20: cooldown counts down, NO additional damage.
    for (let i = 0; i < 19; i++) {
      phaseCombat(world);
    }
    // hp must still be 30 (no second hit until cooldown expires).
    expect(target.hp).toBe(30);
    // cooldown decremented 19 times from 20 ⇒ 1 remaining.
    expect(attacker.attackCooldown).toBe(1);

    // Tick 21: cooldown reaches 0 this tick (decremented at start of tick),
    // then fires again.
    phaseCombat(world);
    expect(target.hp).toBe(20);
    expect(attacker.attackCooldown).toBe(20);
  });

  it("an attacker with non-zero cooldown at construction does not fire immediately", () => {
    const world = makeOpenWorld();
    const attacker = spawnUnit(world, "infantry", "human", 5.5, 5.5, idle());
    const target = spawnUnit(world, "worker", "orc", 6.5, 5.5, idle(), 40);

    // Pre-set cooldown so it won't fire yet.
    attacker.attackCooldown = 5;
    attacker.order = attack(target.id);

    // First 5 ticks: no attack (cooldown > 0 for 4 more ticks, fires on tick 5+1).
    for (let i = 0; i < 5; i++) {
      phaseCombat(world);
    }
    // hp unchanged: cooldown was 5, decremented to 0 after 5 ticks, but fires on
    // the tick when cooldown reaches 0. At tick 5 cooldown becomes 0 and attack fires.
    // After 5 ticks: tick1→cd4, tick2→cd3, tick3→cd2, tick4→cd1, tick5→cd0 then fire.
    expect(target.hp).toBe(30);
    expect(attacker.attackCooldown).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Guard Tower combat
// ---------------------------------------------------------------------------

describe("Guard Tower fires at hostile units in range", () => {
  it("a guard tower spawns a projectile when a hostile unit is within range", () => {
    const world = makeOpenWorld();
    // Guard Tower range=6, sight=8. Place a hostile unit 4 tiles from tower centre.
    // Tower at tile (5,5) footprint 2×2, centre=(6,6).
    spawnGuardTower(world, "human", 5, 5);
    // Hostile at (10,6) → distance from (6,6) to (10.5,6.5) ≈ 4.6 tiles (within range=6).
    const hostile = spawnUnit(world, "infantry", "orc", 10.5, 6.5, idle());

    expect(world.projectiles.size).toBe(0);

    phaseCombat(world);

    expect(world.projectiles.size).toBe(1);
    const proj = [...world.projectiles.values()][0];
    expect(proj.owner).toBe("human");
    expect(proj.target).toBe(hostile.id);
  });

  it("guard tower respects its attack cooldown", () => {
    const world = makeOpenWorld();
    spawnGuardTower(world, "human", 5, 5);
    spawnUnit(world, "infantry", "orc", 10.5, 6.5, idle());

    phaseCombat(world); // fires once
    expect(world.projectiles.size).toBe(1);

    // Next tick: cooldown active — no new projectile fired.
    phaseCombat(world);
    expect(world.projectiles.size).toBeLessThanOrEqual(2); // at most the 1 in flight + possible 2nd if travelled and a new one

    // After 1st tick the in-flight projectile advances but doesn't arrive yet
    // (target is ~4.6 tiles away at 0.267 tiles/tick ≈ 17 ticks). No new shot.
    // The count should NOT jump by +1 this tick (cooldown prevents new fire).
    const countAfterTick1 = world.projectiles.size;

    phaseCombat(world);
    // Still no new projectile from the tower (cooldown=25-1=24 remaining).
    expect(world.projectiles.size).toBe(countAfterTick1); // same in-flight count (projectile still travelling)
  });
});

// ---------------------------------------------------------------------------
// Attack order: target dies → unit idles
// ---------------------------------------------------------------------------

describe("attack order: unit goes idle when target entity is removed", () => {
  it("a unit with attack order goes idle when its target is deleted from the world", () => {
    const world = makeOpenWorld();
    const attacker = spawnUnit(world, "infantry", "human", 5.5, 5.5, idle());
    const target = spawnUnit(world, "infantry", "orc", 6.5, 5.5, idle(), 1 /* will die */);

    attacker.order = attack(target.id);

    // Run full stepWorld once — combat fires, target dies, cleanup removes it.
    stepWorld(world);

    // Target should be gone.
    expect(world.units.has(target.id)).toBe(false);

    // Run another tick — attacker should go idle since target is gone.
    stepWorld(world);

    expect(attacker.order.kind).toBe("stop");
  });
});

// ---------------------------------------------------------------------------
// Determinism: two same-seed worlds stepped INTERLEAVED remain bit-identical
// ---------------------------------------------------------------------------

/**
 * Snapshot a world's combat-relevant state: every unit's HP + cooldown,
 * every building's HP + attackCooldown, and every projectile's position
 * and accumulated damage target.
 */
function snapshotCombatState(world: World): string {
  const parts: string[] = [];

  // Units in ascending id order.
  const unitIds = [...world.units.keys()].sort((a, b) => a - b);
  for (const id of unitIds) {
    const u = world.units.get(id)!;
    parts.push(`u${id}:hp=${u.hp},cd=${u.attackCooldown}`);
  }

  // Buildings in ascending id order.
  const buildingIds = [...world.buildings.keys()].sort((a, b) => a - b);
  for (const id of buildingIds) {
    const b = world.buildings.get(id)!;
    parts.push(`b${id}:hp=${b.hp},cd=${b.attackCooldown ?? 0}`);
  }

  // Projectiles in ascending id order.
  const projIds = [...world.projectiles.keys()].sort((a, b) => a - b);
  for (const id of projIds) {
    const p = world.projectiles.get(id)!;
    parts.push(
      `p${id}:px=${p.pos.x.toFixed(6)},py=${p.pos.y.toFixed(6)},dmg=${p.damage}`,
    );
  }

  return parts.join("|");
}

describe("determinism: two same-seed worlds stepped interleaved are bit-identical", () => {
  it("guard towers + ranged units + enemies in both worlds fire on identical schedules", () => {
    // Build two identical worlds (same seed, same entity layout).
    function buildWorld(): World {
      const w = makeOpenWorld(20, 20);

      // Human guard tower at tile (1,1), footprint 2×2, centre=(2,2).
      // GUARD_TOWER_RANGE=6, GUARD_TOWER_SIGHT=8.
      spawnGuardTower(w, "human", 1, 1);

      // Human ranged unit 3 tiles from an orc infantry (within range=5).
      spawnUnit(w, "ranged", "human", 5.5, 5.5, idle());

      // Orc enemy at (5.5, 2.5): distance from tower centre (2,2) ≈ 3.5 tiles
      // (well within range=6 AND sight=8) and distance from ranged unit (5.5,5.5)
      // ≈ 3 tiles (within ranged unit sight=5 and range=5).
      spawnUnit(w, "infantry", "orc", 5.5, 2.5, idle());

      return w;
    }

    const worldA = buildWorld();
    const worldB = buildWorld();

    const TICKS = 80;
    const snapshots: Array<[string, string]> = [];

    for (let t = 0; t < TICKS; t++) {
      stepWorld(worldA);
      stepWorld(worldB);
      snapshots.push([snapshotCombatState(worldA), snapshotCombatState(worldB)]);
    }

    // Every tick: the two worlds must be bit-identical.
    for (let t = 0; t < TICKS; t++) {
      const [a, b] = snapshots[t];
      expect(a, `tick ${t + 1}: worlds diverged`).toBe(b);
    }

    // Sanity-check: the guard tower actually fired at some point (attackCooldown > 0
    // on at least one tick means it fired and reset its cooldown — proving that
    // path was exercised, not just trivially skipped).
    const towerFired = snapshots.some(([a]) => a.includes("b1:hp=400,cd=25") || /b\d+:hp=400,cd=25/.test(a));
    expect(towerFired, "guard tower should have fired at least once in 80 ticks").toBe(true);
  });
});
