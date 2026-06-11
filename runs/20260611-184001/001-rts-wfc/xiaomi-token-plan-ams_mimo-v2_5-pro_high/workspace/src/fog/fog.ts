/**
 * Fog of war system: three states per tile (unexplored, explored, visible).
 */
import { Tile, Entity, Faction, TILE_SIZE } from '../engine/types.js';

export function updateFog(
  tiles: Tile[][],
  entities: Entity[],
  playerFaction: Faction,
  mapW: number,
  mapH: number
): void {
  // Reset all tiles to non-visible (keep explored state)
  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      if (tiles[y][x].fog === 2) tiles[y][x].fog = 1;
    }
  }

  // Reveal tiles around player's entities
  for (const e of entities) {
    if (e.state === 'dead') continue;
    if (e.faction !== playerFaction) continue;

    const radius = e.stats.sightRadius;
    const centerTx = Math.floor(e.x / TILE_SIZE);
    const centerTy = Math.floor(e.y / TILE_SIZE);

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radius * radius) continue;
        const tx = centerTx + dx;
        const ty = centerTy + dy;
        if (tx >= 0 && tx < mapW && ty >= 0 && ty < mapH) {
          tiles[ty][tx].fog = 2;
          tiles[ty][tx].lastSeen = tiles[ty][tx].type;
        }
      }
    }
  }
}

/** Check if a tile is visible to the player */
export function isTileVisible(tiles: Tile[][], tx: number, ty: number, mapW: number, mapH: number): boolean {
  if (tx < 0 || tx >= mapW || ty < 0 || ty >= mapH) return false;
  return tiles[ty][tx].fog === 2;
}

/** Check if an entity should be visible to the player */
export function isEntityVisible(entity: Entity, tiles: Tile[][], mapW: number, mapH: number): boolean {
  if (entity.faction === 'humans') {
    // Always show player's own units
    return true;
  }
  const tx = Math.floor(entity.x / TILE_SIZE);
  const ty = Math.floor(entity.y / TILE_SIZE);
  return isTileVisible(tiles, tx, ty, mapW, mapH);
}
