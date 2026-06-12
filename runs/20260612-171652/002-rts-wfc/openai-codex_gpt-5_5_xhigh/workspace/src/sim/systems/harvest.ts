import { BALANCE, buildingStats } from '../stats';
import type { Building, Point, Unit } from '../types';
import { getTile } from '../map/tiles';
import { distance } from '../utils';
import type { World } from '../world';

export function tickHarvestAndWork(world: World): void {
  for (const unit of Array.from(world.units.values())) {
    if (unit.kind !== 'worker') {
      continue;
    }
    if (unit.order.kind === 'harvest') {
      tickHarvest(world, unit);
    } else if (unit.order.kind === 'build') {
      tickBuild(world, unit);
    } else if (unit.order.kind === 'repair') {
      tickRepair(world, unit);
    }
  }
}

function tickHarvest(world: World, worker: Unit): void {
  const order = worker.order;
  if (order.kind !== 'harvest') {
    return;
  }
  if (order.phase !== 'toDropoff' && !sourceStillValid(world, order.source, order.resource)) {
    if (!retargetSource(world, worker)) {
      const dropoff = worker.cargo === undefined ? undefined : world.nearestDropoff(worker.owner, worker.cargo.kind, worker.tile);
      if (dropoff !== undefined && worker.cargo !== undefined) {
        order.phase = 'toDropoff';
      } else {
        world.replaceOrder(worker, { kind: 'idle', reason: order.resource === 'gold' ? 'exhausted' : 'cancelled' });
      }
    }
    return;
  }
  if (order.phase === 'toSource') {
    const adjacent = world.nearestAdjacentToTile(order.source, worker.tile);
    if (adjacent === undefined) {
      worker.blockedTicks += 1;
      return;
    }
    if (isAdjacent(worker.tile, order.source)) {
      worker.destination = undefined;
      worker.path = [];
      order.phase = 'gathering';
      order.gatherTicks = order.resource === 'gold' ? BALANCE.goldGatherTicks : BALANCE.woodGatherTicks;
    } else {
      moveToward(world, worker, adjacent);
    }
  } else if (order.phase === 'gathering') {
    gather(world, worker);
  } else {
    deliver(world, worker);
  }
}

function gather(world: World, worker: Unit): void {
  const order = worker.order;
  if (order.kind !== 'harvest') {
    return;
  }
  if (!sourceStillValid(world, order.source, order.resource)) {
    retargetSource(world, worker);
    return;
  }
  order.gatherTicks -= 1;
  worker.lastProgressTick = world.tickCount;
  if (order.gatherTicks > 0) {
    return;
  }
  const tile = getTile(world.map, order.source.x, order.source.y);
  const available = order.resource === 'gold' ? tile.gold : tile.wood;
  const amount = Math.min(BALANCE.workerCarry, available);
  if (amount <= 0) {
    retargetSource(world, worker);
    return;
  }
  if (order.resource === 'gold') {
    tile.gold -= amount;
    world.markTileChanged(order.source, 'goldMine');
  } else {
    tile.wood -= amount;
    world.markTileChanged(order.source, 'forest');
  }
  worker.cargo = { kind: order.resource, amount };
  order.phase = 'toDropoff';
}

function deliver(world: World, worker: Unit): void {
  if (worker.cargo === undefined) {
    const order = worker.order;
    if (order.kind === 'harvest') {
      order.phase = 'toSource';
    }
    return;
  }
  const dropoff = world.nearestDropoff(worker.owner, worker.cargo.kind, worker.tile);
  if (dropoff === undefined) {
    world.replaceOrder(worker, { kind: 'idle', reason: 'no-dropoff' });
    return;
  }
  const adjacent = world.nearestAdjacentToBuilding(dropoff, worker.tile);
  if (adjacent === undefined) {
    world.replaceOrder(worker, { kind: 'idle', reason: 'no-dropoff' });
    return;
  }
  if (isAdjacentToBuilding(worker.tile, dropoff)) {
    const player = world.player(worker.owner);
    if (worker.cargo.kind === 'gold') {
      player.gold += worker.cargo.amount;
    } else {
      player.wood += worker.cargo.amount;
    }
    const resource = worker.cargo.kind;
    worker.cargo = undefined;
    const order = worker.order;
    if (order.kind === 'harvest') {
      if (sourceStillValid(world, order.source, resource) || retargetSource(world, worker)) {
        const next = worker.order;
        if (next.kind === 'harvest') {
          next.phase = 'toSource';
        }
      } else {
        world.replaceOrder(worker, { kind: 'idle', reason: 'exhausted' });
      }
    }
  } else {
    moveToward(world, worker, adjacent);
  }
}

