import { dist, type TileCoord, type Vec2 } from "../core/vec.js";
import { computeDamage } from "./combat.js";
import {
  allocId,
  type Building,
  buildingCenter,
  CORPSE_FADE_SECONDS,
  createUnit,
  distanceToBuilding,
  type Entity,
  type Unit,
} from "./entity.js";
import { advanceAlongPath, isMoving } from "./movement.js";
import { assignPath, tileCenter, unitTile } from "./pathing.js";
import { orderMove, stopUnit } from "./orders.js";
import {
  BUILDING_STATS,
  type BuildingRole,
  type Faction,
  HARVEST,
  REPAIR,
  UNIT_STATS,
  UnitRole,
  UNIT_REQUIREMENTS,
  BUILDING_REQUIREMENTS,
} from "./stats.js";
import type { World } from "./world.js";

const PROJECTILE_SPEED = 10; // tiles/sec
const REPATH_INTERVAL = 0.4;
const STUCK_REPATH = 0.6;
const STUCK_GIVEUP = 2.6;
const BUILD_REACH = 1.4;
const DROPOFF_REACH = 1.4;
const HARVEST_REACH = 1.5;
const GUARD_LEASH = 4;
const RESOURCE_SEARCH_RADIUS = 14;

// ---------- shared helpers ----------

function armorOf(e: Entity): number {
  return e.kind === "unit" ? UNIT_STATS[e.role].armor : 0;
}

function entityCenter(e: Entity): Vec2 {
  return e.kind === "unit" ? e.pos : buildingCenter(e);
}

function targetDistance(u: Unit, target: Entity): number {
  if (target.kind === "building") return distanceToBuilding(target, u.pos);
  return dist(u.pos, target.pos);
}

function nearestBuildingTile(b: Building, from: Vec2): TileCoord {
  let best: TileCoord = { tx: b.origin.tx, ty: b.origin.ty };
  let bestD = Infinity;
  for (let dy = 0; dy < b.footprint.h; dy++) {
    for (let dx = 0; dx < b.footprint.w; dx++) {
      const tx = b.origin.tx + dx;
      const ty = b.origin.ty + dy;
      const d = (tx + 0.5 - from.x) ** 2 + (ty + 0.5 - from.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { tx, ty };
      }
    }
  }
  return best;
}

