/** Static, data-driven definitions: factions, unit stats, building stats. */

export enum Faction {
  Humans = 0,
  Orcs = 1,
}

export enum UnitType {
  Worker = 'worker',
  Melee = 'melee',
  Ranged = 'ranged',
  Heavy = 'heavy',
}

export enum BuildingType {
  TownHall = 'townhall',
  Farm = 'farm',
  Barracks = 'barracks',
  LumberMill = 'lumbermill',
  Tower = 'tower',
}

export interface UnitStats {
  hp: number;
  armor: number;
  damage: number;
  range: number; // tiles; melee ~1.1 so diagonal attacks work
  cooldown: number; // seconds between attacks
  speed: number; // tiles per second
  sight: number; // tiles
  goldCost: number;
  woodCost: number;
  supplyCost: number;
  trainTime: number; // seconds
}

export interface BuildingStats {
  hp: number;
  armor: number;
  width: number; // footprint in tiles
  height: number;
  goldCost: number;
  woodCost: number;
  buildTime: number; // seconds
  supplyGranted: number;
  sight: number;
  // Tower combat:
  damage: number;
  range: number;
  cooldown: number;
}

/** Mirrored mechanics: one stats table shared by both factions. */
export const UNIT_STATS: Record<UnitType, UnitStats> = {
  [UnitType.Worker]: {
    hp: 30, armor: 0, damage: 4, range: 1.15, cooldown: 1.4, speed: 2.6,
    sight: 5, goldCost: 300, woodCost: 0, supplyCost: 1, trainTime: 12,
  },
  [UnitType.Melee]: {
    hp: 60, armor: 2, damage: 8, range: 1.15, cooldown: 1.1, speed: 2.6,
    sight: 5, goldCost: 400, woodCost: 0, supplyCost: 1, trainTime: 16,
  },
  [UnitType.Ranged]: {
    hp: 40, armor: 0, damage: 7, range: 4.5, cooldown: 1.4, speed: 2.6,
    sight: 6, goldCost: 350, woodCost: 50, supplyCost: 1, trainTime: 18,
  },
  [UnitType.Heavy]: {
    hp: 110, armor: 4, damage: 14, range: 1.2, cooldown: 1.3, speed: 3.0,
    sight: 5, goldCost: 700, woodCost: 100, supplyCost: 2, trainTime: 26,
  },
};

export const BUILDING_STATS: Record<BuildingType, BuildingStats> = {
  [BuildingType.TownHall]: {
    hp: 1100, armor: 5, width: 3, height: 3, goldCost: 900, woodCost: 600,
    buildTime: 60, supplyGranted: 5, sight: 6, damage: 0, range: 0, cooldown: 0,
  },
  [BuildingType.Farm]: {
    hp: 300, armor: 2, width: 2, height: 2, goldCost: 300, woodCost: 150,
    buildTime: 18, supplyGranted: 4, sight: 3, damage: 0, range: 0, cooldown: 0,
  },
  [BuildingType.Barracks]: {
    hp: 700, armor: 4, width: 3, height: 3, goldCost: 500, woodCost: 300,
    buildTime: 40, supplyGranted: 0, sight: 4, damage: 0, range: 0, cooldown: 0,
  },
  [BuildingType.LumberMill]: {
    hp: 500, armor: 3, width: 2, height: 2, goldCost: 400, woodCost: 250,
    buildTime: 30, supplyGranted: 0, sight: 4, damage: 0, range: 0, cooldown: 0,
  },
  [BuildingType.Tower]: {
    hp: 350, armor: 6, width: 2, height: 2, goldCost: 350, woodCost: 150,
    buildTime: 28, supplyGranted: 0, sight: 8, damage: 9, range: 5.5, cooldown: 1.2,
  },
};

export interface FactionDef {
  name: string;
  color: string;
  colorDark: string;
  unitNames: Record<UnitType, string>;
  buildingNames: Record<BuildingType, string>;
}

export const FACTIONS: Record<Faction, FactionDef> = {
  [Faction.Humans]: {
    name: 'Humans',
    color: '#3c78dc',
    colorDark: '#24489a',
    unitNames: {
      [UnitType.Worker]: 'Peasant',
      [UnitType.Melee]: 'Footman',
      [UnitType.Ranged]: 'Archer',
      [UnitType.Heavy]: 'Knight',
    },
    buildingNames: {
      [BuildingType.TownHall]: 'Town Hall',
      [BuildingType.Farm]: 'Farm',
      [BuildingType.Barracks]: 'Barracks',
      [BuildingType.LumberMill]: 'Lumber Mill',
      [BuildingType.Tower]: 'Guard Tower',
    },
  },
  [Faction.Orcs]: {
    name: 'Orcs',
    color: '#cc3a2a',
    colorDark: '#8a2018',
    unitNames: {
      [UnitType.Worker]: 'Peon',
      [UnitType.Melee]: 'Grunt',
      [UnitType.Ranged]: 'Spearthrower',
      [UnitType.Heavy]: 'Ogre',
    },
    buildingNames: {
      [BuildingType.TownHall]: 'Great Hall',
      [BuildingType.Farm]: 'Pig Farm',
      [BuildingType.Barracks]: 'War Camp',
      [BuildingType.LumberMill]: 'Troll Mill',
      [BuildingType.Tower]: 'Watch Tower',
    },
  },
};

/** Tech requirements: which buildings must exist to train a unit. */
export const UNIT_REQUIREMENTS: Record<UnitType, readonly BuildingType[]> = {
  [UnitType.Worker]: [],
  [UnitType.Melee]: [],
  [UnitType.Ranged]: [BuildingType.LumberMill],
  [UnitType.Heavy]: [BuildingType.Barracks, BuildingType.LumberMill],
};

/** Which building trains which units. */
export const TRAINED_AT: Record<UnitType, BuildingType> = {
  [UnitType.Worker]: BuildingType.TownHall,
  [UnitType.Melee]: BuildingType.Barracks,
  [UnitType.Ranged]: BuildingType.Barracks,
  [UnitType.Heavy]: BuildingType.Barracks,
};

export const HARVEST_AMOUNT = 100; // carried per trip (gold or wood)
export const HARVEST_TIME = 3; // seconds gathering before the return trip
export const CHOP_PER_SECOND = HARVEST_AMOUNT / HARVEST_TIME; // wood drained from a tile
export const REPAIR_HP_PER_SECOND = 15;
export const REPAIR_GOLD_PER_SECOND = 5;
export const UNIT_RADIUS = 0.34; // tiles
export const CORPSE_FADE_TIME = 6; // seconds
export const STARTING_GOLD = 800;
export const STARTING_WOOD = 500;
export const STARTING_WORKERS = 4;
export const TRAIN_QUEUE_MAX = 5;
export const SUPPLY_CAP_MAX = 50;

/** Minimum damage dealt regardless of armor. */
export const MIN_DAMAGE = 1;

export function computeDamage(attackDamage: number, defenderArmor: number): number {
  return Math.max(MIN_DAMAGE, attackDamage - defenderArmor);
}
