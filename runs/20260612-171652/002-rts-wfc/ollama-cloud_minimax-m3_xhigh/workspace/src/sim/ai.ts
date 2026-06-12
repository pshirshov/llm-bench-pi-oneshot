// AI for the opposing faction. Strategy:
//  - Maintain ~50% of workers on gold, ~50% on wood.
//  - Build order: supply (Farm) ahead of demand, Barracks, Lumber Mill, defensive towers.
//  - Train a mixed army continuously (after the economy is established).
//  - Send escalating attack waves at the player base; first wave within ~4 min at difficulty 1.
//  - Defend by pulling military units to threats (auto-acquire does this).
//  - Rebuild destroyed buildings (Barracks / Town Hall / Lumber Mill / Farm).
//  - Difficulty (1-5) scales starting resources, harvest rate, wave cadence.
//
// AI is a per-tick function that issues orders via the public order API.

import { World } from "./world.js";
import { UnitEntity, BuildingEntity, isBuilding, isUnit } from "./entities.js";
import { TILE, isResourceTile, isWalkableTile } from "./tiles.js";
import { getBuildingStats, getUnitStats, HARVEST } from "./stats.js";
import { issueOrder } from "./orderHandler.js";
import { findPath, octile } from "./pathfinding.js";
import { buildTerrainBlockedMap } from "./helpers.js";

export interface AiConfig {
  /** Difficulty 1..5. */
  difficulty: number;
  /** Multiplier on starting gold/wood. */
  startResources: number;
  /** Multiplier on gold/wood per worker per tick. */
  harvestRate: number;
  /** Multiplier on wave size. */
  waveSize: number;
  /** Wave cadence in sim-seconds. */
  waveCadence: number;
  /** First wave at this sim-second. */
  firstWave: number;
}

export function configForDifficulty(d: number): AiConfig {
  const di = Math.max(1, Math.min(5, d));
  return {
    difficulty: di,
    startResources: 1.0 + 0.4 * (di - 1),
    harvestRate: 1.0 + 0.3 * (di - 1),
    waveSize: 1.0 + 0.4 * (di - 1),
    waveCadence: 180 - 20 * (di - 1),
    firstWave: 240 - 30 * (di - 1),
  };
}

export function isAiControlled(world: World, faction: "humans" | "orcs"): boolean {
  return world.players[faction].difficulty > 0;
}

/** Spawn the AI's initial base (Town Hall + workers) and configure resources. */
export function spawnAiBase(
  world: World,
  faction: "humans" | "orcs",
  startX: number,
  startY: number,
  config: AiConfig,
): void {
  // Adjust starting resources.
  world.players[faction].gold = Math.floor(world.players[faction].gold * config.startResources);
  world.players[faction].wood = Math.floor(world.players[faction].wood * config.startResources);
  // Place Town Hall centered on (startX, startY).
  const townHallX = Math.max(0, startX - 1);
  const townHallY = Math.max(0, startY - 1);
  // Clear footprint of any blocking tiles (forest, gold, etc).
  const stats = getBuildingStats(faction, "townhall");
  for (let dy = 0; dy < stats.footprint.h; dy++) {
    for (let dx = 0; dx < stats.footprint.w; dx++) {
      const x = townHallX + dx;
      const y = townHallY + dy;
      if (world.map.inBounds(x, y)) world.map.set(x, y, TILE.GRASS);
    }
  }
  const th = world.spawnBuilding(faction, "townhall", townHallX, townHallY, 1, null);
  void th;
  world.recomputeSupplyCap(faction);
  // Spawn 3-4 workers adjacent.
  const adj: Array<[number, number]> = [];
  for (let dy = -1; dy <= stats.footprint.h; dy++) {
    for (let dx = -1; dx <= stats.footprint.w; dx++) {
      const onLeft = dx === -1;
      const onRight = dx === stats.footprint.w;
      const onTop = dy === -1;
      const onBottom = dy === stats.footprint.h;
      if (!onLeft && !onRight && !onTop && !onBottom) continue;
      const x = townHallX + dx;
      const y = townHallY + dy;
      if (world.map.inBounds(x, y) && isWalkableTile(world.map.get(x, y))) adj.push([x, y]);
    }
  }
  for (let i = 0; i < 4 && i < adj.length; i++) {
    const pos = adj[i] as [number, number];
    world.spawnUnit(faction, "worker", pos[0], pos[1]);
  }
  // Set difficulty and initial state.
  world.players[faction].difficulty = config.difficulty;
  world.players[faction].aiTimer = 0;
  world.players[faction].waveTimer = 0;
  world.players[faction].aiBuildOrder = ["farm", "barracks", "lumbermill", "farm", "guardtower"];
  world.players[faction].wavesLaunched = 0;
}