/** Nearest free passable tile around a building footprint, spiralling outward. */
function freeTileAround(world: World, b: Building, near: Vec2): Vec2 | null {
  for (let r = 1; r <= 6; r++) {
    let best: Vec2 | null = null;
    let bestD = Infinity;
    for (let dy = -r; dy <= b.footprint.h - 1 + r; dy++) {
      for (let dx = -r; dx <= b.footprint.w - 1 + r; dx++) {
        // Only consider the ring at radius r.
        const onRing =
          dx === -r || dy === -r || dx === b.footprint.w - 1 + r || dy === b.footprint.h - 1 + r;
        if (!onRing) continue;
        const tx = b.origin.tx + dx;
        const ty = b.origin.ty + dy;
        if (!world.map.isPassable(tx, ty)) continue;
        const c = { x: tx + 0.5, y: ty + 0.5 };
        const d = (c.x - near.x) ** 2 + (c.y - near.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
    }
    if (best) return best;
  }
  return null;
}

// ---------- combat ----------

export function applyDamage(world: World, target: Entity, amount: number): void {
  target.hp -= amount;
  if (target.hp <= 0) killEntity(world, target);
}

function killEntity(world: World, e: Entity): void {
  if (e.kind === "unit") {
    world.corpses.push({
      pos: { x: e.pos.x, y: e.pos.y },
      faction: e.faction,
      role: e.role,
      fade: CORPSE_FADE_SECONDS,
      maxFade: CORPSE_FADE_SECONDS,
    });
    world.removeUnit(e.id);
  } else {
    world.removeBuilding(e.id);
  }
}

function performAttack(world: World, u: Unit, target: Entity): void {
  const stats = UNIT_STATS[u.role];
  const c = entityCenter(target);
  u.facing = Math.atan2(c.y - u.pos.y, c.x - u.pos.x);
  const dmg = computeDamage(stats.damage, armorOf(target));
  if (stats.attackKind === "ranged") {
    world.projectiles.push({
      id: allocId(),
      faction: u.faction,
      pos: { x: u.pos.x, y: u.pos.y },
      targetId: target.id,
      damage: dmg,
      speed: PROJECTILE_SPEED,
      destination: { x: c.x, y: c.y },
    });
  } else {
    applyDamage(world, target, dmg);
  }
  u.attackCdRemaining = stats.attackCooldown;
}

/** Move toward and attack a target. Caller is responsible for target validity. */
function engageTarget(world: World, u: Unit, target: Entity, dt: number): void {
  const stats = UNIT_STATS[u.role];
  const tdist = targetDistance(u, target);
  if (tdist <= stats.range) {
    u.path = [];
    u.waypointIndex = 0;
    u.vx = 0;
    u.vy = 0;
    const c = entityCenter(target);
    u.facing = Math.atan2(c.y - u.pos.y, c.x - u.pos.x);
    if (u.attackCdRemaining <= 0) performAttack(world, u, target);
    return;
  }
  const goalTile =
    target.kind === "building" ? nearestBuildingTile(target, u.pos) : unitTile(target);
  const stopAdj = target.kind === "building" || stats.attackKind === "melee";
  const moved =
    u.pathGoal === null ||
    Math.abs(u.pathGoal.tx - goalTile.tx) + Math.abs(u.pathGoal.ty - goalTile.ty) > 1;
  if ((!isMoving(u) || moved) && u.repathCooldown <= 0) {
    assignPath(world.map, u, goalTile, stopAdj);
    u.repathCooldown = REPATH_INTERVAL;
  }
  advanceAlongPath(world, u, dt);
}

// ---------- unit behavior FSM ----------

export function updateUnit(world: World, u: Unit, dt: number): void {
  if (u.attackCdRemaining > 0) u.attackCdRemaining -= dt;
  if (u.repathCooldown > 0) u.repathCooldown -= dt;

  switch (u.command.type) {
    case "idle":
      doIdle(world, u, dt);
      break;
    case "move":
      doMove(world, u, dt);
      break;
    case "attackMove":
      doAttackMove(world, u, dt);
      break;
    case "attack": {
      const target = world.getEntity(u.command.targetId);
      if (!target || target.faction === u.faction) {
        stopUnit(u);
        break;
      }
      engageTarget(world, u, target, dt);
      break;
    }
    case "harvest":
      doHarvest(world, u, dt);
      break;
    case "build":
      doBuild(world, u, dt);
      break;
    case "repair":
      doRepair(world, u, dt);
      break;
  }
}

function doIdle(world: World, u: Unit, dt: number): void {
  const stats = UNIT_STATS[u.role];
  if (stats.canWork) {
    u.vx = 0;
    u.vy = 0;
    return;
  }
  const enemy = world.findNearestEnemy(u.faction, u.pos, stats.sight);
  if (enemy) {
    if (u.guardPos === null) u.guardPos = { x: u.pos.x, y: u.pos.y };
    const c = entityCenter(enemy);
    if (dist(c, u.guardPos) <= stats.sight + GUARD_LEASH) {
      engageTarget(world, u, enemy, dt);
      return;
    }
  }
  u.guardPos = { x: u.pos.x, y: u.pos.y };
  u.vx = 0;
  u.vy = 0;
}

function doMove(world: World, u: Unit, dt: number): void {
  if (!isMoving(u)) {
    stopUnit(u);
    return;
  }
  const arrived = advanceAlongPath(world, u, dt);
  if (arrived) {
    stopUnit(u);
    return;
  }
  handleStuck(world, u);
}

function doAttackMove(world: World, u: Unit, dt: number): void {
  const stats = UNIT_STATS[u.role];
  const enemy = world.findNearestEnemy(u.faction, u.pos, stats.sight);
  if (enemy) {
    engageTarget(world, u, enemy, dt);
    return;
  }
  if (u.command.type !== "attackMove") return;
  const target = u.command.target;
  if (dist(u.pos, target) <= 0.8) {
    stopUnit(u);
    return;
  }
  if (!isMoving(u)) {
    const goal = unitTile({ ...u, pos: target } as Unit);
    if (!assignPath(world.map, u, goal, false)) {
      stopUnit(u);
      return;
    }
  }
  const arrived = advanceAlongPath(world, u, dt);
  if (arrived) stopUnit(u);
  handleStuck(world, u);
}

function handleStuck(world: World, u: Unit): void {
  if (u.stuckTimer > STUCK_GIVEUP) {
    stopUnit(u);
    return;
  }
  if (u.stuckTimer > STUCK_REPATH && u.repathCooldown <= 0 && u.pathGoal) {
    assignPath(world.map, u, u.pathGoal, false);
    u.repathCooldown = REPATH_INTERVAL;
  }
}

function doHarvest(world: World, u: Unit, dt: number): void {
  if (u.command.type !== "harvest") return;
  const cmd = u.command;
  const resource = cmd.resource;

  if (u.harvestPhase === "toResource") {
    // Validate / retarget the resource tile.
    const stillValid =
      resource === "gold"
        ? world.map.isGoldMine(cmd.tile.tx, cmd.tile.ty) && world.map.goldAt(cmd.tile.tx, cmd.tile.ty) > 0
        : world.map.isForest(cmd.tile.tx, cmd.tile.ty) && world.map.woodAt(cmd.tile.tx, cmd.tile.ty) > 0;
    if (!stillValid) {
      const next =
        resource === "gold"
          ? world.findGoldMineNear(u.pos, RESOURCE_SEARCH_RADIUS)
          : world.findForestNear(u.pos, RESOURCE_SEARCH_RADIUS);
      if (!next) {
        stopUnit(u);
        return;
      }
      cmd.tile = next;
    }
    const center = tileCenter(cmd.tile);
    if (dist(u.pos, center) <= HARVEST_REACH) {
      u.harvestPhase = "working";
      u.workTimer = resource === "gold" ? HARVEST.goldMineTime : HARVEST.chopTime;
      u.path = [];
      u.vx = 0;
      u.vy = 0;
      return;
    }
    if (!isMoving(u) && u.repathCooldown <= 0) {
      if (!assignPath(world.map, u, cmd.tile, true)) {
        // Can't reach; try to find another resource next tick.
        const next =
          resource === "gold"
            ? world.findGoldMineNear(u.pos, RESOURCE_SEARCH_RADIUS)
            : world.findForestNear(u.pos, RESOURCE_SEARCH_RADIUS);
        if (next) cmd.tile = next;
        else stopUnit(u);
        u.repathCooldown = REPATH_INTERVAL;
        return;
      }
      u.repathCooldown = REPATH_INTERVAL;
    }
    advanceAlongPath(world, u, dt);
    return;
  }

  if (u.harvestPhase === "working") {
    u.workTimer -= dt;
    if (u.workTimer <= 0) {
      const want = resource === "gold" ? HARVEST.goldPerTrip : HARVEST.woodPerTrip;
      const got =
        resource === "gold"
          ? world.map.mineGold(cmd.tile.tx, cmd.tile.ty, want)
          : world.map.chopWood(cmd.tile.tx, cmd.tile.ty, want);
      if (got <= 0) {
        u.harvestPhase = "toResource";
        return;
      }
      u.carrying = { kind: resource, amount: got };
      u.harvestPhase = "toDropoff";
    }
    return;
  }

  // toDropoff
  const dropoff = world.findDropoff(u.faction, resource, u.pos);
  if (!dropoff) {
    // Nowhere to deliver; wait near resource.
    u.vx = 0;
    u.vy = 0;
    return;
  }
  if (distanceToBuilding(dropoff, u.pos) <= DROPOFF_REACH) {
    if (u.carrying) {
      const fs = world.factions[u.faction];
      const amount = u.carrying.amount * fs.harvestMultiplier;
      if (u.carrying.kind === "gold") fs.gold += amount;
      else fs.wood += amount;
      u.carrying = null;
    }
    u.harvestPhase = "toResource";
    u.path = [];
    return;
  }
  if (!isMoving(u) && u.repathCooldown <= 0) {
    const goalTile = nearestBuildingTile(dropoff, u.pos);
    assignPath(world.map, u, goalTile, true);
    u.repathCooldown = REPATH_INTERVAL;
  }
  advanceAlongPath(world, u, dt);
}

/** Move a worker adjacent to a building, with stuck/unreachable recovery. */
function approachBuilding(world: World, u: Unit, b: Building, dt: number): "arrived" | "moving" | "giveup" {
  if (distanceToBuilding(b, u.pos) <= BUILD_REACH) {
    u.path = [];
    u.vx = 0;
    u.vy = 0;
    return "arrived";
  }
  if (u.stuckTimer > STUCK_GIVEUP) return "giveup";
  const needPath = !isMoving(u) || u.stuckTimer > STUCK_REPATH;
  if (needPath && u.repathCooldown <= 0) {
    if (!assignPath(world.map, u, nearestBuildingTile(b, u.pos), true)) return "giveup";
    u.repathCooldown = REPATH_INTERVAL;
    u.stuckTimer = 0;
  }
  advanceAlongPath(world, u, dt);
  return "moving";
}

function doBuild(world: World, u: Unit, dt: number): void {
  if (u.command.type !== "build") return;
  const b = world.buildings.get(u.command.targetId);
  if (!b || b.faction !== u.faction || b.constructed) {
    stopUnit(u);
    return;
  }
  const r = approachBuilding(world, u, b, dt);
  if (r === "giveup") stopUnit(u);
  else if (r === "arrived") b.workerPresent = true;
}

function doRepair(world: World, u: Unit, dt: number): void {
  if (u.command.type !== "repair") return;
  const b = world.buildings.get(u.command.targetId);
  if (!b || b.faction !== u.faction || b.hp >= b.maxHp || !b.constructed) {
    stopUnit(u);
    return;
  }
  const approach = approachBuilding(world, u, b, dt);
  if (approach === "giveup") {
    stopUnit(u);
    return;
  }
  if (approach === "arrived") {
    const stats = BUILDING_STATS[b.role];
    const heal = REPAIR.hpPerSecond * dt;
    const goldCost = ((stats.goldCost * REPAIR.costFraction) / b.maxHp) * heal;
    const woodCost = ((stats.woodCost * REPAIR.costFraction) / b.maxHp) * heal;
    const fs = world.factions[u.faction];
    if (fs.gold >= goldCost && fs.wood >= woodCost) {
      fs.gold -= goldCost;
      fs.wood -= woodCost;
      b.hp = Math.min(b.maxHp, b.hp + heal);
    } else {
      stopUnit(u);
    }
    if (b.hp >= b.maxHp) stopUnit(u);
  }
}

// ---------- building behavior ----------

export function updateBuilding(world: World, b: Building, dt: number): void {
  if (!b.constructed) {
    if (b.workerPresent) {
      b.buildProgress += dt / BUILDING_STATS[b.role].buildTime;
      if (b.buildProgress >= 1) {
        b.buildProgress = 1;
        b.constructed = true;
        b.hp = b.maxHp;
      } else {
        const target = b.maxHp * (0.15 + 0.85 * b.buildProgress);
        if (b.hp < target) b.hp = target;
      }
    }
    b.workerPresent = false;
    return;
  }
  b.workerPresent = false;

  // Production.
  if (b.trainingQueue.length > 0) {
    b.trainTimer -= dt;
    if (b.trainTimer <= 0) {
      const role = b.trainingQueue[0]!;
      spawnTrainedUnit(world, b, role);
      b.trainingQueue.shift();
      b.trainTimer = b.trainingQueue.length > 0 ? UNIT_STATS[b.trainingQueue[0]!].trainTime : 0;
    }
  }

  // Tower / defensive attack.
  const stats = BUILDING_STATS[b.role];
  if (stats.attack) {
    if (b.attackCdRemaining > 0) b.attackCdRemaining -= dt;
    if (b.attackCdRemaining <= 0) {
      const center = buildingCenter(b);
      const enemy = world.findNearestEnemy(b.faction, center, stats.attack.range);
      if (enemy) {
        const c = entityCenter(enemy);
        world.projectiles.push({
          id: allocId(),
          faction: b.faction,
          pos: { x: center.x, y: center.y },
          targetId: enemy.id,
          damage: computeDamage(stats.attack.damage, armorOf(enemy)),
          speed: PROJECTILE_SPEED,
          destination: { x: c.x, y: c.y },
        });
        b.attackCdRemaining = stats.attack.cooldown;
      }
    }
  }
}

function spawnTrainedUnit(world: World, b: Building, role: UnitRole): void {
  const center = buildingCenter(b);
  const spawn = freeTileAround(world, b, b.rally ?? center) ?? center;
  const u = createUnit(b.faction, role, spawn);
  world.addUnit(u);
  if (b.rally) orderMove(world, u, b.rally);
}

// ---------- production / build orders ----------

export interface ActionResult {
  ok: boolean;
  reason?: string;
}

export function requirementsMet(world: World, faction: Faction, reqs: readonly BuildingRole[]): boolean {
  for (const r of reqs) {
    if (!world.hasBuilding(faction, r)) return false;
  }
  return true;
}

export function enqueueTrain(world: World, b: Building, role: UnitRole): ActionResult {
  if (!b.constructed) return { ok: false, reason: "Building not complete" };
  if (!BUILDING_STATS[b.role].trains.includes(role)) {
    return { ok: false, reason: "Cannot train here" };
  }
  if (!requirementsMet(world, b.faction, UNIT_REQUIREMENTS[role])) {
    return { ok: false, reason: "Missing prerequisite building" };
  }
  const check = world.canTrain(b.faction, role);
  if (!check.ok) return check;
  const stats = UNIT_STATS[role];
  const fs = world.factions[b.faction];
  fs.gold -= stats.goldCost;
  fs.wood -= stats.woodCost;
  if (b.trainingQueue.length === 0) b.trainTimer = stats.trainTime;
  b.trainingQueue.push(role);
  return { ok: true };
}

/** Cancel the last queued unit and refund its cost. */
export function cancelLastTrain(world: World, b: Building): void {
  const role = b.trainingQueue.pop();
  if (role === undefined) return;
  const stats = UNIT_STATS[role];
  const fs = world.factions[b.faction];
  fs.gold += stats.goldCost;
  fs.wood += stats.woodCost;
  if (b.trainingQueue.length === 0) b.trainTimer = 0;
}

export function canBuildBuilding(world: World, faction: Faction, role: BuildingRole): ActionResult {
  if (!requirementsMet(world, faction, BUILDING_REQUIREMENTS[role])) {
    return { ok: false, reason: "Missing prerequisite building" };
  }
  if (!world.canAfford(faction, role)) return { ok: false, reason: "Not enough resources" };
  return { ok: true };
}

// ---------- projectiles & corpses ----------

export function updateProjectiles(world: World, dt: number): void {
  const survivors: typeof world.projectiles = [];
  for (const p of world.projectiles) {
    const target = world.getEntity(p.targetId);
    if (target) p.destination = entityCenter(target);
    const dx = p.destination.x - p.pos.x;
    const dy = p.destination.y - p.pos.y;
    const d = Math.hypot(dx, dy);
    const step = p.speed * dt;
    if (d <= step || d < 1e-3) {
      // Impact.
      if (target && target.faction === p.faction) {
        // Friendly fire guard: target changed identity; drop.
      } else if (target) {
        applyDamage(world, target, p.damage);
      }
      continue; // projectile consumed
    }
    p.pos.x += (dx / d) * step;
    p.pos.y += (dy / d) * step;
    survivors.push(p);
  }
  world.projectiles = survivors;
}

export function updateCorpses(world: World, dt: number): void {
  if (world.corpses.length === 0) return;
  const survivors: typeof world.corpses = [];
  for (const c of world.corpses) {
    c.fade -= dt;
    if (c.fade > 0) survivors.push(c);
  }
  world.corpses = survivors;
}
