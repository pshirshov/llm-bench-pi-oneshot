import { buildingStats } from './stats';
import type { Building, BuildingKind, GameMap, Point, Unit } from './types';
import { getTile, isTileBuildable } from './map/tiles';
import { inBounds } from './utils';

export interface PlacementContext {
  map: GameMap;
  buildings: Iterable<Building>;
  units: Iterable<Unit>;
}

export interface PlacementResult {
  ok: boolean;
  reason?: 'out-of-bounds' | 'terrain' | 'building' | 'unit';
}

export function validatePlacement(context: PlacementContext, kind: BuildingKind, site: Point): PlacementResult {
  const footprint = buildingStats(kind).footprint;
  for (let y = site.y; y < site.y + footprint.h; y += 1) {
    for (let x = site.x; x < site.x + footprint.w; x += 1) {
      if (!inBounds(context.map.width, context.map.height, x, y)) {
        return { ok: false, reason: 'out-of-bounds' };
      }
      if (!isTileBuildable(getTile(context.map, x, y).kind)) {
        return { ok: false, reason: 'terrain' };
      }
    }
  }
  for (const building of context.buildings) {
    if (rectsOverlapGrid(site, footprint, { x: building.x, y: building.y }, { w: building.w, h: building.h })) {
      return { ok: false, reason: 'building' };
    }
  }
  for (const unit of context.units) {
    const points = reservedUnitPoints(unit);
    if (points.some(point => point.x >= site.x && point.x < site.x + footprint.w && point.y >= site.y && point.y < site.y + footprint.h)) {
      return { ok: false, reason: 'unit' };
    }
  }
  return { ok: true };
}

function reservedUnitPoints(unit: Unit): Point[] {
  if (unit.move === undefined) {
    return [unit.tile];
  }
  const points = [unit.tile, unit.move.to];
  const dx = unit.move.to.x - unit.move.from.x;
  const dy = unit.move.to.y - unit.move.from.y;
  if (dx !== 0 && dy !== 0) {
    points.push({ x: unit.move.from.x + dx, y: unit.move.from.y }, { x: unit.move.from.x, y: unit.move.from.y + dy });
  }
  return points;
}

function rectsOverlapGrid(a: Point, as: { w: number; h: number }, b: Point, bs: { w: number; h: number }): boolean {
  return a.x < b.x + bs.w && a.x + as.w > b.x && a.y < b.y + bs.h && a.y + as.h > b.y;
}
