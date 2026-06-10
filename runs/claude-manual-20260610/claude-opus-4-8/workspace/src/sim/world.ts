import { Rng } from "../core/rng.js";
import { dist2, type TileCoord, type Vec2 } from "../core/vec.js";
import { MAX_SUPPLY } from "./config.js";
import {
  type Building,
  buildingCenter,
  buildingTiles,
  createBuilding,
  type Corpse,
  distanceToBuilding,
  type Entity,
  type Projectile,
  type ResourceKind,
  type Unit,
} from "./entity.js";
import { FogMap } from "./fog.js";
import { GameMap } from "./gamemap.js";
import { SpatialHash } from "./spatial.js";
import {
  BUILDING_STATS,
  type BuildingRole,
  enemyOf,
  Faction,
  UNIT_STATS,
  type UnitRole,
} from "./stats.js";

export interface FactionState {
  readonly faction: Faction;
  gold: number;
  wood: number;
  supplyUsed: number;
  supplyCap: number;
  /** Multiplier applied to harvested amounts (AI difficulty bonus). */
  harvestMultiplier: number;
}

export type GameStatus = "playing" | "won" | "lost";

/**
 * Holds the entire mutable simulation state. Owns entity registration,
 * resources and supply accounting; the step logic lives in simulation.ts.
 */
export class World {
  readonly map: GameMap;
  readonly rng: Rng;
  readonly playerFaction: Faction;
  readonly aiFaction: Faction;
  readonly fog: FogMap;
  readonly spatial: SpatialHash;

  readonly units = new Map<number, Unit>();
  readonly buildings = new Map<number, Building>();
  projectiles: Projectile[] = [];
  corpses: Corpse[] = [];

  readonly factions: Record<Faction, FactionState>;

  tick = 0;
  time = 0; // seconds of simulated game time
  status: GameStatus = "playing";
  aiDifficulty = 1;
  /** Scripted opponent controller; structural type avoids an import cycle. */
  ai: { update(world: World, dt: number): void } | null = null;
  /** True once the player's whole base has at some point existed (guards instant-loss before setup). */
  private started = false;

  constructor(map: GameMap, playerFaction: Faction, simSeed: number) {
    this.map = map;
    this.playerFaction = playerFaction;
    this.aiFaction = enemyOf(playerFaction);
    this.rng = new Rng(simSeed);
    this.fog = new FogMap(map.width, map.height);
    this.spatial = new SpatialHash(map.width, map.height, 4);
    this.factions = {
      [Faction.Human]: {
        faction: Faction.Human,
        gold: 0,
        wood: 0,
        supplyUsed: 0,
        supplyCap: 0,
        harvestMultiplier: 1,
      },
      [Faction.Orc]: {
        faction: Faction.Orc,
        gold: 0,
        wood: 0,
        supplyUsed: 0,
        supplyCap: 0,
        harvestMultiplier: 1,
      },
    };
  }

  getEntity(id: number): Entity | undefined {
    return this.units.get(id) ?? this.buildings.get(id);
  }

  addUnit(u: Unit): void {
    this.units.set(u.id, u);
  }

  /** Register a building and reserve its footprint tiles. */
  addBuilding(b: Building): void {
    this.buildings.set(b.id, b);
    this.map.occupy(b.origin.tx, b.origin.ty, b.footprint.w, b.footprint.h, b.id);
  }

  removeUnit(id: number): void {
    this.units.delete(id);
  }

  removeBuilding(id: number): void {
    const b = this.buildings.get(id);
    if (!b) return;
    this.map.free(b.origin.tx, b.origin.ty, b.footprint.w, b.footprint.h);
    this.buildings.delete(id);
  }

  markStarted(): void {
    this.started = true;
  }

  hasStarted(): boolean {
    return this.started;
  }

  /** Recompute supply used/cap for both factions from live entities + training queues. */
  recomputeSupply(): void {
    const used: Record<Faction, number> = { [Faction.Human]: 0, [Faction.Orc]: 0 };
    const cap: Record<Faction, number> = { [Faction.Human]: 0, [Faction.Orc]: 0 };
    for (const u of this.units.values()) {
      used[u.faction] += UNIT_STATS[u.role].supplyCost;
    }
    for (const b of this.buildings.values()) {
      if (b.constructed) cap[b.faction] += BUILDING_STATS[b.role].supplyProvided;
      // Reserve supply for queued/in-training units.
      for (const role of b.trainingQueue) used[b.faction] += UNIT_STATS[role].supplyCost;
    }
    for (const f of [Faction.Human, Faction.Orc]) {
      this.factions[f].supplyUsed = used[f];
      this.factions[f].supplyCap = Math.min(MAX_SUPPLY, cap[f]);
    }
  }

