// World: the simulation state container. Holds the map, entities, fog,
// faction resources, the simulation tick, and the order queue. The world is
// the only thing tests construct and step.

import { Rng } from "./rng.js";
import { GameMap } from "./map.js";
import { BuildingEntity, Entity, ProjectileEntity, UnitEntity } from "./entities.js";
import { Faction, FactionData, FACTIONS, BuildingKind, UnitKind, getBuildingStats, getUnitStats, SIM_CONSTANTS } from "./stats.js";
import { newOrderState, Order } from "./orders.js";
import { FogGrid } from "./fog.js";

export interface FactionState {
  readonly faction: Faction;
  gold: number;
  wood: number;
  supplyUsed: number;
  supplyCap: number;
  /** Killed entity count for stats. */
  kills: number;
  unitsLost: number;
  buildingsLost: number;
  /** Current construction job (worker placing a building). */
  pendingBuilds: Array<{ building: BuildingKind; x: number; y: number; workerId: number }>;
  /** AI tick counter (set per-faction so AI ticks are independent). */
  aiTimer: number;
  /** Per-faction AI build order. */
  aiBuildOrder: BuildingKind[];
  /** Wave cadence for AI attacks. */
  waveTimer: number;
  wavesLaunched: number;
  /** Difficulty for this side. */
  difficulty: number;
}

export class World {
  public readonly map: GameMap;
  public readonly fog: FogGrid;
  public readonly entities: Map<number, Entity> = new Map();
  public readonly players: Record<Faction, FactionState>;
  public tick = 0;
  public speed: 1 | 2 = 1;
  public paused = false;
  public nextId = 1;
  public rng: Rng;
  public outcome: "playing" | "victory" | "defeat" = "playing";
  /** Set to "victory" or "defeat" on outcome. */
  public winner: Faction | null = null;
  /** Active "selection" — for input tests. */
  public playerSelection: Set<number> = new Set();
  /** Control groups: 0..9 → set of entity ids. */
  public controlGroups: Map<number, Set<number>> = new Map();
  /** Pending right-click order (queued for input tests). */
  public pendingOrders: Array<{ ids: number[]; order: Order }> = [];

  constructor(map: GameMap, rng: Rng) {
    this.map = map;
    this.fog = new FogGrid(map);
    this.rng = rng;
    this.players = {
      humans: this.makeFactionState("humans"),
      orcs: this.makeFactionState("orcs"),
    };
  }

  private makeFactionState(faction: Faction): FactionState {
    return {
      faction,
      gold: SIM_CONSTANTS.startGold,
      wood: SIM_CONSTANTS.startWood,
      supplyUsed: 0,
      supplyCap: 0,
      kills: 0,
      unitsLost: 0,
      buildingsLost: 0,
      pendingBuilds: [],
      aiTimer: 0,
      aiBuildOrder: [],
      waveTimer: 0,
      wavesLaunched: 0,
      difficulty: 1,
    };
  }

  newId(): number {
    return this.nextId++;
  }

  factionData(f: Faction): FactionData {
    return FACTIONS[f];
  }

  unitEntities(): UnitEntity[] {
    const out: UnitEntity[] = [];
    for (const e of this.entities.values()) {
      if (e.kind === "unit") out.push(e);
    }
    return out;
  }

  buildingEntities(): BuildingEntity[] {
    const out: BuildingEntity[] = [];
    for (const e of this.entities.values()) {
      if (e.kind === "building") out.push(e);
    }
    return out;
  }

  projectileEntities(): ProjectileEntity[] {
    const out: ProjectileEntity[] = [];
    for (const e of this.entities.values()) {
      if (e.kind === "projectile") out.push(e);
    }
    return out;
  }

  unitsOf(f: Faction): UnitEntity[] {
    return this.unitEntities().filter((u) => u.faction === f);
  }

  buildingsOf(f: Faction): BuildingEntity[] {
    return this.buildingEntities().filter((b) => b.faction === f);
  }

