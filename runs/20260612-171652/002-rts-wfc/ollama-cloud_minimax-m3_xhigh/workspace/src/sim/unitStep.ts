// Unit step orchestrator. Per-tick unit lifecycle: idle auto-acquire,
// combat, gather/return, build, repair, watchdog.

import { World } from "./world.js";
import { BuildingEntity, UnitEntity, isBuilding } from "./entities.js";
import { TILE } from "./tiles.js";
import { findPath, octile } from "./pathfinding.js";
import { getBuildingStats, getUnitStats, HARVEST } from "./stats.js";
import { isAdjacent } from "./helpers.js";
import { SIM_CONSTANTS } from "./stats.js";
import {
  unitBlocks,
  nearestDropOffBuilding,
  findWalkableTileAdjacentToSource,
  findAdjacentWalkableToBuilding,
  retargetHarvestSource,
  stepAlongPath,
} from "./unitMovement.js";

function autoAcquireTarget(world: World, unit: UnitEntity): void {
  const stats = getUnitStats(unit.faction, unit.unitKind);
  let best: { id: number; d: number } | null = null;
  for (const e of world.entities.values()) {
    if (e.faction === unit.faction) continue;
    if (e.kind !== "unit" && e.kind !== "building") continue;
    if (e.kind === "building" && e.construction < 1) continue;
    const tx = e.kind === "unit" ? e.x : (e as BuildingEntity).x;
    const ty = e.kind === "unit" ? e.y : (e as BuildingEntity).y;
    const d = octile(unit.x, unit.y, tx, ty);
    if (d > stats.sightRadius) continue;
    if (best === null || d < best.d) best = { id: e.id, d };
  }
  unit.target = best ? best.id : null;
}

function tryAttack(world: World, unit: UnitEntity, target: number): void {
  const t = world.entities.get(target);
  if (!t) {
    unit.target = null;
    return;
  }
  const dmg = getUnitStats(unit.faction, unit.unitKind).damage;
  if (t.kind === "unit") {
    const armor = getUnitStats(t.faction, t.unitKind).armor;
    const actual = Math.max(1, dmg - armor);
    t.hp -= actual;
    unit.damageDealt += actual;
    if (t.hp <= 0) {
      world.removeEntity(t.id);
      world.players[t.faction].unitsLost++;
      world.players[unit.faction].kills++;
      const stats = getUnitStats(t.faction, t.unitKind);
      world.players[t.faction].supplyUsed = Math.max(0, world.players[t.faction].supplyUsed - stats.supplyCost);
    }
  } else if (t.kind === "building") {
    const actual = Math.max(1, dmg);
    (t as BuildingEntity).hp -= actual;
    unit.damageDealt += actual;
    if ((t as BuildingEntity).hp <= 0) {
      destroyBuilding(world, t as BuildingEntity);
    }
  } else {
    unit.target = null;
  }
}

function destroyBuilding(world: World, b: BuildingEntity): void {
  const p = world.players[b.faction];
  p.buildingsLost++;
  world.removeEntity(b.id);
  world.recomputeSupplyCap(b.faction);
}

