/** AI opponent controller. */

import type { World } from "./world";
import type { Faction, BuildingType, UnitType, TileCoord, Vec2, Unit } from "./types";
import { UNIT_STATS, BUILDING_STATS } from "./stats";
import { TICK_RATE } from "./constants";
import type { PRNG } from "./prng";

interface AIState {
  faction: Faction;
  difficulty: number;
  lastWaveTick: number;
  waveSize: number;
  builtBarracks: boolean;
  builtLumberMill: boolean;
  buildCooldown: number;
}

export function createAI(faction: Faction, difficulty: number): AIState {
  return {
    faction,
    difficulty,
    lastWaveTick: -60 * TICK_RATE,
    waveSize: 2 + difficulty,
    builtBarracks: false,
    builtLumberMill: false,
    buildCooldown: 0,
  };
}

export function aiTick(ai: AIState, world: World, prng: PRNG): void {
  if (ai.buildCooldown > 0) { ai.buildCooldown--; }
  if (world.tick % 5 !== 0) return;

  const faction = ai.faction;
  const resources = world.getResources(faction);
  const myUnits = world.getUnits(faction);
  const myBuildings = world.getBuildings(faction);
  const workers = myUnits.filter(u => u.type === "worker" && u.hp > 0);
  const military = myUnits.filter(u => u.type !== "worker" && u.hp > 0);
  const townHalls = myBuildings.filter(b => b.type === "town_hall" && b.isComplete && b.hp > 0);
  const barracks = myBuildings.filter(b => b.type === "barracks" && b.isComplete && b.hp > 0);
  const lumberMills = myBuildings.filter(b => b.type === "lumber_mill" && b.isComplete && b.hp > 0);
  const supply = world.getSupply(faction);

  if (townHalls.length === 0) return;
  const homeBase: Vec2 = { x: townHalls[0].col + 1.5, y: townHalls[0].row + 1.5 };

  // Train workers
  const idleWorkers = workers.filter(u => u.order.type === "idle");
  if (workers.length < 8 + ai.difficulty * 2) {
    for (const th of townHalls) {
      if (supply.used + 1 <= supply.cap && resources.gold >= UNIT_STATS.worker.goldCost) {
        world.trainUnit(th.id, "worker");
      }
    }
  }

  // Assign idle workers to harvest
  for (const w of idleWorkers) {
    if (w.cargo.type !== null) continue;
    const nearestGold = world.findNearestResource(w, "gold_mine");
    const nearestForest = world.findNearestResource(w, "forest");
    if (nearestGold !== null) {
      world.issueOrder(w.id, { type: "harvest", targetId: nearestGold });
    } else if (nearestForest !== null) {
      world.issueOrder(w.id, { type: "harvest", targetId: nearestForest });
    }
  }

  // Build supply
  if (supply.cap - supply.used < 4 && ai.buildCooldown <= 0) {
    const pos = findBuildPos(world, "farm", homeBase, prng);
    if (pos && resources.gold >= BUILDING_STATS.farm.goldCost && resources.wood >= BUILDING_STATS.farm.woodCost) {
      const w = pickIdleWorker(workers);
      if (w) { world.buildBuilding(w.id, "farm", pos); ai.buildCooldown = 20; }
    }
  }

  // Build barracks
  if (!ai.builtBarracks && barracks.length === 0 && ai.buildCooldown <= 0) {
    const pos = findBuildPos(world, "barracks", homeBase, prng);
    if (pos && resources.gold >= BUILDING_STATS.barracks.goldCost && resources.wood >= BUILDING_STATS.barracks.woodCost) {
      const w = pickIdleWorker(workers);
      if (w) { world.buildBuilding(w.id, "barracks", pos); ai.builtBarracks = true; ai.buildCooldown = 20; }
    }
  }

  // Build lumber mill
  if (barracks.length > 0 && !ai.builtLumberMill && lumberMills.length === 0 && ai.buildCooldown <= 0) {
    const pos = findBuildPos(world, "lumber_mill", homeBase, prng);
    if (pos && resources.gold >= BUILDING_STATS.lumber_mill.goldCost && resources.wood >= BUILDING_STATS.lumber_mill.woodCost) {
      const w = pickIdleWorker(workers);
      if (w) { world.buildBuilding(w.id, "lumber_mill", pos); ai.builtLumberMill = true; ai.buildCooldown = 20; }
    }
  }

  // Build guard towers
  if (barracks.length > 0 && myBuildings.filter(b => b.type === "guard_tower").length < 2 && ai.buildCooldown <= 0) {
    const pos = findBuildPos(world, "guard_tower", homeBase, prng);
    if (pos && resources.gold >= BUILDING_STATS.guard_tower.goldCost && resources.wood >= BUILDING_STATS.guard_tower.woodCost) {
      const w = pickIdleWorker(workers);
      if (w) { world.buildBuilding(w.id, "guard_tower", pos); ai.buildCooldown = 20; }
    }
  }

  // Train military
  if (barracks.length > 0) {
    const supplyLeft = supply.cap - supply.used;
    if (supplyLeft > 0) {
      const unitType = pickUnitType(ai, lumberMills.length > 0, prng);
      const stats = UNIT_STATS[unitType];
      if (resources.gold >= stats.goldCost && resources.wood >= stats.woodCost) {
        for (const b of barracks) {
          if (b.trainingQueue.length < 2) {
            world.trainUnit(b.id, unitType);
            break;
          }
        }
      }
    }
  }

  // Rebuild destroyed buildings
  for (const bType of ["barracks", "lumber_mill"] as BuildingType[]) {
    if (myBuildings.filter(b => b.type === bType && b.hp > 0).length === 0 && ai.buildCooldown <= 0) {
      const pos = findBuildPos(world, bType, homeBase, prng);
      const bs = BUILDING_STATS[bType];
      if (pos && resources.gold >= bs.goldCost && resources.wood >= bs.woodCost) {
        const w = pickIdleWorker(workers);
        if (w) { world.buildBuilding(w.id, bType, pos); ai.buildCooldown = 20; }
      }
    }
  }

  // Attack waves
  const waveInterval = Math.max(10 * TICK_RATE, (4 * 60 - ai.difficulty * 30) * TICK_RATE);
  const firstWave = 4 * 60 * TICK_RATE;
  if (world.tick >= firstWave && (world.tick - ai.lastWaveTick >= waveInterval || military.length >= 8 + ai.difficulty * 3)) {
    if (military.length >= ai.waveSize) {
      const enemyBuildings = world.getBuildings(faction === "human" ? "orc" : "human");
      if (enemyBuildings.length > 0) {
        const target = enemyBuildings[0];
        const ap: Vec2 = { x: target.col + 1, y: target.row + 1 };
        for (const u of military) {
          world.issueOrder(u.id, { type: "attack_move", targetPos: ap });
        }
        ai.lastWaveTick = world.tick;
        ai.waveSize = Math.min(ai.waveSize + 1, 10 + ai.difficulty * 3);
      }
    }
  }

  // Defend base
  const enemies = world.getVisibleEnemies(faction, homeBase, 15);
  if (enemies.length > 0) {
    const dp: Vec2 = { x: enemies[0].x, y: enemies[0].y };
    for (const u of military) {
      if (u.order.type === "idle" || u.order.type === "guard") {
        world.issueOrder(u.id, { type: "attack_move", targetPos: dp });
      }
    }
  }
}

function pickUnitType(ai: AIState, hasLumberMill: boolean, prng: PRNG): UnitType {
  if (hasLumberMill && prng.next() < 0.3) return "ranged";
  if (hasLumberMill && prng.next() < 0.2) return "heavy";
  return "melee";
}

function findBuildPos(world: World, type: BuildingType, home: Vec2, prng: PRNG): TileCoord | null {
  for (let i = 0; i < 50; i++) {
    const angle = prng.next() * Math.PI * 2;
    const d = 3 + Math.floor(prng.next() * 6);
    const col = Math.floor(home.x) + Math.round(Math.cos(angle) * d);
    const row = Math.floor(home.y) + Math.round(Math.sin(angle) * d);
    if (world.canPlaceBuilding(type, col, row)) return { col, row };
  }
  return null;
}

function pickIdleWorker(workers: Unit[]): Unit | null {
  for (const w of workers) {
    if (w.order.type === "idle") return w;
  }
  return null;
}