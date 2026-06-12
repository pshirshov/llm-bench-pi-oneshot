import type { World } from '../world';

export function tickProduction(world: World): void {
  for (const building of Array.from(world.buildings.values())) {
    if (!building.complete || building.queue.length === 0) {
      continue;
    }
    const item = building.queue[0];
    if (item === undefined) {
      throw new Error('queue unexpectedly empty');
    }
    item.remainingTicks -= 1;
    if (item.remainingTicks > 0) {
      continue;
    }
    const spawn = world.findSpawnTile(building);
    if (spawn === undefined) {
      item.remainingTicks = 1;
      continue;
    }
    world.spawnUnit(building.owner, item.kind, spawn, false);
    building.queue.shift();
  }
}
