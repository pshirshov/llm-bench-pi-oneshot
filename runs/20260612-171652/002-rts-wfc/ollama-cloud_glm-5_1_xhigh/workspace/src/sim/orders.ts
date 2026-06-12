/** Order processing — movement, harvest, combat, build, repair. */

import type { Unit, Building, TileCoord } from "./types";
import { UNIT_STATS, BUILDING_STATS, HARVEST_STATS, REPAIR_RATE, REPAIR_GOLD_PER_HP, REPAIR_WOOD_PER_HP } from "./stats";
import { TICK_RATE, UNIT_COLLISION_RADIUS, PROGRESS_WATCHDOG_TICKS, MAX_REPATH_ATTEMPTS } from "./constants";
import { GameMap } from "./map";
import { findPath } from "./pathfinding";
import { dist } from "./helpers";
import { SpatialHash } from "./spatial";

/** Process a unit's current order for one tick. */
export function processUnitOrder(
  unit: Unit,
  map: GameMap,
  units: Unit[],
  buildings: Building[],
  mines: Map<number, { col: number; row: number; remaining: number }>,
  resources: { gold: number; wood: number },
  spatial: SpatialHash
): void {
  unit.stuckTicks = (unit.lastX === unit.x && unit.lastY === unit.y)
    ? unit.stuckTicks + 1 : 0;
  unit.lastX = unit.x;
  unit.lastY = unit.y;

  switch (unit.order.type) {
    case "move": processMoveOrder(unit, map, units, buildings, spatial); break;
    case "attack": processAttackOrder(unit, map, units, buildings, spatial); break;
    case "attack_move": processAttackMoveOrder(unit, map, units, buildings, spatial); break;
    case "harvest": processHarvestOrder(unit, map, units, buildings, mines, resources, spatial); break;
    case "build": processBuildOrder(unit, map, buildings, resources); break;
    case "repair": processRepairOrder(unit, buildings, resources); break;
    case "guard": processGuardOrder(unit, spatial); break;
    case "idle": processIdleOrder(unit, spatial); break;
  }

  updateWatchdog(unit);
  if (unit.cooldownRemaining > 0) unit.cooldownRemaining--;
}

function updateWatchdog(unit: Unit): void {
  const phase = unit.order.type + (unit.harvestPhase ?? "");
  const progressed = unit.x !== unit.lastProgressX || unit.y !== unit.lastProgressY
    || phase !== unit.lastProgressPhase || unit.cargo.amount > 0 || unit.cooldownRemaining > 0;
  if (progressed) {
    unit.progressWatchdog = 0;
    unit.lastProgressX = unit.x;
    unit.lastProgressY = unit.y;
    unit.lastProgressPhase = phase;
  } else {
    unit.progressWatchdog++;
    if (unit.progressWatchdog > PROGRESS_WATCHDOG_TICKS) {
      unit.order = { type: "idle" };
      unit.path = [];
      unit.harvestPhase = null;
      unit.harvestTarget = null;
      unit.progressWatchdog = 0;
    }
  }
}

function processMoveOrder(
  unit: Unit, map: GameMap, units: Unit[], buildings: Building[], spatial: SpatialHash
): void {
  const target = unit.order.targetPos;
  if (!target) { unit.order = { type: "idle" }; return; }
  const d = dist(unit.x, unit.y, target.x, target.y);
  if (d < 0.3) { unit.order = { type: "idle" }; unit.path = []; return; }

  if (unit.path.length === 0 || unit.pathIndex >= unit.path.length) {
    const startTile: TileCoord = { col: Math.floor(unit.x), row: Math.floor(unit.y) };
    const endTile: TileCoord = { col: Math.floor(target.x), row: Math.floor(target.y) };
    const occupied = getOccupiedTiles(buildings, units, unit.id);
    const path = findPath(map, startTile, endTile, occupied);
    if (path) { unit.path = path; unit.pathIndex = 0; unit.repathAttempts = 0; }
    else {
      unit.repathAttempts++;
      if (unit.repathAttempts >= MAX_REPATH_ATTEMPTS) { unit.order = { type: "idle" }; return; }
    }
  }
  moveAlongPath(unit, map, units, buildings, spatial);
}

