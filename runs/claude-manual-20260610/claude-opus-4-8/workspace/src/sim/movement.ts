import { tileCenter } from "./pathing.js";
import { UNIT_STATS } from "./stats.js";
import type { Unit } from "./entity.js";
import type { World } from "./world.js";

const WAYPOINT_TOL = 0.18;
const FINAL_TOL = 0.3;

/** True if the unit still has waypoints to follow. */
export function isMoving(u: Unit): boolean {
  return u.waypointIndex < u.path.length;
}

/**
 * Advance a single unit along its path for `dt` seconds, with tile-collision
 * sliding. Returns true if the unit consumed its final waypoint this tick.
 */
export function advanceAlongPath(world: World, u: Unit, dt: number): boolean {
  if (!isMoving(u)) {
    u.vx = 0;
    u.vy = 0;
    return false;
  }
  const stats = UNIT_STATS[u.role];
  const isFinal = u.waypointIndex === u.path.length - 1;
  const wp = tileCenter(u.path[u.waypointIndex]!);
  const dx = wp.x - u.pos.x;
  const dy = wp.y - u.pos.y;
  const d = Math.hypot(dx, dy);
  const tol = isFinal ? FINAL_TOL : WAYPOINT_TOL;
  if (d <= tol) {
    u.waypointIndex++;
    return u.waypointIndex >= u.path.length;
  }

  const step = Math.min(d, stats.moveSpeed * dt);
  const ux = dx / d;
  const uy = dy / d;
  u.facing = Math.atan2(uy, ux);
  const nx = u.pos.x + ux * step;
  const ny = u.pos.y + uy * step;

  // Tile-collision with axis sliding.
  if (world.map.isPassable(Math.floor(nx), Math.floor(ny))) {
    u.pos.x = nx;
    u.pos.y = ny;
    u.stuckTimer = 0;
  } else if (world.map.isPassable(Math.floor(nx), Math.floor(u.pos.y))) {
    u.pos.x = nx;
    u.stuckTimer += dt;
  } else if (world.map.isPassable(Math.floor(u.pos.x), Math.floor(ny))) {
    u.pos.y = ny;
    u.stuckTimer += dt;
  } else {
    u.stuckTimer += dt;
  }
  u.vx = ux * step;
  u.vy = uy * step;
  return false;
}

/**
 * Positional separation: resolve unit-unit overlaps so units never stack and a
 * crowd settles without oscillation. Displacements are accumulated then applied
 * so the result is order-independent within a tick.
 */
export function resolveSeparation(world: World): void {
  const units = [...world.units.values()];
  const dispX = new Map<number, number>();
  const dispY = new Map<number, number>();
  const neighbours: number[] = [];

  for (const a of units) {
    const ra = UNIT_STATS[a.role].radius;
    neighbours.length = 0;
    world.spatial.queryCircle(a.pos, ra + 1.0, neighbours);
    for (const bid of neighbours) {
      if (bid <= a.id) continue; // resolve each pair once
      const b = world.units.get(bid);
      if (!b) continue;
      const rb = UNIT_STATS[b.role].radius;
      const want = ra + rb;
      let dx = a.pos.x - b.pos.x;
      let dy = a.pos.y - b.pos.y;
      let dist = Math.hypot(dx, dy);
      if (dist >= want) continue;
      if (dist < 1e-4) {
        // Exactly coincident: separate deterministically by id parity.
        const angle = ((a.id * 2654435761) % 360) * (Math.PI / 180);
        dx = Math.cos(angle);
        dy = Math.sin(angle);
        dist = 1;
      }
      const overlap = (want - dist) * 0.5;
      const px = (dx / dist) * overlap;
      const py = (dy / dist) * overlap;
      dispX.set(a.id, (dispX.get(a.id) ?? 0) + px);
      dispY.set(a.id, (dispY.get(a.id) ?? 0) + py);
      dispX.set(b.id, (dispX.get(b.id) ?? 0) - px);
      dispY.set(b.id, (dispY.get(b.id) ?? 0) - py);
    }
  }

  for (const u of units) {
    const dx = dispX.get(u.id);
    const dy = dispY.get(u.id);
    if (dx === undefined && dy === undefined) continue;
    const nx = u.pos.x + (dx ?? 0);
    const ny = u.pos.y + (dy ?? 0);
    if (world.map.isPassable(Math.floor(nx), Math.floor(ny))) {
      u.pos.x = nx;
      u.pos.y = ny;
    } else {
      if (world.map.isPassable(Math.floor(nx), Math.floor(u.pos.y))) u.pos.x = nx;
      if (world.map.isPassable(Math.floor(u.pos.x), Math.floor(ny))) u.pos.y = ny;
    }
  }
}
