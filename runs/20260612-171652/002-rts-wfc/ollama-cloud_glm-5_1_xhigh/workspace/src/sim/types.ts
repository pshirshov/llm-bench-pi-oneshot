/** Core type definitions for the simulation. No DOM imports. */

import type { PRNG } from "./prng";

export type Faction = "human" | "orc";
export type Factionless = "neutral";

export type TileType =
  | "grass"
  | "dirt"
  | "forest"
  | "water"
  | "rock"
  | "gold_mine"
  | "depleted_mine"
  | "chopped_forest";

export type UnitType = "worker" | "melee" | "ranged" | "heavy";

export type BuildingType =
  | "town_hall"
  | "farm"
  | "barracks"
  | "lumber_mill"
  | "guard_tower";

export type OrderType =
  | "idle"
  | "move"
  | "attack"
  | "attack_move"
  | "harvest"
  | "build"
  | "repair"
  | "train"
  | "guard";

export interface Vec2 {
  x: number;
  y: number;
}

export interface TileCoord {
  col: number;
  row: number;
}

export type EntityId = number;

export interface UnitStats {
  hp: number;
  attack: number;
  attackRange: number;
  armor: number;
  moveSpeed: number;
  sight: number;
  goldCost: number;
  woodCost: number;
  supplyCost: number;
  trainTime: number;
  attackCooldown: number;
}

export interface BuildingStats {
  hp: number;
  goldCost: number;
  woodCost: number;
  buildTime: number;
  width: number;
  height: number;
  supplyProvided: number;
  attack: number;
  attackRange: number;
  sight: number;
  attackCooldown: number;
}

export interface FactionUnitStats {
  worker: UnitStats;
  melee: UnitStats;
  ranged: UnitStats;
  heavy: UnitStats;
}

export interface FactionBuildingStats {
  town_hall: BuildingStats;
  farm: BuildingStats;
  barracks: BuildingStats;
  lumber_mill: BuildingStats;
  guard_tower: BuildingStats;
}

export interface HarvestStats {
  goldPerTrip: number;
  woodPerTrip: number;
  harvestDuration: number;
  goldMineCapacity: number;
  forestTileCapacity: number;
}

export interface Unit {
  id: EntityId;
  type: UnitType;
  faction: Faction;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  order: Order;
  cooldownRemaining: number;
  cargo: ResourceCargo;
  harvestTarget: EntityId | null;
  harvestPhase: "moving_to_source" | "gathering" | "moving_to_dropoff" | "returning" | null;
  harvestGatherTimer: number;
  progressWatchdog: number;
  lastProgressX: number;
  lastProgressY: number;
  lastProgressPhase: string;
  path: TileCoord[];
  pathIndex: number;
  repathAttempts: number;
  stuckTicks: number;
  lastX: number;
  lastY: number;
}

export interface ResourceCargo {
  type: "gold" | "wood" | null;
  amount: number;
}

export interface Building {
  id: EntityId;
  type: BuildingType;
  faction: Faction;
  col: number;
  row: number;
  hp: number;
  maxHp: number;
  buildProgress: number;
  isComplete: boolean;
  rallyPoint: Vec2 | null;
  trainingQueue: TrainingItem[];
  cooldownRemaining: number;
}

export interface TrainingItem {
  unitType: UnitType;
  progress: number;
}

export interface GoldMine {
  id: EntityId;
  col: number;
  row: number;
  remaining: number;
  faction: Factionless;
}

export interface Order {
  type: OrderType;
  targetPos?: Vec2;
  targetId?: EntityId;
  buildingType?: BuildingType;
  buildLocation?: TileCoord;
}

export interface Projectile {
  id: EntityId;
  x: number;
  y: number;
  targetId: EntityId;
  damage: number;
  speed: number;
  faction: Faction;
}

export interface ResourceCounts {
  gold: number;
  wood: number;
  supplyUsed: number;
  supplyCap: number;
}

export interface StartLocation {
  col: number;
  row: number;
  faction: Faction;
}

export interface LevelConfig {
  width: number;
  height: number;
  levelNumber: number;
  difficulty: number;
}

export interface GameConfig {
  seed: number;
  level: number;
  playerFaction: Faction;
  prng: PRNG;
}