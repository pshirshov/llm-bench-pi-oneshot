export type Faction = 'human' | 'orc';

export type Tile = 'grass' | 'dirt' | 'forest' | 'water' | 'rock' | 'goldmine';

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

export type EntityKind = 'unit' | 'building';

export type BuildingType = 'th' | 'farm' | 'barracks' | 'lumbermill' | 'tower';

export type UnitType = 'worker' | 'inf' | 'ranged' | 'heavy';

export type OrderType = 'move' | 'attack' | 'harvest' | 'repair' | 'build' | 'idle';

export interface UnitStats {
  hp: number;
  armor: number;
  damage: number;
  attackRange: number;
  attackCooldown: number; // ticks
  speed: number; // tiles/sec
  sight: number;
  goldCost: number;
  woodCost: number;
  supply: number;
  trainTime: number; // ticks
  name: string;
}

export interface BuildingStats {
  hp: number;
  goldCost: number;
  woodCost: number;
  supply: number; // granted
  buildTime: number; // ticks base
  footprintW: number;
  footprintH: number;
  name: string;
}

export interface UnitData {
  worker: UnitStats;
  inf: UnitStats;
  ranged: UnitStats;
  heavy: UnitStats;
}

export interface BuildingData {
  th: BuildingStats;
  farm: BuildingStats;
  barracks: BuildingStats;
  lumbermill: BuildingStats;
  tower: BuildingStats;
}

export interface Entity {
  id: number;
  faction: Faction;
  kind: EntityKind;
  type: UnitType | BuildingType;
  pos: Point; // center of entity (fractional tiles ok for units)
  hp: number;
  maxHp: number;
  size: number; // radius in tiles for collision / draw
  selected: boolean;
  // Unit fields
  order?: OrderType;
  targetId?: number;
  targetPos?: Point;
  harvestResource?: 'gold' | 'wood';
  buildType?: BuildingType;
  buildProgress?: number;
  cooldown?: number;
  lastAttackTick?: number;
  // Movement
  vel?: Point;
  path?: Point[];
  pathIndex?: number;
  stuckTicks?: number;
  // Visual / state
  facing?: number; // radians
  animFrame?: number;
}

export interface Building extends Entity {
  kind: 'building';
  // footprint tiles (bottom-left anchor convention for placement)
  footX: number;
  footY: number;
  footW: number;
  footH: number;
  // construction
  isBuilt: boolean;
  buildProgress: number; // 0..buildTime
}

export interface Projectile {
  id: number;
  pos: Point;
  vel: Point;
  damage: number;
  ownerFaction: Faction;
  targetId: number;
  life: number;
}

export interface Corpse {
  pos: Point;
  faction: Faction;
  kind: 'unit' | 'building';
  size: number;
  fade: number; // 0..1 remaining
}

export type TileVisibility = 'unexplored' | 'explored' | 'visible';

export interface GameState {
  tick: number;
  seed: number;
  rng: () => number; // current seeded rng
  mapW: number;
  mapH: number;
  tiles: Tile[][];
  // visibility
  vis: TileVisibility[][];
  exploredBuildings: Map<number, Building>; // last known enemy buildings for fog
  // entities
  entities: Map<number, Entity>;
  nextId: number;
  projectiles: Projectile[];
  corpses: Corpse[];
  // resources
  gold: Record<Faction, number>;
  wood: Record<Faction, number>;
  supplyUsed: Record<Faction, number>;
  supplyCap: Record<Faction, number>;
  // player
  playerFaction: Faction;
  selectedIds: Set<number>;
  controlGroups: Record<number, number[]>; // 1-9 -> ids
  // camera
  camX: number; // top-left tile
  camY: number;
  // ai state
  aiState: AIState;
  // game flow
  paused: boolean;
  speed: 1 | 2;
  gameOver: 'none' | 'victory' | 'defeat';
  level: number; // 0-based
  difficulty: number;
}

export interface AIState {
  lastWaveTick: number;
  nextWaveSize: number;
  workersOnGold: number;
  workersOnWood: number;
  plannedBarracks: boolean;
  plannedLumber: boolean;
  plannedTowers: number;
  baseCenter: Point;
  threats: Point[];
}

export type PlayerOrder = 
  | { type: 'move'; pos: Point }
  | { type: 'attack'; pos?: Point; targetId?: number }
  | { type: 'harvest'; targetId: number }
  | { type: 'repair'; targetId: number }
  | { type: 'build'; pos: Point; buildingType: BuildingType };

export interface WorldSnapshot {
  tiles: Tile[][];
  entities: Entity[];
  buildings: Building[];
  projectiles: Projectile[];
  corpses: Corpse[];
  vis: TileVisibility[][];
}
