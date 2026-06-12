import { BALANCE } from '../src/sim/stats';
import type { GameMap, Point, TileKind } from '../src/sim/types';
import { World } from '../src/sim/world';
import { createTile, getTile, setTileKind } from '../src/sim/map/tiles';

export function makeMap(width = 32, height = 32): GameMap {
  return {
    width,
    height,
    tiles: Array.from({ length: width * height }, () => createTile('grass')),
    starts: [
      { player: 1, x: 5, y: 5 },
      { player: 2, x: width - 6, y: height - 6 }
    ],
    level: 1,
    seed: 99,
    walkVersion: 0
  };
}

export function makeWorld(width = 32, height = 32): World {
  const world = new World(makeMap(width, height), 99, { aiEnabled: false, difficulty: 1 });
  world.units.clear();
  world.buildings.clear();
  world.projectiles.splice(0, world.projectiles.length);
  world.spawnBuilding(1, 'guardTower', { x: 0, y: 0 });
  world.spawnBuilding(2, 'guardTower', { x: width - 2, y: height - 2 });
  for (const player of world.players.values()) {
    player.supplyUsed = 0;
    player.supplyCap = 100;
    player.gold = 2000;
    player.wood = 2000;
  }
  return world;
}

export function setResource(map: GameMap, point: Point, kind: 'goldMine' | 'forest', amount?: number): void {
  setTileKind(map, point.x, point.y, kind);
  const tile = getTile(map, point.x, point.y);
  if (kind === 'goldMine') {
    tile.gold = amount ?? BALANCE.mineGold;
  } else {
    tile.wood = amount ?? BALANCE.forestWood;
  }
}

export function setBlock(map: GameMap, point: Point, kind: TileKind = 'rock'): void {
  setTileKind(map, point.x, point.y, kind);
}

export function stepUntil(world: World, predicate: () => boolean, maxTicks: number): boolean {
  for (let i = 0; i < maxTicks; i += 1) {
    if (predicate()) {
      return true;
    }
    world.step(1);
  }
  return predicate();
}

export function unitIds(world: World, owner = 1): number[] {
  return Array.from(world.units.values()).filter(unit => unit.owner === owner).map(unit => unit.id);
}
