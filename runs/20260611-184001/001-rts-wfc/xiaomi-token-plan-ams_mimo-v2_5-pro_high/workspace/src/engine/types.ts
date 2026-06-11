/** Core game types shared across all systems. */

export type Faction = 'humans' | 'orcs';

export type TileType = 'grass' | 'dirt' | 'forest' | 'water' | 'rock' | 'gold_mine';

export interface Tile {
  type: TileType;
  /** For forest: remaining wood. For gold_mine: remaining gold */
  resource: number;
  /** Fog state: 0=unexplored, 1=explored, 2=visible */
  fog: number;
  /** Last-seen tile type (for explored but not visible) */
  lastSeen: TileType;
  /** Last-seen building or unit on this tile (for fog) */
  lastSeenEntity: EntityType | null;
}

export type EntityType = 'town_hall' | 'farm' | 'barracks' | 'lumber_mill' | 'guard_tower'
  | 'worker' | 'melee' | 'ranged' | 'heavy';

export type UnitType = 'worker' | 'melee' | 'ranged' | 'heavy';
export type BuildingType = 'town_hall' | 'farm' | 'barracks' | 'lumber_mill' | 'guard_tower';

export interface EntityStats {
  type: EntityType;
  faction: Faction;
  name: string;
  hp: number;
  maxHp: number;
  armor: number;
  damage: number;
  attackRange: number;    // in tiles; 0 = melee
  attackCooldown: number; // ms between attacks
  moveSpeed: number;      // tiles per second
  sightRadius: number;    // in tiles
  goldCost: number;
  woodCost: number;
  supplyCost: number;     // units only
  supplyProvided: number; // buildings only
  buildTime: number;      // ms
  width: number;          // tile footprint
  height: number;
  isUnit: boolean;
  /** Prerequisite building types */
  requires: BuildingType[];
  /** For workers: what they can build */
  canBuild?: BuildingType[];
  harvestRate?: number;
  repairRate?: number;
}

export interface Entity {
  id: number;
  type: EntityType;
  faction: Faction;
  x: number;         // pixel position (center)
  y: number;
  tileX: number;     // tile position (top-left for buildings)
  tileY: number;
  hp: number;
  maxHp: number;
  stats: EntityStats;
  state: EntityState;
  targetX: number | null;
  targetY: number | null;
  attackTarget: number | null;  // entity id
  attackCooldownLeft: number;
  path: Array<{ x: number; y: number }>;
  pathIndex: number;
  /** Worker: carrying resources */
  carrying: 'gold' | 'wood' | null;
  carryAmount: number;
  /** Worker: harvest target tile */
  harvestTileX: number | null;
  harvestTileY: number | null;
  /** Worker: building target */
  buildingType: BuildingType | null;
  buildProgress: number;
  /** Building: training queue */
  trainQueue: Array<{ type: UnitType; progress: number }>;
  /** Corpse fade timer */
  deathTimer: number;
  /** Visible on screen */
  visible: boolean;
}

export type EntityState =
  'idle' | 'moving' | 'attacking' | 'harvesting' | 'returning_resources'
  | 'building' | 'repairing' | 'training' | 'dead';

export interface Projectile {
  id: number;
  x: number;
  y: number;
  targetId: number;
  damage: number;
  faction: Faction;
  speed: number;  // pixels per second
  startX: number;
  startY: number;
}

export interface GameState {
  seed: number;
  mapWidth: number;
  mapHeight: number;
  tiles: Tile[][];
  entities: Entity[];
  projectiles: Projectile[];
  nextEntityId: number;
  nextProjectileId: number;
  gameTime: number;       // ms elapsed
  paused: boolean;
  speed: number;          // 1 or 2
  playerFaction: Faction;
  aiFaction: Faction;
  /** Resources: [gold, wood, supplyUsed, supplyCap] per faction */
  resources: Record<Faction, [number, number, number, number]>;
  selectedEntityIds: number[];
  /** For campaign */
  level: number;
  gameOver: boolean;
  winner: Faction | null;
}

export interface Camera {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface InputState {
  mouseX: number;
  mouseY: number;
  mouseDown: boolean;
  rightMouseDown: boolean;
  dragStartX: number;
  dragStartY: number;
  isDragging: boolean;
  keys: Set<string>;
  shiftKey: boolean;
  ctrlKey: boolean;
  buildMode: BuildingType | null;
}

export const TILE_SIZE = 32; // pixels per tile
