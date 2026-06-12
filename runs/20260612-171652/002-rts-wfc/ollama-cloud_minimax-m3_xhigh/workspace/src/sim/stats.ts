// Stats table — single source of truth for combat, economy, and time costs.
// All game logic reads from this; no combat/economy magic numbers anywhere else.

export type Faction = "humans" | "orcs";
export type UnitKind = "worker" | "melee" | "ranged" | "heavy";
export type BuildingKind = "townhall" | "farm" | "barracks" | "lumbermill" | "guardtower";

export interface UnitStats {
  readonly kind: UnitKind;
  readonly hp: number;
  readonly armor: number;
  readonly damage: number;
  /** Attack range in tile units. 1 = adjacent. */
  readonly attackRange: number;
  /** Attack cooldown in sim-seconds. */
  readonly attackCooldown: number;
  /** Move speed in tiles per sim-second. */
  readonly moveSpeed: number;
  /** Sight radius in tiles (Chebyshev). */
  readonly sightRadius: number;
  /** Build/harvest speed multiplier. */
  readonly workSpeed: number;
  readonly goldCost: number;
  readonly woodCost: number;
  readonly supplyCost: number;
  /** Training time in sim-seconds. */
  readonly trainTime: number;
  readonly attackProjectile?: boolean;
}

export interface BuildingStats {
  readonly kind: BuildingKind;
  readonly hp: number;
  readonly footprint: { w: number; h: number };
  /** Gold cost. */
  readonly goldCost: number;
  /** Wood cost. */
  readonly woodCost: number;
  /** Build time in sim-seconds. */
  readonly buildTime: number;
  /** Supply capacity granted. */
  readonly supply?: number;
  /** Footprint walkable after construction completes (always false). */
  readonly walkable: false;
  /** Sight radius in tiles. */
  readonly sightRadius: number;
  /** Range if a defensive tower. */
  readonly attackRange?: number;
  readonly attackDamage?: number;
  readonly attackCooldown?: number;
}

export interface FactionData {
  readonly id: Faction;
  readonly displayName: string;
  readonly color: string;
  readonly accent: string;
  readonly names: {
    readonly worker: string;
    readonly melee: string;
    readonly ranged: string;
    readonly heavy: string;
    readonly townhall: string;
    readonly farm: string;
    readonly barracks: string;
    readonly lumbermill: string;
    readonly guardtower: string;
  };
  readonly units: Record<UnitKind, UnitStats>;
  readonly buildings: Record<BuildingKind, BuildingStats>;
}

export interface HarvestStats {
  /** Gold carried per trip. */
  readonly goldPerTrip: number;
  /** Wood carried per trip. */
  readonly woodPerTrip: number;
  /** Time spent gathering from a gold mine per load. */
  readonly goldGatherTime: number;
  /** Time spent chopping per load. */
  readonly woodChopTime: number;
  /** Initial gold in a fresh mine. */
  readonly mineGold: number;
  /** Initial wood in a fresh forest tile. */
  readonly forestWood: number;
  /** Repair HP per sim-second. */
  readonly repairRate: number;
  /** Gold cost per sim-second of repair. */
  readonly repairGoldPerSec: number;
}

export interface SimConstants {
  /** Simulation tick rate (Hz). All sim-time figures derive from this. */
  readonly tickRate: number;
  /** Map sizes for the 5 campaign levels. */
  readonly mapSizes: readonly [number, number, number, number, number];
  /** AI difficulty for each level. */
  readonly levelDifficulty: readonly [number, number, number, number, number];
  /** Starting workers per side. */
  readonly startingWorkers: number;
  /** Initial resources given to each side. */
  readonly startGold: number;
  readonly startWood: number;
  /** Wood returns to neutral (chopped forest regrows) after this many sim-seconds; 0 = no regrowth. */
  readonly forestRegrowSeconds: number;
  /** Gold mines do not regrow. */
  /** Sight reveal range for fog of war. */
  readonly baseSight: number;
  /** Fog black-out at distance. */
  /** Width/height of the tile in pixels for rendering. */
  readonly tilePixelSize: number;
  /** Maximum pathfinding steps per A* call (prevents runaway search). */
  readonly maxPathfindSteps: number;
  /** Speed-up factors. */
  readonly speeds: readonly [number, number];
  /** The maximum number of full-tile radii a single repath will traverse per unit before giving up C4 fallback. */
  readonly maxRepathAttempts: number;
  /** Number of order-progress ticks before a unit with an active order is forced to transition to idle. */
  readonly progressWatchdogTicks: number;
}

