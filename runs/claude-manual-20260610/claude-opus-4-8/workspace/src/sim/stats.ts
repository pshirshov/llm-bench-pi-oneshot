/**
 * Single data-driven stats table for every unit and building. Factions are
 * mirrored: stats are shared by role; only display names and colours differ.
 */

export enum Faction {
  Human = "human",
  Orc = "orc",
}

export enum UnitRole {
  Worker = "worker",
  Infantry = "infantry",
  Ranged = "ranged",
  Heavy = "heavy",
}

export enum BuildingRole {
  TownHall = "townhall",
  Farm = "farm",
  Barracks = "barracks",
  LumberMill = "lumbermill",
  GuardTower = "guardtower",
}

export type AttackKind = "melee" | "ranged";

export interface UnitStats {
  readonly role: UnitRole;
  readonly hp: number;
  readonly armor: number;
  readonly damage: number;
  /** Attack range in tiles (centre-to-centre). */
  readonly range: number;
  /** Seconds between attacks. */
  readonly attackCooldown: number;
  /** Movement speed in tiles per second. */
  readonly moveSpeed: number;
  readonly sight: number;
  readonly goldCost: number;
  readonly woodCost: number;
  readonly supplyCost: number;
  readonly trainTime: number;
  readonly attackKind: AttackKind;
  /** Workers can harvest, build and repair. */
  readonly canWork: boolean;
  /** Collision/selection radius in tiles. */
  readonly radius: number;
}

export interface BuildingStats {
  readonly role: BuildingRole;
  readonly hp: number;
  /** Grid footprint in tiles. */
  readonly footprint: { w: number; h: number };
  readonly goldCost: number;
  readonly woodCost: number;
  readonly buildTime: number;
  readonly supplyProvided: number;
  readonly sight: number;
  readonly isGoldDropoff: boolean;
  readonly isWoodDropoff: boolean;
  /** Roles this building can train (empty if none). */
  readonly trains: readonly UnitRole[];
  /** Static defensive attack, if any. */
  readonly attack?: {
    readonly damage: number;
    readonly range: number;
    readonly cooldown: number;
  };
}

export const UNIT_STATS: Record<UnitRole, UnitStats> = {
  [UnitRole.Worker]: {
    role: UnitRole.Worker,
    hp: 40,
    armor: 0,
    damage: 5,
    range: 1.2,
    attackCooldown: 1.2,
    moveSpeed: 2.7,
    sight: 6,
    goldCost: 50,
    woodCost: 0,
    supplyCost: 1,
    trainTime: 12,
    attackKind: "melee",
    canWork: true,
    radius: 0.32,
  },
  [UnitRole.Infantry]: {
    role: UnitRole.Infantry,
    hp: 60,
    armor: 2,
    damage: 8,
    range: 1.2,
    attackCooldown: 1.0,
    moveSpeed: 2.9,
    sight: 7,
    goldCost: 60,
    woodCost: 0,
    supplyCost: 1,
    trainTime: 18,
    attackKind: "melee",
    canWork: false,
    radius: 0.34,
  },
  [UnitRole.Ranged]: {
    role: UnitRole.Ranged,
    hp: 40,
    armor: 0,
    damage: 7,
    range: 5,
    attackCooldown: 1.4,
    moveSpeed: 2.8,
    sight: 8,
    goldCost: 70,
    woodCost: 25,
    supplyCost: 1,
    trainTime: 20,
    attackKind: "ranged",
    canWork: false,
    radius: 0.32,
  },
  [UnitRole.Heavy]: {
    role: UnitRole.Heavy,
    hp: 110,
    armor: 4,
    damage: 14,
    range: 1.2,
    attackCooldown: 1.1,
    moveSpeed: 3.0,
    sight: 7,
    goldCost: 100,
    woodCost: 30,
    supplyCost: 2,
    trainTime: 28,
    attackKind: "melee",
    canWork: false,
    radius: 0.4,
  },
};

export const BUILDING_STATS: Record<BuildingRole, BuildingStats> = {
  [BuildingRole.TownHall]: {
    role: BuildingRole.TownHall,
    hp: 1200,
    footprint: { w: 4, h: 4 },
    goldCost: 385,
    woodCost: 250,
    buildTime: 60,
    supplyProvided: 5,
    sight: 8,
    isGoldDropoff: true,
    isWoodDropoff: true,
    trains: [UnitRole.Worker],
  },
  [BuildingRole.Farm]: {
    role: BuildingRole.Farm,
    hp: 400,
    footprint: { w: 2, h: 2 },
    goldCost: 80,
    woodCost: 20,
    buildTime: 18,
    supplyProvided: 4,
    sight: 4,
    isGoldDropoff: false,
    isWoodDropoff: false,
    trains: [],
  },
  [BuildingRole.Barracks]: {
    role: BuildingRole.Barracks,
    hp: 800,
    footprint: { w: 3, h: 3 },
    goldCost: 150,
    woodCost: 50,
    buildTime: 40,
    supplyProvided: 0,
    sight: 6,
    isGoldDropoff: false,
    isWoodDropoff: false,
    trains: [UnitRole.Infantry, UnitRole.Ranged, UnitRole.Heavy],
  },
  [BuildingRole.LumberMill]: {
    role: BuildingRole.LumberMill,
    hp: 600,
    footprint: { w: 3, h: 3 },
    goldCost: 120,
    woodCost: 20,
    buildTime: 35,
    supplyProvided: 0,
    sight: 6,
    isGoldDropoff: false,
    isWoodDropoff: true,
    trains: [],
  },
  [BuildingRole.GuardTower]: {
    role: BuildingRole.GuardTower,
    hp: 500,
    footprint: { w: 2, h: 2 },
    goldCost: 80,
    woodCost: 60,
    buildTime: 30,
    supplyProvided: 0,
    sight: 8,
    isGoldDropoff: false,
    isWoodDropoff: false,
    trains: [],
    attack: { damage: 12, range: 6, cooldown: 1.0 },
  },
};

