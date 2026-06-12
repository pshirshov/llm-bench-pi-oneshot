/** World state: the core simulation. No DOM imports. */

import type { Unit, Building, Projectile, Faction, TileCoord, Vec2, Order, EntityId, BuildingType, UnitType } from "./types";
import { UNIT_STATS, BUILDING_STATS, STARTING_WORKERS, STARTING_GOLD, STARTING_WOOD } from "./stats";
import { FOG_VISIBLE } from "./constants";
import { GameMap } from "./map";
import { createPRNG, type PRNG } from "./prng";
import { generateMap } from "./wfc";
import { SpatialHash } from "./spatial";
import { FogOfWar } from "./fog";
import { createUnit, createBuilding } from "./entity";
import { processUnitOrder } from "./orders";
import { processTraining, validatePlacement, calculateSupply } from "./production";
import { createAI, aiTick } from "./ai";
import { dist } from "./helpers";

export interface Resources {
  gold: number;
  wood: number;
}

export class World {
  readonly map: GameMap;
  readonly units: Unit[] = [];
  readonly buildings: Building[] = [];
  readonly projectiles: Projectile[] = [];
  readonly fog: FogOfWar;
  readonly spatial: SpatialHash;

  private resources: Map<Faction, Resources> = new Map();
  private aiStates: Map<Faction, ReturnType<typeof createAI>> = new Map();
  readonly prng: PRNG;
  readonly playerFaction: Faction;
  readonly enemyFaction: Faction;
  readonly level: number;
  readonly difficulty: number;
  readonly starts: TileCoord[];
  tick: number = 0;
  gameOver: boolean = false;
  winner: Faction | null = null;
  speed: number = 1;

  constructor(seed: number, level: number, playerFaction: Faction) {
    this.prng = createPRNG(seed);
    this.playerFaction = playerFaction;
    this.enemyFaction = playerFaction === "human" ? "orc" : "human";
    this.level = level;
    this.difficulty = level;

    const LEVEL_SIZES: [number, number][] = [[32,32],[48,48],[64,64],[80,80],[96,96]];
    const [w, h] = LEVEL_SIZES[Math.min(level - 1, 4)];

    const { map, starts } = generateMap(w, h, seed);
    this.map = map;
    this.starts = starts;
    this.fog = new FogOfWar(w, h);
    this.spatial = new SpatialHash(w, h);

    // Initialize resources
    for (const f of ["human", "orc"] as Faction[]) {
      this.resources.set(f, { gold: STARTING_GOLD, wood: STARTING_WOOD });
      this.aiStates.set(f, createAI(f, this.difficulty));
    }

    // Place starting buildings and workers
    for (let i = 0; i < starts.length; i++) {
      const faction: Faction = i === 0 ? "human" : "orc";
      const s = starts[i];
      const th = createBuilding("town_hall", faction, s.col - 1, s.row - 1, true);
      this.buildings.push(th);
      for (let j = 0; j < STARTING_WORKERS; j++) {
        const angle = (j / STARTING_WORKERS) * Math.PI * 2;
        const wx = s.col + 0.5 + Math.cos(angle) * 1.5;
        const wy = s.row + 0.5 + Math.sin(angle) * 1.5;
        const worker = createUnit("worker", faction, wx, wy);
        this.units.push(worker);
      }
    }

    // Register gold mines from map
    // (Already done during generation)

    this.updateFog();
  }

  getResources(faction: Faction): Resources {
    return this.resources.get(faction) ?? { gold: 0, wood: 0 };
  }

  getSupply(faction: Faction): { used: number; cap: number } {
    return calculateSupply(this.units, this.buildings, faction);
  }

  getUnits(faction: Faction): Unit[] {
    return this.units.filter(u => u.faction === faction && u.hp > 0);
  }

  getBuildings(faction: Faction): Building[] {
    return this.buildings.filter(b => b.faction === faction);
  }

  getVisibleEnemies(faction: Faction, center: Vec2, radius: number): Unit[] {
    const enemyFaction = faction === "human" ? "orc" : "human";
    return this.units.filter(u =>
      u.faction === enemyFaction && u.hp > 0 &&
      this.fog.getTile(faction, Math.floor(u.x), Math.floor(u.y)) === FOG_VISIBLE &&
      dist(u.x, u.y, center.x, center.y) <= radius
    );
  }

