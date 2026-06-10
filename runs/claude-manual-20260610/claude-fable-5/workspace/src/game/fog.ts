import { idx } from '../map/gamemap';
import { BUILDING_STATS, UNIT_STATS } from './data';
import { buildingCenter, footprintOf, GameState, PlayerState } from './state';

/**
 * Recompute the fog grid for one player: every previously visible tile drops
 * to explored, then each own unit/building stamps a visibility disc. Terrain
 * and enemy buildings under vision are memorised for "explored" rendering.
 */
export function updateFog(state: GameState, player: PlayerState): void {
  const { map } = state;
  const fog = player.fog;
  for (let i = 0; i < fog.length; i++) {
    if (fog[i] === 2) fog[i] = 1;
  }

  const stamp = (cx: number, cy: number, radius: number): void => {
    const r2 = radius * radius;
    const minX = Math.max(0, Math.floor(cx - radius));
    const maxX = Math.min(map.width - 1, Math.ceil(cx + radius));
    const minY = Math.max(0, Math.floor(cy - radius));
    const maxY = Math.min(map.height - 1, Math.ceil(cy + radius));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r2) {
          const i = y * map.width + x;
          fog[i] = 2;
          player.seenTiles[i] = map.tiles[i];
        }
      }
    }
  };

  for (const u of state.units) {
    if (u.faction !== player.faction) continue;
    stamp(u.x, u.y, UNIT_STATS[u.type].sight);
  }
  for (const b of state.buildings) {
    if (b.faction !== player.faction) continue;
    const c = buildingCenter(b);
    stamp(c.x, c.y, b.constructed ? BUILDING_STATS[b.type].sight : 2);
  }

  // Memorise enemy buildings whose footprint touches a visible tile; forget
  // memories disproven by current vision.
  for (const b of state.buildings) {
    if (b.faction === player.faction) continue;
    if (buildingVisible(state, player, b.id)) {
      const { w, h } = footprintOf(b);
      player.buildingMemory.set(b.id, { type: b.type, faction: b.faction, tx: b.tx, ty: b.ty, w, h });
    }
  }
  for (const [id, mem] of player.buildingMemory) {
    const stillExists = state.buildings.some((b) => b.id === id);
    if (stillExists) continue;
    // The building is gone; drop the memory once we can see its tiles.
    let anyVisible = false;
    for (let y = mem.ty; y < mem.ty + mem.h && !anyVisible; y++) {
      for (let x = mem.tx; x < mem.tx + mem.w && !anyVisible; x++) {
        if (fog[idx(map, x, y)] === 2) anyVisible = true;
      }
    }
    if (anyVisible) player.buildingMemory.delete(id);
  }
}

export function tileVisible(player: PlayerState, mapWidth: number, x: number, y: number): boolean {
  return player.fog[y * mapWidth + x] === 2;
}

export function buildingVisible(state: GameState, player: PlayerState, buildingId: number): boolean {
  const b = state.buildings.find((bl) => bl.id === buildingId);
  if (!b) return false;
  const { w, h } = footprintOf(b);
  for (let y = b.ty; y < b.ty + h; y++) {
    for (let x = b.tx; x < b.tx + w; x++) {
      if (player.fog[idx(state.map, x, y)] === 2) return true;
    }
  }
  return false;
}

export function unitVisible(player: PlayerState, mapWidth: number, x: number, y: number): boolean {
  return player.fog[Math.floor(y) * mapWidth + Math.floor(x)] === 2;
}
