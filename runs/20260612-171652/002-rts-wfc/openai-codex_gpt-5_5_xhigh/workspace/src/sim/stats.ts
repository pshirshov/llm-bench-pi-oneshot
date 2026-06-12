import { TICK_RATE } from './constants';
import type { BuildingKind, Faction, ResourceKind, UnitKind } from './types';

export interface Cost {
  gold: number;
  wood: number;
}

export interface UnitStats {
  label: string;
  hp: number;
  armor: number;
  damage: number;
  range: number;
  cooldownTicks: number;
  moveSpeed: number;
  sight: number;
  cost: Cost;
  supply: number;
  trainingTicks: number;
  requires: BuildingKind[];
}

export interface BuildingStats {
  label: string;
  hp: number;
  armor: number;
  damage: number;
  range: number;
  cooldownTicks: number;
  sight: number;
  cost: Cost;
  buildTicks: number;
  footprint: { w: number; h: number };
  supplyProvided: number;
  trains: UnitKind[];
  dropoff: ResourceKind[];
  requires: BuildingKind[];
}

export interface FactionTheme {
  label: string;
  primary: string;
  secondary: string;
  dark: string;
  unitNames: Record<UnitKind, string>;
  buildingNames: Record<BuildingKind, string>;
}

const seconds = (value: number): number => value * TICK_RATE;

const mirroredUnits: Record<UnitKind, Omit<UnitStats, 'label'>> = {
  worker: {
    hp: 40,
    armor: 0,
    damage: 4,
    range: 1,
    cooldownTicks: seconds(1.2),
    moveSpeed: 1.5,
    sight: 4,
    cost: { gold: 50, wood: 0 },
    supply: 1,
    trainingTicks: seconds(8),
    requires: []
  },
  melee: {
    hp: 65,
    armor: 1,
    damage: 8,
    range: 1,
    cooldownTicks: seconds(1.1),
    moveSpeed: 1.45,
    sight: 5,
    cost: { gold: 80, wood: 0 },
    supply: 1,
    trainingTicks: seconds(15),
    requires: ['barracks']
  },
  ranged: {
    hp: 50,
    armor: 0,
    damage: 6,
    range: 4.5,
    cooldownTicks: seconds(1.3),
    moveSpeed: 1.5,
    sight: 6,
    cost: { gold: 60, wood: 30 },
    supply: 1,
    trainingTicks: seconds(18),
    requires: ['barracks', 'lumberMill']
  },
  heavy: {
    hp: 95,
    armor: 2,
    damage: 11,
    range: 1,
    cooldownTicks: seconds(1.25),
    moveSpeed: 1.35,
    sight: 5,
    cost: { gold: 140, wood: 60 },
    supply: 2,
    trainingTicks: seconds(25),
    requires: ['barracks', 'lumberMill']
  }
};

export const FACTIONS: Record<Faction, FactionTheme> = {
  humans: {
    label: 'Humans',
    primary: '#2f7dd1',
    secondary: '#f2d46b',
    dark: '#163c70',
    unitNames: { worker: 'Peasant', melee: 'Footman', ranged: 'Archer', heavy: 'Knight' },
    buildingNames: { townHall: 'Town Hall', farm: 'Farm', barracks: 'Barracks', lumberMill: 'Lumber Mill', guardTower: 'Guard Tower' }
  },
  orcs: {
    label: 'Orcs',
    primary: '#3f9b45',
    secondary: '#b35b2d',
    dark: '#1e5121',
    unitNames: { worker: 'Peon', melee: 'Grunt', ranged: 'Spearthrower', heavy: 'Ogre' },
    buildingNames: { townHall: 'Great Hall', farm: 'Pig Farm', barracks: 'War Hut', lumberMill: 'War Mill', guardTower: 'Watch Tower' }
  }
};

export const UNIT_STATS: Record<Faction, Record<UnitKind, UnitStats>> = {
  humans: createUnitStats('humans'),
  orcs: createUnitStats('orcs')
};

export const BUILDING_STATS: Record<BuildingKind, BuildingStats> = {
  townHall: {
    label: 'Town Hall', hp: 520, armor: 2, damage: 0, range: 0, cooldownTicks: seconds(1), sight: 7,
    cost: { gold: 350, wood: 180 }, buildTicks: seconds(45), footprint: { w: 3, h: 3 }, supplyProvided: 6,
    trains: ['worker'], dropoff: ['gold', 'wood'], requires: []
  },
  farm: {
    label: 'Farm', hp: 180, armor: 1, damage: 0, range: 0, cooldownTicks: seconds(1), sight: 4,
    cost: { gold: 60, wood: 40 }, buildTicks: seconds(20), footprint: { w: 2, h: 2 }, supplyProvided: 4,
    trains: [], dropoff: [], requires: []
  },
  barracks: {
    label: 'Barracks', hp: 340, armor: 2, damage: 0, range: 0, cooldownTicks: seconds(1), sight: 6,
    cost: { gold: 180, wood: 120 }, buildTicks: seconds(35), footprint: { w: 3, h: 3 }, supplyProvided: 0,
    trains: ['melee', 'ranged', 'heavy'], dropoff: [], requires: []
  },
  lumberMill: {
    label: 'Lumber Mill', hp: 260, armor: 1, damage: 0, range: 0, cooldownTicks: seconds(1), sight: 6,
    cost: { gold: 120, wood: 140 }, buildTicks: seconds(30), footprint: { w: 2, h: 2 }, supplyProvided: 0,
    trains: [], dropoff: ['wood'], requires: []
  },
  guardTower: {
    label: 'Guard Tower', hp: 220, armor: 2, damage: 9, range: 6, cooldownTicks: seconds(1.1), sight: 7,
    cost: { gold: 100, wood: 120 }, buildTicks: seconds(28), footprint: { w: 2, h: 2 }, supplyProvided: 0,
    trains: [], dropoff: [], requires: ['barracks']
  }
};

export const BALANCE = {
  startingWorkers: 4,
  startingGold: 520,
  startingWood: 320,
  aiStartingBonusGoldPerDifficulty: 120,
  aiStartingBonusWoodPerDifficulty: 90,
  workerCarry: 10,
  goldGatherTicks: seconds(3),
  woodGatherTicks: seconds(2),
  forestWood: 50,
  mineGold: 700,
  repairHpPerTick: 0.45,
  repairWoodPerHp: 0.03,
  maxQueue: 6
} as const;

function createUnitStats(faction: Faction): Record<UnitKind, UnitStats> {
  const names = FACTIONS[faction].unitNames;
  return {
    worker: { label: names.worker, ...mirroredUnits.worker },
    melee: { label: names.melee, ...mirroredUnits.melee },
    ranged: { label: names.ranged, ...mirroredUnits.ranged },
    heavy: { label: names.heavy, ...mirroredUnits.heavy }
  };
}

export function unitStats(faction: Faction, kind: UnitKind): UnitStats {
  return UNIT_STATS[faction][kind];
}

export function buildingStats(kind: BuildingKind): BuildingStats {
  return BUILDING_STATS[kind];
}

export function costTotal(cost: Cost): number {
  return cost.gold + cost.wood;
}
