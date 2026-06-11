/**
 * Game simulation: fixed-timestep update loop, entity movement, harvesting, building, training.
 */
import { GameState, Entity, Faction, TILE_SIZE } from './types.js';
import { findPath, pixelToTile, tileToPixel } from '../pathfinding/astar.js';
import { processAttack, processProjectiles, findNearestEnemy } from '../combat/combat.js';
import { createEntity, resetIdCounter } from '../entities/manager.js';
import { getStats } from '../entities/stats.js';
import { generateMap, StartLocation } from '../map/wfc.js';
import { AIController } from '../ai/ai.js';
import { updateFog } from '../fog/fog.js';

const CAMPAIGN_CONFIGS = [
  { mapW: 32, mapH: 32, difficulty: 1 },
  { mapW: 48, mapH: 48, difficulty: 2 },
  { mapW: 64, mapH: 64, difficulty: 3 },
  { mapW: 80, mapH: 80, difficulty: 4 },
  { mapW: 96, mapH: 96, difficulty: 5 },
];

export function initGameState(
  seed: number,
  playerFaction: Faction,
  level: number = 0
): { state: GameState; ai: AIController } {
  resetIdCounter();

  const config = CAMPAIGN_CONFIGS[level] || CAMPAIGN_CONFIGS[0];
  const mapSeed = seed + level * 12345;
  const { tiles: tileTypes, starts } = generateMap(config.mapW, config.mapH, mapSeed, level);

  // Create tile objects
  const tiles = tileTypes.map(row => row.map(type => ({
    type,
    resource: type === 'gold_mine' ? 2000 : type === 'forest' ? 500 : 0,
    fog: 0,
    lastSeen: type,
    lastSeenEntity: null
  })));

  const state: GameState = {
    seed,
    mapWidth: config.mapW,
    mapHeight: config.mapH,
    tiles,
    entities: [],
    projectiles: [],
    nextEntityId: 1,
    nextProjectileId: 1,
    gameTime: 0,
    paused: false,
    speed: 1,
    playerFaction,
    aiFaction: playerFaction === 'humans' ? 'orcs' : 'humans',
    resources: {
      humans: [500, 300, 0, 10],
      orcs: [500, 300, 0, 10]
    },
    selectedEntityIds: [],
    level,
    gameOver: false,
    winner: null
  };

  // Place starting buildings and units
  placeStartEntities(state, starts[0], 'humans');
  placeStartEntities(state, starts[1], 'orcs');

  const ai = new AIController(state.aiFaction, config.difficulty, seed);

  // Initial fog update
  updateFog(state.tiles, state.entities, state.playerFaction, state.mapWidth, state.mapHeight);

  return { state, ai };
}

function placeStartEntities(state: GameState, start: StartLocation, faction: Faction): void {
  // Town Hall
  const th = createEntity('town_hall', faction, start.x - 2, start.y - 2, state);
  th.hp = th.stats.hp;
  th.state = 'idle';

  // Workers
  for (let i = 0; i < 4; i++) {
    createEntity('worker', faction, start.x + i, start.y + 3, state);
  }
}

/** Fixed-timestep simulation update */
export function updateSimulation(state: GameState, ai: AIController, dt: number): void {
  if (state.paused || state.gameOver) return;

  const effectiveDt = dt * state.speed;
  state.gameTime += effectiveDt;

  // Update entities
  for (const entity of state.entities) {
    if (entity.state === 'dead') {
      entity.deathTimer -= effectiveDt;
      continue;
    }

    updateEntity(entity, state, effectiveDt);
  }

  // Remove fully faded corpses
  state.entities = state.entities.filter(e => !(e.state === 'dead' && e.deathTimer <= 0));

  // Process projectiles
  processProjectiles(state, effectiveDt);

  // Update AI
  ai.update(state, effectiveDt);

  // Update fog
  updateFog(state.tiles, state.entities, state.playerFaction, state.mapWidth, state.mapHeight);

  // Check win/lose
  checkGameOver(state);
}

function updateEntity(entity: Entity, state: GameState, dt: number): void {
  switch (entity.state) {
    case 'idle':
      handleIdle(entity, state);
      break;
    case 'moving':
      handleMoving(entity, state, dt);
      break;
    case 'attacking':
      handleAttacking(entity, state, dt);
      break;
    case 'harvesting':
      handleHarvesting(entity, state, dt);
      break;
    case 'returning_resources':
      handleReturningResources(entity, state, dt);
      break;
    case 'building':
      handleBuilding(entity, state, dt);
      break;
    case 'repairing':
      handleRepairing(entity, state, dt);
      break;
    case 'training':
      handleTraining(entity, state, dt);
      break;
  }
}