export const SIM_CONSTANTS: SimConstants = {
  tickRate: 30,
  mapSizes: [32, 48, 64, 80, 96],
  levelDifficulty: [1, 2, 3, 4, 5],
  startingWorkers: 4,
  startGold: 500,
  startWood: 200,
  forestRegrowSeconds: 0,
  baseSight: 8,
  tilePixelSize: 32,
  maxPathfindSteps: 4000,
  speeds: [1, 2],
  maxRepathAttempts: 8,
  progressWatchdogTicks: 600,
};

export const HARVEST: HarvestStats = {
  goldPerTrip: 100,
  woodPerTrip: 80,
  goldGatherTime: 4.0,
  woodChopTime: 2.5,
  mineGold: 2500,
  forestWood: 400,
  repairRate: 20,
  repairGoldPerSec: 2,
};

const humanUnits: Record<UnitKind, UnitStats> = {
  worker: {
    kind: "worker",
    hp: 30,
    armor: 0,
    damage: 4,
    attackRange: 1,
    attackCooldown: 1.2,
    moveSpeed: 1.2,
    sightRadius: 5,
    workSpeed: 1,
    goldCost: 50,
    woodCost: 0,
    supplyCost: 1,
    trainTime: 6,
  },
  melee: {
    kind: "melee",
    hp: 60,
    armor: 2,
    damage: 9,
    attackRange: 1,
    attackCooldown: 1.0,
    moveSpeed: 1.2,
    sightRadius: 5,
    workSpeed: 0,
    goldCost: 80,
    woodCost: 0,
    supplyCost: 1,
    trainTime: 9,
  },
  ranged: {
    kind: "ranged",
    hp: 40,
    armor: 0,
    damage: 7,
    attackRange: 5,
    attackCooldown: 1.2,
    moveSpeed: 1.1,
    sightRadius: 6,
    workSpeed: 0,
    goldCost: 70,
    woodCost: 30,
    supplyCost: 2,
    trainTime: 10,
    attackProjectile: true,
  },
  heavy: {
    kind: "heavy",
    hp: 130,
    armor: 4,
    damage: 16,
    attackRange: 1,
    attackCooldown: 1.3,
    moveSpeed: 0.9,
    sightRadius: 6,
    workSpeed: 0,
    goldCost: 130,
    woodCost: 50,
    supplyCost: 3,
    trainTime: 16,
  },
};

const orcUnits: Record<UnitKind, UnitStats> = {
  worker: {
    kind: "worker",
    hp: 30,
    armor: 0,
    damage: 4,
    attackRange: 1,
    attackCooldown: 1.2,
    moveSpeed: 1.2,
    sightRadius: 5,
    workSpeed: 1,
    goldCost: 50,
    woodCost: 0,
    supplyCost: 1,
    trainTime: 6,
  },
  melee: {
    kind: "melee",
    hp: 60,
    armor: 2,
    damage: 9,
    attackRange: 1,
    attackCooldown: 1.0,
    moveSpeed: 1.2,
    sightRadius: 5,
    workSpeed: 0,
    goldCost: 80,
    woodCost: 0,
    supplyCost: 1,
    trainTime: 9,
  },
  ranged: {
    kind: "ranged",
    hp: 40,
    armor: 0,
    damage: 7,
    attackRange: 5,
    attackCooldown: 1.2,
    moveSpeed: 1.1,
    sightRadius: 6,
    workSpeed: 0,
    goldCost: 70,
    woodCost: 30,
    supplyCost: 2,
    trainTime: 10,
    attackProjectile: true,
  },
  heavy: {
    kind: "heavy",
    hp: 130,
    armor: 4,
    damage: 16,
    attackRange: 1,
    attackCooldown: 1.3,
    moveSpeed: 0.9,
    sightRadius: 6,
    workSpeed: 0,
    goldCost: 130,
    woodCost: 50,
    supplyCost: 3,
    trainTime: 16,
  },
};