function stepGather(world: World, unit: UnitEntity, blocked: Uint8Array, dt: number): void {
  const order = unit.orderState.order as { kind: "harvest"; tx: number; ty: number } | null;
  if (!order) {
    unit.orderState.phase = "idle";
    return;
  }
  if (unit.orderState.path.length > 0) {
    stepAlongPath(world, unit, blocked, dt);
    return;
  }
  if (!isAdjacent(unit.x, unit.y, order.tx, order.ty)) {
    const adj = findWalkableTileAdjacentToSource(world, blocked, order.tx, order.ty, unit.id);
    if (adj === null) {
      unit.orderState.phase = "idle";
      return;
    }
    const path = findPath(world.map, unit.x, unit.y, adj.x, adj.y, { blocked });
    if (path === null) {
      unit.orderState.phase = "idle";
      return;
    }
    unit.orderState.path = path;
    return;
  }
  const t = world.map.get(order.tx, order.ty);
  if (t === TILE.GOLD_MINE) {
    const idx = order.ty * world.map.width + order.tx;
    if ((world.map.mineGold[idx] ?? 0) <= 0) {
      if (!retargetHarvestSource(world, unit, "gold", blocked)) {
        if (unit.orderState.cargo.gold > 0) {
          returnFromHarvest(world, unit, blocked, "gold");
        } else {
          unit.orderState.phase = "idle";
        }
      }
      return;
    }
    unit.orderState.workProgress += dt;
    if (unit.orderState.workProgress >= HARVEST.goldGatherTime) {
      unit.orderState.workProgress = 0;
      const carry = Math.min(HARVEST.goldPerTrip, world.map.mineGold[idx] ?? 0);
      world.map.mineGold[idx] = Math.max(0, (world.map.mineGold[idx] ?? 0) - carry);
      unit.orderState.cargo.gold += carry;
      if ((world.map.mineGold[idx] ?? 0) <= 0) {
        world.map.set(order.tx, order.ty, TILE.DEPLETED_MINE);
      }
      returnFromHarvest(world, unit, blocked, "gold");
    }
  } else if (t === TILE.FOREST) {
    const idx = order.ty * world.map.width + order.tx;
    if ((world.map.forestWood[idx] ?? 0) <= 0) {
      if (!retargetHarvestSource(world, unit, "wood", blocked)) {
        if (unit.orderState.cargo.wood > 0) {
          returnFromHarvest(world, unit, blocked, "wood");
        } else {
          unit.orderState.phase = "idle";
        }
      }
      return;
    }
    unit.orderState.workProgress += dt;
    if (unit.orderState.workProgress >= HARVEST.woodChopTime) {
      unit.orderState.workProgress = 0;
      const carry = Math.min(HARVEST.woodPerTrip, world.map.forestWood[idx] ?? 0);
      world.map.forestWood[idx] = Math.max(0, (world.map.forestWood[idx] ?? 0) - carry);
      unit.orderState.cargo.wood += carry;
      if ((world.map.forestWood[idx] ?? 0) <= 0) {
        world.map.set(order.tx, order.ty, TILE.STUMP);
      }
      returnFromHarvest(world, unit, blocked, "wood");
    }
  } else {
    unit.orderState.phase = "idle";
  }
}

function returnFromHarvest(
  world: World,
  unit: UnitEntity,
  blocked: Uint8Array,
  resource: "gold" | "wood",
): void {
  const drop = nearestDropOffBuilding(world, unit, resource);
  if (!drop) {
    unit.orderState.phase = "idle";
    return;
  }
  const adj = findAdjacentWalkableToBuilding(world, blocked, drop, unit.id);
  if (adj === null) {
    unit.orderState.phase = "idle";
    return;
  }
  const path = findPath(world.map, unit.x, unit.y, adj.x, adj.y, { blocked });
  if (path === null) {
    unit.orderState.phase = "idle";
    return;
  }
  unit.orderState.path = path;
  unit.orderState.phase = "returning";
}

function stepReturn(world: World, unit: UnitEntity, blocked: Uint8Array, dt: number): void {
  if (unit.orderState.path.length > 0) {
    stepAlongPath(world, unit, blocked, dt);
    return;
  }
  const order = unit.orderState.order as { kind: "harvest"; tx: number; ty: number } | null;
  const resource: "gold" | "wood" = order && world.map.get(order.tx, order.ty) === TILE.FOREST ? "wood" : "gold";
  const drop = nearestDropOffBuilding(world, unit, resource);
  if (!drop) {
    unit.orderState.phase = "idle";
    return;
  }
  if (!isAdjacent(unit.x, unit.y, drop.x, drop.y)) {
    const adj = findAdjacentWalkableToBuilding(world, blocked, drop, unit.id);
    if (adj === null) {
      unit.orderState.phase = "idle";
      return;
    }
    const path = findPath(world.map, unit.x, unit.y, adj.x, adj.y, { blocked });
    if (path === null) {
      unit.orderState.phase = "idle";
      return;
    }
    unit.orderState.path = path;
    return;
  }
  if (resource === "gold") {
    world.players[unit.faction].gold += unit.orderState.cargo.gold;
    unit.orderState.cargo.gold = 0;
  } else {
    world.players[unit.faction].wood += unit.orderState.cargo.wood;
    unit.orderState.cargo.wood = 0;
  }
  if (!retargetHarvestSource(world, unit, resource, blocked)) {
    unit.orderState.phase = "idle";
  }
}

