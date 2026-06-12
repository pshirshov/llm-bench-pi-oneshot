import { MAX_ORDER_STALL_TICKS, MIN_UNIT_DISTANCE } from '../constants';
import { getTile, isTileWalkable } from '../map/tiles';
import { validNeighbors } from '../pathfinding';
import type { Unit } from '../types';
import { assertFinite, distance } from '../utils';
import type { World } from '../world';

export function assertWorldInvariants(world: World): void {
  for (const player of world.players.values()) {
    assertNonNegative(player.gold, 'gold');
    assertNonNegative(player.wood, 'wood');
    assertNonNegative(player.supplyUsed, 'supplyUsed');
    assertNonNegative(player.supplyCap, 'supplyCap');
  }
  const units = Array.from(world.units.values());
  for (const unit of units) {
    assertUnit(world, unit);
  }
  for (const building of world.buildings.values()) {
    assertNonNegative(building.hp, `building ${building.id} hp`);
  }
  for (let i = 0; i < units.length; i += 1) {
    for (let j = i + 1; j < units.length; j += 1) {
      const separation = distance({ x: units[i].x, y: units[i].y }, { x: units[j].x, y: units[j].y });
      if (separation < MIN_UNIT_DISTANCE) {
        throw new Error(`units ${units[i].id} and ${units[j].id} overlap at distance ${separation}`);
      }
    }
  }
}

function assertUnit(world: World, unit: Unit): void {
  assertNonNegative(unit.hp, `unit ${unit.id} hp`);
  assertFinite(unit.x, `unit ${unit.id} x`);
  assertFinite(unit.y, `unit ${unit.id} y`);
  if (!isTileWalkable(getTile(world.map, unit.tile.x, unit.tile.y).kind)) {
    throw new Error(`unit ${unit.id} occupies unwalkable tile ${unit.tile.x},${unit.tile.y}`);
  }
  if (world.buildingAtTile(unit.tile.x, unit.tile.y) !== undefined) {
    throw new Error(`unit ${unit.id} occupies building footprint`);
  }
  const move = unit.move;
  if (move !== undefined) {
    if (world.staticGrid().isBlocked(move.to.x, move.to.y)) {
      throw new Error(`unit ${unit.id} moves into blocked tile`);
    }
    const neighbors = validNeighbors(world.staticGrid(), move.from);
    if (!neighbors.some(point => point.x === move.to.x && point.y === move.to.y)) {
      throw new Error(`unit ${unit.id} movement cuts a blocked corner`);
    }
  }
  if (unit.order.kind !== 'idle' && world.tickCount - unit.lastProgressTick > MAX_ORDER_STALL_TICKS + 1) {
    throw new Error(`unit ${unit.id} active order exceeded progress watchdog`);
  }
}

function assertNonNegative(value: number, label: string): void {
  assertFinite(value, label);
  if (value < 0) {
    throw new Error(`${label} is negative`);
  }
}