function buildingsFor(): Record<BuildingKind, BuildingStats> {
  return {
    townhall: {
      kind: "townhall",
      hp: 1200,
      footprint: { w: 3, h: 3 },
      goldCost: 400,
      woodCost: 200,
      buildTime: 0, // already built at start
      supply: 6,
      walkable: false,
      sightRadius: 9,
    },
    farm: {
      kind: "farm",
      hp: 400,
      footprint: { w: 2, h: 2 },
      goldCost: 80,
      woodCost: 30,
      buildTime: 12,
      supply: 4,
      walkable: false,
      sightRadius: 5,
    },
    barracks: {
      kind: "barracks",
      hp: 800,
      footprint: { w: 3, h: 3 },
      goldCost: 150,
      woodCost: 50,
      buildTime: 18,
      walkable: false,
      sightRadius: 6,
    },
    lumbermill: {
      kind: "lumbermill",
      hp: 600,
      footprint: { w: 2, h: 2 },
      goldCost: 100,
      woodCost: 0,
      buildTime: 12,
      walkable: false,
      sightRadius: 5,
    },
    guardtower: {
      kind: "guardtower",
      hp: 500,
      footprint: { w: 1, h: 1 },
      goldCost: 100,
      woodCost: 50,
      buildTime: 14,
      walkable: false,
      sightRadius: 8,
      attackRange: 6,
      attackDamage: 12,
      attackCooldown: 1.1,
    },
  };
}

export const FACTIONS: Record<Faction, FactionData> = {
  humans: {
    id: "humans",
    displayName: "Humans",
    color: "#3a6dbf",
    accent: "#d8c478",
    names: {
      worker: "Peasant",
      melee: "Footman",
      ranged: "Archer",
      heavy: "Knight",
      townhall: "Town Hall",
      farm: "Farm",
      barracks: "Barracks",
      lumbermill: "Lumber Mill",
      guardtower: "Guard Tower",
    },
    units: humanUnits,
    buildings: buildingsFor(),
  },
  orcs: {
    id: "orcs",
    displayName: "Orcs",
    color: "#8a2a2a",
    accent: "#3b3b3b",
    names: {
      worker: "Peon",
      melee: "Grunt",
      ranged: "Spearthrower",
      heavy: "Ogre",
      townhall: "Stronghold",
      farm: "Mushroom Farm",
      barracks: "Barracks",
      lumbermill: "Lumber Mill",
      guardtower: "Watch Tower",
    },
    units: orcUnits,
    buildings: buildingsFor(),
  },
};

export const TILE_SIZE = SIM_CONSTANTS.tilePixelSize;
export const TICK_RATE = SIM_CONSTANTS.tickRate;
export const TICK_DT = 1 / SIM_CONSTANTS.tickRate;

export function getUnitStats(faction: Faction, kind: UnitKind): UnitStats {
  const stats = FACTIONS[faction].units[kind];
  if (!stats) {
    throw new Error(`Missing unit stats for ${faction}/${kind}`);
  }
  return stats;
}

export function getBuildingStats(faction: Faction, kind: BuildingKind): BuildingStats {
  const stats = FACTIONS[faction].buildings[kind];
  if (!stats) {
    throw new Error(`Missing building stats for ${faction}/${kind}`);
  }
  return stats;
}