function stepBuild(world: World, unit: UnitEntity, blocked: Uint8Array, dt: number): void {
  if (unit.orderState.path.length > 0) {
    stepAlongPath(world, unit, blocked, dt);
    return;
  }
  const order = unit.orderState.order as { kind: "build"; building: import("./stats.js").BuildingKind; x: number; y: number } | null;
  if (!order) {
    unit.orderState.phase = "idle";
    return;
  }
  let build: BuildingEntity | null = null;
  for (const e of world.entities.values()) {
    if (e.kind !== "building") continue;
    if (e.faction !== unit.faction) continue;
    if (e.buildingKind !== order.building) continue;
    if (e.x === order.x && e.y === order.y) {
      build = e as BuildingEntity;
      break;
    }
  }
  if (!build) {
    unit.orderState.phase = "idle";
    return;
  }
  if (!isAdjacent(unit.x, unit.y, build.x, build.y)) {
    const adj = findAdjacentWalkableToBuilding(world, blocked, build, unit.id);
    if (adj === null) {
      unit.orderState.phase = "idle";
      return;
    }
    const path = findPath(world.map, unit.x, unit.y, adj.x, adj.y, { blocked });
    if (path === null) {
      unit.orderState.phase = "idle";
      return;
    }
    unit.orderState.path = path;
    return;
  }
  const stats = getBuildingStats(unit.faction, order.building);
  unit.orderState.workProgress += dt;
  const rate = 1 / Math.max(0.1, stats.buildTime);
  build.construction = Math.min(1, build.construction + rate * dt);
  if (build.construction >= 1) {
    build.builtBy = null;
    unit.orderState.phase = "idle";
    unit.orderState.order = null;
    world.recomputeSupplyCap(unit.faction);
  }
}

function stepRepair(world: World, unit: UnitEntity, blocked: Uint8Array, dt: number): void {
  if (unit.orderState.path.length > 0) {
    stepAlongPath(world, unit, blocked, dt);
    return;
  }
  const t = world.entities.get(unit.target ?? -1);
  if (!t || t.kind !== "building" || t.faction !== unit.faction) {
    unit.orderState.phase = "idle";
    return;
  }
  const b = t as BuildingEntity;
  if (b.hp >= b.maxHp) {
    unit.orderState.phase = "idle";
    return;
  }
  if (!isAdjacent(unit.x, unit.y, b.x, b.y)) {
    const adj = findAdjacentWalkableToBuilding(world, blocked, b, unit.id);
    if (adj === null) {
      unit.orderState.phase = "idle";
      return;
    }
    const path = findPath(world.map, unit.x, unit.y, adj.x, adj.y, { blocked });
    if (path === null) {
      unit.orderState.phase = "idle";
      return;
    }
    unit.orderState.path = path;
    return;
  }
  const cost = HARVEST.repairGoldPerSec * dt;
  if (world.players[unit.faction].gold < cost) return;
  world.players[unit.faction].gold -= cost;
  b.hp = Math.min(b.maxHp, b.hp + HARVEST.repairRate * dt);
  if (b.hp >= b.maxHp) {
    unit.orderState.phase = "idle";
    unit.orderState.order = null;
  }
}

