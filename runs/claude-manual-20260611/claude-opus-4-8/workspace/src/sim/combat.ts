/**
 * T9 — Combat phase: target acquisition, attack resolution, projectile integration.
 *
 * ## What this phase does each tick
 *
 * 1. **Projectile integration**: advance all in-flight projectiles; on arrival
 *    apply armor-adjusted damage to the target and delete the projectile.
 *
 * 2. **Unit combat**: for each unit with an `attack` or `attackMove` order,
 *    and for idle/hold units in auto-acquire mode, find or validate a hostile
 *    target, move into attack range (path-following is already handled by the
 *    movement phase; here we just check range), and fire on cooldown.
 *
 * 3. **Building combat**: Guard Towers auto-acquire the nearest hostile unit
 *    within their sight radius and fire ranged shots on cooldown.
 *
 * ## Damage formula
 *   damage dealt = max(1, attacker.damage − defender.armor)
 *   The min-1 floor is REQUIRED — an attack always deals at least 1 damage.
 *
 * ## Determinism
 *   - All collections are iterated in ascending EntityId order.
 *   - No Math.random calls; all randomness (if ever needed) routes through
 *     world.rng.
 *
 * ## Design notes
 *   - Guard Tower attack cooldown is stored as `Building.attackCooldown` (an
 *     optional field added to the Building entity), matching the precedent set by
 *     `Unit.attackCooldown`. This ensures each World instance carries its own
 *     cooldown state, so two same-seed worlds stepped interleaved remain
 *     bit-identical — a module-level side-table keyed by EntityId would share
 *     state across worlds whose EntityId counters both start at 1.
 *   - Guard Tower combat stats (armor, damage, range, attackCooldown, sight) are
 *     defined as constants here because BuildingStats intentionally has no combat
 *     columns — these values belong to the combat sub-system, not the economy one.
 *   - Projectile speed is constant (PROJECTILE_SPEED tiles/tick) — no per-unit
 *     variation needed at this stage.
 */

import type { Building, Projectile, Unit } from "./entity.js";
import type { World } from "./world.js";
import type { EntityId, Faction } from "../game/types.js";
import { makeEntityId } from "../game/types.js"; // re-exported for tests
import { getUnitStats } from "./stats.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Guard Tower / Watch Tower combat stats.
 * The building itself has no combat columns in BuildingStats; these live here.
 */
const GUARD_TOWER_DAMAGE = 12;
const GUARD_TOWER_ARMOR = 5;
const GUARD_TOWER_RANGE = 6; // tiles
const GUARD_TOWER_ATTACK_COOLDOWN = 25; // ticks (~0.83 s at 30 Hz)
const GUARD_TOWER_SIGHT = 8; // tiles

/**
 * Projectile travel speed, in tiles per tick.
 * 8 tiles/s at SIM_HZ=30 ≈ 0.267 tiles/tick.
 */
const PROJECTILE_SPEED = 8 / 30; // 8 tiles/s at SIM_HZ=30

/**
 * A ranged attack is fired when the attacker's centre-to-target distance is
 * within range; melee when distance ≤ MELEE_ENGAGE_DIST (slightly > 1 so the
 * unit that just reached an adjacent tile can attack without needing to step
 * onto the same tile as the target).
 */
const MELEE_ENGAGE_DIST = 1.5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Euclidean distance between two fractional positions. */
function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Centre of a unit (already fractional tile coords). */
function unitCentre(u: Unit): { x: number; y: number } {
  return { x: u.pos.x, y: u.pos.y };
}

/** Centre of a building's footprint (fractional tile coords). */
function buildingCentre(b: Building): { x: number; y: number } {
  return {
    x: b.tile.x + b.footprint.w / 2,
    y: b.tile.y + b.footprint.h / 2,
  };
}

/**
 * Returns the fractional-tile centre of any combat participant (unit or
 * building).
 */
function entityCentre(
  world: World,
  id: EntityId,
): { x: number; y: number } | null {
  const u = world.units.get(id);
  if (u !== undefined) return unitCentre(u);
  const b = world.buildings.get(id);
  if (b !== undefined) return buildingCentre(b);
  return null;
}

/** The enemy faction of `faction`. */
function enemy(faction: Faction): Faction {
  return faction === "human" ? "orc" : "human";
}

