/**
 * Fog of war system: three states per tile (unexplored, explored, visible).
 */

import type { GameState, Faction, FogState, Entity } from '../core/types';

/**
 * Update fog of war for a faction based on their units' sight radii.
 */
export function updateFog(state: GameState, faction: Faction): void {
  const fog = state.map.fog[faction];

  // First, downgrade all 'visible' to 'explored'
  for (let i = 0; i < fog.length; i++) {
    if (fog[i] === 'visible') {
      fog[i] = 'explored';
    }
  }

  // Then, mark tiles visible from each entity's sight
  for (const entity of state.entities) {
    if (!entity.alive || entity.faction !== faction) continue;
    if (entity.sightRadius <= 0) continue;

    const cx = Math.floor(entity.x);
    const cy = Math.floor(entity.y);
    const r = entity.sightRadius;

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const tx = cx + dx;
        const ty = cy + dy;
        if (tx < 0 || tx >= state.map.width || ty < 0 || ty >= state.map.height) continue;

        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= r) {
          const idx = ty * state.map.width + tx;
          fog[idx] = 'visible';
        }
      }
    }
  }
}

/**
 * Get the fog state for a tile.
 */
export function getFogState(state: GameState, faction: Faction, x: number, y: number): FogState {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx < 0 || tx >= state.map.width || ty < 0 || ty >= state.map.height) {
    return 'unexplored';
  }
  return state.map.fog[faction][ty * state.map.width + tx];
}

/**
 * Check if an entity is visible to a faction.
 * Own entities are always visible.
 */
export function isVisible(state: GameState, faction: Faction, entity: Entity): boolean {
  if (entity.faction === faction) return true;
  const fog = getFogState(state, faction, entity.x, entity.y);
  return fog === 'visible';
}

/**
 * Check if a tile is visible to a faction.
 */
export function isTileVisible(state: GameState, faction: Faction, x: number, y: number): boolean {
  return getFogState(state, faction, x, y) === 'visible';
}

/**
 * Check if a tile has been explored by a faction.
 */
export function isTileExplored(state: GameState, faction: Faction, x: number, y: number): boolean {
  const fog = getFogState(state, faction, x, y);
  return fog === 'explored' || fog === 'visible';
}

/**
 * Get all visible entities for a faction.
 */
export function getVisibleEntities(state: GameState, faction: Faction): Entity[] {
  return state.entities.filter(e => {
    if (!e.alive) return false;
    if (e.faction === faction) return true; // Own units always visible
    return isVisible(state, faction, e);
  });
}

/**
 * Get a snapshot of visible state for rendering.
 * Returns only what the player faction can see.
 */
export function getVisibleState(state: GameState, faction: Faction): GameState {
  const visibleEntities = getVisibleEntities(state, faction);

  return {
    ...state,
    entities: visibleEntities,
    // Keep fog data for the player faction
    map: {
      ...state.map,
      fog: {
        ...state.map.fog,
        // Only expose player's fog
      },
    },
  };
}
