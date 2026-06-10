// World state and entity definitions.

import { type FactionId } from './data.js';
import { type TileId } from './data.js';

export type EntityId = number;

export interface Vec2 { x: number; y: number; }

// Identified by an integer id; entities are referenced by id from many places
// (orders, ownership) so we keep them in a map for O(1) lookups.

export type UnitKind = 'worker' | 'melee' | 'ranged' | 'heavy';
export type BuildingKind = 'townhall' | 'farm' | 'barracks' | 'mill' | 'tower';

export type OrderKind =
  | { kind: 'idle' }
  | { kind: 'move'; tx: number; ty: number }
  | { kind: 'attack'; target: EntityId }
  | { kind: 'attackMove'; tx: number; ty: number }
  | { kind: 'harvest'; target: EntityId }      // resource (gold_mine tile entity or forest tile)
  | { kind: 'returnResource'; dropOff: EntityId } // building to return to
  | { kind: 'repair'; target: EntityId }
  | { kind: 'build'; target: EntityId }         // building under construction
  | { kind: 'train'; unitKind: UnitKind; buildingId: EntityId } // queued at building
  | { kind: 'construct'; buildingId: EntityId }; // worker constructing

export interface UnitEntity {
  id: EntityId;
  kind: 'unit';
  faction: FactionId;
  unitKind: UnitKind;
  // World position is continuous (sub-tile) for smooth movement.
  pos: Vec2;
  hp: number;
  // Path: remaining waypoints (tile coords). Filled by A*; consumed one step at a time.
  path: { x: number; y: number }[];
  // Cached next waypoint; when sub-tile pos reaches this, pop and advance.
  pathIdx: number;
  order: OrderKind;
  // Combat
  attackCooldown: number;     // seconds remaining
  // Misc
  carry: { gold: number; wood: number };
  // Worker state machine
  workerState?: 'idle' | 'movingToResource' | 'harvesting' | 'returning' | 'movingToBuild' | 'building' | 'movingToRepair' | 'repairing';
  harvestTimer?: number;       // seconds into current harvest action
  buildProgress?: number;      // seconds accumulated for construction
  buildTarget?: EntityId;      // building being constructed
  // For target tracking
  targetId?: EntityId;
  // Cached tiles occupied (for separation)
  occ: { x: number; y: number };
  // Animation
  facing: number;              // radians
  // Corpse fade timer (after hp <= 0, briefly before despawn)
  corpseTimer?: number;
  // Corpse fade t (0..1)
  corpseT?: number;
}

export interface BuildingEntity {
  id: EntityId;
  kind: 'building';
  faction: FactionId;
  buildingKind: BuildingKind;
  // Anchor tile (top-left of footprint)
  pos: Vec2;
  size: { w: number; h: number };
  hp: number;
  maxHp: number;
  armor: number;
  // Construction
  underConstruction: boolean;
  buildProgress: number;       // seconds accumulated (0 => not built)
  buildTime: number;           // total seconds
  // Training queue (mostly for the player)
  trainQueue: UnitKind[];
  trainProgress: number;       // seconds accumulated on head of queue
  // Garrison / dropoff flag (always true for townhall and mill)
  accepts: { gold: boolean; wood: boolean };
  // Combat (towers)
  attackCooldown?: number;
  attackDamage?: { min: number; max: number };
  attackRange?: number;
  attackCooldownMax?: number;
  // Animation
  flashTimer?: number;         // damage flash
  // Resource deposits only used internally for resource gathering drop-off counters
  // None for now.
}

export interface ProjectileEntity {
  id: EntityId;
  kind: 'projectile';
  faction: FactionId;
  pos: Vec2;
  target: EntityId;
  targetKind: 'unit' | 'building';
  damage: number;
  speed: number;       // tiles per second
  ttl: number;         // seconds remaining
}

export type Entity = UnitEntity | BuildingEntity | ProjectileEntity;

// Resource tile entities (gold mines & forests are *tiles* that can be
// "harvested" until depleted). They live in a side-table, not the entity list.
export interface ResourceTile {
  x: number;
  y: number;
  type: 'gold' | 'wood';
  amount: number;     // gold or wood remaining
  // Optional: which entity is currently harvesting (to avoid two workers
  // walking to the same tile from opposite sides)
  reservedBy?: EntityId;
}

// Fog of war: per tile, per faction
export type FogState = 'unexplored' | 'explored' | 'visible';

export interface FactionState {
  faction: FactionId;
  gold: number;
  wood: number;
  // "supply used" / "supply cap"
  supplyUsed: number;
  supplyCap: number;
  // Per-faction fog: flat array (size = map.w * map.h)
  fog: Uint8Array; // 0=unexplored, 1=explored, 2=visible
  // Has this faction been eliminated?
  alive: boolean;
}

export interface MapData {
  width: number;
  height: number;
  tiles: TileId[];        // row-major
  startingSpots: { x: number; y: number }[]; // length 2; [0] is player, [1] is AI
}

export interface World {
  map: MapData;
  units: Map<EntityId, UnitEntity>;
  buildings: Map<EntityId, BuildingEntity>;
  projectiles: Map<EntityId, ProjectileEntity>;
  resources: ResourceTile[]; // by tile coord
  factions: Record<FactionId, FactionState>;
  nextId: EntityId;
  // Time
  time: number;           // seconds since start
  // Campaign
  level: number;          // 0..4
  difficulty: number;     // 1..5
  // Outcome
  gameOver: false | { winner: FactionId };
  // Log of events (small) for debugging & tests
  events: WorldEvent[];
}

export type WorldEvent =
  | { t: number; kind: 'damage'; attacker: EntityId; target: EntityId; amount: number }
  | { t: number; kind: 'death'; entity: EntityId }
  | { t: number; kind: 'build'; entity: EntityId; building: BuildingKind; x: number; y: number }
  | { t: number; kind: 'train'; entity: EntityId; unit: UnitKind; owner: EntityId }
  | { t: number; kind: 'harvest'; worker: EntityId; amount: number; type: 'gold' | 'wood' }
  | { t: number; kind: 'deposit'; building: EntityId; amount: number; type: 'gold' | 'wood' }
  | { t: number; kind: 'attackOrder'; unit: EntityId; target: EntityId };
