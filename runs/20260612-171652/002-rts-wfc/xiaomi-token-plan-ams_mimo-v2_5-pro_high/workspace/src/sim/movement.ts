/**
 * Movement system: pathfinding, path following, collision avoidance.
 */

import type { Entity, GameState } from '../core/types';
import { findPath } from '../core/pathfinding';
import { buildingCenter } from './entities';

/** How close two units may get before collision avoidance kicks in */
const MIN_SEPARATION = 0.5;
/** Maximum ticks to wait before re-evaluating path */
const WAIT_TICKS_BEFORE_REPATH = 30;

/**
 * Assign a move order to an entity, computing a path.
 */
export function assignMoveOrder(
  state: GameState,
  entity: Entity,
  targetX: number,
  targetY: number,
): void {
  const tx = Math.floor(targetX);
  const ty = Math.floor(targetY);
  const sx = Math.floor(entity.x);
  const sy = Math.floor(entity.y);

  const path = findPath(state.map, sx, sy, tx, ty);
  entity.order = { type: 'move', target: { x: targetX, y: targetY } };
  entity.path = path ?? [];
  entity.pathIndex = 0;
  entity.progressTicks = 0;
}

/**
 * Assign a harvest order: walk to resource, gather, carry to drop-off, repeat.
 */
export function assignHarvestOrder(
  _state: GameState,
  entity: Entity,
  targetId: number,
): void {
  entity.order = { type: 'harvest', targetId };
  entity.path = [];
  entity.pathIndex = 0;
  entity.progressTicks = 0;
  entity.cargoGold = 0;
  entity.cargoWood = 0;
}

/**
 * Process movement for all moving entities in the current tick.
 * Handles path following, collision avoidance, and progress tracking.
 */
export function processMovement(state: GameState): void {
  for (const entity of state.entities) {
    if (!entity.alive) continue;
    if (entity.entityType !== 'unit') continue;
    if (entity.order.type === 'idle') continue;
    if (entity.isProjectile) continue;
    if (entity.moveSpeed <= 0) continue;

    // Handle path following
    if (entity.path.length > 0 && entity.pathIndex < entity.path.length) {
      followPath(state, entity);
    }
  }
}

/**
 * Move an entity along its path.
 */
function followPath(state: GameState, entity: Entity): void {
  const target = entity.path[entity.pathIndex];
  if (!target) return;

  const dx = target.x - entity.x;
  const dy = target.y - entity.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 0.1) {
    // Arrived at this waypoint
    entity.x = target.x;
    entity.y = target.y;
    entity.pathIndex++;
    entity.progressTicks = 0;
    return;
  }

  // Calculate movement for this tick
  const speed = entity.moveSpeed / 20; // tiles per tick
  const moveX = (dx / dist) * Math.min(speed, dist);
  const moveY = (dy / dist) * Math.min(speed, dist);

  // Check for collisions with other units
  const newX = entity.x + moveX;
  const newY = entity.y + moveY;

  if (canMoveTo(state, entity, newX, newY)) {
    entity.x = newX;
    entity.y = newY;
    entity.progressTicks = 0;
  } else {
    // Collision — try to find alternative route
    entity.progressTicks++;
    if (entity.progressTicks > WAIT_TICKS_BEFORE_REPATH) {
      // Try to re-route around
      repathEntity(state, entity);
    }
  }
}

/**
 * Check if an entity can move to a position without collision.
 */
function canMoveTo(state: GameState, entity: Entity, newX: number, newY: number): boolean {
  // Check map bounds
  if (newX < 0 || newX >= state.map.width || newY < 0 || newY >= state.map.height) {
    return false;
  }

  // Check walkability
  const tx = Math.floor(newX);
  const ty = Math.floor(newY);
  if (tx < 0 || tx >= state.map.width || ty < 0 || ty >= state.map.height) {
    return false;
  }
  if (!state.map.walkable[ty * state.map.width + tx]) {
    return false;
  }

  // Check collision with other units
  for (const other of state.entities) {
    if (!other.alive || other.id === entity.id) continue;
    if (other.entityType !== 'unit') continue;
    if (other.isProjectile) continue;

    const dx = newX - other.x;
    const dy = newY - other.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < MIN_SEPARATION) {
      return false;
    }
  }

  return true;
}

/**
 * Re-route an entity that's stuck.
 */
function repathEntity(state: GameState, entity: Entity): void {
  const target = entity.order.target;
  if (!target) {
    entity.order = { type: 'idle' };
    entity.path = [];
    return;
  }

  const sx = Math.floor(entity.x);
  const sy = Math.floor(entity.y);
  const tx = Math.floor(target.x);
  const ty = Math.floor(target.y);

  const path = findPath(state.map, sx, sy, tx, ty);
  if (path && path.length > 0) {
    entity.path = path;
    entity.pathIndex = 0;
    entity.progressTicks = 0;
  } else {
    // Can't find path — cancel order
    entity.order = { type: 'idle' };
    entity.path = [];
  }
}

/**
 * Check if two entities are colliding.
 */
export function areEntitiesColliding(a: Entity, b: Entity): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy) < MIN_SEPARATION;
}

/**
 * Get all units currently colliding with the given entity.
 */
export function getCollisions(state: GameState, entity: Entity): Entity[] {
  return state.entities.filter(e =>
    e.alive && e.id !== entity.id && e.entityType === 'unit' && !e.isProjectile &&
    areEntitiesColliding(entity, e),
  );
}

/**
 * Get the building center (re-export for use by other modules).
 */
export { buildingCenter };
