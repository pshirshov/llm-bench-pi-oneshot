export type PlayerId = 1 | 2;
export type Faction = 'humans' | 'orcs';
export type UnitKind = 'worker' | 'melee' | 'ranged' | 'heavy';
export type BuildingKind = 'townHall' | 'farm' | 'barracks' | 'lumberMill' | 'guardTower';
export type ResourceKind = 'gold' | 'wood';
export type TileKind = 'grass' | 'dirt' | 'forest' | 'water' | 'rock' | 'goldMine' | 'depletedMine';
export type EntityId = number;
export type GameOutcome = 'playing' | 'victory' | 'defeat';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Tile {
  kind: TileKind;
  gold: number;
  wood: number;
}

export interface StartLocation {
  player: PlayerId;
  x: number;
  y: number;
}

export interface GameMap {
  width: number;
  height: number;
  tiles: Tile[];
  starts: [StartLocation, StartLocation];
  level: number;
  seed: number;
  walkVersion: number;
}

export interface Cargo {
  kind: ResourceKind;
  amount: number;
}

export type OrderTerminalReason = 'completed' | 'replaced' | 'cancelled' | 'unreachable' | 'exhausted' | 'no-dropoff' | 'stalled';

export type UnitOrder =
  | { kind: 'idle'; reason?: OrderTerminalReason }
  | { kind: 'move'; target: Point; reachable: boolean }
  | { kind: 'attack'; targetId: EntityId }
  | { kind: 'attackMove'; target: Point; reachable: boolean }
  | { kind: 'harvest'; resource: ResourceKind; source: Point; phase: 'toSource' | 'gathering' | 'toDropoff'; gatherTicks: number }
  | { kind: 'build'; building: BuildingKind; site: Point; phase: 'toSite' | 'constructing' }
  | { kind: 'repair'; targetId: EntityId; phase: 'toTarget' | 'repairing' };

export interface MoveState {
  from: Point;
  to: Point;
  progress: number;
  duration: number;
}

export interface Unit {
  id: EntityId;
  type: 'unit';
  owner: PlayerId;
  faction: Faction;
  kind: UnitKind;
  hp: number;
  tile: Point;
  x: number;
  y: number;
  order: UnitOrder;
  cargo?: Cargo;
  destination?: Point;
  desiredDestination?: Point;
  path: Point[];
  pathVersion: number;
  pathReachable: boolean;
  move?: MoveState;
  attackCooldown: number;
  blockedTicks: number;
  repathAttempts: number;
  lastProgressTick: number;
  lastProgressSignature: string;
  waveTag?: number;
}

export interface TrainingQueueItem {
  kind: UnitKind;
  remainingTicks: number;
  totalTicks: number;
}

export interface BuildProgress {
  remainingTicks: number;
  totalTicks: number;
  workerId: EntityId;
}

export interface Building {
  id: EntityId;
  type: 'building';
  owner: PlayerId;
  faction: Faction;
  kind: BuildingKind;
  hp: number;
  x: number;
  y: number;
  w: number;
  h: number;
  complete: boolean;
  queue: TrainingQueueItem[];
  build?: BuildProgress;
  attackCooldown: number;
}

export interface Projectile {
  id: number;
  owner: PlayerId;
  from: Point;
  x: number;
  y: number;
  targetId: EntityId;
  damage: number;
  remainingTicks: number;
}

export interface Corpse {
  x: number;
  y: number;
  remainingTicks: number;
  owner: PlayerId;
}

export interface PlayerState {
  id: PlayerId;
  faction: Faction;
  gold: number;
  wood: number;
  supplyUsed: number;
  supplyCap: number;
  aiDifficulty: number;
  wavesLaunched: number;
  unlockedLevel: number;
}

export interface FogState {
  explored: Uint8Array;
  visible: Uint8Array;
}

export interface SerializedWorld {
  tick: number;
  outcome: GameOutcome;
  mapHash: string;
  players: string;
  units: string;
  buildings: string;
  projectiles: string;
}
