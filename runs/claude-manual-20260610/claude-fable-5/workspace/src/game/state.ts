import { Rng } from '../core/rng';
import { GameMap, idx } from '../map/gamemap';
import { isWalkable, Tile } from '../map/tiles';
import { BUILDING_STATS, BuildingType, Faction, UnitType } from './data';

export type UnitOrder =
  | { kind: 'idle' }
  | { kind: 'move'; x: number; y: number }
  | { kind: 'attackMove'; x: number; y: number }
  | { kind: 'attack'; targetId: number }
  | { kind: 'harvestGold'; tile: number } // tile index of the mine
  | { kind: 'harvestWood'; tile: number } // tile index of the forest cell
  | { kind: 'build'; buildingId: number }
  | { kind: 'repair'; buildingId: number };

export interface Unit {
  id: number;
  faction: Faction;
  type: UnitType;
  x: number; // tile coordinates (float, centre of the unit)
  y: number;
  hp: number;
  cooldown: number; // seconds until the next attack is allowed
  order: UnitOrder;
  path: number[] | null; // tile indices to walk through
  pathStep: number;
  /** Auto-acquired combat target while idle/attack-moving. */
  autoTargetId: number | null;
  carrying: { kind: 'gold' | 'wood'; amount: number } | null;
  harvestTimer: number;
  /** Set when a move-group member decides it has arrived; stops shoving. */
  settled: boolean;
  repathCooldown: number;
  stuckTime: number;
  /** Position at the start of the tick; used for crowd-stuck detection. */
  prevX: number;
  prevY: number;
  /** Goal of the move order this unit last settled from (group arrival). */
  lastGoalX: number | null;
  lastGoalY: number | null;
}

export interface TrainItem {
  unit: UnitType;
  remaining: number; // seconds
  total: number;
}

export interface Building {
  id: number;
  faction: Faction;
  type: BuildingType;
  tx: number; // top-left tile
  ty: number;
  hp: number;
  constructed: boolean;
  buildProgress: number; // seconds of work applied
  builderId: number | null;
  trainQueue: TrainItem[];
  cooldown: number; // tower attack cooldown
}

export interface Projectile {
  x: number;
  y: number;
  targetId: number; // unit or building id
  targetIsBuilding: boolean;
  speed: number;
  damage: number; // raw attack damage; armor applied on impact
  faction: Faction;
}

export interface Corpse {
  x: number;
  y: number;
  faction: Faction;
  unitType: UnitType;
  age: number; // seconds
}

export type FogState = 0 | 1 | 2; // unexplored | explored | visible

export interface BuildingMemory {
  type: BuildingType;
  faction: Faction;
  tx: number;
  ty: number;
  w: number;
  h: number;
}

export interface PlayerState {
  faction: Faction;
  gold: number;
  wood: number;
  supplyUsed: number;
  supplyCap: number;
  /** Multiplier applied to deposited resources (AI difficulty bonus). */
  harvestBonus: number;
  fog: Uint8Array; // FogState per tile
  /** Terrain as last seen (so explored areas render stale forests/mines). */
  seenTiles: Uint8Array;
  /** Enemy buildings as last seen, keyed by building id. */
  buildingMemory: Map<number, BuildingMemory>;
}

export type GameResult = 'playing' | 'victory' | 'defeat';

export interface GameState {
  map: GameMap;
  rng: Rng; // simulation randomness (combat jitter, AI choices)
  seed: number;
  level: number;
  difficulty: number;
  tick: number;
  time: number; // simulated seconds
  units: Unit[];
  buildings: Building[];
  projectiles: Projectile[];
  corpses: Corpse[];
  players: [PlayerState, PlayerState]; // index 0 = human player, 1 = AI
  playerFaction: Faction;
  result: GameResult;
  nextId: number;
  /** Static blocking grid: terrain + building footprints. 1 = blocked. */
  blocked: Uint8Array;
}

export const TICK_RATE = 30; // simulation ticks per second
export const TICK_DT = 1 / TICK_RATE;

export function playerIndexOf(state: GameState, faction: Faction): 0 | 1 {
  return state.players[0].faction === faction ? 0 : 1;
}

export function playerOf(state: GameState, faction: Faction): PlayerState {
  return state.players[playerIndexOf(state, faction)];
}

export function rebuildBlockedTile(state: GameState, x: number, y: number): void {
  const i = idx(state.map, x, y);
  const t = state.map.tiles[i] as Tile;
  let b = isWalkable(t) ? 0 : 1;
  if (b === 0) {
    for (const bl of state.buildings) {
      if (x >= bl.tx && x < bl.tx + footprintOf(bl).w && y >= bl.ty && y < bl.ty + footprintOf(bl).h) {
        b = 1;
        break;
      }
    }
  }
  state.blocked[i] = b;
}

export function footprintOf(b: Building): { w: number; h: number } {
  const s = BUILDING_STATS[b.type];
  return { w: s.width, h: s.height };
}

export function buildBlockedGrid(state: GameState): void {
  const { map } = state;
  for (let i = 0; i < map.tiles.length; i++) {
    state.blocked[i] = isWalkable(map.tiles[i] as Tile) ? 0 : 1;
  }
  for (const b of state.buildings) {
    const { w, h } = footprintOf(b);
    for (let y = b.ty; y < b.ty + h; y++) {
      for (let x = b.tx; x < b.tx + w; x++) {
        state.blocked[idx(map, x, y)] = 1;
      }
    }
  }
}

export function findUnit(state: GameState, id: number): Unit | undefined {
  return state.units.find((u) => u.id === id);
}

export function findBuilding(state: GameState, id: number): Building | undefined {
  return state.buildings.find((b) => b.id === id);
}

export function buildingCenter(b: Building): { x: number; y: number } {
  const { w, h } = footprintOf(b);
  return { x: b.tx + w / 2, y: b.ty + h / 2 };
}

/** Distance from a point to the closest edge of a building footprint. */
export function distToBuilding(b: Building, x: number, y: number): number {
  const { w, h } = footprintOf(b);
  const cx = Math.min(Math.max(x, b.tx), b.tx + w);
  const cy = Math.min(Math.max(y, b.ty), b.ty + h);
  return Math.hypot(x - cx, y - cy);
}
