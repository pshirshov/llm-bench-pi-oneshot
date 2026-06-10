import type { TileCoord, Vec2 } from "../core/vec.js";
import { dist } from "../core/vec.js";
import {
  canBuildBuilding,
  enqueueTrain,
} from "./behaviors.js";
import { type Building, buildingCenter, createBuilding, type Unit } from "./entity.js";
import { orderAttackMove, orderBuild, orderHarvest } from "./orders.js";
import {
  BUILDING_STATS,
  BuildingRole,
  type Faction,
  UnitRole,
} from "./stats.js";
import type { World } from "./world.js";

const THINK_INTERVAL = 0.5; // seconds between AI decision passes

/**
 * Scripted-strategy opponent. Maintains worker saturation, follows a supply-aware
 * build order, trains a mixed army continuously, sends escalating attack waves,
 * defends its base, and rebuilds lost structures. Difficulty (1-5) scales the
 * starting economy (applied at setup), wave size and wave cadence.
 */
export class AiController {
  private readonly faction: Faction;
  private readonly difficulty: number;
  private thinkAccum = 0;
  private waveTimer: number;
  private waveNumber = 0;
  private readonly workerTarget: number;

  constructor(faction: Faction, difficulty: number) {
    this.faction = faction;
    this.difficulty = Math.max(1, Math.min(5, difficulty));
    // First wave ~4 minutes at difficulty 1, sooner at higher difficulty.
    this.waveTimer = Math.max(70, 240 - (this.difficulty - 1) * 42);
    this.workerTarget = 6 + this.difficulty;
  }

  update(world: World, dt: number): void {
    this.waveTimer -= dt;
    this.thinkAccum += dt;
    if (this.thinkAccum < THINK_INTERVAL) return;
    const step = this.thinkAccum;
    this.thinkAccum = 0;

    const base = world.baseCenter(this.faction);
    if (!base) return; // no buildings; nothing to do (effectively defeated)

    this.manageEconomy(world, base);
    this.manageConstruction(world);
    this.manageBuildOrder(world);
    this.manageArmy(world);
    this.manageDefenseAndWaves(world, base, step);
  }

  /** Ensure every unfinished structure has a worker building it (re-dispatch after a worker gives up or dies). */
  private manageConstruction(world: World): void {
    for (const b of this.myBuildings(world)) {
      if (b.constructed) continue;
      let hasBuilder = false;
      for (const u of world.units.values()) {
        if (u.faction === this.faction && u.command.type === "build" && u.command.targetId === b.id) {
          hasBuilder = true;
          break;
        }
      }
      if (!hasBuilder) {
        const w = this.pickBuilder(world, buildingCenter(b));
        if (w) orderBuild(world, w, b.id);
      }
    }
  }

  private myUnits(world: World): Unit[] {
    const out: Unit[] = [];
    for (const u of world.units.values()) if (u.faction === this.faction) out.push(u);
    return out;
  }

  private myBuildings(world: World): Building[] {
    const out: Building[] = [];
    for (const b of world.buildings.values()) if (b.faction === this.faction) out.push(b);
    return out;
  }

  private manageEconomy(world: World, base: Vec2): void {
    const units = this.myUnits(world);
    const workers = units.filter((u) => u.role === UnitRole.Worker);

    // Train more workers from an idle town hall.
    if (workers.length < this.workerTarget) {
      for (const b of this.myBuildings(world)) {
        if (b.role === BuildingRole.TownHall && b.constructed && b.trainingQueue.length === 0) {
          enqueueTrain(world, b, UnitRole.Worker);
          break;
        }
      }
    }

    // Saturate gold and wood (~60/40 split). Reassign idle workers.
    let onGold = 0;
    let onWood = 0;
    const idle: Unit[] = [];
    for (const w of workers) {
      if (w.command.type === "harvest") {
        if (w.command.resource === "gold") onGold++;
        else onWood++;
      } else if (w.command.type === "idle") {
        idle.push(w);
      }
    }
    for (const w of idle) {
      const wantWood = onWood * 3 < onGold * 2; // keep gold:wood near 3:2
      if (wantWood) {
        const tile = world.findForestNear(base, 24) ?? world.findForestNear(w.pos, 24);
        if (tile) {
          orderHarvest(world, w, tile, "wood");
          onWood++;
          continue;
        }
      }
      const gold = world.findGoldMineNear(base, 28) ?? world.findGoldMineNear(w.pos, 28);
      if (gold) {
        orderHarvest(world, w, gold, "gold");
        onGold++;
      } else {
        const tile = world.findForestNear(base, 24);
        if (tile) {
          orderHarvest(world, w, tile, "wood");
          onWood++;
        }
      }
    }
  }

  private manageBuildOrder(world: World): void {
    const fs = world.factions[this.faction];
    const need = (role: BuildingRole): boolean => world.countBuildings(this.faction, role) === 0;

    // Supply ahead of demand: build a farm when nearly capped.
    if (fs.supplyCap - fs.supplyUsed <= 3 && fs.supplyCap < 90) {
      if (this.tryBuild(world, BuildingRole.Farm)) return;
    }

    // Core build order.
    if (need(BuildingRole.Barracks)) {
      if (this.tryBuild(world, BuildingRole.Barracks)) return;
    }
    if (need(BuildingRole.LumberMill)) {
      if (this.tryBuild(world, BuildingRole.LumberMill)) return;
    }
    // A second farm and defensive towers as the economy grows.
    if (world.countBuildings(this.faction, BuildingRole.Farm) < 2 && fs.supplyCap < 90) {
      if (this.tryBuild(world, BuildingRole.Farm)) return;
    }
    const towers = world.countBuildings(this.faction, BuildingRole.GuardTower);
    if (towers < this.difficulty && fs.gold > 200 && fs.wood > 120) {
      if (this.tryBuild(world, BuildingRole.GuardTower)) return;
    }
  }