function findNearestResource(
  world: World,
  unit: UnitEntity,
  resource: "gold" | "wood",
): { x: number; y: number } | null {
  let best: { x: number; y: number; d: number } | null = null;
  for (let y = 0; y < world.map.height; y++) {
    for (let x = 0; x < world.map.width; x++) {
      const t = world.map.get(x, y);
      if (resource === "gold" && t !== TILE.GOLD_MINE) continue;
      if (resource === "wood" && t !== TILE.FOREST) continue;
      const idx = y * world.map.width + x;
      if (resource === "gold" && (world.map.mineGold[idx] ?? 0) <= 0) continue;
      if (resource === "wood" && (world.map.forestWood[idx] ?? 0) <= 0) continue;
      const d = octile(unit.x, unit.y, x, y);
      if (best === null || d < best.d) best = { x, y, d };
    }
  }
  return best;
}

function idleWorkerCount(world: World, faction: "humans" | "orcs"): number {
  let n = 0;
  for (const e of world.unitEntities()) {
    if (e.faction !== faction) continue;
    if (e.unitKind !== "worker") continue;
    if (e.orderState.phase === "idle") n++;
  }
  return n;
}

function countGatherers(world: World, faction: "humans" | "orcs"): number {
  let g = 0, w = 0;
  for (const e of world.unitEntities()) {
    if (e.faction !== faction) continue;
    if (e.unitKind !== "worker") continue;
    if (e.orderState.phase === "gathering" || e.orderState.phase === "returning") {
      const order = e.orderState.order as { kind: "harvest"; tx: number; ty: number } | null;
      if (order) {
        const t = world.map.get(order.tx, order.ty);
        if (t === TILE.GOLD_MINE) g++;
        else if (t === TILE.FOREST) w++;
      }
    }
  }
  return Math.min(g, w); // not used; just for debug
}

function gatherersForResource(
  world: World,
  faction: "humans" | "orcs",
  resource: "gold" | "wood",
): number {
  let n = 0;
  for (const e of world.unitEntities()) {
    if (e.faction !== faction) continue;
    if (e.unitKind !== "worker") continue;
    if (e.orderState.phase !== "gathering" && e.orderState.phase !== "returning") continue;
    const order = e.orderState.order as { kind: "harvest"; tx: number; ty: number } | null;
    if (!order) continue;
    const t = world.map.get(order.tx, order.ty);
    if (resource === "gold" && t === TILE.GOLD_MINE) n++;
    if (resource === "wood" && t === TILE.FOREST) n++;
  }
  return n;
}

function assignWorkerToGather(
  world: World,
  worker: UnitEntity,
  resource: "gold" | "wood",
): void {
  const src = findNearestResource(world, worker, resource);
  if (!src) return;
  issueOrder(world, worker.id, { kind: "harvest", tx: src.x, ty: src.y });
}

function findBuildSite(
  world: World,
  faction: "humans" | "orcs",
  building: import("./stats.js").BuildingKind,
  nearX: number,
  nearY: number,
): { x: number; y: number } | null {
  const stats = getBuildingStats(faction, building);
  const W = world.map.width;
  const H = world.map.height;
  // Try a small spiral around (nearX, nearY).
  for (let radius = 2; radius <= 10; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = nearX + dx;
        const y = nearY + dy;
        if (x < 0 || y < 0 || x + stats.footprint.w > W || y + stats.footprint.h > H) continue;
        if (isBuildableAtForAi(world, x, y, stats.footprint.w, stats.footprint.h)) return { x, y };
      }
    }
  }
  return null;
}

