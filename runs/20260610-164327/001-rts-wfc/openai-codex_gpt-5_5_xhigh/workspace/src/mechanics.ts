import { BUILDING_STATS, UNIT_STATS } from './data';
import type { BuildingType, Entity, PlayerState, Resources, UnitType } from './types';

export function computeDamage(attackDamage: number, defenderArmor: number): number {
  return Math.max(1, attackDamage - defenderArmor);
}

export function canAfford(resources: Resources, goldCost: number, woodCost: number): boolean {
  return resources.gold >= goldCost && resources.wood >= woodCost;
}

export function spend(resources: Resources, goldCost: number, woodCost: number): void {
  if (!canAfford(resources, goldCost, woodCost)) {
    throw new Error(`insufficient resources: need ${goldCost} gold and ${woodCost} wood`);
  }
  resources.gold -= goldCost;
  resources.wood -= woodCost;
}

export function refund(resources: Resources, goldCost: number, woodCost: number): void {
  resources.gold += goldCost;
  resources.wood += woodCost;
}

export function unitCost(unitType: UnitType): { gold: number; wood: number; supply: number } {
  const stats = UNIT_STATS[unitType];
  return { gold: stats.goldCost, wood: stats.woodCost, supply: stats.supplyCost };
}

export function buildingCost(buildingType: BuildingType): { gold: number; wood: number } {
  const stats = BUILDING_STATS[buildingType];
  return { gold: stats.goldCost, wood: stats.woodCost };
}

export function calculateSupply(side: PlayerState, entities: Iterable<Entity>): { used: number; cap: number } {
  let used = 0;
  let cap = 0;
  for (const entity of entities) {
    if (entity.owner !== side.side || entity.hp <= 0) {
      continue;
    }
    if (entity.kind === 'unit' && entity.unit !== undefined) {
      used += entity.unit.supplyCost;
    }
    if (entity.kind === 'building' && entity.building !== undefined && entity.completed) {
      cap += entity.building.supplyProvided;
      for (const queued of entity.building.trainQueue) {
        used += UNIT_STATS[queued.unitType].supplyCost;
      }
    }
  }
  return { used, cap };
}

export function canReserveSupply(side: PlayerState, entities: Iterable<Entity>, unitType: UnitType): boolean {
  const supply = calculateSupply(side, entities);
  return supply.used + UNIT_STATS[unitType].supplyCost <= supply.cap;
}
