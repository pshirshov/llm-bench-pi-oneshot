import { MAX_REPATH_ATTEMPTS, REPATH_INTERVAL_TICKS, TICK_RATE } from '../constants';
import { findPath, type GridSpec } from '../pathfinding';
import { unitStats } from '../stats';
import type { Point, Unit } from '../types';
import { keyOf, samePoint, tileKey } from '../utils';
import type { World } from '../world';

interface Reservations {
  occupied: Set<string>;
  reserved: Set<string>;
}

export function tickMovement(world: World): void {
  advanceActiveMoves(world);
  const grid = world.staticGrid();
  const reservations = buildReservations(world);
  const units = Array.from(world.units.values()).sort((a, b) => a.id - b.id);
  for (const unit of units) {
    if (unit.move !== undefined || unit.destination === undefined) {
      continue;
    }
    if (unit.pathVersion !== world.map.walkVersion) {
      replan(world, unit, grid);
    }
    if (samePoint(unit.tile, unit.destination)) {
      finishMovementOrder(world, unit);
      continue;
    }
    if (unit.path.length === 0) {
      replan(world, unit, grid);
      if (unit.path.length === 0) {
        finishMovementOrder(world, unit);
        continue;
      }
    }
    const next = unit.path[0];
    if (next === undefined) {
      throw new Error('path unexpectedly empty');
    }
    if (canEnter(grid, unit, next, reservations)) {
      unit.path.shift();
      startMove(world, unit, next);
      reservations.reserved.add(keyOf(next));
      unit.blockedTicks = 0;
    } else {
      unit.blockedTicks += 1;
      unit.lastProgressTick = world.tickCount;
      if (unit.blockedTicks % REPATH_INTERVAL_TICKS === 0) {
        replan(world, unit, grid);
        unit.repathAttempts += 1;
      }
      if (unit.repathAttempts > MAX_REPATH_ATTEMPTS) {
        if (unit.order.kind === 'move' || unit.order.kind === 'attackMove') {
          world.replaceOrder(unit, { kind: 'idle', reason: 'stalled' });
        }
      }
    }
  }
}

function advanceActiveMoves(world: World): void {
  for (const unit of world.units.values()) {
    if (unit.move === undefined) {
      continue;
    }
    unit.move.progress += 1;
    const ratio = Math.min(1, unit.move.progress / unit.move.duration);
    unit.x = unit.move.from.x + 0.5 + (unit.move.to.x - unit.move.from.x) * ratio;
    unit.y = unit.move.from.y + 0.5 + (unit.move.to.y - unit.move.from.y) * ratio;
    if (ratio >= 1) {
      unit.tile = { ...unit.move.to };
      unit.x = unit.tile.x + 0.5;
      unit.y = unit.tile.y + 0.5;
      unit.move = undefined;
    }
  }
}

function buildReservations(world: World): Reservations {
  const occupied = new Set<string>();
  const reserved = new Set<string>();
  for (const unit of world.units.values()) {
    occupied.add(keyOf(unit.tile));
    reserved.add(keyOf(unit.tile));
    if (unit.move !== undefined) {
      reserved.add(keyOf(unit.move.to));
    }
  }
  return { occupied, reserved };
}

function canEnter(grid: GridSpec, unit: Unit, next: Point, reservations: Reservations): boolean {
  if (grid.isBlocked(next.x, next.y)) {
    return false;
  }
  const targetKey = keyOf(next);
  if (reservations.reserved.has(targetKey)) {
    return false;
  }
  const dx = next.x - unit.tile.x;
  const dy = next.y - unit.tile.y;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
    return false;
  }
  if (dx !== 0 && dy !== 0) {
    if (grid.isBlocked(unit.tile.x + dx, unit.tile.y) || grid.isBlocked(unit.tile.x, unit.tile.y + dy)) {
      return false;
    }
    if (reservations.reserved.has(tileKey(unit.tile.x + dx, unit.tile.y)) || reservations.reserved.has(tileKey(unit.tile.x, unit.tile.y + dy))) {
      return false;
    }
  }
  return true;
}

function startMove(world: World, unit: Unit, next: Point): void {
  const stats = unitStats(unit.faction, unit.kind);
  const dx = next.x - unit.tile.x;
  const dy = next.y - unit.tile.y;
  const distance = dx !== 0 && dy !== 0 ? Math.SQRT2 : 1;
  unit.move = {
    from: { ...unit.tile },
    to: { ...next },
    progress: 0,
    duration: Math.max(1, Math.ceil((distance / stats.moveSpeed) * TICK_RATE))
  };
}

function replan(world: World, unit: Unit, grid: GridSpec): void {
  const target = unit.destination ?? unit.desiredDestination;
  if (target === undefined) {
    return;
  }
  const result = findPath(grid, unit.tile, target);
  unit.destination = result.destination;
  unit.path = result.path;
  unit.pathVersion = world.map.walkVersion;
  unit.pathReachable = result.reachable && samePoint(result.destination, target);
}

function finishMovementOrder(world: World, unit: Unit): void {
  if (unit.order.kind === 'move') {
    world.replaceOrder(unit, { kind: 'idle', reason: unit.pathReachable ? 'completed' : 'unreachable' });
  } else if (unit.order.kind === 'attackMove') {
    world.replaceOrder(unit, { kind: 'idle', reason: unit.pathReachable ? 'completed' : 'unreachable' });
  } else {
    unit.destination = undefined;
    unit.path = [];
  }
}