  findNearestResource(unit: Unit, type: "gold_mine" | "forest"): EntityId | null {
    const sight = 30;
    let best: EntityId | null = null;
    let bestDist = Infinity;
    for (let dr = -sight; dr <= sight; dr++) {
      for (let dc = -sight; dc <= sight; dc++) {
        const c = Math.floor(unit.x) + dc;
        const r = Math.floor(unit.y) + dr;
        if (!this.map.inBounds(c, r)) continue;
        const tile = this.map.getTile(c, r);
        if (type === "gold_mine" && tile === "gold_mine") {
          const d = dist(unit.x, unit.y, c + 0.5, r + 0.5);
          if (d < bestDist) {
            bestDist = d;
            // Find mine ID
            for (const mine of this.map.goldMines.values()) {
              if (mine.col === c && mine.row === r) { best = mine.id; break; }
            }
          }
        } else if (type === "forest" && tile === "forest") {
          const d = dist(unit.x, unit.y, c + 0.5, r + 0.5);
          if (d < bestDist) {
            bestDist = d;
            best = c + r * 10000; // Encode tile position
          }
        }
      }
    }
    return best;
  }

  canPlaceBuilding(type: BuildingType, col: number, row: number): boolean {
    return validatePlacement(type, col, row, this.map, this.buildings, this.units);
  }

  issueOrder(unitId: EntityId, order: Order): void {
    const unit = this.units.find(u => u.id === unitId);
    if (!unit || unit.hp <= 0) return;
    unit.order = order;
    unit.path = [];
    unit.pathIndex = 0;
    unit.repathAttempts = 0;
    if (order.type === "harvest") {
      unit.harvestPhase = "moving_to_source";
      unit.harvestTarget = order.targetId ?? null;
      unit.harvestGatherTimer = 0;
    }
  }

  trainUnit(buildingId: EntityId, unitType: UnitType): boolean {
    const building = this.buildings.find(b => b.id === buildingId);
    if (!building || !building.isComplete || building.hp <= 0) return false;
    const faction = building.faction;
    const res = this.getResources(faction);
    const supply = this.getSupply(faction);
    const stats = UNIT_STATS[unitType];
    if (res.gold < stats.goldCost || res.wood < stats.woodCost) return false;
    if (supply.used + stats.supplyCost > supply.cap) return false;

    // Check building can train this unit type
    if (building.type === "town_hall" && unitType !== "worker") return false;
    if (building.type === "barracks" && unitType === "worker") return false;

    // Check tech prerequisites
    if (unitType === "ranged" || unitType === "heavy") {
      const hasLumberMill = this.buildings.some(
        b => b.faction === faction && b.type === "lumber_mill" && b.isComplete && b.hp > 0
      );
      if (!hasLumberMill) return false;
    }
    if (unitType === "heavy") {
      const hasBarracks = this.buildings.some(
        b => b.faction === faction && b.type === "barracks" && b.isComplete && b.hp > 0
      );
      if (!hasBarracks) return false;
    }

    res.gold -= stats.goldCost;
    res.wood -= stats.woodCost;
    res.gold = Math.max(0, res.gold);
    res.wood = Math.max(0, res.wood);
    building.trainingQueue.push({ unitType, progress: 0 });
    return true;
  }

  buildBuilding(unitId: EntityId, type: BuildingType, location: TileCoord): boolean {
    const unit = this.units.find(u => u.id === unitId);
    if (!unit || unit.type !== "worker" || unit.hp <= 0) return false;
    const faction = unit.faction;
    const res = this.getResources(faction);
    const bStats = BUILDING_STATS[type];
    if (res.gold < bStats.goldCost || res.wood < bStats.woodCost) return false;
    if (!this.canPlaceBuilding(type, location.col, location.row)) return false;

    res.gold -= bStats.goldCost;
    res.wood -= bStats.woodCost;
    res.gold = Math.max(0, res.gold);
    res.wood = Math.max(0, res.wood);
    const building = createBuilding(type, faction, location.col, location.row, false);
    building.hp = 1;
    this.buildings.push(building);
    unit.order = { type: "build", buildingType: type, buildLocation: location, targetId: building.id };
    return true;
  }

