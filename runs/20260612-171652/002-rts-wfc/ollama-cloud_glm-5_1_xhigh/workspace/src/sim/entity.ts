/** Entity creation helpers. */

import type { Unit, Building, Projectile, EntityId, Faction, UnitType, BuildingType, Order, ResourceCargo } from "./types";
import { UNIT_STATS, BUILDING_STATS } from "./stats";

let nextId = 1;

export function resetEntityIds(): void {
  nextId = 1;
}

export function genId(): EntityId {
  return nextId++;
}

export function createUnit(
  type: UnitType, faction: Faction, x: number, y: number
): Unit {
  const stats = UNIT_STATS[type];
  return {
    id: genId(),
    type,
    faction,
    x, y,
    hp: stats.hp,
    maxHp: stats.hp,
    order: { type: "idle" } as Order,
    cooldownRemaining: 0,
    cargo: { type: null, amount: 0 } as ResourceCargo,
    harvestTarget: null,
    harvestPhase: null,
    harvestGatherTimer: 0,
    progressWatchdog: 0,
    lastProgressX: x,
    lastProgressY: y,
    lastProgressPhase: "idle",
    path: [],
    pathIndex: 0,
    repathAttempts: 0,
    stuckTicks: 0,
    lastX: x,
    lastY: y,
  };
}

export function createBuilding(
  type: BuildingType, faction: Faction, col: number, row: number,
  isComplete: boolean = false
): Building {
  const stats = BUILDING_STATS[type];
  return {
    id: genId(),
    type,
    faction,
    col, row,
    hp: isComplete ? stats.hp : 1,
    maxHp: stats.hp,
    buildProgress: isComplete ? stats.buildTime : 0,
    isComplete,
    rallyPoint: null,
    trainingQueue: [],
    cooldownRemaining: 0,
  };
}

export function createProjectile(
  x: number, y: number, targetId: EntityId, damage: number, faction: Faction
): Projectile {
  return {
    id: genId(),
    x, y,
    targetId,
    damage,
    speed: 0.5, // tiles per tick
    faction,
  };
}

export function idleOrder(): Order {
  return { type: "idle" };
}

export function moveOrder(target: { x: number; y: number }): Order {
  return { type: "move", targetPos: target };
}

export function attackOrder(targetId: EntityId): Order {
  return { type: "attack", targetId };
}

export function attackMoveOrder(target: { x: number; y: number }): Order {
  return { type: "attack_move", targetPos: target };
}

export function harvestOrder(targetId: EntityId): Order {
  return { type: "harvest", targetId };
}

export function buildOrder(buildingType: BuildingType, location: { col: number; row: number }): Order {
  return { type: "build", buildingType, buildLocation: location };
}

export function repairOrder(targetId: EntityId): Order {
  return { type: "repair", targetId };
}