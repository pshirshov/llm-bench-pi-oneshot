/**
 * Public API exports for the simulation.
 * All headless testing goes through these exports.
 */

export { initGame, gameTick, serializeState, spawnTestUnit, spawnTestBuilding, setResources, destroyEntity } from './sim/game';
export { createAIState, processAI } from './ai/ai';
export { createPRNG, parseSeedFromURL } from './core/prng';
export type { PRNG } from './core/prng';
export { computeLayout, hitTest } from './ui/layout';
export type { HudLayout, Rect, ButtonDef } from './ui/layout';
export { FACTION_STATS, TECH_REQUIREMENTS, TOWER_ATTACK_DAMAGE, TOWER_ATTACK_RANGE } from './core/stats';
export { generateMap } from './gen/mapgen';
export { findPath, isReachable, findNearestWalkable } from './core/pathfinding';
export { assignMoveOrder, assignHarvestOrder } from './sim/movement';
export { enqueueTraining, placeBuilding, isValidPlacement } from './sim/orders';
export { getEntity, getFactionEntities, getEntitiesInRange, buildingCenter, killEntity, hasBuildings, hasTechRequirements, getDropOffs } from './sim/entities';
export { updateFog, getFogState, isVisible, isTileVisible } from './sim/fog';
export { TILE_DEFS, ADJACENCY, tilesAdjacentAllowed } from './core/tiles';
export { runWFC } from './gen/wfc';
export { CAMPAIGN_DATA, createLevelConfig, getLevelSeed } from './campaign/levels';
export { createInputState, handleMouseDown, handleMouseUp, handleKeyDown } from './ui/input';

export type {
  GameState, GameConfig, Faction, Entity, UnitType, BuildingType, TileType, Vec2, FogState,
} from './core/types';