  /** Recompute supply cap from completed townhalls & farms. */
  recomputeSupplyCap(f: Faction): void {
    const player = this.players[f];
    let cap = 0;
    for (const b of this.buildingsOf(f)) {
      if (b.construction < 1) continue;
      const stats = getBuildingStats(f, b.buildingKind);
      if (stats.supply) cap += stats.supply;
    }
    player.supplyCap = cap;
  }

  spawnUnit(f: Faction, kind: UnitKind, tileX: number, tileY: number): UnitEntity {
    const stats = getUnitStats(f, kind);
    const id = this.newId();
    const e: UnitEntity = {
      id,
      kind: "unit",
      faction: f,
      unitKind: kind,
      x: tileX,
      y: tileY,
      subX: 0.5,
      subY: 0.5,
      hp: stats.hp,
      orderState: newOrderState(),
      target: null,
      moveGoal: null,
      damageDealt: 0,
      corpseTimer: 0,
    };
    this.entities.set(id, e);
    return e;
  }

  spawnBuilding(
    f: Faction,
    kind: BuildingKind,
    tileX: number,
    tileY: number,
    construction = 1,
    builtBy: number | null = null,
  ): BuildingEntity {
    const stats = getBuildingStats(f, kind);
    const id = this.newId();
    const e: BuildingEntity = {
      id,
      kind: "building",
      faction: f,
      buildingKind: kind,
      x: tileX,
      y: tileY,
      hp: stats.hp,
      maxHp: stats.hp,
      construction,
      trainQueue: [],
      builtBy,
      corpseTimer: 0,
    };
    this.entities.set(id, e);
    return e;
  }

  spawnProjectile(
    f: Faction,
    source: number,
    target: number,
    x: number,
    y: number,
    speed: number,
    damage: number,
  ): ProjectileEntity {
    const id = this.newId();
    const p: ProjectileEntity = {
      id,
      kind: "projectile",
      faction: f,
      source,
      target,
      x,
      y,
      speed,
      damage,
      hit: false,
    };
    this.entities.set(id, p);
    return p;
  }

  removeEntity(id: number): void {
    this.entities.delete(id);
  }

  /** Public: serialize the deterministic parts of world state for testing. */
  serialize(): string {
    const out: Array<string> = [];
    out.push(`tick=${this.tick}`);
    out.push(`map=${this.map.width}x${this.map.height}`);
    out.push(`tiles=${this.map.tiles.join(",")}`);
    out.push(`gold_h=${this.players.humans.gold}`);
    out.push(`gold_o=${this.players.orcs.gold}`);
    out.push(`wood_h=${this.players.humans.wood}`);
    out.push(`wood_o=${this.players.orcs.wood}`);
    out.push(`sup_h=${this.players.humans.supplyUsed}/${this.players.humans.supplyCap}`);
    out.push(`sup_o=${this.players.orcs.supplyUsed}/${this.players.orcs.supplyCap}`);
    const ids = Array.from(this.entities.keys()).sort((a, b) => a - b);
    for (const id of ids) {
      const e = this.entities.get(id) as Entity;
      if (e.kind === "unit") {
        out.push(
          `u${id}:${e.faction}:${e.unitKind}:${e.x},${e.y}:${e.hp}:${e.orderState.phase}:${e.orderState.cargo.gold}:${e.orderState.cargo.wood}:${e.subX.toFixed(3)},${e.subY.toFixed(3)}`,
        );
      } else if (e.kind === "building") {
        out.push(
          `b${id}:${e.faction}:${e.buildingKind}:${e.x},${e.y}:${e.hp}:${e.construction.toFixed(3)}`,
        );
      } else {
        out.push(
          `p${id}:${e.faction}:${e.source}->${e.target}:${e.x.toFixed(2)},${e.y.toFixed(2)}`,
        );
      }
    }
    return out.join("\n");
  }
}