  /** Whether `faction` can afford and has supply headroom to train `role`. */
  canTrain(faction: Faction, role: UnitRole): { ok: boolean; reason?: string } {
    const stats = UNIT_STATS[role];
    const fs = this.factions[faction];
    if (fs.gold < stats.goldCost) return { ok: false, reason: "Not enough gold" };
    if (fs.wood < stats.woodCost) return { ok: false, reason: "Not enough wood" };
    if (fs.supplyUsed + stats.supplyCost > fs.supplyCap) {
      return { ok: false, reason: "Not enough supply" };
    }
    return { ok: true };
  }

  canAfford(faction: Faction, role: BuildingRole): boolean {
    const stats = BUILDING_STATS[role];
    const fs = this.factions[faction];
    return fs.gold >= stats.goldCost && fs.wood >= stats.woodCost;
  }

  /** Completed buildings of a faction, by role. */
  hasBuilding(faction: Faction, role: BuildingRole): boolean {
    for (const b of this.buildings.values()) {
      if (b.faction === faction && b.role === role && b.constructed) return true;
    }
    return false;
  }

  countBuildings(faction: Faction, role: BuildingRole): number {
    let n = 0;
    for (const b of this.buildings.values()) {
      if (b.faction === faction && b.role === role) n++;
    }
    return n;
  }

  livingBuildings(faction: Faction): number {
    let n = 0;
    for (const b of this.buildings.values()) if (b.faction === faction) n++;
    return n;
  }

  /** Nearest constructed drop-off building for a resource kind. */
  findDropoff(faction: Faction, resource: ResourceKind, near: Vec2): Building | null {
    let best: Building | null = null;
    let bestD = Infinity;
    for (const b of this.buildings.values()) {
      if (b.faction !== faction || !b.constructed) continue;
      const stats = BUILDING_STATS[b.role];
      const accepts = resource === "gold" ? stats.isGoldDropoff : stats.isWoodDropoff;
      if (!accepts) continue;
      const d = distanceToBuilding(b, near);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  /** Nearest hostile entity (unit or building) to `pos` within `range` tiles, using the spatial hash for units. */
  findNearestEnemy(faction: Faction, pos: Vec2, range: number): Entity | null {
    const foe = enemyOf(faction);
    let best: Entity | null = null;
    let bestD = range * range;
    const candidates: number[] = [];
    this.spatial.queryCircle(pos, range, candidates);
    for (const id of candidates) {
      const u = this.units.get(id);
      if (!u || u.faction !== foe) continue;
      const d = dist2(pos, u.pos);
      if (d < bestD) {
        bestD = d;
        best = u;
      }
    }
    // Buildings are few; scan directly using edge distance.
    for (const b of this.buildings.values()) {
      if (b.faction !== foe) continue;
      const d = distanceToBuilding(b, pos);
      if (d * d < bestD) {
        bestD = d * d;
        best = b;
      }
    }
    return best;
  }

  /** Find a forest tile with wood within `radius` of `from`, nearest first. */
  findForestNear(from: Vec2, radius: number): TileCoord | null {
    const cx = Math.floor(from.x);
    const cy = Math.floor(from.y);
    let best: TileCoord | null = null;
    let bestD = Infinity;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (!this.map.isForest(x, y) || this.map.woodAt(x, y) <= 0) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = { tx: x, ty: y };
        }
      }
    }
    return best;
  }

  findGoldMineNear(from: Vec2, radius: number): TileCoord | null {
    const cx = Math.floor(from.x);
    const cy = Math.floor(from.y);
    let best: TileCoord | null = null;
    let bestD = Infinity;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (!this.map.isGoldMine(x, y) || this.map.goldAt(x, y) <= 0) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = { tx: x, ty: y };
        }
      }
    }
    return best;
  }

  /** Centre of a faction's first town hall (used as a home reference for AI/harvest). */
  baseCenter(faction: Faction): Vec2 | null {
    for (const b of this.buildings.values()) {
      if (b.faction === faction && b.role === ("townhall" as BuildingRole)) {
        return buildingCenter(b);
      }
    }
    // Fallback: any building.
    for (const b of this.buildings.values()) {
      if (b.faction === faction) return buildingCenter(b);
    }
    return null;
  }

  /** Convenience: create + register a building. */
  spawnBuilding(faction: Faction, role: BuildingRole, origin: TileCoord, constructed: boolean): Building {
    const b = createBuilding(faction, role, origin, constructed);
    this.addBuilding(b);
    return b;
  }

  /** All tiles occupied by a building (for fog / rendering helpers). */
  static tilesOf(b: Building): TileCoord[] {
    return buildingTiles(b);
  }
}