function moveAlongPath(
  unit: Unit, map: GameMap, units: Unit[], buildings: Building[], spatial: SpatialHash
): void {
  if (unit.pathIndex >= unit.path.length) return;
  const stats = UNIT_STATS[unit.type];
  const speed = stats.moveSpeed / TICK_RATE;
  const wp = unit.path[unit.pathIndex];
  const tx = wp.col + 0.5;
  const ty = wp.row + 0.5;
  const dx = tx - unit.x;
  const dy = ty - unit.y;
  const d = Math.sqrt(dx * dx + dy * dy);

  if (d < speed) {
    if (map.isWalkable(wp.col, wp.row)) { unit.x = tx; unit.y = ty; }
    unit.pathIndex++;
  } else {
    const mx = (dx / d) * speed;
    const my = (dy / d) * speed;
    const nx = unit.x + mx;
    const ny = unit.y + my;
    const nearby = spatial.query(nx, ny, UNIT_COLLISION_RADIUS);
    const blocked = nearby.some(u => u.id !== unit.id && dist(nx, ny, u.x, u.y) < UNIT_COLLISION_RADIUS);
    if (!blocked) { unit.x = nx; unit.y = ny; }
  }
}

function getOccupiedTiles(buildings: Building[], units: Unit[], excludeId: number): Set<string> {
  const occ = new Set<string>();
  for (const b of buildings) {
    if (b.hp <= 0) continue;
    const bs = BUILDING_STATS[b.type];
    for (let dr = 0; dr < bs.height; dr++)
      for (let dc = 0; dc < bs.width; dc++)
        occ.add(`${b.col + dc},${b.row + dr}`);
  }
  for (const u of units) {
    if (u.id !== excludeId && u.hp > 0)
      occ.add(`${Math.floor(u.x)},${Math.floor(u.y)}`);
  }
  return occ;
}

function processAttackOrder(
  unit: Unit, map: GameMap, units: Unit[], buildings: Building[], spatial: SpatialHash
): void {
  const targetId = unit.order.targetId;
  if (targetId === undefined) { unit.order = { type: "idle" }; return; }
  const target = units.find(u => u.id === targetId && u.hp > 0);
  if (!target) { unit.order = { type: "idle" }; return; }
  const stats = UNIT_STATS[unit.type];
  const d = dist(unit.x, unit.y, target.x, target.y);
  if (d > stats.sight + 2) { unit.order = { type: "idle" }; return; }
  if (d <= stats.attackRange + 0.3) {
    if (unit.cooldownRemaining <= 0) {
      const dmg = Math.max(1, stats.attack - (UNIT_STATS[target.type]?.armor ?? 0));
      target.hp -= dmg;
      unit.cooldownRemaining = stats.attackCooldown;
    }
  } else {
    unit.order.targetPos = { x: target.x, y: target.y };
    unit.path = [];
    unit.pathIndex = 0;
    processMoveOrder(unit, map, units, buildings, spatial);
  }
}

function processAttackMoveOrder(
  unit: Unit, map: GameMap, units: Unit[], buildings: Building[], spatial: SpatialHash
): void {
  if (!unit.order.targetPos) { unit.order = { type: "idle" }; return; }
  const stats = UNIT_STATS[unit.type];
  const nearby = spatial.query(unit.x, unit.y, stats.sight);
  const enemy = nearby.find(u => u.faction !== unit.faction && u.hp > 0);
  if (enemy) { unit.order = { type: "attack", targetId: enemy.id }; return; }
  processMoveOrder(unit, map, units, buildings, spatial);
}