function tickBuild(world: World, worker: Unit): void {
  const order = worker.order;
  if (order.kind !== 'build') {
    return;
  }
  const building = Array.from(world.buildings.values()).find(candidate => candidate.owner === worker.owner && candidate.x === order.site.x && candidate.y === order.site.y && !candidate.complete);
  if (building === undefined || building.build === undefined) {
    world.replaceOrder(worker, { kind: 'idle', reason: 'completed' });
    return;
  }
  const adjacent = world.nearestAdjacentToBuilding(building, worker.tile);
  if (adjacent === undefined) {
    world.replaceOrder(worker, { kind: 'idle', reason: 'unreachable' });
    return;
  }
  if (!isAdjacentToBuilding(worker.tile, building)) {
    moveToward(world, worker, adjacent);
    return;
  }
  building.build.remainingTicks -= 1;
  worker.lastProgressTick = world.tickCount;
  const stats = buildingStats(building.kind);
  const completed = 1 - building.build.remainingTicks / building.build.totalTicks;
  building.hp = Math.max(building.hp, Math.max(1, Math.floor(stats.hp * completed)));
  if (building.build.remainingTicks <= 0) {
    world.completeBuilding(building);
    world.replaceOrder(worker, { kind: 'idle', reason: 'completed' });
  }
}

function tickRepair(world: World, worker: Unit): void {
  const order = worker.order;
  if (order.kind !== 'repair') {
    return;
  }
  const building = world.buildings.get(order.targetId);
  if (building === undefined || building.owner !== worker.owner) {
    world.replaceOrder(worker, { kind: 'idle', reason: 'cancelled' });
    return;
  }
  const stats = buildingStats(building.kind);
  if (building.hp >= stats.hp) {
    world.replaceOrder(worker, { kind: 'idle', reason: 'completed' });
    return;
  }
  const adjacent = world.nearestAdjacentToBuilding(building, worker.tile);
  if (adjacent === undefined) {
    world.replaceOrder(worker, { kind: 'idle', reason: 'unreachable' });
    return;
  }
  if (!isAdjacentToBuilding(worker.tile, building)) {
    moveToward(world, worker, adjacent);
    return;
  }
  const repaired = Math.min(BALANCE.repairHpPerTick, stats.hp - building.hp);
  const cost = repaired * BALANCE.repairWoodPerHp;
  if (world.player(worker.owner).wood < cost) {
    world.replaceOrder(worker, { kind: 'idle', reason: 'cancelled' });
    return;
  }
  world.player(worker.owner).wood -= cost;
  building.hp += repaired;
  worker.lastProgressTick = world.tickCount;
  if (building.hp >= stats.hp) {
    building.hp = stats.hp;
    world.replaceOrder(worker, { kind: 'idle', reason: 'completed' });
  }
}

function retargetSource(world: World, worker: Unit): boolean {
  const order = worker.order;
  if (order.kind !== 'harvest') {
    return false;
  }
  const replacement = world.nearestResource(order.resource, worker.tile);
  if (replacement === undefined) {
    return false;
  }
  order.source = replacement;
  order.phase = 'toSource';
  order.gatherTicks = 0;
  return true;
}

function sourceStillValid(world: World, source: Point, resource: 'gold' | 'wood'): boolean {
  const tile = getTile(world.map, source.x, source.y);
  return resource === 'gold' ? tile.kind === 'goldMine' && tile.gold > 0 : tile.kind === 'forest' && tile.wood > 0;
}

function moveToward(world: World, worker: Unit, target: Point): void {
  if (worker.move !== undefined) {
    return;
  }
  if (worker.destination === undefined || !sameDestination(worker.destination, target)) {
    world.setDestination(worker, target);
  }
}

function sameDestination(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

function isAdjacent(a: Point, b: Point): boolean {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) === 1;
}

function isAdjacentToBuilding(point: Point, building: Building): boolean {
  const nearestX = Math.max(building.x, Math.min(point.x, building.x + building.w - 1));
  const nearestY = Math.max(building.y, Math.min(point.y, building.y + building.h - 1));
  return distance(point, { x: nearestX, y: nearestY }) <= Math.SQRT2;
}