function stepCombat(world: World, unit: UnitEntity, blocked: Uint8Array, dt: number): void {
  const stats = getUnitStats(unit.faction, unit.unitKind);
  if (unit.target === null || !world.entities.has(unit.target)) {
    autoAcquireTarget(world, unit);
  }
  if (unit.orderState.path.length > 0) {
    stepAlongPath(world, unit, blocked, dt);
  }
  if (unit.target !== null) {
    const t = world.entities.get(unit.target);
    if (!t) {
      unit.target = null;
      return;
    }
    const tx = t.kind === "unit" ? t.x : (t as BuildingEntity).x;
    const ty = t.kind === "unit" ? t.y : (t as BuildingEntity).y;
    const d = octile(unit.x, unit.y, tx, ty);
    if (d <= stats.attackRange) {
      unit.orderState.attackCooldown -= dt;
      if (unit.orderState.attackCooldown <= 0) {
        if (stats.attackProjectile) {
          world.spawnProjectile(unit.faction, unit.id, t.id, unit.x + 0.5, unit.y + 0.5, 8, stats.damage);
        } else {
          tryAttack(world, unit, t.id);
        }
        unit.orderState.attackCooldown = stats.attackCooldown;
      }
    } else {
      if (unit.orderState.path.length === 0) {
        const path = findPath(world.map, unit.x, unit.y, tx, ty, { blocked });
        if (path !== null) unit.orderState.path = path;
      }
    }
  }
}

/** Public: step one unit one tick. */
export function stepUnit(world: World, unit: UnitEntity, dt: number): void {
  if (unit.orderState.attackCooldown > 0) unit.orderState.attackCooldown -= dt;
  if (unit.hp <= 0) {
    unit.corpseTimer += dt;
    if (unit.corpseTimer > 3) {
      const stats = getUnitStats(unit.faction, unit.unitKind);
      world.players[unit.faction].supplyUsed = Math.max(0, world.players[unit.faction].supplyUsed - stats.supplyCost);
      world.removeEntity(unit.id);
    }
    return;
  }
  const blocked = unitBlocks(world, unit.id);
  const prev = {
    tx: unit.x,
    ty: unit.y,
    phase: unit.orderState.phase,
    cargoKey: `${unit.orderState.cargo.gold},${unit.orderState.cargo.wood}`,
  };
  switch (unit.orderState.phase) {
    case "moving":
    case "patrolling":
      stepAlongPath(world, unit, blocked, dt);
      if (unit.orderState.phase === "patrolling") {
        if (unit.target === null) autoAcquireTarget(world, unit);
        if (unit.target !== null) unit.orderState.phase = "attacking";
      }
      break;
    case "gathering":
      stepGather(world, unit, blocked, dt);
      break;
    case "returning":
      stepReturn(world, unit, blocked, dt);
      break;
    case "building":
      stepBuild(world, unit, blocked, dt);
      break;
    case "repairing":
      stepRepair(world, unit, blocked, dt);
      break;
    case "attacking":
      stepCombat(world, unit, blocked, dt);
      break;
    case "idle":
    default:
      if (unit.target === null) autoAcquireTarget(world, unit);
      if (unit.target !== null) unit.orderState.phase = "attacking";
      break;
  }
  if (unit.orderState.order !== null || unit.orderState.phase !== "idle") {
    unit.orderState.watchdog++;
  } else {
    unit.orderState.watchdog = 0;
  }
  if (unit.orderState.watchdog > 0) {
    const next = {
      tx: unit.x,
      ty: unit.y,
      phase: unit.orderState.phase,
      cargoKey: `${unit.orderState.cargo.gold},${unit.orderState.cargo.wood}`,
    };
    const progressed =
      next.tx !== prev.tx ||
      next.ty !== prev.ty ||
      next.phase !== prev.phase ||
      next.cargoKey !== prev.cargoKey;
    if (progressed) {
      unit.orderState.watchdog = 0;
      unit.orderState.lastSnapshot = next;
    } else if (unit.orderState.watchdog > SIM_CONSTANTS.progressWatchdogTicks) {
      unit.orderState.phase = "idle";
      unit.orderState.order = null;
      unit.orderState.watchdog = 0;
    }
  }
}

void isBuilding;