function handleIdle(entity: Entity, state: GameState): void {
  // Auto-attack nearby enemies
  if (entity.stats.damage > 0) {
    const enemy = findNearestEnemy(entity, state);
    if (enemy) {
      entity.attackTarget = enemy.id;
      entity.state = 'attacking';
    }
  }
}

function handleMoving(entity: Entity, state: GameState, dt: number): void {
  if (entity.targetX === null || entity.targetY === null) {
    entity.state = 'idle';
    return;
  }

  // Need path?
  if (entity.path.length === 0 || entity.pathIndex >= entity.path.length) {
    const { tx: sx, ty: sy } = pixelToTile(entity.x, entity.y);
    const { tx: gx, ty: gy } = pixelToTile(entity.targetX, entity.targetY);
    const result = findPath(state.tiles, sx, sy, gx, gy, state.mapWidth, state.mapHeight);
    if (result.found) {
      entity.path = result.path;
      entity.pathIndex = 0;
    } else {
      entity.state = 'idle';
      return;
    }
  }

  // Follow path
  const target = entity.path[entity.pathIndex];
  const targetPx = target.x * TILE_SIZE + TILE_SIZE / 2;
  const targetPy = target.y * TILE_SIZE + TILE_SIZE / 2;

  const dx = targetPx - entity.x;
  const dy = targetPy - entity.y;
  const dist = Math.hypot(dx, dy);

  if (dist < 4) {
    entity.pathIndex++;
    if (entity.pathIndex >= entity.path.length) {
      entity.state = 'idle';
      return;
    }
  } else {
    const speed = entity.stats.moveSpeed * TILE_SIZE * (dt / 1000);
    entity.x += (dx / dist) * Math.min(speed, dist);
    entity.y += (dy / dist) * Math.min(speed, dist);
  }

  // Auto-attack while moving
  if (entity.stats.damage > 0 && entity.attackCooldownLeft <= 0) {
    const enemy = findNearestEnemy(entity, state);
    if (enemy && Math.hypot(enemy.x - entity.x, enemy.y - entity.y) < entity.stats.attackRange * TILE_SIZE) {
      entity.attackTarget = enemy.id;
      entity.state = 'attacking';
    }
  }
}

function handleAttacking(entity: Entity, state: GameState, dt: number): void {
  const target = state.entities.find(e => e.id === entity.attackTarget);

  if (!target || target.state === 'dead') {
    entity.attackTarget = null;
    entity.state = 'idle';
    return;
  }

  const range = entity.stats.attackRange * TILE_SIZE;
  const dist = Math.hypot(entity.x - target.x, entity.y - target.y);

  if (dist <= range + TILE_SIZE) {
    // In range: attack
    processAttack(entity, target, state, dt);
  } else {
    // Move toward target
    entity.targetX = target.x;
    entity.targetY = target.y;
    handleMoving(entity, state, dt);
  }
}

function handleHarvesting(entity: Entity, state: GameState, dt: number): void {
  if (entity.harvestTileX === null || entity.harvestTileY === null) {
    entity.state = 'idle';
    return;
  }

  const tile = state.tiles[entity.harvestTileY]?.[entity.harvestTileX];
  if (!tile || tile.resource <= 0) {
    entity.state = 'idle';
    entity.harvestTileX = null;
    entity.harvestTileY = null;
    return;
  }

  // Move to resource tile
  const { tx: sx, ty: sy } = pixelToTile(entity.x, entity.y);
  if (Math.abs(sx - entity.harvestTileX) > 1 || Math.abs(sy - entity.harvestTileY) > 1) {
    const target = tileToPixel(entity.harvestTileX, entity.harvestTileY);
    entity.targetX = target.px;
    entity.targetY = target.py;
    handleMoving(entity, state, dt);
    return;
  }

  // Harvest
  const rate = entity.stats.harvestRate || 10;
  const amount = rate * (dt / 1000);

  if (tile.type === 'gold_mine') {
    const harvested = Math.min(amount, tile.resource);
    tile.resource -= harvested;
    entity.carrying = 'gold';
    entity.carryAmount += harvested;
  } else if (tile.type === 'forest') {
    const harvested = Math.min(amount, tile.resource);
    tile.resource -= harvested;
    entity.carrying = 'wood';
    entity.carryAmount += harvested;
  }

  // Return when carrying enough
  if (entity.carryAmount >= 10) {
    entity.state = 'returning_resources';
    // Find nearest town hall or lumber mill
    const dropOff = findDropOff(entity, state);
    if (dropOff) {
      entity.targetX = dropOff.x;
      entity.targetY = dropOff.y;
    } else {
      entity.state = 'idle';
    }
  }
}