function isBuildableAtForAi(
  world: World,
  x: number, y: number, w: number, h: number,
): boolean {
  const map = world.map;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      if (!map.inBounds(xx, yy)) return false;
      if (!isWalkableTile(map.get(xx, yy))) return false;
      if (isResourceTile(map.get(xx, yy))) return false;
    }
  }
  for (const e of world.entities.values()) {
    if (!isBuilding(e)) continue;
    if (e.construction < 1) continue;
    const s = getBuildingStats(e.faction, e.buildingKind);
    if (rectsOverlap(x, y, w, h, e.x, e.y, s.footprint.w, s.footprint.h)) return false;
  }
  for (const e of world.entities.values()) {
    if (!isUnit(e)) continue;
    if (e.x >= x && e.x < x + w && e.y >= y && e.y < y + h) return false;
  }
  return true;
}

function rectsOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function findTownHall(world: World, faction: "humans" | "orcs"): BuildingEntity | null {
  for (const e of world.buildingsOf(faction)) {
    if (e.buildingKind === "townhall" && e.construction >= 1) return e;
  }
  return null;
}

function canAffordBuilding(world: World, faction: "humans" | "orcs", b: import("./stats.js").BuildingKind): boolean {
  const s = getBuildingStats(faction, b);
  return world.players[faction].gold >= s.goldCost && world.players[faction].wood >= s.woodCost;
}

function tryPlaceBuilding(
  world: World,
  faction: "humans" | "orcs",
  b: import("./stats.js").BuildingKind,
): boolean {
  const th = findTownHall(world, faction);
  if (!th) return false;
  const site = findBuildSite(world, faction, b, th.x, th.y);
  if (!site) return false;
  // Find an idle worker to build.
  const workers = world.unitsOf(faction).filter((u) => u.unitKind === "worker" && u.orderState.phase === "idle");
  if (workers.length === 0) return false;
  const w = workers[0] as UnitEntity;
  return issueOrder(world, w.id, { kind: "build", building: b, x: site.x, y: site.y });
}

function findTrainerBuilding(
  world: World,
  faction: "humans" | "orcs",
  unitKind: import("./stats.js").UnitKind,
): BuildingEntity | null {
  if (unitKind === "worker") {
    return findTownHall(world, faction);
  }
  for (const e of world.buildingsOf(faction)) {
    if (e.construction < 1) continue;
    if (unitKind === "melee" && e.buildingKind === "barracks") return e;
    if (unitKind === "ranged") {
      if (e.buildingKind === "barracks" || e.buildingKind === "lumbermill") {
        // Prefer lumber mill for ranged.
        if (e.buildingKind === "lumbermill") return e;
      }
    }
    if (unitKind === "heavy") {
      if (e.buildingKind === "barracks" || e.buildingKind === "lumbermill") {
        if (e.buildingKind === "lumbermill") return e;
      }
    }
  }
  // Fallback: barracks.
  for (const e of world.buildingsOf(faction)) {
    if (e.construction < 1) continue;
    if (e.buildingKind === "barracks") return e;
  }
  return null;
}

function canAffordUnit(world: World, faction: "humans" | "orcs", unitKind: import("./stats.js").UnitKind): boolean {
  const s = getUnitStats(faction, unitKind);
  if (world.players[faction].gold < s.goldCost) return false;
  if (world.players[faction].wood < s.woodCost) return false;
  const used = world.players[faction].supplyUsed;
  const cap = world.players[faction].supplyCap;
  return used + s.supplyCost <= cap;
}

function enqueueTraining(
  world: World,
  faction: "humans" | "orcs",
  unitKind: import("./stats.js").UnitKind,
): boolean {
  const building = findTrainerBuilding(world, faction, unitKind);
  if (!building) return false;
  if (!canAffordUnit(world, faction, unitKind)) return false;
  const stats = getUnitStats(faction, unitKind);
  world.players[faction].gold -= stats.goldCost;
  world.players[faction].wood -= stats.woodCost;
  building.trainQueue.push({ unit: unitKind, progress: 0, total: stats.trainTime });
  return true;
}

function findEnemyBase(world: World, faction: "humans" | "orcs"): { x: number; y: number } | null {
  const enemy = faction === "humans" ? "orcs" : "humans";
  for (const e of world.buildingsOf(enemy)) {
    if (e.construction >= 1) return { x: e.x, y: e.y };
  }
  return null;
}

