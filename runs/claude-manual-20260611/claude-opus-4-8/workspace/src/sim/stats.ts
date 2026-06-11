/**
 * Data-driven stats tables for all units and buildings in both factions.
 *
 * Mirroring rule: numeric stats per role are IDENTICAL across factions.
 * Only `name` (and later color / sprite) differs between Human and Orc.
 *
 * Prerequisites: encoded as typed records mapping (faction, unitKind) →
 * required buildings. An empty array means no prerequisite beyond the
 * Barracks being present (workers need no Barracks at all — they are
 * trained from the Town Hall).
 */

import type { BuildingKind, Faction, UnitKind } from "../game/types.js";

// ---------------------------------------------------------------------------
// Stat shapes
// ---------------------------------------------------------------------------

export interface UnitStats {
  readonly name: string;
  /** Maximum hit points. */
  readonly hp: number;
  /** Damage reduction per hit. Damage dealt = max(1, attacker.damage - armor). */
  readonly armor: number;
  /** Base attack damage before armor is applied. */
  readonly damage: number;
  /** Attack range in tiles (1 = melee). */
  readonly range: number;
  /** Minimum ticks between attacks (at 20 ticks/s). */
  readonly attackCooldown: number;
  /** Movement speed in tiles per second. */
  readonly moveSpeed: number;
  /** Sight radius in tiles. */
  readonly sight: number;
  /** Gold cost to train. */
  readonly goldCost: number;
  /** Wood cost to train. */
  readonly woodCost: number;
  /** Supply consumed when trained. */
  readonly supplyCost: number;
  /** Training time in ticks (at 20 ticks/s). */
  readonly trainTime: number;
}

export interface BuildingStats {
  readonly name: string;
  /** Maximum hit points. */
  readonly hp: number;
  /** Gold cost to construct. */
  readonly goldCost: number;
  /** Wood cost to construct. */
  readonly woodCost: number;
  /** Construction time in ticks (at 20 ticks/s). */
  readonly buildTime: number;
  /** Tile footprint: width × height in tiles. */
  readonly footprint: { readonly w: number; readonly h: number };
  /** Supply capacity granted by this building (0 if none). */
  readonly supplyProvided: number;
  /** Sight radius in tiles (fog-of-war visibility from this building). */
  readonly sight: number;
}

// ---------------------------------------------------------------------------
// Lookup key helpers
// ---------------------------------------------------------------------------

export type UnitKey = `${Faction}:${UnitKind}`;
export type BuildingKey = `${Faction}:${BuildingKind}`;

function unitKey(faction: Faction, kind: UnitKind): UnitKey {
  return `${faction}:${kind}`;
}

function buildingKey(faction: Faction, kind: BuildingKind): BuildingKey {
  return `${faction}:${kind}`;
}

// ---------------------------------------------------------------------------
// Numeric stat baselines (shared between factions; only name differs)
// ---------------------------------------------------------------------------

type NumericUnitStats = Omit<UnitStats, "name">;
type NumericBuildingStats = Omit<BuildingStats, "name">;

const UNIT_NUMERIC: Record<UnitKind, NumericUnitStats> = {
  worker: {
    hp: 40,
    armor: 0,
    damage: 5,
    range: 1,
    attackCooldown: 30, // 1.5 s at 20 ticks/s
    moveSpeed: 3.0,
    sight: 4,
    goldCost: 75,
    woodCost: 0,
    supplyCost: 1,
    trainTime: 40, // 2 s
  },
  infantry: {
    hp: 60,
    armor: 2,
    damage: 10,
    range: 1,
    attackCooldown: 20, // 1 s
    moveSpeed: 3.5,
    sight: 5,
    goldCost: 100,
    woodCost: 0,
    supplyCost: 1,
    trainTime: 60, // 3 s
  },
  ranged: {
    hp: 40,
    armor: 0,
    damage: 9,
    range: 5,
    attackCooldown: 25, // 1.25 s
    moveSpeed: 3.0,
    sight: 6,
    goldCost: 100,
    woodCost: 50,
    supplyCost: 1,
    trainTime: 70, // 3.5 s
  },
  heavy: {
    hp: 120,
    armor: 4,
    damage: 18,
    range: 1,
    attackCooldown: 40, // 2 s
    moveSpeed: 2.5,
    sight: 5,
    goldCost: 200,
    woodCost: 100,
    supplyCost: 2,
    trainTime: 120, // 6 s
  },
};

