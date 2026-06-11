/**
 * Combat system: damage calculation, attack handling, projectiles.
 */
import { Entity, GameState, Projectile, TILE_SIZE } from '../engine/types.js';

/** Calculate damage dealt by attacker to defender */
export function calcDamage(attacker: Entity, defender: Entity): number {
  return Math.max(1, attacker.stats.damage - defender.stats.armor);
}

/** Apply damage to entity, return true if entity died */
export function applyDamage(entity: Entity, damage: number): boolean {
  entity.hp -= damage;
  return entity.hp <= 0;
}

/** Check if entity is in attack range */
export function isInAttackRange(attacker: Entity, target: Entity, _tiles: GameState['tiles']): boolean {
  const range = attacker.stats.attackRange * TILE_SIZE;
  if (range <= TILE_SIZE) {
    // Melee: check adjacency (accounting for building size)
    const targetSize = target.stats.width * TILE_SIZE;
    const dist = Math.hypot(attacker.x - target.x, attacker.y - target.y);
    return dist <= TILE_SIZE * 1.5 + targetSize / 2;
  }
  // Ranged: direct distance
  const dist = Math.hypot(attacker.x - target.x, attacker.y - target.y);
  return dist <= range;
}

/** Process attack for one entity */
export function processAttack(
  attacker: Entity,
  target: Entity,
  state: GameState,
  dt: number
): void {
  // Update cooldown
  if (attacker.attackCooldownLeft > 0) {
    attacker.attackCooldownLeft -= dt;
    return;
  }

  if (!isInAttackRange(attacker, target, state.tiles)) return;

  // Ranged units create projectiles
  if (attacker.stats.attackRange > 1) {
    const proj: Projectile = {
      id: state.nextProjectileId++,
      x: attacker.x,
      y: attacker.y,
      targetId: target.id,
      damage: calcDamage(attacker, target),
      faction: attacker.faction,
      speed: 200,
      startX: attacker.x,
      startY: attacker.y
    };
    state.projectiles.push(proj);
  } else {
    // Melee: instant damage
    const dmg = calcDamage(attacker, target);
    if (applyDamage(target, dmg)) {
      handleDeath(target, state);
    }
  }

  attacker.attackCooldownLeft = attacker.stats.attackCooldown;
}

/** Process projectiles */
export function processProjectiles(state: GameState, dt: number): void {
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const proj = state.projectiles[i];
    const target = state.entities.find(e => e.id === proj.targetId);

    if (!target || target.state === 'dead') {
      state.projectiles.splice(i, 1);
      continue;
    }

    const dx = target.x - proj.x;
    const dy = target.y - proj.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 8) {
      // Hit
      if (applyDamage(target, proj.damage)) {
        handleDeath(target, state);
      }
      state.projectiles.splice(i, 1);
    } else {
      // Move toward target
      const speed = proj.speed * (dt / 1000);
      proj.x += (dx / dist) * speed;
      proj.y += (dy / dist) * speed;
    }
  }
}

/** Handle entity death */
export function handleDeath(entity: Entity, state: GameState): void {
  entity.state = 'dead';
  entity.deathTimer = 2000;

  // Remove from selection
  state.selectedEntityIds = state.selectedEntityIds.filter(id => id !== entity.id);
}

/** Find nearest enemy in sight range */
export function findNearestEnemy(
  entity: Entity,
  state: GameState
): Entity | null {
  const sightRange = entity.stats.sightRadius * TILE_SIZE;
  let nearest: Entity | null = null;
  let nearestDist = Infinity;

  for (const other of state.entities) {
    if (other.state === 'dead') continue;
    if (other.faction === entity.faction) continue;
    const dist = Math.hypot(entity.x - other.x, entity.y - other.y);
    if (dist < sightRange && dist < nearestDist) {
      nearestDist = dist;
      nearest = other;
    }
  }
  return nearest;
}