function launchAttackWave(world: World, faction: "humans" | "orcs", config: AiConfig): void {
  const enemyBase = findEnemyBase(world, faction);
  if (!enemyBase) return;
  // Send up to waveSize * 4 units to attack the enemy base.
  const waveSize = Math.floor(4 * config.waveSize);
  const military = world.unitsOf(faction).filter((u) =>
    u.unitKind !== "worker" && u.orderState.phase === "idle"
  );
  let sent = 0;
  for (const u of military) {
    if (sent >= waveSize) break;
    issueOrder(world, u.id, { kind: "attackMove", x: enemyBase.x, y: enemyBase.y });
    sent++;
  }
  world.players[faction].wavesLaunched++;
}

/** Run the AI for one faction for one tick. */
export function aiStep(world: World, faction: "humans" | "orcs", dt: number): void {
  const player = world.players[faction];
  if (player.difficulty <= 0) return;
  const config = configForDifficulty(player.difficulty);
  player.aiTimer += dt;

  // Throttle: only run on integer-tick boundaries. Use world.tick for
  // determinism — a separate accumulator isn't needed because each "section"
  // gates itself by an internal counter on the player.
  const slowTick = world.tick % 30 === 0; // every 1 sim-second
  const slowerTick = world.tick % 90 === 0; // every 3 sim-seconds
  const slowestTick = world.tick % 300 === 0; // every 10 sim-seconds
  void slowTick; void slowerTick; void slowestTick;

  // Assign idle workers to gold or wood based on current ratio.
  if (player.aiTimer > 0 && world.tick % 30 === 0) {
    const targetGatherers = 2;
    const targetWood = 2;
    let currentGold = gatherersForResource(world, faction, "gold");
    let currentWood = gatherersForResource(world, faction, "wood");
    const idle = world.unitsOf(faction).filter((u) => u.unitKind === "worker" && u.orderState.phase === "idle");
    for (const w of idle) {
      if (currentGold < targetGatherers) {
        assignWorkerToGather(world, w, "gold");
        currentGold++;
      } else if (currentWood < targetWood) {
        assignWorkerToGather(world, w, "wood");
        currentWood++;
      } else if (currentGold + currentWood < 6) {
        // Grow: alternate.
        if (currentGold <= currentWood) {
          assignWorkerToGather(world, w, "gold");
          currentGold++;
        } else {
          assignWorkerToGather(world, w, "wood");
          currentWood++;
        }
      }
    }
  }

  // Build order: every ~3 sim-seconds, try to place the next building.
  if (world.tick % 90 === 0) {
    const next = player.aiBuildOrder[0];
    if (next && canAffordBuilding(world, faction, next)) {
      const placed = tryPlaceBuilding(world, faction, next);
      if (placed) {
        player.aiBuildOrder.shift();
        if (player.aiBuildOrder.length < 3) {
          player.aiBuildOrder.push(next);
        }
      }
    }
    // Rebuild destroyed essential buildings.
    if (!findTownHall(world, faction) && canAffordBuilding(world, faction, "townhall")) {
      tryPlaceBuilding(world, faction, "townhall");
    }
    if (player.aiBuildOrder.length === 0) {
      player.aiBuildOrder = ["barracks", "lumbermill", "farm", "guardtower", "farm"];
    }
  }

  // Train military every ~3 sim-seconds.
  if (world.tick % 90 === 0) {
    const armyMix: import("./stats.js").UnitKind[] = ["melee", "melee", "ranged", "heavy", "melee"];
    for (const k of armyMix) {
      if (enqueueTraining(world, faction, k)) break;
    }
    const workers = world.unitsOf(faction).filter((u) => u.unitKind === "worker").length;
    if (workers < 4 && canAffordUnit(world, faction, "worker")) {
      enqueueTraining(world, faction, "worker");
    }
  }

  // Wave launch.
  player.waveTimer += dt;
  if (player.waveTimer >= (player.wavesLaunched === 0 ? config.firstWave : config.waveCadence)) {
    player.waveTimer = 0;
    launchAttackWave(world, faction, config);
  }
  void countGatherers;
}

void findPath;
void HARVEST;
void buildTerrainBlockedMap;
void isResourceTile;
void isWalkableTile;
void idleWorkerCount;
