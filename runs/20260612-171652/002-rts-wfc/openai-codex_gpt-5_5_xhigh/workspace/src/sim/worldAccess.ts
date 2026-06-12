import type { Building, EntityId, Point, Rect, SerializedWorld, Unit } from './types';
import { distance, rectContains } from './utils';
import type { World } from './world';

export function selectAt(world: World, worldPoint: Point, additive: boolean): void {
  if (!additive) {
    world.selectedIds.clear();
  }
  const entity = entityAtWorld(world, worldPoint);
  if (entity !== undefined && entity.owner === 1) {
    world.selectedIds.add(entity.id);
  }
}

export function selectBox(world: World, rect: Rect, additive: boolean): void {
  if (!additive) {
    world.selectedIds.clear();
  }
  for (const unit of world.units.values()) {
    if (unit.owner === 1 && rectContains(rect, { x: unit.x, y: unit.y })) {
      world.selectedIds.add(unit.id);
    }
  }
}

export function entityAtWorld(world: World, point: Point): Unit | Building | undefined {
  for (const unit of world.units.values()) {
    if (distance({ x: unit.x, y: unit.y }, point) <= 0.45) {
      return unit;
    }
  }
  return world.buildingAtTile(Math.floor(point.x), Math.floor(point.y));
}

export function serializeWorld(world: World): SerializedWorld {
  const unitRows = Array.from(world.units.values()).sort(byId).map(unitRow);
  const buildingRows = Array.from(world.buildings.values()).sort(byId).map(buildingRow);
  const playerRows = Array.from(world.players.values()).sort((a, b) => a.id - b.id)
    .map(p => [p.id, p.gold.toFixed(2), p.wood.toFixed(2), p.supplyUsed, p.supplyCap, p.wavesLaunched].join(':'));
  return {
    tick: world.tickCount,
    outcome: world.outcome,
    mapHash: world.map.tiles.map(t => `${t.kind[0]}${t.gold}${t.wood}`).join(''),
    players: playerRows.join('|'),
    units: unitRows.join('|'),
    buildings: buildingRows.join('|'),
    projectiles: world.projectiles.map(p => [p.targetId, p.damage, p.remainingTicks].join(':')).join('|')
  };
}

function byId<T extends { id: EntityId }>(a: T, b: T): number {
  return a.id - b.id;
}

function unitRow(u: Unit): string {
  return [u.id, u.owner, u.kind, u.hp.toFixed(2), u.tile.x, u.tile.y, u.order.kind, u.cargo?.kind ?? '', u.cargo?.amount ?? 0].join(':');
}

function buildingRow(b: Building): string {
  return [b.id, b.owner, b.kind, b.hp.toFixed(2), b.x, b.y, b.complete ? 1 : 0, b.queue.length].join(':');
}
