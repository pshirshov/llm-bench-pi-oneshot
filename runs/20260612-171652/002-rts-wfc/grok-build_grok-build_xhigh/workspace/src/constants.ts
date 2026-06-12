/**
 * All game constants and stats tables.
 * Every numeric value referenced in gameplay lives here.
 * Tick-based simulation: SIM_TICKS_PER_SECOND is the fixed timestep rate.
 */

export const SIM_TICKS_PER_SECOND = 60;
export const SIM_TICK_DELTA = 1 / SIM_TICKS_PER_SECOND; // seconds per sim tick

// Map sizes for campaign levels (width x height in tiles)
export const LEVEL_SIZES: readonly [number, number][] = [
  [32, 32], // level 0 (easy)
  [48, 48],
  [64, 64],
  [80, 80],
  [96, 96], // level 4 (hard)
];

// Resource constants
export const STARTING_WORKERS = 4;
export const GOLD_PER_TRIP = 10;
export const WOOD_PER_TRIP = 5;
export const GOLD_MINE_CAPACITY = 1500;
export const FOREST_TILE_YIELD = 200; // total wood before depletion

// Harvest durations in ticks
export const HARVEST_GOLD_TICKS = Math.floor(1.2 * SIM_TICKS_PER_SECOND);
export const HARVEST_WOOD_TICKS = Math.floor(1.8 * SIM_TICKS_PER_SECOND);
export const BUILD_WORKER_TICKS = Math.floor(1.5 * SIM_TICKS_PER_SECOND); // time per 'repair/build progress' tick? Wait, use per-unit costs.

// Movement
export const TILE_SIZE = 1.0; // logical units
export const UNIT_RADIUS = 0.35; // for collision, centers must stay >= 0.5 + epsilon apart? 1.0 tile separation for centers? Spec: 0.5 tile-widths = 0.5
export const MIN_UNIT_SEPARATION = 0.5; // tile units; centers >= this distance

// Pathing
export const PATHFIND_MAX_NODES = 4096;
export const REPATh_ATTEMPT_LIMIT = 8; // for C4/C5

// Sight / ranges in tiles
export const DEFAULT_SIGHT_RADIUS = 8;

// AI
export const AI_FIRST_WAVE_TICKS = 4 * 60 * SIM_TICKS_PER_SECOND; // ~4 min at diff 1
export const AI_WAVE_INTERVAL_BASE = 90 * SIM_TICKS_PER_SECOND;

// Stats table — single source of truth. All values in-game units.

// Factions: 0=Human, 1=Orc
export type Faction = 0 | 1;
export const FACTIONS: readonly Faction[] = [0, 1];
export const FACTION_NAMES: readonly string[] = ['Humans', 'Orcs'];
export const FACTION_COLORS: readonly string[] = ['#4a90d9', '#c45c2e'];

// Building types (mirrored)
export type BuildingType =
  | 'townHall'
  | 'farm'
  | 'barracks'
  | 'lumberMill'
  | 'guardTower';

// Unit types
export type UnitType =
  | 'worker'
  | 'footman'   // melee infantry
  | 'archer'    // ranged
  | 'knight';   // heavy

export const ALL_BUILDING_TYPES: readonly BuildingType[] = [
  'townHall', 'farm', 'barracks', 'lumberMill', 'guardTower',
];

export const ALL_UNIT_TYPES: readonly UnitType[] = [
  'worker', 'footman', 'archer', 'knight',
];

// Building footprints (width, height in tiles) — all odd or even consistently for center
export const BUILDING_FOOTPRINTS: Record<BuildingType, { w: number; h: number }> = {
  townHall: { w: 3, h: 3 },
  farm: { w: 2, h: 2 },
  barracks: { w: 3, h: 2 },
  lumberMill: { w: 2, h: 3 },
  guardTower: { w: 2, h: 2 },
};

// Stats interfaces
export interface UnitStats {
  hp: number;
  armor: number;
  damage: number;
  attackRange: number; // tiles
  attackCooldownTicks: number;
  moveSpeed: number; // tiles per second
  sightRadius: number; // tiles
  goldCost: number;
  woodCost: number;
  supplyCost: number;
  trainTicks: number;
  buildTimeWorkerTicks?: number; // for buildings constructed by worker
}

export interface BuildingStats {
  hp: number;
  goldCost: number;
  woodCost: number;
  supplyProvided: number; // for townHall and farm
  buildTimeTicks: number; // worker labor ticks needed
  attackRange?: number; // for guardTower
  damage?: number;
  attackCooldownTicks?: number;
}

