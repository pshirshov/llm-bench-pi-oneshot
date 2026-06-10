import type { BuildingStats, BuildingType, FactionId, TileType, UnitStats, UnitType } from './types';

export const FACTIONS: Record<FactionId, { displayName: string; color: string; dark: string; accent: string }> = {
  humans: { displayName: 'Humans', color: '#3f7fe8', dark: '#1d3e77', accent: '#d8d4b0' },
  orcs: { displayName: 'Orcs', color: '#c25032', dark: '#61291d', accent: '#6fc75c' },
};

export const TILE_COLORS: Record<TileType, string> = {
  grass: '#3f8f3a',
  dirt: '#8f6b3a',
  forest: '#1f5f2e',
  water: '#244f92',
  rock: '#676b73',
  gold: '#c99a20',
};

export const UNIT_STATS: Record<UnitType, UnitStats> = {
  worker: {
    type: 'worker',
    humanName: 'Peasant',
    orcName: 'Peon',
    hp: 45,
    armor: 0,
    damage: 4,
    range: 0.95,
    cooldown: 1.2,
    speed: 3.1,
    sight: 6,
    goldCost: 50,
    woodCost: 0,
    supplyCost: 1,
    trainingTime: 12,
    projectile: false,
  },
  melee: {
    type: 'melee',
    humanName: 'Footman',
    orcName: 'Grunt',
    hp: 75,
    armor: 2,
    damage: 9,
    range: 1.05,
    cooldown: 1.1,
    speed: 2.8,
    sight: 6,
    goldCost: 90,
    woodCost: 0,
    supplyCost: 2,
    trainingTime: 18,
    projectile: false,
  },
  ranged: {
    type: 'ranged',
    humanName: 'Archer',
    orcName: 'Spearthrower',
    hp: 48,
    armor: 0,
    damage: 7,
    range: 5.4,
    cooldown: 1.35,
    speed: 2.75,
    sight: 7,
    goldCost: 70,
    woodCost: 35,
    supplyCost: 2,
    trainingTime: 20,
    projectile: true,
  },
  heavy: {
    type: 'heavy',
    humanName: 'Knight',
    orcName: 'Ogre',
    hp: 115,
    armor: 3,
    damage: 16,
    range: 1.05,
    cooldown: 1.45,
    speed: 2.65,
    sight: 6,
    goldCost: 160,
    woodCost: 60,
    supplyCost: 3,
    trainingTime: 32,
    projectile: false,
  },
};

export const BUILDING_STATS: Record<BuildingType, BuildingStats> = {
  townHall: {
    type: 'townHall',
    humanName: 'Town Hall',
    orcName: 'Great Hall',
    hp: 900,
    armor: 2,
    goldCost: 450,
    woodCost: 220,
    buildTime: 55,
    footprint: { width: 4, height: 4 },
    sight: 8,
    supplyProvided: 10,
    trains: ['worker'],
    attackDamage: 0,
    attackRange: 0,
    attackCooldown: 0,
  },
  farm: {
    type: 'farm',
    humanName: 'Farm',
    orcName: 'Pig Farm',
    hp: 260,
    armor: 1,
    goldCost: 70,
    woodCost: 35,
    buildTime: 22,
    footprint: { width: 2, height: 2 },
    sight: 4,
    supplyProvided: 6,
    trains: [],
    attackDamage: 0,
    attackRange: 0,
    attackCooldown: 0,
  },
  barracks: {
    type: 'barracks',
    humanName: 'Barracks',
    orcName: 'Barracks',
    hp: 650,
    armor: 2,
    goldCost: 180,
    woodCost: 120,
    buildTime: 38,
    footprint: { width: 3, height: 3 },
    sight: 6,
    supplyProvided: 0,
    trains: ['melee', 'ranged', 'heavy'],
    attackDamage: 0,
    attackRange: 0,
    attackCooldown: 0,
  },
  lumberMill: {
    type: 'lumberMill',
    humanName: 'Lumber Mill',
    orcName: 'War Mill',
    hp: 520,
    armor: 1,
    goldCost: 120,
    woodCost: 150,
    buildTime: 34,
    footprint: { width: 3, height: 3 },
    sight: 6,
    supplyProvided: 0,
    trains: [],
    attackDamage: 0,
    attackRange: 0,
    attackCooldown: 0,
  },
  guardTower: {
    type: 'guardTower',
    humanName: 'Guard Tower',
    orcName: 'Watch Tower',
    hp: 330,
    armor: 2,
    goldCost: 110,
    woodCost: 100,
    buildTime: 30,
    footprint: { width: 2, height: 2 },
    sight: 8,
    supplyProvided: 0,
    trains: [],
    attackDamage: 14,
    attackRange: 6.2,
    attackCooldown: 1.25,
  },
};

export const BUILD_BUTTON_ORDER: readonly BuildingType[] = ['townHall', 'farm', 'barracks', 'lumberMill', 'guardTower'];
export const TRAIN_BUTTON_ORDER: readonly UnitType[] = ['worker', 'melee', 'ranged', 'heavy'];

export function displayUnitName(faction: FactionId, unitType: UnitType): string {
  const stats = UNIT_STATS[unitType];
  return faction === 'humans' ? stats.humanName : stats.orcName;
}

export function displayBuildingName(faction: FactionId, buildingType: BuildingType): string {
  const stats = BUILDING_STATS[buildingType];
  return faction === 'humans' ? stats.humanName : stats.orcName;
}

export function isLandTile(tile: TileType): boolean {
  return tile === 'grass' || tile === 'dirt';
}

export function isResourceTile(tile: TileType): boolean {
  return tile === 'gold' || tile === 'forest';
}

export function tileBlocksMovement(tile: TileType): boolean {
  return tile === 'water' || tile === 'rock' || tile === 'forest' || tile === 'gold';
}