const BUILDING_NUMERIC: Record<BuildingKind, NumericBuildingStats> = {
  townHall: {
    hp: 900,
    goldCost: 0,
    woodCost: 0,
    buildTime: 0,
    footprint: { w: 4, h: 4 },
    supplyProvided: 5,
    sight: 6,
  },
  farm: {
    hp: 250,
    goldCost: 0,
    woodCost: 250,
    buildTime: 100, // 5 s
    footprint: { w: 2, h: 2 },
    supplyProvided: 4,
    sight: 3,
  },
  barracks: {
    hp: 600,
    goldCost: 700,
    woodCost: 450,
    buildTime: 200, // 10 s
    footprint: { w: 3, h: 3 },
    supplyProvided: 0,
    sight: 4,
  },
  lumberMill: {
    hp: 500,
    goldCost: 500,
    woodCost: 450,
    buildTime: 150, // 7.5 s
    footprint: { w: 3, h: 3 },
    supplyProvided: 0,
    sight: 4,
  },
  guardTower: {
    hp: 400,
    goldCost: 550,
    woodCost: 200,
    buildTime: 120, // 6 s
    footprint: { w: 2, h: 2 },
    supplyProvided: 0,
    sight: 7,
  },
};

// ---------------------------------------------------------------------------
// Faction-specific unit names (mirrored numerically, distinct by name)
// ---------------------------------------------------------------------------

const UNIT_NAMES: Record<Faction, Record<UnitKind, string>> = {
  human: {
    worker: "Peasant",
    infantry: "Footman",
    ranged: "Archer",
    heavy: "Knight",
  },
  orc: {
    worker: "Peon",
    infantry: "Grunt",
    ranged: "Spearthrower",
    heavy: "Ogre",
  },
};

const BUILDING_NAMES: Record<Faction, Record<BuildingKind, string>> = {
  human: {
    townHall: "Town Hall",
    farm: "Farm",
    barracks: "Barracks",
    lumberMill: "Lumber Mill",
    guardTower: "Guard Tower",
  },
  orc: {
    townHall: "Great Hall",
    farm: "Pig Farm",
    barracks: "Barracks",
    lumberMill: "Lumber Mill",
    guardTower: "Watch Tower",
  },
};

// ---------------------------------------------------------------------------
// Build the lookup tables
// ---------------------------------------------------------------------------

function buildUnitStats(): Record<UnitKey, UnitStats> {
  const factions: Faction[] = ["human", "orc"];
  const kinds: UnitKind[] = ["worker", "infantry", "ranged", "heavy"];
  const result = {} as Record<UnitKey, UnitStats>;
  for (const faction of factions) {
    for (const kind of kinds) {
      result[unitKey(faction, kind)] = {
        ...UNIT_NUMERIC[kind],
        name: UNIT_NAMES[faction][kind],
      };
    }
  }
  return result;
}

function buildBuildingStats(): Record<BuildingKey, BuildingStats> {
  const factions: Faction[] = ["human", "orc"];
  const kinds: BuildingKind[] = [
    "townHall",
    "farm",
    "barracks",
    "lumberMill",
    "guardTower",
  ];
  const result = {} as Record<BuildingKey, BuildingStats>;
  for (const faction of factions) {
    for (const kind of kinds) {
      result[buildingKey(faction, kind)] = {
        ...BUILDING_NUMERIC[kind],
        name: BUILDING_NAMES[faction][kind],
      };
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Exported stat tables
// ---------------------------------------------------------------------------

export const UNIT_STATS: Record<UnitKey, UnitStats> = buildUnitStats();
export const BUILDING_STATS: Record<BuildingKey, BuildingStats> =
  buildBuildingStats();

// ---------------------------------------------------------------------------
// Prerequisite tables
// ---------------------------------------------------------------------------

/**
 * Buildings that must be present (constructed, not destroyed) before a unit
 * of the given kind can be trained.  Worker requires no building prerequisite.
 * Infantry requires Barracks.  Ranged requires Barracks + LumberMill.
 * Heavy requires Barracks + LumberMill.
 */
export const UNIT_REQUIREMENTS: Record<UnitKind, readonly BuildingKind[]> = {
  worker: [],
  infantry: ["barracks"],
  ranged: ["barracks", "lumberMill"],
  heavy: ["barracks", "lumberMill"],
};

/**
 * Buildings that must be present before a given building can be constructed.
 * Town Hall and Farm have no prerequisites (always buildable).
 * Barracks requires Town Hall.
 * Lumber Mill requires Barracks.
 * Guard Tower requires Barracks.
 */
export const BUILDING_REQUIREMENTS: Record<
  BuildingKind,
  readonly BuildingKind[]
> = {
  townHall: [],
  farm: [],
  barracks: ["townHall"],
  lumberMill: ["barracks"],
  guardTower: ["barracks"],
};

// ---------------------------------------------------------------------------
// Convenience accessor (avoids construction of key string at call sites)
// ---------------------------------------------------------------------------

export function getUnitStats(faction: Faction, kind: UnitKind): UnitStats {
  return UNIT_STATS[unitKey(faction, kind)];
}

export function getBuildingStats(
  faction: Faction,
  kind: BuildingKind,
): BuildingStats {
  return BUILDING_STATS[buildingKey(faction, kind)];
}