/** Tech prerequisites: a role is buildable/trainable only if these building roles already exist (completed). */
export const UNIT_REQUIREMENTS: Record<UnitRole, readonly BuildingRole[]> = {
  [UnitRole.Worker]: [BuildingRole.TownHall],
  [UnitRole.Infantry]: [BuildingRole.Barracks],
  [UnitRole.Ranged]: [BuildingRole.Barracks, BuildingRole.LumberMill],
  [UnitRole.Heavy]: [BuildingRole.Barracks, BuildingRole.LumberMill],
};

export const BUILDING_REQUIREMENTS: Record<BuildingRole, readonly BuildingRole[]> = {
  [BuildingRole.TownHall]: [],
  [BuildingRole.Farm]: [BuildingRole.TownHall],
  [BuildingRole.Barracks]: [BuildingRole.TownHall],
  [BuildingRole.LumberMill]: [BuildingRole.TownHall],
  [BuildingRole.GuardTower]: [BuildingRole.LumberMill],
};

// ---- Harvesting configuration ----
export const HARVEST = {
  goldPerTrip: 10,
  woodPerTrip: 10,
  goldMineTime: 1.8, // seconds to mine one load
  chopTime: 2.6, // seconds to chop one load
  goldMineAmount: 20000, // gold per mine tile
  forestTileWood: 120, // wood per forest tile before it depletes
} as const;

export const REPAIR = {
  /** HP restored per second of repair (also consumes resources proportionally). */
  hpPerSecond: 24,
  /** Fraction of build cost charged to fully repair. */
  costFraction: 0.5,
} as const;

export interface FactionTheme {
  readonly displayName: string;
  readonly primary: string;
  readonly dark: string;
  readonly light: string;
  readonly names: {
    readonly [UnitRole.Worker]: string;
    readonly [UnitRole.Infantry]: string;
    readonly [UnitRole.Ranged]: string;
    readonly [UnitRole.Heavy]: string;
    readonly [BuildingRole.TownHall]: string;
    readonly [BuildingRole.Farm]: string;
    readonly [BuildingRole.Barracks]: string;
    readonly [BuildingRole.LumberMill]: string;
    readonly [BuildingRole.GuardTower]: string;
  };
}

export const THEMES: Record<Faction, FactionTheme> = {
  [Faction.Human]: {
    displayName: "Humans",
    primary: "#4a78d0",
    dark: "#2b4a86",
    light: "#bcd0f5",
    names: {
      [UnitRole.Worker]: "Peasant",
      [UnitRole.Infantry]: "Footman",
      [UnitRole.Ranged]: "Archer",
      [UnitRole.Heavy]: "Knight",
      [BuildingRole.TownHall]: "Town Hall",
      [BuildingRole.Farm]: "Farm",
      [BuildingRole.Barracks]: "Barracks",
      [BuildingRole.LumberMill]: "Lumber Mill",
      [BuildingRole.GuardTower]: "Guard Tower",
    },
  },
  [Faction.Orc]: {
    displayName: "Orcs",
    primary: "#c0392b",
    dark: "#7d2018",
    light: "#f0c0b0",
    names: {
      [UnitRole.Worker]: "Peon",
      [UnitRole.Infantry]: "Grunt",
      [UnitRole.Ranged]: "Spearthrower",
      [UnitRole.Heavy]: "Ogre",
      [BuildingRole.TownHall]: "Great Hall",
      [BuildingRole.Farm]: "Pig Farm",
      [BuildingRole.Barracks]: "War Mill",
      [BuildingRole.LumberMill]: "Lumber Camp",
      [BuildingRole.GuardTower]: "Watch Tower",
    },
  },
};

export function enemyOf(f: Faction): Faction {
  return f === Faction.Human ? Faction.Orc : Faction.Human;
}

export function unitName(faction: Faction, role: UnitRole): string {
  return THEMES[faction].names[role];
}

export function buildingName(faction: Faction, role: BuildingRole): string {
  return THEMES[faction].names[role];
}
