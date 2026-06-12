/**
 * Combat system: attack orders, projectiles, damage calculation.
 */

import type { Entity, GameState } from '../core/types';
import { vecDist } from '../core/types';
import { killEntity, buildingCenter } from './entities';
import { findPath } from '../core/pathfinding';

/** Projectile speed in tiles per tick */
const PROJECTILE_SPEED = 0.3;

/**
 * Process combat for all entities.
 * Handles attack cooldowns, auto-acquisition, and attacks.
 */
export function processCombat(state: GameState): void {
  for (const entity of state.entities) {
    if (!entity.alive) continue;
    if (entity.attackCooldownTimer > 0) {
      entity.attackCooldownTimer--;
    }

    // Process projectiles
    if (entity.isProjectile) {
      processProjectile(state, entity);
      continue;
    }

    // Process towers
    if (entity.entityType === 'building' && entity.buildingType === 'guardTower') {
      processTowerCombat(state, entity);
      continue;
    }

    // Process unit combat
    if (entity.entityType !== 'unit') continue;

    // Auto-acquire targets for idle/guarding units
    if (entity.order.type === 'idle' || entity.order.type === 'attack') {
      const target = findAutoTarget(state, entity);
      if (target) {
        entity.order = { type: 'attack', targetId: target.id };
      }
    }

    // Execute attack order
    if (entity.order.type === 'attack' && entity.order.targetId !== undefined) {
      executeAttackOrder(state, entity);
    }

    // Attack-move: find and attack enemies while moving
    if (entity.order.type === 'attackMove') {
      const target = findAutoTarget(state, entity);
      if (target) {
        entity.order = { type: 'attack', targetId: target.id };
      } else if (entity.path.length === 0 && entity.order.target) {
        // Continue moving to destination
        const path = findPath(state.map, Math.floor(entity.x), Math.floor(entity.y),
          Math.floor(entity.order.target.x), Math.floor(entity.order.target.y));
        entity.path = path ?? [];
        entity.pathIndex = 0;
      }
    }
  }
}

/**
 * Process tower combat: auto-attack enemies in range.
 */
function processTowerCombat(state: GameState, tower: Entity): void {
  if (tower.attackCooldownTimer > 0) return;

  // Find nearest enemy in range
  let bestTarget: Entity | null = null;
  let bestDist = Infinity;

  for (const entity of state.entities) {
    if (!entity.alive || entity.faction === tower.faction) continue;
    if (entity.entityType === 'building' && entity.buildingType) {
      // Towers don't attack buildings
      continue;
    }

    const dist = vecDist(buildingCenter(tower), entity);
    if (dist <= tower.attackRange && dist < bestDist) {
      bestDist = dist;
      bestTarget = entity;
    }
  }

  if (bestTarget) {
    spawnProjectile(state, tower, bestTarget);
    tower.attackCooldownTimer = tower.attackCooldown;
  }
}

/**
 * Find a valid auto-target for a unit.
 */
function findAutoTarget(state: GameState, unit: Entity): Entity | null {
  let bestTarget: Entity | null = null;
  let bestDist = Infinity;

  for (const entity of state.entities) {
    if (!entity.alive || entity.faction === unit.faction) continue;

    const dist = vecDist(unit, entity);
    if (dist <= unit.sightRadius && dist < bestDist) {
      bestDist = dist;
      bestTarget = entity;
    }
  }

  return bestTarget;
}

/**
 * Execute an attack order.
 */
function executeAttackOrder(state: GameState, attacker: Entity): void {
  const targetId = attacker.order.targetId;
  if (targetId === undefined) return;

  const target = state.entities.find(e => e.id === targetId && e.alive);
  if (!target) {
    // Target is dead — go idle
    attacker.order = { type: 'idle' };
    attacker.path = [];
    return;
  }

  const targetPos = target.entityType === 'building' ? buildingCenter(target) : target;
  const dist = vecDist(attacker, targetPos);

  if (dist <= attacker.attackRange) {
    // In range — attack
    if (attacker.attackCooldownTimer <= 0) {
      performAttack(state, attacker, target);
      attacker.attackCooldownTimer = attacker.attackCooldown;
    }
  } else {
    // Move to target
    if (attacker.path.length === 0 || attacker.pathIndex >= attacker.path.length) {
      const path = findPath(state.map, Math.floor(attacker.x), Math.floor(attacker.y),
        Math.floor(targetPos.x), Math.floor(targetPos.y));
      attacker.path = path ?? [];
      attacker.pathIndex = 0;
    }
  }
}

/**
 * Perform an attack: damage the target, potentially kill it.
 */
function performAttack(state: GameState, attacker: Entity, target: Entity): void {
  // Spawn projectile for ranged attacks
  if (attacker.attackRange > 1) {
    spawnProjectile(state, attacker, target);
    return;
  }

  // Melee attack — apply damage immediately
  const damage = Math.max(1, attacker.damage - target.armor);
  target.hp -= damage;

  if (target.hp <= 0) {
    killEntity(state, target);
  }
}

/**
 * Spawn a projectile.
 */
function spawnProjectile(state: GameState, attacker: Entity, target: Entity): void {
  const projectile: Entity = {
    id: state.nextEntityId++,
    faction: attacker.faction,
    entityType: 'unit',
    x: attacker.x,
    y: attacker.y,
    hp: 1,
    maxHp: 1,
    armor: 0,
    damage: 0,
    attackRange: 0,
    attackCooldown: 0,
    attackCooldownTimer: 0,
    moveSpeed: 0,
    sightRadius: 0,
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
    isProjectile: true,
    projectileTargetId: target.id,
    projectileDamage: Math.max(1, attacker.damage - target.armor),
    projectileSpeed: PROJECTILE_SPEED,
  };

  state.entities.push(projectile);
}

/**
 * Process a projectile's movement and impact.
 */
function processProjectile(state: GameState, projectile: Entity): void {
  if (!projectile.isProjectile || projectile.projectileTargetId === undefined) {
    killEntity(state, projectile);
    return;
  }

  const target = state.entities.find(e => e.id === projectile.projectileTargetId);
  if (!target || !target.alive) {
    killEntity(state, projectile);
    return;
  }

  const targetPos = target.entityType === 'building' ? buildingCenter(target) : target;
  const dx = targetPos.x - projectile.x;
  const dy = targetPos.y - projectile.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 0.2) {
    // Hit!
    const damage = projectile.projectileDamage ?? 1;
    target.hp -= damage;
    if (target.hp <= 0) {
      killEntity(state, target);
    }
    killEntity(state, projectile);
    return;
  }

  // Move toward target
  const speed = projectile.projectileSpeed ?? PROJECTILE_SPEED;
  projectile.x += (dx / dist) * speed;
  projectile.y += (dy / dist) * speed;
}
