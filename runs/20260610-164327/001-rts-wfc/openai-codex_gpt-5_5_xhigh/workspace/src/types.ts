export const TILE_SIZE = 32;

export type TileType = 'grass' | 'dirt' | 'forest' | 'water' | 'rock' | 'gold';
export type ResourceKind = 'gold' | 'wood';
export type FactionId = 'humans' | 'orcs';
export type SideId = 0 | 1;
export type UnitType = 'worker' | 'melee' | 'ranged' | 'heavy';
export type BuildingType = 'townHall' | 'farm' | 'barracks' | 'lumberMill' | 'guardTower';
export type EntityKind = 'unit' | 'building';
export type GameStatus = 'menu' | 'playing' | 'victory' | 'defeat';
export type FogState = 0 | 1 | 2;

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StartLocation extends Point {
  label: 'player' | 'ai';
}

export interface LevelDefinition {
  level: number;
  name: string;
  width: number;
  height: number;
  difficulty: number;
  waterWeight: number;
  rockWeight: number;
  forestWeight: number;
  description: string;
}

export interface GameMap {
  width: number;
  height: number;
  tiles: TileType[];
  gold: Int32Array;
  wood: Int32Array;
  starts: [StartLocation, StartLocation];
}

export interface UnitStats {
  type: UnitType;
  humanName: string;
  orcName: string;
  hp: number;
  armor: number;
  damage: number;
  range: number;
  cooldown: number;
  speed: number;
  sight: number;
  goldCost: number;
  woodCost: number;
  supplyCost: number;
  trainingTime: number;
  projectile: boolean;
}

export interface BuildingStats {
  type: BuildingType;
  humanName: string;
  orcName: string;
  hp: number;
  armor: number;
  goldCost: number;
  woodCost: number;
  buildTime: number;
  footprint: { width: number; height: number };
  sight: number;
  supplyProvided: number;
  trains: readonly UnitType[];
  attackDamage: number;
  attackRange: number;
  attackCooldown: number;
}

export interface Resources {
  gold: number;
  wood: number;
}

export interface SupplyState {
  used: number;
  cap: number;
}

export type UnitOrder =
  | { kind: 'idle' }
  | { kind: 'move'; target: Point; attackMove: boolean }
  | { kind: 'attack'; targetId: number; attackMove: boolean }
  | { kind: 'harvest'; resource: ResourceKind; target: Point; returnAfterDropoff: boolean }
  | { kind: 'returnResources'; resource: ResourceKind; harvestTarget: Point }
  | { kind: 'build'; buildingId: number }
  | { kind: 'repair'; targetId: number };

export interface TrainingQueueItem {
  unitType: UnitType;
  remaining: number;
  total: number;
}

export interface Entity {
  id: number;
  owner: SideId;
  kind: EntityKind;
  type: UnitType | BuildingType;
  faction: FactionId;
  x: number;
  y: number;
  radius: number;
  hp: number;
  maxHp: number;
  armor: number;
  sight: number;
  completed: boolean;
  buildProgress: number;
  buildTime: number;
  attackDamage: number;
  attackRange: number;
  attackCooldown: number;
  cooldownRemaining: number;
  projectileAttack: boolean;
  unit?: {
    speed: number;
    supplyCost: number;
    carried: { kind: ResourceKind; amount: number } | null;
    order: UnitOrder;
    path: Point[];
    pathIndex: number;
    stuckTime: number;
    workProgress: number;
    formationOffset: Point;
  };
  building?: {
    footprint: { width: number; height: number };
    supplyProvided: number;
    trainQueue: TrainingQueueItem[];
  };
}

export interface Projectile {
  id: number;
  owner: SideId;
  source: Point;
  x: number;
  y: number;
  targetId: number;
  damage: number;
  speed: number;
  color: string;
}

export interface Corpse {
  x: number;
  y: number;
  radius: number;
  color: string;
  remaining: number;
  total: number;
}

export interface PlayerState {
  side: SideId;
  faction: FactionId;
  resources: Resources;
  aiHarvestBonus: number;
}

export interface SelectionSummary {
  entities: Entity[];
  primary: Entity | null;
}
