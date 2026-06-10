import { UnitType, BuildingType, Faction, UnitStats, BuildingStats } from './types';

// ─── Unit Stats (mirrored for both factions) ───

export const UNIT_STATS: Record<UnitType, UnitStats> = {
  [UnitType.Worker]: {
    hp: 40,
    armor: 0,
    attackDamage: 5,
    attackRange: 1,
    attackCooldown: 1.0,
    moveSpeed: 2.5,
    sightRadius: 5,
    goldCost: 50,
    woodCost: 0,
    supplyCost: 1,
    trainingTime: 12,
  },
  [UnitType.Infantry]: {
    hp: 60,
    armor: 2,
    attackDamage: 8,
    attackRange: 1,
    attackCooldown: 0.8,
    moveSpeed: 2.8,
    sightRadius: 5,
    goldCost: 100,
    woodCost: 0,
    supplyCost: 1,
    trainingTime: 16,
  },
  [UnitType.Ranged]: {
    hp: 40,
    armor: 0,
    attackDamage: 4,
    attackRange: 5,
    attackCooldown: 1.2,
    moveSpeed: 2.8,
    sightRadius: 6,
    goldCost: 70,
    woodCost: 40,
    supplyCost: 1,
    trainingTime: 20,
  },
  [UnitType.Heavy]: {
    hp: 120,
    armor: 4,
    attackDamage: 12,
    attackRange: 1,
    attackCooldown: 1.0,
    moveSpeed: 2.2,
    sightRadius: 5,
    goldCost: 200,
    woodCost: 80,
    supplyCost: 2,
    trainingTime: 30,
  },
};

// ─── Building Stats ───

export const BUILDING_STATS: Record<BuildingType, BuildingStats> = {
  [BuildingType.TownHall]: {
    hp: 1200,
    goldCost: 0,
    woodCost: 0,
    buildTime: 0, // starting building, no build needed
    footprintW: 3,
    footprintH: 3,
    supplyProvided: 5,
    attackDamage: 0,
    attackRange: 0,
    attackCooldown: 0,
    sightRadius: 6,
  },
  [BuildingType.Farm]: {
    hp: 300,
    goldCost: 100,
    woodCost: 50,
    buildTime: 15,
    footprintW: 2,
    footprintH: 2,
    supplyProvided: 6,
    attackDamage: 0,
    attackRange: 0,
    attackCooldown: 0,
    sightRadius: 0,
  },
  [BuildingType.Barracks]: {
    hp: 600,
    goldCost: 200,
    woodCost: 100,
    buildTime: 25,
    footprintW: 3,
    footprintH: 3,
    supplyProvided: 0,
    attackDamage: 0,
    attackRange: 0,
    attackCooldown: 0,
    sightRadius: 4,
  },
  [BuildingType.LumberMill]: {
    hp: 500,
    goldCost: 150,
    woodCost: 0,
    buildTime: 20,
    footprintW: 2,
    footprintH: 2,
    supplyProvided: 0,
    attackDamage: 0,
    attackRange: 0,
    attackCooldown: 0,
    sightRadius: 4,
  },
  [BuildingType.GuardTower]: {
    hp: 300,
    goldCost: 120,
    woodCost: 60,
    buildTime: 18,
    footprintW: 1,
    footprintH: 1,
    supplyProvided: 0,
    attackDamage: 10,
    attackRange: 6,
    attackCooldown: 1.5,
    sightRadius: 7,
  },
};

// ─── Faction display names and colors ───

export const FACTION_NAMES: Record<Faction, string> = {
  [Faction.Human]: 'Human',
  [Faction.Orc]: 'Orc',
};

export const FACTION_COLORS: Record<Faction, string> = {
  [Faction.Human]: '#4488ff',
  [Faction.Orc]: '#ff4444',
};

export const FACTION_COLORS_DARK: Record<Faction, string> = {
  [Faction.Human]: '#224488',
  [Faction.Orc]: '#882222',
};

// Unit display names per faction
export const UNIT_NAMES: Record<Faction, Record<UnitType, string>> = {
  [Faction.Human]: {
    [UnitType.Worker]: 'Peasant',
    [UnitType.Infantry]: 'Footman',
    [UnitType.Ranged]: 'Archer',
    [UnitType.Heavy]: 'Knight',
  },
  [Faction.Orc]: {
    [UnitType.Worker]: 'Peon',
    [UnitType.Infantry]: 'Grunt',
    [UnitType.Ranged]: 'Spearthrower',
    [UnitType.Heavy]: 'Ogre',
  },
};

export const BUILDING_NAMES: Record<BuildingType, string> = {
  [BuildingType.TownHall]: 'Town Hall',
  [BuildingType.Farm]: 'Farm',
  [BuildingType.Barracks]: 'Barracks',
  [BuildingType.LumberMill]: 'Lumber Mill',
  [BuildingType.GuardTower]: 'Guard Tower',
};

// ─── Tile colors ───

export const TILE_COLORS: Record<string, string> = {
  grass: '#4a8c3f',
  dirt: '#c4a45a',
  forest: '#2d5a1e',
  water: '#3366aa',
  rock: '#777777',
  gold_mine: '#ddaa22',
};

export const TILE_COLORS_DIM: Record<string, string> = {
  grass: '#2a4c1f',
  dirt: '#6a5a2a',
  forest: '#1a3a0e',
  water: '#1a3366',
  rock: '#444444',
  gold_mine: '#6a5511',
};

// ─── Game constants ───

export const TICK_RATE = 60; // ticks per second
export const TICK_DURATION = 1 / TICK_RATE;
export const TILE_SIZE = 32; // pixels per tile for rendering

export const WORKER_CARRY_AMOUNT = 8;
export const GOLD_MINE_AMOUNT = 2000;
export const FOREST_TILE_WOOD = 100;
export const WORKER_HARVEST_RATE = 1; // resource per second while harvesting
export const WORKER_BUILD_RATE = 1 / 30; // build progress per second (30s total = 1/30 per sec)
export const WORKER_REPAIR_RATE = 5; // hp per second

export const ATTACK_MOVE_ACQUIRE_RADIUS = 6; // tiles for auto-acquire on attack-move
export const GUARD_ACQUIRE_RADIUS_ADD = 2; // extra beyond sight for guard mode

export const MINIMAP_SIZE = 160;
export const TOP_BAR_H = 36;
export const BOTTOM_PANEL_H = 160;

export const PROJECTILE_SPEED = 10; // tiles per second

// ─── Prerequisites ───

export function getUnitPrerequisites(unitType: UnitType): BuildingType[] {
  switch (unitType) {
    case UnitType.Worker:
      return [BuildingType.TownHall];
    case UnitType.Infantry:
      return [BuildingType.Barracks];
    case UnitType.Ranged:
      return [BuildingType.Barracks, BuildingType.LumberMill];
    case UnitType.Heavy:
      return [BuildingType.Barracks, BuildingType.LumberMill];
  }
}

export function getTrainingBuilding(unitType: UnitType): BuildingType {
  switch (unitType) {
    case UnitType.Worker:
      return BuildingType.TownHall;
    default:
      return BuildingType.Barracks;
  }
}

// ─── Walkability ───

export const WALKABLE_TILES = new Set(['grass', 'dirt', 'forest', 'gold_mine']);
export const BUILDABLE_TILES = new Set(['grass', 'dirt']);
export const RESOURCE_TILES = new Set(['gold_mine', 'forest']);