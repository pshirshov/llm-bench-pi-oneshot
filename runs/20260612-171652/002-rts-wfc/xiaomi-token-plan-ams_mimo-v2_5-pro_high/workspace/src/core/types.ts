/** Core type definitions shared across the simulation */

export const TICK_RATE = 20; // simulation ticks per second
export const TICK_DT = 1 / TICK_RATE;

export type Faction = 'humans' | 'orcs';

export type TileType =
  | 'grass'
  | 'dirt'
  | 'forest'
  | 'water'
  | 'rock'
  | 'goldMine'
  | 'goldMineDepleted';

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export function vec2(x: number, y: number): Vec2 { return { x, y }; }
export function vecEq(a: Vec2, b: Vec2): boolean { return a.x === b.x && a.y === b.y; }
export function vecDist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}
export function vecManhattan(a: Vec2, b: Vec2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
export function vecFloor(v: Vec2): Vec2 {
  return { x: Math.floor(v.x), y: Math.floor(v.y) };
}

export type UnitType = 'worker' | 'melee' | 'ranged' | 'heavy';
export type BuildingType = 'townHall' | 'farm' | 'barracks' | 'lumberMill' | 'guardTower' | 'goldMine';

export interface UnitStats {
  readonly hp: number;
  readonly armor: number;
  readonly damage: number;
  readonly attackRange: number;
  readonly attackCooldown: number; // in ticks
  readonly moveSpeed: number; // tiles per second
  readonly sightRadius: number;
  readonly goldCost: number;
  readonly woodCost: number;
  readonly supplyCost: number;
  readonly trainTime: number; // in ticks
}

export interface BuildingStats {
  readonly hp: number;
  readonly armor: number;
  readonly supplyProvided: number;
  readonly goldCost: number;
  readonly woodCost: number;
  readonly buildTime: number; // in ticks
  readonly width: number;
  readonly height: number;
  readonly sightRadius: number;
}

export interface FactionStats {
  readonly name: string;
  readonly color: string;
  readonly minimapColor: string;
  readonly units: Record<UnitType, UnitStats>;
  readonly buildings: Record<BuildingType, BuildingStats>;
}

export type OrderType =
  | 'idle'
  | 'move'
  | 'attack'
  | 'attackMove'
  | 'harvest'
  | 'build'
  | 'repair'
  | 'gather'
  | 'train';

export interface Order {
  readonly type: OrderType;
  readonly target?: Vec2;
  readonly targetId?: number;
  readonly buildType?: BuildingType;
}

export type EntityType = 'unit' | 'building';

export interface Entity {
  readonly id: number;
  faction: Faction;
  readonly entityType: EntityType;
  readonly unitType?: UnitType;
  readonly buildingType?: BuildingType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  armor: number;
  damage: number;
  attackRange: number;
  attackCooldown: number;
  attackCooldownTimer: number;
  moveSpeed: number;
  sightRadius: number;
  order: Order;
  path: Vec2[];
  pathIndex: number;
  cargoGold: number;
  cargoWood: number;
  harvestTarget?: number;
  buildTarget?: number;
  repairTarget?: number;
  progressTicks: number;
  progressTotal: number;
  width: number;
  height: number;
  alive: boolean;
  /** For projectiles */
  isProjectile?: boolean;
  projectileTargetId?: number;
  projectileDamage?: number;
  projectileSpeed?: number;
}

export type FogState = 'unexplored' | 'explored' | 'visible';

export interface GameMap {
  readonly width: number;
  readonly height: number;
  readonly tiles: TileType[];
  /** Which tiles are walkable (derived from tile type + buildings) */
  readonly walkable: boolean[];
  /** Fog state per tile per faction */
  readonly fog: Record<Faction, FogState[]>;
  /** Start locations for each faction */
  readonly startLocations: Record<Faction, Vec2>;
  readonly level: number;
}

export interface GameState {
  readonly map: GameMap;
  entities: Entity[];
  nextEntityId: number;
  resources: Record<Faction, { gold: number; wood: number }>;
  supplyUsed: Record<Faction, number>;
  supplyCap: Record<Faction, number>;
  tick: number;
  winner: Faction | null;
  speed: number;
  paused: boolean;
  seed: number;
}

export interface GameConfig {
  readonly seed: number;
  readonly level: number;
  readonly playerFaction: Faction;
  readonly difficulty: number;
}

/** Harvest constants */
export const WORKER_CARRY_GOLD = 10;
export const WORKER_CARRY_WOOD = 10;
export const WORKER_HARVEST_TICKS = 40; // 2 seconds at 20 tps
export const WORKER_REPAIR_RATE = 5; // HP per tick
export const WORKER_REPAIR_COST_GOLD = 0.5; // gold per HP
export const WORKER_REPAIR_COST_WOOD = 0.5; // wood per HP
export const GOLD_MINE_AMOUNT = 5000;
export const PROGRESS_WATCHDOG_TICKS = 600; // 30 seconds — if no progress, cancel order

/** Map generation */
export const MIN_START_SEPARATION_RATIO = 0.6;
export const MIN_START_LINE_SEPARATION_RATIO = 0.4;
export const RESOURCE_REACH_TILES = 15;
export const MIN_BUILD_AREA = 5;
export const CAMPAIGN_LEVELS = 5;

/** Difficulty multipliers */
export function difficultyResourceMult(d: number): number { return 1 + (d - 1) * 0.3; }
export function difficultyHarvestMult(d: number): number { return 1 + (d - 1) * 0.15; }
export function difficultyWaveSizeMult(d: number): number { return 0.8 + (d - 1) * 0.5; }
export function difficultyWaveCadenceTicks(d: number): number {
  // Difficulty 1: ~4 minutes between waves; Difficulty 5: ~2 minutes
  return Math.floor((240 - (d - 1) * 30) * TICK_RATE);
}
