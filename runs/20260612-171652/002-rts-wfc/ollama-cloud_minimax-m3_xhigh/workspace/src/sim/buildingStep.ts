// Building and projectile step. Buildings: progress construction, train queue.
// Projectiles: travel to target, apply damage on arrival.
//
// I2 bookkeeping: training is rejected when supply would exceed cap; a
// completed unit consumes supply; a destroyed unit releases supply.

import { World } from "./world.js";
import { BuildingEntity, isBuilding, isProjectile, isUnit, ProjectileEntity, UnitEntity } from "./entities.js";
import { TILE } from "./tiles.js";
import { getBuildingStats, getUnitStats } from "./stats.js";
import { findPath, octile } from "./pathfinding.js";
import { TICK_DT } from "./stats.js";

const HALF_TILE = 0.5;

function trySpawnUnitAtAdjacentTile(
  world: World,
  b: BuildingEntity,
  kind: import("./stats.js").UnitKind,
): UnitEntity | null {
  const stats = getUnitStats(b.faction, kind);
  const cap = world.players[b.faction].supplyCap;
  const used = world.players[b.faction].supplyUsed;
  if (used + stats.supplyCost > cap) {
    return null; // can't exceed cap (I2: training blocked at cap)
  }
  // Find a free walkable tile adjacent to building, or nearby.
  const fp = getBuildingStats(b.faction, b.buildingKind).footprint;
  const candidates: Array<[number, number]> = [];
  for (let dy = -1; dy <= fp.h; dy++) {
    for (let dx = -1; dx <= fp.w; dx++) {
      const onLeft = dx === -1;
      const onRight = dx === fp.w;
      const onTop = dy === -1;
      const onBottom = dy === fp.h;
      if (!onLeft && !onRight && !onTop && !onBottom) continue;
      const x = b.x + dx;
      const y = b.y + dy;
      if (x < 0 || y < 0 || x >= world.map.width || y >= world.map.height) continue;
      candidates.push([x, y]);
    }
  }
  // Sort by distance from building center, then by "free" first.
  for (const [x, y] of candidates) {
    if (!isFreeTile(world, x, y)) continue;
    const u = world.spawnUnit(b.faction, kind, x, y);
    world.players[b.faction].supplyUsed += stats.supplyCost;
    return u;
  }
  // C6: try expanding the search outward in expanding rings.
  for (let r = 2; r <= 5; r++) {
    for (let dy = -r; dy <= r + fp.h - 1; dy++) {
      for (let dx = -r; dx <= r + fp.w - 1; dx++) {
        const onPerim =
          dx === -r || dy === -r || dx === r + fp.w - 1 || dy === r + fp.h - 1;
        if (!onPerim) continue;
        const x = b.x + dx;
        const y = b.y + dy;
        if (x < 0 || y < 0 || x >= world.map.width || y >= world.map.height) continue;
        if (!isFreeTile(world, x, y)) continue;
        const u = world.spawnUnit(b.faction, kind, x, y);
        world.players[b.faction].supplyUsed += stats.supplyCost;
        return u;
      }
    }
  }
  return null;
}

function isFreeTile(world: World, x: number, y: number): boolean {
  const t = world.map.get(x, y);
  if (t === TILE.WATER || t === TILE.ROCK || t === TILE.GOLD_MINE || t === TILE.FOREST) return false;
  for (const e of world.entities.values()) {
    if (e.kind === "unit") {
      if (e.x === x && e.y === y) return false;
    } else if (e.kind === "building" && e.construction >= 1) {
      const fp = getBuildingStats(e.faction, e.buildingKind).footprint;
      if (x >= e.x && x < e.x + fp.w && y >= e.y && y < e.y + fp.h) return false;
    }
  }
  return true;
}

export function stepBuilding(world: World, b: BuildingEntity, dt: number): void {
  if (b.hp <= 0) {
    b.corpseTimer += dt;
    if (b.corpseTimer > 3) {
      // Free supply no longer used (units still have to die separately).
      world.players[b.faction].buildingsLost++;
      world.removeEntity(b.id);
      world.recomputeSupplyCap(b.faction);
    }
    return;
  }
  // Training queue: progress the head entry.
  if (b.trainQueue.length > 0) {
    const head = b.trainQueue[0] as { unit: import("./stats.js").UnitKind; progress: number; total: number };
    head.progress += dt;
    if (head.progress >= head.total) {
      const kind = head.unit;
      b.trainQueue.shift();
      const u = trySpawnUnitAtAdjacentTile(world, b, kind);
      if (u === null) {
        // C6: spawn failed. Push the head back as a retry on next tick? We
        // keep it simple: refund the supply, drop the entry (so we don't loop
        // forever). The test that exercises C6 will spawn at radius 1+.
        // Actually, we should retry until success: place back at progress=0.
        b.trainQueue.unshift({ unit: kind, progress: 0, total: head.total });
      }
    }
  }
}

export function stepProjectile(world: World, p: ProjectileEntity, dt: number): void {
  const target = world.entities.get(p.target);
  if (!target) {
    world.removeEntity(p.id);
    return;
  }
  const tx = target.kind === "unit" ? target.x : (target as BuildingEntity).x;
  const ty = target.kind === "unit" ? target.y : (target as BuildingEntity).y;
  // Target center approximation: tx+0.5, ty+0.5 for units; for buildings use the
  // center of footprint.
  const cx = target.kind === "unit" ? tx + HALF_TILE : tx;
  const cy = target.kind === "unit" ? ty + HALF_TILE : ty;
  const dx = cx - p.x;
  const dy = cy - p.y;
  const dist = Math.hypot(dx, dy);
  const step = p.speed * dt;
  if (dist <= step || dist < 0.1) {
    // Apply damage.
    if (target.kind === "unit") {
      const tu = target as UnitEntity;
      const armor = getUnitStats(tu.faction, tu.unitKind).armor;
      const actual = Math.max(1, p.damage - armor);
      tu.hp -= actual;
      if (tu.hp <= 0) {
        world.removeEntity(tu.id);
        world.players[tu.faction].unitsLost++;
        const stats = getUnitStats(tu.faction, tu.unitKind);
        world.players[tu.faction].supplyUsed = Math.max(0, world.players[tu.faction].supplyUsed - stats.supplyCost);
        // Track kills for the source.
        const src = world.entities.get(p.source);
        if (src && src.kind === "unit") {
          (src as UnitEntity).damageDealt += actual;
          world.players[(src as UnitEntity).faction].kills++;
        }
      }
    } else if (target.kind === "building") {
      const tb = target as BuildingEntity;
      const actual = Math.max(1, p.damage);
      tb.hp -= actual;
      if (tb.hp <= 0) {
        world.players[tb.faction].buildingsLost++;
        world.removeEntity(tb.id);
        world.recomputeSupplyCap(tb.faction);
        const src = world.entities.get(p.source);
        if (src && src.kind === "unit") {
          world.players[(src as UnitEntity).faction].kills++;
        }
      }
    }
    world.removeEntity(p.id);
    return;
  }
  p.x += (dx / dist) * step;
  p.y += (dy / dist) * step;
}

void findPath;
void octile;
void TICK_DT;
void isBuilding;
void isProjectile;
void isUnit;