  /** Main simulation step. Call TICK_RATE times per second. */
  step(): void {
    if (this.gameOver) return;

    // Rebuild spatial hash
    this.spatial.clear();
    for (const u of this.units) {
      if (u.hp > 0) this.spatial.insert(u);
    }

    // Process unit orders
    for (const unit of this.units) {
      if (unit.hp <= 0) continue;
      const faction = unit.faction;
      const res = this.getResources(faction);
      processUnitOrder(unit, this.map, this.units, this.buildings, this.map.goldMines, res, this.spatial);
    }

    // Process building training
    for (const faction of ["human", "orc"] as Faction[]) {
      const res = this.getResources(faction);
      const supply = this.getSupply(faction);
      const newUnits = processTraining(this.buildings, faction, res, supply.used, supply.cap, this.map, this.units);
      for (const u of newUnits) this.units.push(u);
    }

    // Process projectiles
    this.stepProjectiles();

    // Remove dead units
    for (let i = this.units.length - 1; i >= 0; i--) {
      if (this.units[i].hp <= 0) this.units.splice(i, 1);
    }

    // Remove dead buildings
    for (let i = this.buildings.length - 1; i >= 0; i--) {
      if (this.buildings[i].hp <= 0) this.buildings.splice(i, 1);
    }

    // AI ticks
    for (const faction of ["human", "orc"] as Faction[]) {
      const ai = this.aiStates.get(faction);
      if (ai) aiTick(ai, this, this.prng);
    }

    // Update fog of war
    this.updateFog();

    // Check win/lose
    this.checkWinLose();

    // Clamp resources (I2: bookkeeping sanity)
    for (const f of ["human", "orc"] as Faction[]) {
      const res = this.getResources(f);
      res.gold = Math.max(0, res.gold);
      res.wood = Math.max(0, res.wood);
    }

    this.tick++;
  }

  private stepProjectiles(): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const target = this.units.find(u => u.id === p.targetId);
      if (!target || target.hp <= 0) {
        this.projectiles.splice(i, 1);
        continue;
      }
      const dx = target.x - p.x;
      const dy = target.y - p.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < p.speed) {
        // Hit
        target.hp -= p.damage;
        this.projectiles.splice(i, 1);
      } else {
        p.x += (dx / d) * p.speed;
        p.y += (dy / d) * p.speed;
      }
    }
  }

  private updateFog(): void {
    for (const faction of ["human", "orc"] as Faction[]) {
      const sightPositions: { x: number; y: number; sight: number }[] = [];
      for (const u of this.units) {
        if (u.faction === faction && u.hp > 0) {
          sightPositions.push({ x: u.x, y: u.y, sight: UNIT_STATS[u.type].sight });
        }
      }
      for (const b of this.buildings) {
        if (b.faction === faction && b.isComplete && b.hp > 0) {
          const bs = BUILDING_STATS[b.type];
          if (bs.sight > 0) {
            sightPositions.push({ x: b.col + bs.width / 2, y: b.row + bs.height / 2, sight: bs.sight });
          }
        }
      }
      this.fog.update(faction, sightPositions);
    }
  }

  private checkWinLose(): void {
    for (const faction of ["human", "orc"] as Faction[]) {
      const buildings = this.buildings.filter(b => b.faction === faction && b.hp > 0);
      if (buildings.length === 0) {
        this.gameOver = true;
        this.winner = faction === "human" ? "orc" : "human";
        return;
      }
    }
  }

  /** Serialize world state for determinism tests. */
  serialize(): string {
    const units = this.units.map(u => `${u.id}:${u.type}:${u.faction}:${u.x.toFixed(2)},${u.y.toFixed(2)}:${u.hp}:${u.order.type}`).join(";");
    const buildings = this.buildings.map(b => `${b.id}:${b.type}:${b.faction}:${b.col},${b.row}:${b.hp}:${b.isComplete ? 1 : 0}`).join(";");
    const res = ["human", "orc"].map(f => {
      const r = this.getResources(f as Faction);
      return `${f}:${r.gold},${r.wood}`;
    }).join(";");
    return `${this.tick}|${units}|${buildings}|${res}`;
  }
}