/**
 * Applies armor-adjusted damage to `hp`, returning the new hp.
 * Formula: damage dealt = max(1, rawDamage − armor).
 */
function applyDamage(hp: number, rawDamage: number, armor: number): number {
  return hp - Math.max(1, rawDamage - armor);
}

/**
 * Armor value for a unit.
 */
function unitArmor(unit: Unit): number {
  return getUnitStats(unit.owner, unit.kind).armor;
}

/**
 * Armor value for a building (only guard towers participate in combat; others
 * have armor 0 so every hit deals at least 1).
 */
function buildingArmor(building: Building): number {
  return building.kind === "guardTower" ? GUARD_TOWER_ARMOR : 0;
}

/**
 * Apply `rawDamage` to a target entity (unit or building) identified by `id`.
 * Returns true if the entity was found and damaged, false if it no longer exists.
 */
function damageEntity(world: World, id: EntityId, rawDamage: number): boolean {
  const u = world.units.get(id);
  if (u !== undefined) {
    u.hp = applyDamage(u.hp, rawDamage, unitArmor(u));
    return true;
  }
  const b = world.buildings.get(id);
  if (b !== undefined) {
    b.hp = applyDamage(b.hp, rawDamage, buildingArmor(b));
    return true;
  }
  return false;
}

/**
 * Spawns a projectile from `fromPos` aimed at entity `targetId`.  The
 * projectile's velocity is set toward the TARGET'S CURRENT POSITION at spawn
 * time; the projectile does not home continuously (it travels in a straight
 * line from its spawn point).
 */
function spawnProjectile(
  world: World,
  owner: Faction,
  fromPos: { x: number; y: number },
  targetId: EntityId,
  rawDamage: number,
): void {
  const targetPos = entityCentre(world, targetId);
  // If the target disappeared in the same tick before we fired, no projectile.
  if (targetPos === null) return;

  const dx = targetPos.x - fromPos.x;
  const dy = targetPos.y - fromPos.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const vel =
    d < 1e-9
      ? { x: 0, y: -PROJECTILE_SPEED } // degenerate: fire up
      : { x: (dx / d) * PROJECTILE_SPEED, y: (dy / d) * PROJECTILE_SPEED };

  const proj: Projectile = {
    id: world.nextId() as EntityId,
    owner,
    pos: { x: fromPos.x, y: fromPos.y },
    vel,
    target: targetId,
    targetPos: { x: targetPos.x, y: targetPos.y },
    damage: rawDamage,
  };
  world.projectiles.set(proj.id, proj);
}

// ---------------------------------------------------------------------------
// Auto-acquire: nearest hostile within sight radius
// ---------------------------------------------------------------------------

/**
 * Brute-force scan for the nearest hostile entity (unit or fully-built
 * building) within `sightRadius` tiles of `pos` and belonging to the enemy
 * faction.  Returns the entity id, or null if nothing is in sight.
 *
 * Iteration order: all units (ascending EntityId), then all buildings
 * (ascending EntityId).  Ties broken by this stable order, so the result is
 * deterministic.
 *
 * T12 will swap the inner scan for a spatial hash without changing this
 * signature.
 */
function autoAcquire(
  world: World,
  pos: { x: number; y: number },
  sightRadius: number,
  myFaction: Faction,
): EntityId | null {
  const hostileFaction = enemy(myFaction);
  const r2 = sightRadius * sightRadius;
  let bestId: EntityId | null = null;
  let bestDist2 = Infinity;

  // Scan units in ascending EntityId order.
  const unitIds = [...world.units.keys()].sort((a, b) => a - b);
  for (const id of unitIds) {
    const u = world.units.get(id)!;
    if (u.owner !== hostileFaction) continue;
    if (u.hp <= 0) continue; // being cleaned up this tick
    const dx = u.pos.x - pos.x;
    const dy = u.pos.y - pos.y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= r2 && d2 < bestDist2) {
      bestDist2 = d2;
      bestId = id;
    }
  }

  // Scan buildings in ascending EntityId order.
  const buildingIds = [...world.buildings.keys()].sort((a, b) => a - b);
  for (const id of buildingIds) {
    const b = world.buildings.get(id)!;
    if (b.owner !== hostileFaction) continue;
    if (b.buildProgress < 1) continue; // under construction — not a valid target
    if (b.hp <= 0) continue;
    const bc = buildingCentre(b);
    const dx = bc.x - pos.x;
    const dy = bc.y - pos.y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= r2 && d2 < bestDist2) {
      bestDist2 = d2;
      bestId = id;
    }
  }

  return bestId;
}

