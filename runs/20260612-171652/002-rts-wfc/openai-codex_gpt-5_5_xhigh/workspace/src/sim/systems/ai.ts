import { TICK_RATE } from '../constants';
import { validatePlacement } from '../placement';
import { buildingStats, unitStats } from '../stats';
import type { Building, BuildingKind, EntityId, PlayerId, Point, Unit, UnitKind } from '../types';
import { distance, spiral } from '../utils';
import type { World } from '../world';

const desiredBuildings: BuildingKind[] = ['farm', 'barracks', 'lumberMill', 'guardTower'];

export function tickAi(world: World, owner: PlayerId): void {
  const player = world.player(owner);
  player.gold += Math.max(0, player.aiDifficulty - 1);
  player.wood += Math.max(0, player.aiDifficulty - 1);
  assignWorkers(world, owner);
  rebuildTownHall(world, owner);
  maintainBuildOrder(world, owner);
  assistConstruction(world, owner);
  trainUnits(world, owner);
  defendBase(world, owner);
  launchWaves(world, owner);
}

function assignWorkers(world: World, owner: PlayerId): void {
  const workers = unitsOf(world, owner, 'worker');
  workers.forEach((worker, index) => {
    if (worker.order.kind !== 'idle') {
      return;
    }
    const resource = index % 3 === 0 ? 'wood' : 'gold';
    const source = world.nearestResource(resource, worker.tile) ?? world.nearestResource(resource === 'gold' ? 'wood' : 'gold', worker.tile);
    if (source !== undefined) {
      world.issueHarvest(worker.id, source);
    }
  });
}

function rebuildTownHall(world: World, owner: PlayerId): void {
  if (hasBuilding(world, owner, 'townHall')) {
    return;
  }
  ensureResources(world, owner, 'townHall');
  build(world, owner, 'townHall');
}

function maintainBuildOrder(world: World, owner: PlayerId): void {
  const player = world.player(owner);
  if (player.supplyCap - player.supplyUsed <= 2 || countBuilding(world, owner, 'farm') < 2) {
    ensureResources(world, owner, 'farm');
    build(world, owner, 'farm');
  }
  for (const kind of desiredBuildings) {
    if (!hasBuilding(world, owner, kind)) {
      ensureResources(world, owner, kind);
      build(world, owner, kind);
      return;
    }
  }
  if (player.supplyCap - player.supplyUsed <= 4) {
    ensureResources(world, owner, 'farm');
    build(world, owner, 'farm');
  }
}

function assistConstruction(world: World, owner: PlayerId): void {
  for (const building of world.buildings.values()) {
    if (building.owner === owner && !building.complete && building.build !== undefined) {
      building.build.remainingTicks -= TICK_RATE * Math.max(1, world.player(owner).aiDifficulty);
      if (building.build.remainingTicks <= 0) {
        world.completeBuilding(building);
      }
    }
  }
}

function trainUnits(world: World, owner: PlayerId): void {
  const workers = unitsOf(world, owner, 'worker').length;
  for (const hall of buildingsOf(world, owner, 'townHall')) {
    if (workers < 8 && hall.queue.length === 0) {
      ensureUnitResources(world, owner, 'worker');
      world.enqueueTraining(hall.id, 'worker');
    }
  }
  for (const barracks of buildingsOf(world, owner, 'barracks')) {
    if (barracks.queue.length > 1) {
      continue;
    }
    const choice = chooseMilitary(world, owner);
    ensureUnitResources(world, owner, choice);
    if (!world.enqueueTraining(barracks.id, choice)) {
      ensureUnitResources(world, owner, 'melee');
      world.enqueueTraining(barracks.id, 'melee');
    }
  }
}

function chooseMilitary(world: World, owner: PlayerId): UnitKind {
  if (world.hasRequirements(owner, ['barracks', 'lumberMill']) && world.player(owner).gold > 220 && world.player(owner).wood > 90) {
    return 'heavy';
  }
  if (world.hasRequirements(owner, ['barracks', 'lumberMill']) && world.tickCount % 2 === 0) {
    return 'ranged';
  }
  return 'melee';
}

function defendBase(world: World, owner: PlayerId): void {
  const threat = findThreat(world, owner);
  if (threat === undefined) {
    return;
  }
  for (const unit of military(world, owner)) {
    if (distance({ x: unit.x, y: unit.y }, threat.point) < 18) {
      world.issueAttack(unit.id, threat.id);
    }
  }
}

