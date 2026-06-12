/**
 * Core immutable-ish data types for the simulation.
 * All positions in world tile coordinates (float for units, integer base for buildings).
 */

import type { BuildingType, Faction, TileType, UnitType } from './constants';

export type EntityId = number;

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type OrderType =
  | 'idle'
  | 'move'
  | 'attack'
  | 'harvest'
  | 'build'
  | 'repair';

export interface OrderIdle {
  type: 'idle';
}

export interface OrderMove {
  type: 'move';
  target: Vec2;
  /** last known good path or current path segment */
  path?: Vec2[];
  pathIndex?: number;
  repathAttempts?: number;
}

export interface OrderAttack {
  type: 'attack';
  targetId: EntityId;
  moveToRange?: boolean; // attack-move style
}

export interface OrderHarvest {
  type: 'harvest';
  sourcePos: Vec2; // center of resource tile (or adjacent target pos)
  resourceType: 'gold' | 'wood';
  phase: 'travel' | 'gather' | 'return' | 'drop';
  carried: number;
  dropOffId?: EntityId; // nearest dropoff at start of return
  gatherTicksLeft?: number;
  repathAttempts?: number;
}

export interface OrderBuild {
  type: 'build';
  buildingType: BuildingType;
  footprint: Rect; // top-left tile + size
  phase: 'travel' | 'constructing';
  progressTicks: number;
  targetPos?: Vec2; // build site center or corner
}

export interface OrderRepair {
  type: 'repair';
  targetId: EntityId;
  phase: 'travel' | 'repairing';
  progressTicks: number;
}

export type Order =
  | OrderIdle
  | OrderMove
  | OrderAttack
  | OrderHarvest
  | OrderBuild
  | OrderRepair;

export interface Unit {
  readonly id: EntityId;
  readonly faction: Faction;
  readonly type: UnitType;
  pos: Vec2; // center
  hp: number;
  order: Order;
  lastAttackTick: number; // for cooldown
  // transient path state lives in order for move/harvest
  carriedResource?: { type: 'gold' | 'wood'; amount: number };
}

export interface Building {
  readonly id: EntityId;
  readonly faction: Faction;
  readonly type: BuildingType;
  readonly footprint: Rect; // integer tile top-left, w/h in tiles
  hp: number;
  // construction state
  isComplete: boolean;
  buildProgress: number; // 0 to required
  // for production queue
  trainQueue: UnitType[]; // FIFO
  trainProgress: number;
  lastAttackTick?: number; // for towers
}

export interface Projectile {
  readonly id: EntityId;
  readonly faction: Faction; // attacker
  pos: Vec2;
  targetPos: Vec2; // or target unit id but snapshot for simplicity
  damage: number;
  speed: number; // tiles / tick
  life: number;
  ownerId?: EntityId;
}

export interface ResourceNode {
  pos: Vec2; // tile center integer-ish
  type: 'goldMine' | 'forest';
  amount: number; // remaining
  depleted: boolean;
}

export interface MapTile {
  type: TileType;
  // cached walkability etc computed from type + entities
}

export interface GameMap {
  readonly width: number;
  readonly height: number;
  tiles: TileType[][]; // [y][x]
  // resources embedded as special tiles but also explicit nodes for tracking
  resourceNodes: ResourceNode[];
  startLocations: [Vec2, Vec2]; // faction 0 and 1 starts (centers)
}

export interface WorldState {
  tick: number;
  readonly seed: number;
  readonly map: GameMap;
  units: Map<EntityId, Unit>;
  buildings: Map<EntityId, Building>;
  projectiles: Map<EntityId, Projectile>;
  // per-faction resources
  gold: [number, number];
  wood: [number, number];
  supplyUsed: [number, number];
  supplyCap: [number, number];
  // fog of war: per player faction, but since one human one AI we track both
  // 0=unexplored, 1=explored, 2=visible. Stored as number[][] for each faction
  fog: [number[][], number[][]]; // [faction][y][x]
  // selection and UI state is NOT in sim — input layer manages transient selection
  // AI state lives outside or in a controller
  nextId: number; // for spawning
  // for tests: last command time etc not needed
}

export type Side = 0 | 1; // player/AI but actually faction

export interface SimSnapshot {
  readonly tick: number;
  readonly units: ReadonlyArray<Readonly<Unit>>;
  readonly buildings: ReadonlyArray<Readonly<Building>>;
  // etc for determinism
}