function processHarvestOrder(
  unit: Unit, map: GameMap, units: Unit[], buildings: Building[],
  mines: Map<number, { col: number; row: number; remaining: number }>,
  resources: { gold: number; wood: number }, spatial: SpatialHash
): void {
  if (unit.type !== "worker") { unit.order = { type: "idle" }; return; }
  const targetId = unit.order.targetId;
  if (targetId === undefined || targetId === null) { unit.order = { type: "idle" }; return; }

  if (unit.harvestPhase === null || unit.harvestPhase === undefined) {
    unit.harvestPhase = "moving_to_source";
    unit.harvestGatherTimer = 0;
  }

  const phase = unit.harvestPhase;

  if (phase === "moving_to_source") {
    const mine = mines.get(targetId);
    let destX: number;
    let destY: number;

    if (mine && mine.remaining > 0) {
      destX = mine.col + 0.5;
      destY = mine.row + 0.5;
    } else if (mine && mine.remaining <= 0) {
      // Mine exhausted, retarget
      retargetGoldMine(unit, map, mines);
      return;
    } else {
      // Forest tile: targetId = col + row * 10000
      const col = targetId % 10000;
      const row = Math.floor(targetId / 10000);
      if (map.getTile(col, row) !== "forest") {
        retargetForest(unit, map);
        return;
      }
      destX = col + 0.5;
      destY = row + 0.5;
    }

    const d = dist(unit.x, unit.y, destX, destY);
    if (d <= 1.8) {
      unit.harvestPhase = "gathering";
      unit.harvestGatherTimer = HARVEST_STATS.harvestDuration;
      unit.path = [];
      return;
    }

    // Move toward the resource (without changing order type)
    unit.order.targetPos = { x: destX, y: destY };
    unit.path = [];
    unit.pathIndex = 0;
    processMoveOrder(unit, map, units, buildings, spatial);
  } else if (phase === "gathering") {
    unit.harvestGatherTimer--;
    if (unit.harvestGatherTimer > 0) return;

    // Done gathering
    const mine = mines.get(targetId);
    if (mine && mine.remaining > 0) {
      unit.cargo = { type: "gold", amount: HARVEST_STATS.goldPerTrip };
      map.harvestGold(targetId, HARVEST_STATS.goldPerTrip);
    } else if (!mine) {
      const col = targetId % 10000;
      const row = Math.floor(targetId / 10000);
      if (map.getTile(col, row) === "forest") {
        unit.cargo = { type: "wood", amount: HARVEST_STATS.woodPerTrip };
        map.harvestWood(col, row, HARVEST_STATS.woodPerTrip);
      } else {
        retargetForest(unit, map);
        return;
      }
    } else {
      // Mine exhausted
      retargetGoldMine(unit, map, mines);
      return;
    }
    unit.harvestPhase = "moving_to_dropoff";
  } else if (phase === "moving_to_dropoff") {
    if (unit.cargo.type === null) { goIdle(unit); return; }
    const dropoff = findDropoff(unit, buildings);
    if (!dropoff) { goIdle(unit); return; }
    const bStats = BUILDING_STATS[dropoff.type];
    const d = dist(unit.x, unit.y, dropoff.col + bStats.width / 2, dropoff.row + bStats.height / 2);
    if (d <= 2.0) {
      // Deliver
      if (unit.cargo.type === "gold") resources.gold += unit.cargo.amount;
      else resources.wood += unit.cargo.amount;
      unit.cargo = { type: null, amount: 0 };
      unit.harvestPhase = "moving_to_source";
    } else {
      // Move toward dropoff
      unit.order.targetPos = { x: dropoff.col + bStats.width / 2, y: dropoff.row + bStats.height / 2 };
      unit.path = [];
      unit.pathIndex = 0;
      processMoveOrder(unit, map, units, buildings, spatial);
    }
  }
}

function retargetGoldMine(unit: Unit, map: GameMap, mines: Map<number, { col: number; row: number; remaining: number }>): void {
  let bestDist = Infinity;
  let bestId: number | null = null;
  for (const [id, mine] of mines) {
    if (mine.remaining <= 0) continue;
    const d = dist(unit.x, unit.y, mine.col + 0.5, mine.row + 0.5);
    if (d < bestDist) { bestDist = d; bestId = id; }
  }
  if (bestId !== null) {
    unit.order.targetId = bestId;
    unit.harvestPhase = "moving_to_source";
    unit.harvestTarget = bestId;
  } else {
    goIdle(unit);
  }
}

function retargetForest(unit: Unit, map: GameMap): void {
  let bestDist = Infinity;
  let bestCol = -1;
  let bestRow = -1;
  const range = 20;
  for (let dr = -range; dr <= range; dr++) {
    for (let dc = -range; dc <= range; dc++) {
      const c = Math.floor(unit.x) + dc;
      const r = Math.floor(unit.y) + dr;
      if (map.getTile(c, r) === "forest") {
        const d = dist(unit.x, unit.y, c + 0.5, r + 0.5);
        if (d < bestDist) { bestDist = d; bestCol = c; bestRow = r; }
      }
    }
  }
  if (bestCol >= 0) {
    const fid = bestCol + bestRow * 10000;
    unit.order.targetId = fid;
    unit.harvestPhase = "moving_to_source";
    unit.harvestTarget = fid;
  } else {
    goIdle(unit);
  }
}