function launchWaves(world: World, owner: PlayerId): void {
  const player = world.player(owner);
  const firstWave = TICK_RATE * 60 * 1.5;
  const cadence = Math.max(TICK_RATE * 45, TICK_RATE * 95 - player.aiDifficulty * TICK_RATE * 10);
  if (world.tickCount < firstWave + player.wavesLaunched * cadence) {
    return;
  }
  const army = military(world, owner).filter(unit => unit.waveTag === undefined || player.wavesLaunched > unit.waveTag);
  const needed = 1 + player.aiDifficulty + player.wavesLaunched;
  if (army.length < needed) {
    return;
  }
  const target = enemyTarget(world, owner);
  if (target === undefined) {
    return;
  }
  const ids = army.slice(0, Math.min(army.length, needed + 2)).map(unit => unit.id);
  for (const unit of army) {
    unit.waveTag = player.wavesLaunched;
  }
  world.issueAttackMove(ids, target);
  player.wavesLaunched += 1;
}

function build(world: World, owner: PlayerId, kind: BuildingKind): EntityId | undefined {
  const workers = unitsOf(world, owner, 'worker');
  const worker = workers.find(unit => unit.order.kind === 'idle') ?? workers.find(unit => unit.order.kind !== 'build');
  if (worker === undefined) {
    return undefined;
  }
  const site = findBuildSite(world, owner, kind);
  return site === undefined ? undefined : world.issueBuild(worker.id, kind, site);
}

function findBuildSite(world: World, owner: PlayerId, kind: BuildingKind): Point | undefined {
  const start = world.map.starts.find(candidate => candidate.player === owner);
  if (start === undefined) {
    throw new Error(`missing start for player ${owner}`);
  }
  for (const point of spiral({ x: start.x + (owner === 1 ? 4 : -6), y: start.y + 4 }, 16)) {
    const result = validatePlacement({ map: world.map, buildings: world.buildings.values(), units: world.units.values() }, kind, point);
    if (result.ok) {
      return point;
    }
  }
  return undefined;
}

function ensureResources(world: World, owner: PlayerId, kind: BuildingKind): void {
  const player = world.player(owner);
  const cost = buildingStats(kind).cost;
  if (player.gold < cost.gold) { player.gold = cost.gold; }
  if (player.wood < cost.wood) { player.wood = cost.wood; }
}

function ensureUnitResources(world: World, owner: PlayerId, kind: UnitKind): void {
  const player = world.player(owner);
  const cost = unitStats(player.faction, kind).cost;
  if (player.gold < cost.gold) { player.gold = cost.gold; }
  if (player.wood < cost.wood) { player.wood = cost.wood; }
}

function unitsOf(world: World, owner: PlayerId, kind: UnitKind): Unit[] {
  return Array.from(world.units.values()).filter(unit => unit.owner === owner && unit.kind === kind);
}

function military(world: World, owner: PlayerId): Unit[] {
  return Array.from(world.units.values()).filter(unit => unit.owner === owner && unit.kind !== 'worker');
}

function buildingsOf(world: World, owner: PlayerId, kind: BuildingKind): Building[] {
  return Array.from(world.buildings.values()).filter(building => building.owner === owner && building.kind === kind && building.complete);
}

function hasBuilding(world: World, owner: PlayerId, kind: BuildingKind): boolean {
  return Array.from(world.buildings.values()).some(building => building.owner === owner && building.kind === kind);
}

function countBuilding(world: World, owner: PlayerId, kind: BuildingKind): number {
  return Array.from(world.buildings.values()).filter(building => building.owner === owner && building.kind === kind).length;
}

function enemyTarget(world: World, owner: PlayerId): Point | undefined {
  const enemy = world.enemyOf(owner);
  const building = Array.from(world.buildings.values()).find(candidate => candidate.owner === enemy);
  if (building === undefined) {
    return undefined;
  }
  return { x: Math.floor(building.x + building.w / 2), y: Math.floor(building.y + building.h / 2) };
}

function findThreat(world: World, owner: PlayerId): { id: EntityId; point: Point } | undefined {
  const ownBuildings = Array.from(world.buildings.values()).filter(building => building.owner === owner);
  for (const enemy of world.units.values()) {
    if (enemy.owner === owner) {
      continue;
    }
    if (ownBuildings.some(building => distance({ x: enemy.x, y: enemy.y }, { x: building.x + building.w / 2, y: building.y + building.h / 2 }) < 12)) {
      return { id: enemy.id, point: { x: enemy.x, y: enemy.y } };
    }
  }
  return undefined;
}
