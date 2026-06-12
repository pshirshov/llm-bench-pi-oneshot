import type { GameMap, Point, Tile, TileKind } from '../types';
import { inBounds } from '../utils';

export interface TileRule {
  weight: number;
  walkable: boolean;
  buildable: boolean;
  adjacency: TileKind[];
}

export const TILE_RULES: Record<TileKind, TileRule> = {
  grass: { weight: 45, walkable: true, buildable: true, adjacency: ['grass', 'dirt', 'forest', 'water', 'rock', 'goldMine', 'depletedMine'] },
  dirt: { weight: 16, walkable: true, buildable: true, adjacency: ['grass', 'dirt', 'forest', 'water', 'rock', 'goldMine', 'depletedMine'] },
  forest: { weight: 16, walkable: false, buildable: false, adjacency: ['grass', 'dirt', 'forest', 'rock'] },
  water: { weight: 8, walkable: false, buildable: false, adjacency: ['grass', 'dirt', 'water'] },
  rock: { weight: 7, walkable: false, buildable: false, adjacency: ['grass', 'dirt', 'forest', 'rock'] },
  goldMine: { weight: 2, walkable: false, buildable: false, adjacency: ['grass', 'dirt'] },
  depletedMine: { weight: 0, walkable: true, buildable: false, adjacency: ['grass', 'dirt', 'depletedMine'] }
};

export const COLLAPSIBLE_TILES: TileKind[] = ['grass', 'dirt', 'forest', 'water', 'rock', 'goldMine'];

export function createTile(kind: TileKind): Tile {
  return {
    kind,
    gold: kind === 'goldMine' ? 0 : 0,
    wood: kind === 'forest' ? 0 : 0
  };
}

export function tileIndex(map: GameMap, x: number, y: number): number {
  return y * map.width + x;
}

export function getTile(map: GameMap, x: number, y: number): Tile {
  if (!inBounds(map.width, map.height, x, y)) {
    throw new Error(`tile out of bounds: ${x},${y}`);
  }
  return map.tiles[tileIndex(map, x, y)];
}

export function setTileKind(map: GameMap, x: number, y: number, kind: TileKind): void {
  const tile = getTile(map, x, y);
  const wasWalkable = isTileWalkable(tile.kind);
  tile.kind = kind;
  if (kind !== 'goldMine') {
    tile.gold = 0;
  }
  if (kind !== 'forest') {
    tile.wood = 0;
  }
  if (wasWalkable !== isTileWalkable(kind)) {
    map.walkVersion += 1;
  }
}

export function isTileWalkable(kind: TileKind): boolean {
  return TILE_RULES[kind].walkable;
}

export function isTileBuildable(kind: TileKind): boolean {
  return TILE_RULES[kind].buildable;
}

export function areAdjacentKindsAllowed(a: TileKind, b: TileKind): boolean {
  return TILE_RULES[a].adjacency.includes(b) && TILE_RULES[b].adjacency.includes(a);
}

export function neighbors8(point: Point): Point[] {
  const result: Point[] = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx !== 0 || dy !== 0) {
        result.push({ x: point.x + dx, y: point.y + dy });
      }
    }
  }
  return result;
}

export function mapHash(map: GameMap): string {
  let hash = 2166136261;
  for (const tile of map.tiles) {
    for (let i = 0; i < tile.kind.length; i += 1) {
      hash ^= tile.kind.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= tile.gold + tile.wood;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