function handleReturningResources(entity: Entity, state: GameState, dt: number): void {
  if (!entity.targetX || !entity.targetY) {
    entity.state = 'idle';
    return;
  }

  const dist = Math.hypot(entity.targetX - entity.x, entity.targetY - entity.y);
  if (dist < TILE_SIZE * 2) {
    // Drop off resources
    if (entity.carrying === 'gold') {
      state.resources[entity.faction][0] += Math.floor(entity.carryAmount);
    } else if (entity.carrying === 'wood') {
      state.resources[entity.faction][1] += Math.floor(entity.carryAmount);
    }
    entity.carrying = null;
    entity.carryAmount = 0;
    entity.state = 'harvesting';
  } else {
    handleMoving(entity, state, dt);
  }
}

function handleBuilding(entity: Entity, state: GameState, dt: number): void {
  if (!entity.buildingType) {
    entity.state = 'idle';
    return;
  }

  // Move to build site
  const dist = Math.hypot(entity.targetX! - entity.x, entity.targetY! - entity.y);
  if (dist > TILE_SIZE * 2) {
    handleMoving(entity, state, dt);
    return;
  }

  // Find the building entity
  const building = state.entities.find(
    e => e.faction === entity.faction && e.type === entity.buildingType &&
    e.tileX === entity.tileX && e.tileY === entity.tileY && e.state === 'building'
  );

  if (!building) {
    entity.state = 'idle';
    entity.buildingType = null;
    return;
  }

  // Build progress
  const rate = 50; // build points per second
  building.buildProgress += rate * (dt / 1000);

  if (building.buildProgress >= building.stats.buildTime) {
    building.state = 'idle';
    building.hp = building.stats.maxHp;
    entity.state = 'idle';
    entity.buildingType = null;
  }
}

function handleRepairing(entity: Entity, state: GameState, dt: number): void {
  const target = state.entities.find(e => e.id === entity.attackTarget);
  if (!target || target.state === 'dead' || target.hp >= target.maxHp) {
    entity.state = 'idle';
    entity.attackTarget = null;
    return;
  }

  const dist = Math.hypot(entity.x - target.x, entity.y - target.y);
  if (dist > TILE_SIZE * 2) {
    entity.targetX = target.x;
    entity.targetY = target.y;
    handleMoving(entity, state, dt);
    return;
  }

  // Repair
  const rate = entity.stats.repairRate || 2;
  const repairAmount = rate * target.stats.maxHp * (dt / 1000);
  target.hp = Math.min(target.maxHp, target.hp + repairAmount);

  // Cost: 1 gold per 10 hp repaired
  const cost = Math.floor(repairAmount / 10);
  if (cost > 0 && state.resources[entity.faction][0] >= cost) {
    state.resources[entity.faction][0] -= cost;
  }
}

function handleTraining(entity: Entity, state: GameState, dt: number): void {
  if (entity.trainQueue.length === 0) {
    entity.state = 'idle';
    return;
  }

  const item = entity.trainQueue[0];
  item.progress += dt;

  if (item.progress >= getStats(item.type, entity.faction).buildTime) {
    // Spawn unit near building
    const spawnX = entity.tileX + entity.stats.width;
    const spawnY = entity.tileY + entity.stats.height;
    createEntity(item.type, entity.faction, spawnX, spawnY, state);

    entity.trainQueue.shift();
    if (entity.trainQueue.length === 0) {
      entity.state = 'idle';
    }
  }
}

function findDropOff(entity: Entity, state: GameState): { x: number; y: number } | null {
  const dropOffTypes = entity.carrying === 'gold' ? ['town_hall'] : ['town_hall', 'lumber_mill'];
  let nearest: Entity | null = null;
  let nearestDist = Infinity;

  for (const e of state.entities) {
    if (e.faction !== entity.faction || e.state === 'dead') continue;
    if (!dropOffTypes.includes(e.type)) continue;
    const dist = Math.hypot(e.x - entity.x, e.y - entity.y);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = e;
    }
  }

  if (nearest) {
    return { x: nearest.x, y: nearest.y };
  }
  return null;
}

function checkGameOver(state: GameState): void {
  if (state.gameOver) return;

  for (const faction of ['humans', 'orcs'] as Faction[]) {
    const buildings = state.entities.filter(
      e => e.faction === faction && !e.stats.isUnit && e.state !== 'dead'
    );
    if (buildings.length === 0) {
      state.gameOver = true;
      state.winner = faction === 'humans' ? 'orcs' : 'humans';
      return;
    }
  }
}
