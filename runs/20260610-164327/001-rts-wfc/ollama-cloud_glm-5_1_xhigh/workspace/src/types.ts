// ─── Core type definitions for Warband ───

export enum TileType {
  Grass = 'grass',
  Dirt = 'dirt',
  Forest = 'forest',
  Water = 'water',
  Rock = 'rock',
  GoldMine = 'gold_mine',
}

export enum Faction {
  Human = 'human',
  Orc = 'orc',
}

export enum UnitType {
  Worker = 'worker',
  Infantry = 'infantry',
  Ranged = 'ranged',
  Heavy = 'heavy',
}

export enum BuildingType {
  TownHall = 'town_hall',
  Farm = 'farm',
  Barracks = 'barracks',
  LumberMill = 'lumber_mill',
  GuardTower = 'guard_tower',
}

export enum FogState {
  Unexplored = 0,
  Explored = 1,
  Visible = 2,
}

export enum UnitState {
  Idle = 'idle',
  Moving = 'moving',
  Attacking = 'attacking',
  Harvesting = 'harvesting',
  Building = 'building',
  Repairing = 'repairing',
  Returning = 'returning', // carrying resources back
  Dead = 'dead',
}

export enum BuildingState {
  Constructing = 'constructing',
  Complete = 'complete',
  Destroyed = 'destroyed',
}

export type ResourceType = 'gold' | 'wood';

export interface Vec2 {
  x: number;
  y: number;
}

export interface UnitStats {
  hp: number;
  armor: number;
  attackDamage: number;
  attackRange: number;
  attackCooldown: number; // seconds
  moveSpeed: number; // tiles per second
  sightRadius: number; // tiles
  goldCost: number;
  woodCost: number;
  supplyCost: number;
  trainingTime: number; // seconds
}

export interface BuildingStats {
  hp: number;
  goldCost: number;
  woodCost: number;
  buildTime: number; // seconds a worker takes to build
  footprintW: number;
  footprintH: number;
  supplyProvided: number;
  attackDamage: number;
  attackRange: number;
  attackCooldown: number; // seconds
  sightRadius: number;
}

export interface Unit {
  id: number;
  type: UnitType;
  faction: Faction;
  x: number; // tile position (continuous)
  y: number;
  hp: number;
  maxHp: number;
  armor: number;
  attackDamage: number;
  attackRange: number;
  attackCooldown: number; // total cooldown seconds
  cooldownRemaining: number;
  moveSpeed: number;
  sightRadius: number;
  state: UnitState;
  targetId: number | null;
  targetPos: Vec2 | null; // for move/attack-move targets
  path: Vec2[];
  carryingType: ResourceType | null;
  carryingAmount: number;
  rallyPoint: Vec2 | null;
  goldCost: number;
  woodCost: number;
  supplyCost: number;
}

export interface Building {
  id: number;
  type: BuildingType;
  faction: Faction;
  tileX: number; // top-left tile
  tileY: number;
  hp: number;
  maxHp: number;
  state: BuildingState;
  buildProgress: number; // 0..1
  trainingQueue: TrainingItem[];
  rallyPoint: Vec2 | null;
  // for guard towers
  attackDamage: number;
  attackRange: number;
  attackCooldown: number;
  cooldownRemaining: number;
  sightRadius: number;
}

export interface TrainingItem {
  unitType: UnitType;
  progress: number; // 0..1
  totalTime: number; // seconds
}

export interface Projectile {
  id: number;
  x: number;
  y: number;
  targetId: number;
  damage: number;
  speed: number;
  faction: Faction;
  sourceId: number;
}

export interface Tile {
  type: TileType;
  buildingId: number | null;
  resourceAmount: number; // gold for gold mines, wood for forest tiles
  revealed: boolean; // has this tile ever been revealed (for fog explored state)
}

export interface GameMap {
  width: number;
  height: number;
  tiles: Tile[][];
}

export interface Resources {
  gold: number;
  wood: number;
}

export interface SupplyInfo {
  used: number;
  cap: number;
}

export interface ControlGroup {
  unitIds: number[];
  buildingId: number | null;
}

export type OrderType =
  | 'move' | 'attack' | 'attackMove' | 'harvest' | 'build'
  | 'repair' | 'stop' | 'train';

export interface PlaceBuildOrder {
  type: 'build';
  buildingType: BuildingType;
  tileX: number;
  tileY: number;
}

export interface TrainOrder {
  type: 'train';
  unitType: UnitType;
  buildingId: number;
}

export interface MoveOrder {
  type: 'move';
  x: number;
  y: number;
}

export interface AttackOrder {
  type: 'attack';
  targetId: number;
}

export interface AttackMoveOrder {
  type: 'attackMove';
  x: number;
  y: number;
}

export interface HarvestOrder {
  type: 'harvest';
  targetTileX: number;
  targetTileY: number;
}

export interface RepairOrder {
  type: 'repair';
  targetId: number;
}

export type Order = MoveOrder | AttackOrder | AttackMoveOrder | HarvestOrder | PlaceBuildOrder | RepairOrder | TrainOrder;

export enum GameScreen {
  Menu = 'menu',
  LevelSelect = 'levelSelect',
  Playing = 'playing',
  Victory = 'victory',
  Defeat = 'defeat',
}

export interface CampaignLevel {
  level: number;
  mapWidth: number;
  mapHeight: number;
  aiDifficulty: number;
  seed: number;
  name: string;
  unlocked: boolean;
}