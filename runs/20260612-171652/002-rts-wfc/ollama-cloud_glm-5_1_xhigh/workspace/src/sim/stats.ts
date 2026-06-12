/** Data-driven stats table. Every combat/economy number lives here. */

import { TICK_RATE } from "./constants";
import type { FactionUnitStats, FactionBuildingStats, HarvestStats } from "./types";

export const UNIT_STATS: FactionUnitStats = {
  worker: {
    hp: 40,
    attack: 5,
    attackRange: 1,
    armor: 0,
    moveSpeed: 2.0,
    sight: 5,
    goldCost: 60,
    woodCost: 0,
    supplyCost: 1,
    trainTime: 15 * TICK_RATE,
    attackCooldown: 1 * TICK_RATE,
  },
  melee: {
    hp: 90,
    attack: 8,
    attackRange: 1,
    armor: 2,
    moveSpeed: 2.2,
    sight: 5,
    goldCost: 130,
    woodCost: 0,
    supplyCost: 1,
    trainTime: 25 * TICK_RATE,
    attackCooldown: 1 * TICK_RATE,
  },
  ranged: {
    hp: 60,
    attack: 6,
    attackRange: 5,
    armor: 0,
    moveSpeed: 2.0,
    sight: 7,
    goldCost: 90,
    woodCost: 60,
    supplyCost: 1,
    trainTime: 30 * TICK_RATE,
    attackCooldown: 1.5 * TICK_RATE,
  },
  heavy: {
    hp: 150,
    attack: 12,
    attackRange: 1,
    armor: 4,
    moveSpeed: 2.4,
    sight: 5,
    goldCost: 250,
    woodCost: 125,
    supplyCost: 2,
    trainTime: 45 * TICK_RATE,
    attackCooldown: 1.2 * TICK_RATE,
  },
};

export const BUILDING_STATS: FactionBuildingStats = {
  town_hall: {
    hp: 800,
    goldCost: 0,
    woodCost: 0,
    buildTime: 0,
    width: 3,
    height: 3,
    supplyProvided: 10,
    attack: 0,
    attackRange: 0,
    sight: 6,
    attackCooldown: 0,
  },
  farm: {
    hp: 200,
    goldCost: 80,
    woodCost: 50,
    buildTime: 20 * TICK_RATE,
    width: 2,
    height: 2,
    supplyProvided: 8,
    attack: 0,
    attackRange: 0,
    sight: 0,
    attackCooldown: 0,
  },
  barracks: {
    hp: 400,
    goldCost: 150,
    woodCost: 60,
    buildTime: 30 * TICK_RATE,
    width: 3,
    height: 3,
    supplyProvided: 0,
    attack: 0,
    attackRange: 0,
    sight: 0,
    attackCooldown: 0,
  },
  lumber_mill: {
    hp: 400,
    goldCost: 120,
    woodCost: 80,
    buildTime: 25 * TICK_RATE,
    width: 3,
    height: 2,
    supplyProvided: 0,
    attack: 0,
    attackRange: 0,
    sight: 0,
    attackCooldown: 0,
  },
  guard_tower: {
    hp: 300,
    goldCost: 100,
    woodCost: 50,
    buildTime: 20 * TICK_RATE,
    width: 2,
    height: 2,
    supplyProvided: 0,
    attack: 10,
    attackRange: 6,
    sight: 7,
    attackCooldown: 1.5 * TICK_RATE,
  },
};

export const HARVEST_STATS: HarvestStats = {
  goldPerTrip: 10,
  woodPerTrip: 10,
  harvestDuration: 3 * TICK_RATE,
  goldMineCapacity: 2500,
  forestTileCapacity: 200,
};

export const STARTING_WORKERS = 4;
export const REPAIR_RATE = 5;
export const REPAIR_GOLD_PER_HP = 0.5;
export const REPAIR_WOOD_PER_HP = 0.25;

export const FACTION_NAMES: Record<string, string> = {
  human: "Humans",
  orc: "Orcs",
};

export const UNIT_NAMES: Record<string, Record<string, string>> = {
  human: { worker: "Peasant", melee: "Footman", ranged: "Archer", heavy: "Knight" },
  orc: { worker: "Peon", melee: "Grunt", ranged: "Spearthrower", heavy: "Ogre" },
};

export const BUILDING_NAMES: Record<string, Record<string, string>> = {
  human: {
    town_hall: "Town Hall",
    farm: "Farm",
    barracks: "Barracks",
    lumber_mill: "Lumber Mill",
    guard_tower: "Guard Tower",
  },
  orc: {
    town_hall: "Great Hall",
    farm: "Pig Farm",
    barracks: "Barracks",
    lumber_mill: "Troll Lumber Mill",
    guard_tower: "Watch Tower",
  },
};

export const FACTION_COLORS: Record<string, string> = {
  human: "#4488ff",
  orc: "#cc4422",
};

export const STARTING_GOLD = 500;
export const STARTING_WOOD = 300;

export function getUnitStats(faction: string, unitType: string) {
  return UNIT_STATS[unitType as keyof FactionUnitStats];
}

export function getBuildingStats(buildingType: string) {
  return BUILDING_STATS[buildingType as keyof FactionBuildingStats];
}