  /** Attempt to place a building near base and assign a worker to it. */
  private tryBuild(world: World, role: BuildingRole): boolean {
    if (!canBuildBuilding(world, this.faction, role).ok) return false;
    const base = world.baseCenter(this.faction);
    if (!base) return false;
    const origin = this.findBuildSpot(world, role, base);
    if (!origin) return false;
    const worker = this.pickBuilder(world, base);
    if (!worker) return false;

    const stats = BUILDING_STATS[role];
    const fs = world.factions[this.faction];
    fs.gold -= stats.goldCost;
    fs.wood -= stats.woodCost;
    const site = createBuilding(this.faction, role, origin, false);
    world.addBuilding(site);
    orderBuild(world, worker, site.id);
    return true;
  }

  private findBuildSpot(world: World, role: BuildingRole, base: Vec2): TileCoord | null {
    const { w, h } = BUILDING_STATS[role].footprint;
    const bx = Math.floor(base.x);
    const by = Math.floor(base.y);
    let best: TileCoord | null = null;
    let bestD = Infinity;
    for (let dy = -16; dy <= 16; dy++) {
      for (let dx = -16; dx <= 16; dx++) {
        const tx = bx + dx;
        const ty = by + dy;
        const d = dx * dx + dy * dy;
        if (d < 9 || d > 16 * 16) continue; // keep a little distance from the hall
        if (d >= bestD) continue;
        if (world.map.canPlace(tx, ty, w, h) && this.hasPassableAdjacency(world, tx, ty, w, h)) {
          best = { tx, ty };
          bestD = d;
        }
      }
    }
    return best;
  }

  /** A builder must be able to stand next to the footprint, else the site is unreachable. */
  private hasPassableAdjacency(world: World, tx: number, ty: number, w: number, h: number): boolean {
    for (let x = tx - 1; x <= tx + w; x++) {
      if (world.map.isPassable(x, ty - 1) || world.map.isPassable(x, ty + h)) return true;
    }
    for (let y = ty - 1; y <= ty + h; y++) {
      if (world.map.isPassable(tx - 1, y) || world.map.isPassable(tx + w, y)) return true;
    }
    return false;
  }

  private pickBuilder(world: World, base: Vec2): Unit | null {
    // Prefer an idle/harvesting worker nearest base.
    let best: Unit | null = null;
    let bestD = Infinity;
    for (const u of world.units.values()) {
      if (u.faction !== this.faction || u.role !== UnitRole.Worker) continue;
      if (u.command.type === "build") continue;
      const d = dist(u.pos, base);
      if (d < bestD) {
        bestD = d;
        best = u;
      }
    }
    return best;
  }

  private manageArmy(world: World): void {
    const barracks = this.myBuildings(world).find(
      (b) => b.role === BuildingRole.Barracks && b.constructed && b.trainingQueue.length === 0,
    );
    if (!barracks) return;
    const units = this.myUnits(world);
    const inf = units.filter((u) => u.role === UnitRole.Infantry).length;
    const rng = units.filter((u) => u.role === UnitRole.Ranged).length;
    const heavy = units.filter((u) => u.role === UnitRole.Heavy).length;

    // Desired mix ~ 5 infantry : 3 ranged : 2 heavy.
    const haveMill = world.hasBuilding(this.faction, BuildingRole.LumberMill);
    let pick: UnitRole = UnitRole.Infantry;
    if (haveMill && heavy * 5 < inf * 2) pick = UnitRole.Heavy;
    else if (haveMill && rng * 5 < inf * 3) pick = UnitRole.Ranged;
    else pick = UnitRole.Infantry;
    enqueueTrain(world, barracks, pick);
  }

  private manageDefenseAndWaves(world: World, base: Vec2, _dt: number): void {
    const military = this.myUnits(world).filter(
      (u) =>
        u.role === UnitRole.Infantry || u.role === UnitRole.Ranged || u.role === UnitRole.Heavy,
    );

    // Defense: if an enemy is near the base, send the whole army to it.
    const threat = world.findNearestEnemy(this.faction, base, 18);
    if (threat) {
      const tc = threat.kind === "unit" ? threat.pos : buildingCenter(threat);
      for (const u of military) orderAttackMove(world, u, tc);
      return;
    }

    // Waves: once the timer fires and enough army has massed, attack the player.
    const waveSize = 5 + this.difficulty * 2 + this.waveNumber * 2;
    if (this.waveTimer <= 0 && military.length >= Math.min(waveSize, 6)) {
      const targetBase = world.baseCenter(world.playerFaction);
      if (targetBase) {
        for (const u of military) {
          if (u.command.type === "idle" || u.command.type === "attackMove") {
            orderAttackMove(world, u, targetBase);
          }
        }
        this.waveNumber++;
        this.waveTimer = Math.max(45, 110 - this.difficulty * 8);
      }
    }
  }
}
