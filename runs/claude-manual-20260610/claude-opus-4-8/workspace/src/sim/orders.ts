import type { TileCoord, Vec2 } from "../core/vec.js";
import type { ResourceKind, Unit } from "./entity.js";
import { assignPath, nearestPassable } from "./pathing.js";
import type { World } from "./world.js";

function toTile(p: Vec2): TileCoord {
  return { tx: Math.floor(p.x), ty: Math.floor(p.y) };
}

export function stopUnit(u: Unit): void {
  u.command = { type: "idle" };
  u.path = [];
  u.waypointIndex = 0;
  u.pathGoal = null;
}

export function orderMove(world: World, u: Unit, target: Vec2): void {
  const goal = nearestPassable(world.map, toTile(target));
  if (!goal) {
    stopUnit(u);
    return;
  }
  u.command = { type: "move", target: { x: goal.tx + 0.5, y: goal.ty + 0.5 } };
  assignPath(world.map, u, goal, false);
}

export function orderAttackMove(world: World, u: Unit, target: Vec2): void {
  const goal = nearestPassable(world.map, toTile(target));
  if (!goal) {
    stopUnit(u);
    return;
  }
  u.command = { type: "attackMove", target: { x: goal.tx + 0.5, y: goal.ty + 0.5 } };
  assignPath(world.map, u, goal, false);
}

export function orderAttack(_world: World, u: Unit, targetId: number): void {
  u.command = { type: "attack", targetId };
  u.path = [];
  u.waypointIndex = 0;
  u.pathGoal = null;
}

export function orderHarvest(_world: World, u: Unit, tile: TileCoord, resource: ResourceKind): void {
  u.command = { type: "harvest", tile: { tx: tile.tx, ty: tile.ty }, resource };
  u.harvestPhase = "toResource";
  u.path = [];
  u.waypointIndex = 0;
  u.pathGoal = null;
}

export function orderBuild(_world: World, u: Unit, buildingId: number): void {
  u.command = { type: "build", targetId: buildingId };
  u.path = [];
  u.waypointIndex = 0;
  u.pathGoal = null;
}

export function orderRepair(_world: World, u: Unit, buildingId: number): void {
  u.command = { type: "repair", targetId: buildingId };
  u.path = [];
  u.waypointIndex = 0;
  u.pathGoal = null;
}
