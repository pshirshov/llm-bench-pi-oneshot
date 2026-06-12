import { PROJECTILE_SPEED_TILES_PER_SECOND, TICK_RATE } from '../constants';
import { buildingStats, unitStats } from '../stats';
import type { Building, EntityId, PlayerId, Point, Unit } from '../types';
import { distance } from '../utils';
import type { World } from '../world';

export function tickCombat(world: World): void {
  for (const unit of world.units.values()) {
    unit.attackCooldown = Math.max(0, unit.attackCooldown - 1);
  }
  for (const building of world.buildings.values()) {
    building.attackCooldown = Math.max(0, building.attackCooldown - 1);
  }
  for (const unit of Array.from(world.units.values()).sort((a, b) => a.id - b.id)) {
    tickUnitCombat(world, unit);
  }
  for (const building of Array.from(world.buildings.values()).sort((a, b) => a.id - b.id)) {
    tickBuildingCombat(world, building);
  }
}

export function tickProjectiles(world: World): void {
  for (const projectile of world.projectiles) {
    projectile.remainingTicks -= 1;
    const ratio = projectile.remainingTicks <= 0 ? 1 : 0.75;
    const target = entityPosition(world, projectile.targetId) ?? projectile.from;
    projectile.x += (target.x - projectile.x) * ratio;
    projectile.y += (target.y - projectile.y) * ratio;
  }
  for (let i = world.projectiles.length - 1; i >= 0; i -= 1) {
    const projectile = world.projectiles[i];
    if (projectile.remainingTicks <= 0) {
      applyDamage(world, projectile.targetId, projectile.damage);
      world.projectiles.splice(i, 1);
    }
  }
}

export function computeDamage(attack: number, armor: number): number {
  return Math.max(1, attack - armor);
}

function tickUnitCombat(world: World, unit: Unit): void {
  const stats = unitStats(unit.faction, unit.kind);
  const explicitTarget = unit.order.kind === 'attack' ? unit.order.targetId : undefined;
  let targetId = explicitTarget;
  if (targetId === undefined && (unit.order.kind === 'idle' || unit.order.kind === 'attackMove')) {
    targetId = findHostileInRange(world, unit.owner, unitCenter(unit), stats.sight);
  }
  if (targetId === undefined) {
    return;
  }
  const targetPosition = entityPosition(world, targetId);
  if (targetPosition === undefined) {
    if (unit.order.kind === 'attack') {
      world.replaceOrder(unit, { kind: 'idle', reason: 'completed' });
    }
    return;
  }
  if (distance(unitCenter(unit), targetPosition) <= stats.range) {
    unit.destination = undefined;
    unit.path = [];
    if (unit.attackCooldown <= 0) {
      fire(world, unit.owner, unitCenter(unit), targetId, stats.damage, stats.range > 1.5);
      unit.attackCooldown = stats.cooldownTicks;
    }
  } else if (unit.order.kind === 'attack') {
    world.setDestination(unit, { x: Math.floor(targetPosition.x), y: Math.floor(targetPosition.y) });
  }
}

function tickBuildingCombat(world: World, building: Building): void {
  const stats = buildingStats(building.kind);
  if (!building.complete || stats.damage <= 0 || building.attackCooldown > 0) {
    return;
  }
  const center = buildingCenter(building);
  const targetId = findHostileInRange(world, building.owner, center, stats.range);
  if (targetId !== undefined) {
    fire(world, building.owner, center, targetId, stats.damage, true);
    building.attackCooldown = stats.cooldownTicks;
  }
}

function fire(world: World, owner: PlayerId, from: Point, targetId: EntityId, attack: number, projectile: boolean): void {
  const armor = entityArmor(world, targetId);
  if (armor === undefined) {
    return;
  }
  const damage = computeDamage(attack, armor);
  if (!projectile) {
    applyDamage(world, targetId, damage);
    return;
  }
  const target = entityPosition(world, targetId);
  if (target === undefined) {
    return;
  }
  const travelTicks = Math.max(1, Math.ceil((distance(from, target) / PROJECTILE_SPEED_TILES_PER_SECOND) * TICK_RATE));
  world.projectiles.push({ id: world.tickCount * 100000 + world.projectiles.length, owner, from: { ...from }, x: from.x, y: from.y, targetId, damage, remainingTicks: travelTicks });
}

function applyDamage(world: World, targetId: EntityId, damage: number): void {
  if (world.units.has(targetId) || world.buildings.has(targetId)) {
    world.damageEntity(targetId, damage);
  }
}

function findHostileInRange(world: World, owner: PlayerId, from: Point, range: number): EntityId | undefined {
  let best: EntityId | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const unit of world.units.values()) {
    if (unit.owner !== owner) {
      const d = distance(from, unitCenter(unit));
      if (d <= range && d < bestDistance) {
        best = unit.id;
        bestDistance = d;
      }
    }
  }
  for (const building of world.buildings.values()) {
    if (building.owner !== owner) {
      const d = distance(from, buildingCenter(building));
      if (d <= range && d < bestDistance) {
        best = building.id;
        bestDistance = d;
      }
    }
  }
  return best;
}

function entityPosition(world: World, id: EntityId): Point | undefined {
  const unit = world.units.get(id);
  if (unit !== undefined) {
    return unitCenter(unit);
  }
  const building = world.buildings.get(id);
  return building === undefined ? undefined : buildingCenter(building);
}

function entityArmor(world: World, id: EntityId): number | undefined {
  const unit = world.units.get(id);
  if (unit !== undefined) {
    return unitStats(unit.faction, unit.kind).armor;
  }
  const building = world.buildings.get(id);
  return building === undefined ? undefined : buildingStats(building.kind).armor;
}

function unitCenter(unit: Unit): Point {
  return { x: unit.x, y: unit.y };
}

function buildingCenter(building: Building): Point {
  return { x: building.x + building.w / 2, y: building.y + building.h / 2 };
}
