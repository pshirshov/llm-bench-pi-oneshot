import type { TileCoord, Vec2 } from "../core/vec.js";
import {
  BUILDING_STATS,
  BuildingRole,
  Faction,
  UNIT_STATS,
  UnitRole,
} from "./stats.js";

export type ResourceKind = "gold" | "wood";

export type HarvestPhase = "toResource" | "working" | "toDropoff";

/** Context-sensitive order issued to a unit. */
export type Command =
  | { type: "idle" }
  | { type: "move"; target: Vec2 }
  | { type: "attackMove"; target: Vec2 }
  | { type: "attack"; targetId: number }
  | { type: "harvest"; tile: TileCoord; resource: ResourceKind }
  | { type: "build"; targetId: number }
  | { type: "repair"; targetId: number };

export interface Unit {
  readonly kind: "unit";
  readonly id: number;
  readonly faction: Faction;
  readonly role: UnitRole;
  pos: Vec2;
  hp: number;
  maxHp: number;
  command: Command;

  // Movement state.
  path: TileCoord[];
  waypointIndex: number;
  pathGoal: TileCoord | null;
  repathCooldown: number;
  stuckTimer: number;
  vx: number;
  vy: number;
  facing: number;

  // Combat.
  attackCdRemaining: number;
  /** Anchor point for leashed auto-acquisition while idle/guarding. */
  guardPos: Vec2 | null;

  // Harvesting.
  carrying: { kind: ResourceKind; amount: number } | null;
  workTimer: number;
  harvestPhase: HarvestPhase;
  /** Remembered resource/dropoff for the harvest loop. */
  homeDropoffId: number | null;

  selected: boolean;
}

export interface Building {
  readonly kind: "building";
  readonly id: number;
  readonly faction: Faction;
  readonly role: BuildingRole;
  readonly origin: TileCoord;
  readonly footprint: { w: number; h: number };
  hp: number;
  maxHp: number;
  constructed: boolean;
  /** 0..1 construction progress. */
  buildProgress: number;
  /** Whether a worker is actively building/repairing this tick. */
  workerPresent: boolean;

  trainingQueue: UnitRole[];
  trainTimer: number;
  rally: Vec2 | null;
  attackCdRemaining: number;

  selected: boolean;
}

export type Entity = Unit | Building;

export interface Projectile {
  readonly id: number;
  readonly faction: Faction;
  pos: Vec2;
  targetId: number;
  damage: number;
  speed: number;
  /** Last known target position, used if the target dies in flight. */
  destination: Vec2;
}

export interface Corpse {
  pos: Vec2;
  faction: Faction;
  role: UnitRole;
  fade: number;
  maxFade: number;
}

export const CORPSE_FADE_SECONDS = 3;

let nextId = 1;
export function allocId(): number {
  return nextId++;
}
/** Reset id allocation — used when starting a fresh game so runs are reproducible. */
export function resetIds(): void {
  nextId = 1;
}

export function createUnit(
  faction: Faction,
  role: UnitRole,
  pos: Vec2,
): Unit {
  const stats = UNIT_STATS[role];
  return {
    kind: "unit",
    id: allocId(),
    faction,
    role,
    pos: { x: pos.x, y: pos.y },
    hp: stats.hp,
    maxHp: stats.hp,
    command: { type: "idle" },
    path: [],
    waypointIndex: 0,
    pathGoal: null,
    repathCooldown: 0,
    stuckTimer: 0,
    vx: 0,
    vy: 0,
    facing: 0,
    attackCdRemaining: 0,
    guardPos: null,
    carrying: null,
    workTimer: 0,
    harvestPhase: "toResource",
    homeDropoffId: null,
    selected: false,
  };
}

export function createBuilding(
  faction: Faction,
  role: BuildingRole,
  origin: TileCoord,
  constructed: boolean,
): Building {
  const stats = BUILDING_STATS[role];
  return {
    kind: "building",
    id: allocId(),
    faction,
    role,
    origin: { tx: origin.tx, ty: origin.ty },
    footprint: { w: stats.footprint.w, h: stats.footprint.h },
    hp: constructed ? stats.hp : Math.max(1, Math.floor(stats.hp * 0.1)),
    maxHp: stats.hp,
    constructed,
    buildProgress: constructed ? 1 : 0,
    workerPresent: false,
    trainingQueue: [],
    trainTimer: 0,
    rally: null,
    attackCdRemaining: 0,
    selected: false,
  };
}

export function buildingCenter(b: Building): Vec2 {
  return {
    x: b.origin.tx + b.footprint.w / 2,
    y: b.origin.ty + b.footprint.h / 2,
  };
}

/** Tiles occupied by a building footprint. */
export function buildingTiles(b: Building): TileCoord[] {
  const tiles: TileCoord[] = [];
  for (let dy = 0; dy < b.footprint.h; dy++) {
    for (let dx = 0; dx < b.footprint.w; dx++) {
      tiles.push({ tx: b.origin.tx + dx, ty: b.origin.ty + dy });
    }
  }
  return tiles;
}

/** Distance from a point to the nearest edge of a building footprint (tiles). */
export function distanceToBuilding(b: Building, p: Vec2): number {
  const minX = b.origin.tx;
  const maxX = b.origin.tx + b.footprint.w;
  const minY = b.origin.ty;
  const maxY = b.origin.ty + b.footprint.h;
  const dx = Math.max(minX - p.x, 0, p.x - maxX);
  const dy = Math.max(minY - p.y, 0, p.y - maxY);
  return Math.hypot(dx, dy);
}