// The complete stats table — all values chosen to pass Stat sanity.
export const UNIT_STATS: Record<Faction, Record<UnitType, UnitStats>> = {
  0: { // Humans
    worker:   { hp: 35, armor: 0, damage: 3,  attackRange: 1, attackCooldownTicks: 30, moveSpeed: 1.8, sightRadius: 6, goldCost: 50, woodCost: 0,  supplyCost: 1, trainTicks: 45 },
    footman:  { hp: 55, armor: 1, damage: 6,  attackRange: 1, attackCooldownTicks: 35, moveSpeed: 1.6, sightRadius: 7, goldCost: 80, woodCost: 0,  supplyCost: 1, trainTicks: 70 },
    archer:   { hp: 40, armor: 0, damage: 5,  attackRange: 5, attackCooldownTicks: 45, moveSpeed: 1.5, sightRadius: 9, goldCost: 60, woodCost: 30, supplyCost: 1, trainTicks: 65 },
    knight:   { hp: 80, armor: 2, damage: 9,  attackRange: 1, attackCooldownTicks: 40, moveSpeed: 1.9, sightRadius: 6, goldCost: 140,woodCost: 50, supplyCost: 2, trainTicks: 110 },
  },
  1: { // Orcs — mirrored
    worker:   { hp: 35, armor: 0, damage: 3,  attackRange: 1, attackCooldownTicks: 30, moveSpeed: 1.8, sightRadius: 6, goldCost: 50, woodCost: 0,  supplyCost: 1, trainTicks: 45 },
    footman:  { hp: 55, armor: 1, damage: 6,  attackRange: 1, attackCooldownTicks: 35, moveSpeed: 1.6, sightRadius: 7, goldCost: 80, woodCost: 0,  supplyCost: 1, trainTicks: 70 },
    archer:   { hp: 40, armor: 0, damage: 5,  attackRange: 5, attackCooldownTicks: 45, moveSpeed: 1.5, sightRadius: 9, goldCost: 60, woodCost: 30, supplyCost: 1, trainTicks: 65 },
    knight:   { hp: 80, armor: 2, damage: 9,  attackRange: 1, attackCooldownTicks: 40, moveSpeed: 1.9, sightRadius: 6, goldCost: 140,woodCost: 50, supplyCost: 2, trainTicks: 110 },
  },
};

export const BUILDING_STATS: Record<Faction, Record<BuildingType, BuildingStats>> = {
  0: {
    townHall:   { hp: 1200, goldCost: 400, woodCost: 200, supplyProvided: 6, buildTimeTicks: 180 },
    farm:       { hp: 350,  goldCost: 100, woodCost: 50,  supplyProvided: 4, buildTimeTicks: 80 },
    barracks:   { hp: 650,  goldCost: 200, woodCost: 100, supplyProvided: 0, buildTimeTicks: 120 },
    lumberMill: { hp: 550,  goldCost: 120, woodCost: 80,  supplyProvided: 0, buildTimeTicks: 95 },
    guardTower: { hp: 280,  goldCost: 80,  woodCost: 60,  supplyProvided: 0, buildTimeTicks: 70, attackRange: 7, damage: 8, attackCooldownTicks: 50 },
  },
  1: { // mirrored
    townHall:   { hp: 1200, goldCost: 400, woodCost: 200, supplyProvided: 6, buildTimeTicks: 180 },
    farm:       { hp: 350,  goldCost: 100, woodCost: 50,  supplyProvided: 4, buildTimeTicks: 80 },
    barracks:   { hp: 650,  goldCost: 200, woodCost: 100, supplyProvided: 0, buildTimeTicks: 120 },
    lumberMill: { hp: 550,  goldCost: 120, woodCost: 80,  supplyProvided: 0, buildTimeTicks: 95 },
    guardTower: { hp: 280,  goldCost: 80,  woodCost: 60,  supplyProvided: 0, buildTimeTicks: 70, attackRange: 7, damage: 8, attackCooldownTicks: 50 },
  },
};

// Supply: town hall provides initial + farms
export const STARTING_SUPPLY = 6; // from initial town hall? Actually townHall provides 6, plus initial workers consume 4

// Derived helper: compute train requirements
export function getTrainRequirements(_unit: UnitType, _hasLumberMill: boolean, _hasBarracks: boolean): { gold: number; wood: number; supply: number } {
  // In practice we look up from table, this is just for doc.
  return { gold: 0, wood: 0, supply: 0 }; // use table instead
}

// Tile types
export type TileType = 'grass' | 'dirt' | 'forest' | 'water' | 'rock' | 'goldMine' | 'goldDepleted' | 'forestDepleted';

export const WALKABLE_TILES: ReadonlySet<TileType> = new Set([
  'grass', 'dirt', 'forest', 'goldMine', 'goldDepleted', 'forestDepleted',
] as const);

export const RESOURCE_TILES: ReadonlySet<TileType> = new Set(['goldMine', 'forest']);

// Note: forest is walkable (workers approach adjacent), but provides wood when chopped.
// After depletion becomes forestDepleted (still walkable, no resource).
// goldDepleted: walkable, no resource.
// rock, water: not walkable.
// Buildings occupy their footprint: not walkable.
