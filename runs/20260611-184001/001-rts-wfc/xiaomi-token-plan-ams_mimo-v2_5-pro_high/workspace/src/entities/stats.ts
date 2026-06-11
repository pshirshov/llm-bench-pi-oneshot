import { EntityStats, EntityType, Faction, BuildingType, UnitType } from '../engine/types.js';

const HUMAN_NAMES: Record<EntityType, string> = {
  town_hall: 'Town Hall', farm: 'Farm', barracks: 'Barracks',
  lumber_mill: 'Lumber Mill', guard_tower: 'Guard Tower',
  worker: 'Peasant', melee: 'Footman', ranged: 'Archer', heavy: 'Knight'
};

const ORC_NAMES: Record<EntityType, string> = {
  town_hall: 'Great Hall', farm: 'Pig Farm', barracks: 'Barracks',
  lumber_mill: 'Lumber Mill', guard_tower: 'Watch Tower',
  worker: 'Peon', melee: 'Grunt', ranged: 'Spearthrower', heavy: 'Ogre'
};

const BASE_STATS: Record<EntityType, Omit<EntityStats, 'faction' | 'name'>> = {
  town_hall: {
    type: 'town_hall', hp: 1200, maxHp: 1200, armor: 0, damage: 0,
    attackRange: 0, attackCooldown: 0, moveSpeed: 0, sightRadius: 6,
    goldCost: 0, woodCost: 0, supplyCost: 0, supplyProvided: 10,
    buildTime: 120000, width: 4, height: 4, isUnit: false, requires: []
  },
  farm: {
    type: 'farm', hp: 400, maxHp: 400, armor: 0, damage: 0,
    attackRange: 0, attackCooldown: 0, moveSpeed: 0, sightRadius: 4,
    goldCost: 100, woodCost: 50, supplyCost: 0, supplyProvided: 6,
    buildTime: 40000, width: 2, height: 2, isUnit: false, requires: []
  },
  barracks: {
    type: 'barracks', hp: 800, maxHp: 800, armor: 0, damage: 0,
    attackRange: 0, attackCooldown: 0, moveSpeed: 0, sightRadius: 4,
    goldCost: 200, woodCost: 100, supplyCost: 0, supplyProvided: 0,
    buildTime: 60000, width: 3, height: 3, isUnit: false, requires: []
  },
  lumber_mill: {
    type: 'lumber_mill', hp: 600, maxHp: 600, armor: 0, damage: 0,
    attackRange: 0, attackCooldown: 0, moveSpeed: 0, sightRadius: 4,
    goldCost: 100, woodCost: 150, supplyCost: 0, supplyProvided: 0,
    buildTime: 50000, width: 3, height: 3, isUnit: false, requires: []
  },
  guard_tower: {
    type: 'guard_tower', hp: 500, maxHp: 500, armor: 2, damage: 15,
    attackRange: 6, attackCooldown: 1000, moveSpeed: 0, sightRadius: 8,
    goldCost: 100, woodCost: 80, supplyCost: 0, supplyProvided: 0,
    buildTime: 30000, width: 2, height: 2, isUnit: false, requires: ['lumber_mill']
  },
  worker: {
    type: 'worker', hp: 200, maxHp: 200, armor: 0, damage: 5,
    attackRange: 1, attackCooldown: 1500, moveSpeed: 3.5, sightRadius: 4,
    goldCost: 75, woodCost: 0, supplyCost: 1, supplyProvided: 0,
    buildTime: 20000, width: 1, height: 1, isUnit: true, requires: [],
    canBuild: ['town_hall', 'farm', 'barracks', 'lumber_mill', 'guard_tower'],
    harvestRate: 10, repairRate: 2
  },
  melee: {
    type: 'melee', hp: 400, maxHp: 400, armor: 2, damage: 12,
    attackRange: 1, attackCooldown: 1200, moveSpeed: 3.0, sightRadius: 5,
    goldCost: 150, woodCost: 0, supplyCost: 2, supplyProvided: 0,
    buildTime: 30000, width: 1, height: 1, isUnit: true, requires: ['barracks']
  },
  ranged: {
    type: 'ranged', hp: 250, maxHp: 250, armor: 0, damage: 15,
    attackRange: 5, attackCooldown: 1500, moveSpeed: 3.0, sightRadius: 6,
    goldCost: 120, woodCost: 50, supplyCost: 2, supplyProvided: 0,
    buildTime: 30000, width: 1, height: 1, isUnit: true, requires: ['barracks', 'lumber_mill']
  },
  heavy: {
    type: 'heavy', hp: 700, maxHp: 700, armor: 4, damage: 25,
    attackRange: 1, attackCooldown: 1800, moveSpeed: 2.5, sightRadius: 5,
    goldCost: 300, woodCost: 100, supplyCost: 4, supplyProvided: 0,
    buildTime: 50000, width: 1, height: 1, isUnit: true, requires: ['barracks', 'lumber_mill']
  }
};

export function getStats(type: EntityType, faction: Faction): EntityStats {
  const base = BASE_STATS[type];
  const names = faction === 'humans' ? HUMAN_NAMES : ORC_NAMES;
  return { ...base, faction, name: names[type] };
}

export function getUnitTrainTypes(faction: Faction): Array<{ type: UnitType; stats: EntityStats }> {
  return (['worker', 'melee', 'ranged', 'heavy'] as UnitType[]).map(t => ({
    type: t,
    stats: getStats(t, faction)
  }));
}

export function getBuildingTypes(faction: Faction): Array<{ type: BuildingType; stats: EntityStats }> {
  return (['farm', 'barracks', 'lumber_mill', 'guard_tower'] as BuildingType[]).map(t => ({
    type: t,
    stats: getStats(t, faction)
  }));
}