// ---------------------------------------------------------------------------
// Projectile integration
// ---------------------------------------------------------------------------

/**
 * Advance all projectiles one tick and handle impacts.
 *
 * A projectile arrives when it passes within PROJECTILE_SPEED/2 of its target
 * position (it cannot overshoot by more than one step).  On impact:
 *   - If the original target entity still exists, apply armor-adjusted damage.
 *   - If the original target is gone, the projectile still impacts at the
 *     last-known position (no second target acquisition — the damage is lost).
 * Delete the projectile after impact.
 */
function integrateProjectiles(world: World): void {
  const toDelete: EntityId[] = [];

  // Iterate in ascending id order for determinism.
  const ids = [...world.projectiles.keys()].sort((a, b) => a - b);
  for (const id of ids) {
    const proj = world.projectiles.get(id)!;

    // Update homing target position if the target still exists.
    if (proj.target !== undefined) {
      const livePos = entityCentre(world, proj.target);
      if (livePos !== null) {
        proj.targetPos = { x: livePos.x, y: livePos.y };
      }
    }

    // Advance position.
    proj.pos = {
      x: proj.pos.x + proj.vel.x,
      y: proj.pos.y + proj.vel.y,
    };

    // Check arrival: within one step of the target position.
    const ddx = proj.pos.x - proj.targetPos.x;
    const ddy = proj.pos.y - proj.targetPos.y;
    const d2 = ddx * ddx + ddy * ddy;
    const arrivalRadius = PROJECTILE_SPEED + 0.1;
    if (d2 <= arrivalRadius * arrivalRadius) {
      // Impact: apply damage to the original target if still alive.
      if (proj.target !== undefined) {
        damageEntity(world, proj.target, proj.damage);
      }
      toDelete.push(id);
    }
  }

  for (const id of toDelete) {
    world.projectiles.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Unit combat
// ---------------------------------------------------------------------------

/**
 * Perform one unit's combat logic for this tick:
 *
 * 1. Determine the active target:
 *    - `attack` order: the explicit targetId; if dead → idle.
 *    - `attackMove` / `stop` / `hold`: auto-acquire nearest hostile in sight.
 *    - All other orders: no combat this tick.
 *
 * 2. If a target exists and is in range, and cooldown is ready: fire.
 *    - Melee (range ≤ 1): direct damage (no projectile).
 *    - Ranged (range > 1): spawn a Projectile.
 *    - Reset attackCooldown.
 *
 * 3. Decrement attackCooldown regardless.
 */
function stepUnitCombat(unit: Unit, world: World): void {
  // Decrement cooldown.
  if (unit.attackCooldown > 0) {
    unit.attackCooldown--;
  }

  const stats = getUnitStats(unit.owner, unit.kind);
  const pos = unitCentre(unit);

  let targetId: EntityId | null = null;

  switch (unit.order.kind) {
    case "attack": {
      const t = world.units.get(unit.order.targetId) ?? world.buildings.get(unit.order.targetId);
      if (t === undefined || ("hp" in t && t.hp <= 0)) {
        // Target dead or missing — go idle.
        unit.order = { kind: "stop" };
        unit.target = undefined;
        return;
      }
      targetId = unit.order.targetId;
      unit.target = targetId;
      break;
    }
    case "attackMove":
    case "stop":
    case "hold": {
      // Auto-acquire: use existing target if still alive and in sight, else scan.
      if (unit.target !== undefined) {
        const existing = world.units.get(unit.target) ?? world.buildings.get(unit.target);
        if (
          existing === undefined ||
          ("hp" in existing && existing.hp <= 0) ||
          ("owner" in existing && existing.owner === unit.owner)
        ) {
          unit.target = undefined;
        }
      }
      if (unit.target === undefined) {
        const acquired = autoAcquire(world, pos, stats.sight, unit.owner);
        if (acquired !== null) {
          unit.target = acquired;
        }
      }
      targetId = unit.target ?? null;
      break;
    }
    default:
      // All other orders (move, harvest, build, repair, train): no combat.
      unit.target = undefined;
      return;
  }

  if (targetId === null) return;
  if (unit.attackCooldown > 0) return;

  // Measure distance to target.
  const targetCentre = entityCentre(world, targetId);
  if (targetCentre === null) {
    unit.target = undefined;
    return;
  }

  const d = dist(pos.x, pos.y, targetCentre.x, targetCentre.y);
  const isRanged = stats.range > 1;
  const engageDist = isRanged ? stats.range : MELEE_ENGAGE_DIST;

  if (d > engageDist) {
    // Out of range — the movement phase is already steering toward the target;
    // nothing to do in the combat phase.
    return;
  }

  // In range and ready: fire.
  if (isRanged) {
    spawnProjectile(world, unit.owner, pos, targetId, stats.damage);
  } else {
    damageEntity(world, targetId, stats.damage);
  }

  // Reset cooldown.
  unit.attackCooldown = stats.attackCooldown;
}

// ---------------------------------------------------------------------------
// Building (Guard Tower) combat
// ---------------------------------------------------------------------------

/**
 * Perform one building's combat logic for this tick.
 * Only guard towers are combat-capable; all others skip immediately.
 *
 * A guard tower auto-acquires the nearest hostile unit within its sight
 * radius and fires a ranged shot on cooldown.  The shot always spawns a
 * Projectile (towers are always ranged).
 */
function stepBuildingCombat(building: Building, world: World): void {
  if (building.kind !== "guardTower") return;
  if (building.buildProgress < 1) return;
  if (building.hp <= 0) return;

  // Decrement cooldown.
  const cd = building.attackCooldown ?? 0;
  if (cd > 0) {
    building.attackCooldown = cd - 1;
    return;
  }

  // Cooldown is 0 — look for a target.
  const pos = buildingCentre(building);
  const targetId = autoAcquire(world, pos, GUARD_TOWER_SIGHT, building.owner);
  if (targetId === null) return;

  const targetCentre = entityCentre(world, targetId);
  if (targetCentre === null) return;

  const d = dist(pos.x, pos.y, targetCentre.x, targetCentre.y);
  if (d > GUARD_TOWER_RANGE) return;

  // Fire a projectile.
  spawnProjectile(world, building.owner, pos, targetId, GUARD_TOWER_DAMAGE);
  building.attackCooldown = GUARD_TOWER_ATTACK_COOLDOWN;
}

// ---------------------------------------------------------------------------
// Phase entry point
// ---------------------------------------------------------------------------

/**
 * The combat phase: replaces the no-op stub in `simulation.ts`.
 *
 * Order within a tick:
 *   1. Integrate projectiles (advance + impact) — damage is applied from last
 *      tick's projectiles before new ones spawn, so a projectile never damages
 *      and despawns in the same tick it spawns.
 *   2. Unit combat (ascending EntityId order for determinism).
 *   3. Building combat (ascending EntityId order for determinism).
 *
 * Dead entities (hp ≤ 0) are NOT removed here — the cleanup phase (which runs
 * after combat) handles removal, so dead entities are still present and valid
 * for lookup during this phase.
 */
export function phaseCombat(world: World): void {
  // Step 1: advance projectiles.
  integrateProjectiles(world);

  // Step 2: unit combat in ascending EntityId order.
  const unitIds = [...world.units.keys()].sort((a, b) => a - b);
  for (const id of unitIds) {
    const unit = world.units.get(id);
    if (unit === undefined) continue; // defensive
    stepUnitCombat(unit, world);
  }

  // Step 3: building combat in ascending EntityId order.
  const buildingIds = [...world.buildings.keys()].sort((a, b) => a - b);
  for (const id of buildingIds) {
    const building = world.buildings.get(id);
    if (building === undefined) continue;
    stepBuildingCombat(building, world);
  }
}

// ---------------------------------------------------------------------------
// Exported helper for tests
// ---------------------------------------------------------------------------

/**
 * Compute armor-adjusted damage. Exported so tests can verify the formula
 * without invoking the full combat phase.
 */
export function computeDamage(rawDamage: number, armor: number): number {
  return Math.max(1, rawDamage - armor);
}

// Re-export entity id factory so tests can create EntityIds without importing types directly.
export { makeEntityId };
