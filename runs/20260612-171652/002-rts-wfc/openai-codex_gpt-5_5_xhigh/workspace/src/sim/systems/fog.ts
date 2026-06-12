import { buildingStats, unitStats } from '../stats';
import type { PlayerId, Point } from '../types';
import { distance, inBounds, mustGet } from '../utils';
import type { World } from '../world';

export function tickFog(world: World): void {
  for (const player of [1, 2] as const) {
    const fog = mustGet(world.fog, player, 'fog');
    fog.visible.fill(0);
    for (const unit of world.units.values()) {
      if (unit.owner === player) {
        reveal(world, player, { x: unit.x, y: unit.y }, unitStats(unit.faction, unit.kind).sight);
      }
    }
    for (const building of world.buildings.values()) {
      if (building.owner === player) {
        reveal(world, player, { x: building.x + building.w / 2, y: building.y + building.h / 2 }, buildingStats(building.kind).sight);
      }
    }
  }
}

function reveal(world: World, player: PlayerId, center: Point, radius: number): void {
  const fog = mustGet(world.fog, player, 'fog');
  const minX = Math.max(0, Math.floor(center.x - radius));
  const maxX = Math.min(world.map.width - 1, Math.ceil(center.x + radius));
  const minY = Math.max(0, Math.floor(center.y - radius));
  const maxY = Math.min(world.map.height - 1, Math.ceil(center.y + radius));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (inBounds(world.map.width, world.map.height, x, y) && distance(center, { x: x + 0.5, y: y + 0.5 }) <= radius) {
        const index = y * world.map.width + x;
        fog.visible[index] = 1;
        fog.explored[index] = 1;
      }
    }
  }
}