function goIdle(unit: Unit): void {
  unit.order = { type: "idle" };
  unit.harvestPhase = null;
  unit.harvestTarget = null;
}

function findDropoff(unit: Unit, buildings: Building[]): Building | null {
  let best: Building | null = null;
  let bestDist = Infinity;
  const ct = unit.cargo.type;
  for (const b of buildings) {
    if (b.faction !== unit.faction || !b.isComplete || b.hp <= 0) continue;
    const bs = BUILDING_STATS[b.type];
    const isDrop = ct === "gold" ? b.type === "town_hall" : b.type === "town_hall" || b.type === "lumber_mill";
    if (!isDrop) continue;
    const d = dist(unit.x, unit.y, b.col + bs.width / 2, b.row + bs.height / 2);
    if (d < bestDist) { bestDist = d; best = b; }
  }
  return best;
}

function processBuildOrder(unit: Unit, map: GameMap, buildings: Building[], _resources: { gold: number; wood: number }): void {
  if (unit.type !== "worker") { unit.order = { type: "idle" }; return; }
  const bt = unit.order.buildingType;
  const loc = unit.order.buildLocation;
  if (!bt || !loc) { unit.order = { type: "idle" }; return; }
  const target = buildings.find(b =>
    b.type === bt && b.col === loc.col && b.row === loc.row && !b.isComplete && b.faction === unit.faction
  );
  if (!target) { unit.order = { type: "idle" }; return; }
  const bStats = BUILDING_STATS[bt];
  const d = dist(unit.x, unit.y, target.col + bStats.width / 2, target.row + bStats.height / 2);
  if (d > 2.0) {
    unit.order.targetPos = { x: target.col + bStats.width / 2, y: target.row + bStats.height / 2 };
    unit.path = [];
    unit.pathIndex = 0;
    // Note: we don't call processMoveOrder here to avoid parameter mismatch
    // The unit will move on subsequent ticks via the move order
    return;
  }
  if (target.hp < target.maxHp) {
    const rate = target.maxHp / bStats.buildTime;
    target.hp = Math.min(target.maxHp, target.hp + rate);
    target.buildProgress++;
    if (target.hp >= target.maxHp) {
      target.isComplete = true;
      target.hp = target.maxHp;
      unit.order = { type: "idle" };
    }
  }
}

function processRepairOrder(unit: Unit, buildings: Building[], resources: { gold: number; wood: number }): void {
  if (unit.type !== "worker") { unit.order = { type: "idle" }; return; }
  const targetId = unit.order.targetId;
  if (targetId === undefined) { unit.order = { type: "idle" }; return; }
  const target = buildings.find(b => b.id === targetId);
  if (!target || target.hp >= target.maxHp || target.faction !== unit.faction) { unit.order = { type: "idle" }; return; }
  const bs = BUILDING_STATS[target.type];
  const d = dist(unit.x, unit.y, target.col + bs.width / 2, target.row + bs.height / 2);
  if (d > 2.0) return;
  const goldCost = REPAIR_GOLD_PER_HP * REPAIR_RATE;
  const woodCost = REPAIR_WOOD_PER_HP * REPAIR_RATE;
  if (resources.gold < goldCost || resources.wood < woodCost) { unit.order = { type: "idle" }; return; }
  target.hp = Math.min(target.maxHp, target.hp + REPAIR_RATE);
  resources.gold = Math.max(0, resources.gold - goldCost);
  resources.wood = Math.max(0, resources.wood - woodCost);
  if (target.hp >= target.maxHp) unit.order = { type: "idle" };
}

function processGuardOrder(unit: Unit, spatial: SpatialHash): void {
  const stats = UNIT_STATS[unit.type];
  const nearby = spatial.query(unit.x, unit.y, stats.sight);
  const enemy = nearby.find(u => u.faction !== unit.faction && u.hp > 0);
  if (enemy) unit.order = { type: "attack", targetId: enemy.id };
}

function processIdleOrder(unit: Unit, spatial: SpatialHash): void {
  if (unit.type !== "worker") processGuardOrder(unit, spatial);
}