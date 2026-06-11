/**
 * Canvas 2D renderer: terrain, entities, fog, UI overlays.
 */
import { GameState, Entity, Faction, TILE_SIZE, Camera, TileType, EntityType } from '../engine/types.js';

const TILE_COLORS: Record<TileType, string> = {
  grass: '#3a7a2a',
  dirt: '#8b7355',
  forest: '#1a5a1a',
  water: '#2244aa',
  rock: '#666666',
  gold_mine: '#daa520'
};

const FACTION_COLORS: Record<Faction, { primary: string; secondary: string }> = {
  humans: { primary: '#4488cc', secondary: '#6699dd' },
  orcs: { primary: '#cc4444', secondary: '#dd6666' }
};

const ENTITY_SHAPES: Record<EntityType, (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) => void> = {
  town_hall: (ctx, x, y, w, h, c) => {
    ctx.fillStyle = c;
    ctx.fillRect(x - w / 2, y - h / 2, w, h);
    ctx.fillStyle = '#ffd700';
    ctx.fillRect(x - w / 4, y - h / 4, w / 2, h / 2);
  },
  farm: (ctx, x, y, w, h, c) => {
    ctx.fillStyle = c;
    ctx.fillRect(x - w / 2, y - h / 2, w, h);
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(x - w / 4, y - h / 6, w / 2, h / 3);
  },
  barracks: (ctx, x, y, w, h, c) => {
    ctx.fillStyle = c;
    ctx.fillRect(x - w / 2, y - h / 2, w, h);
    ctx.fillStyle = '#ff4444';
    ctx.fillRect(x - 3, y - 3, 6, 6);
  },
  lumber_mill: (ctx, x, y, w, h, c) => {
    ctx.fillStyle = c;
    ctx.fillRect(x - w / 2, y - h / 2, w, h);
    ctx.fillStyle = '#8B4513';
    ctx.beginPath();
    ctx.moveTo(x, y - h / 3);
    ctx.lineTo(x - w / 3, y + h / 3);
    ctx.lineTo(x + w / 3, y + h / 3);
    ctx.fill();
  },
  guard_tower: (ctx, x, y, w, h, c) => {
    ctx.fillStyle = c;
    ctx.fillRect(x - w / 3, y - h / 2, w * 2 / 3, h);
    ctx.fillStyle = '#aaa';
    ctx.fillRect(x - w / 4, y - h / 3, w / 2, h / 6);
  },
  worker: (ctx, x, y, _w, _h, c) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(x - 1, y - 3, 2, 3);
  },
  melee: (ctx, x, y, _w, _h, c) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ccc';
    ctx.fillRect(x - 1, y - 8, 2, 6);
  },
  ranged: (ctx, x, y, _w, _h, c) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(x + 3, y - 4, 3, 8);
  },
  heavy: (ctx, x, y, _w, _h, c) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffd700';
    ctx.fillRect(x - 2, y - 11, 4, 5);
  }
};

export function render(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  camera: Camera,
  canvasW: number,
  canvasH: number
): void {
  ctx.clearRect(0, 0, canvasW, canvasH);

  const startTileX = Math.floor(camera.x / TILE_SIZE);
  const startTileY = Math.floor(camera.y / TILE_SIZE);
  const endTileX = Math.min(state.mapWidth - 1, startTileX + Math.ceil(canvasW / TILE_SIZE) + 1);
  const endTileY = Math.min(state.mapHeight - 1, startTileY + Math.ceil(canvasH / TILE_SIZE) + 1);

  // Draw terrain
  for (let ty = startTileY; ty <= endTileY; ty++) {
    for (let tx = startTileX; tx <= endTileX; tx++) {
      if (ty < 0 || tx < 0 || ty >= state.mapHeight || tx >= state.mapWidth) continue;

      const tile = state.tiles[ty][tx];
      const screenX = tx * TILE_SIZE - camera.x;
      const screenY = ty * TILE_SIZE - camera.y;

      if (tile.fog === 0) {
        // Unexplored - black
        ctx.fillStyle = '#000';
        ctx.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
        continue;
      }

      const tileType = tile.fog === 1 ? tile.lastSeen : tile.type;
      ctx.fillStyle = TILE_COLORS[tileType];
      ctx.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE);

      // Grid line
      ctx.strokeStyle = 'rgba(0,0,0,0.1)';
      ctx.strokeRect(screenX, screenY, TILE_SIZE, TILE_SIZE);

      // Resource indicator
      if (tile.fog === 2) {
        if (tile.type === 'gold_mine' && tile.resource > 0) {
          ctx.fillStyle = '#ffd700';
          ctx.beginPath();
          ctx.arc(screenX + TILE_SIZE / 2, screenY + TILE_SIZE / 2, 6, 0, Math.PI * 2);
          ctx.fill();
        }
        if (tile.type === 'forest' && tile.resource > 0) {
          ctx.fillStyle = '#0a4a0a';
          ctx.beginPath();
          ctx.moveTo(screenX + TILE_SIZE / 2, screenY + 4);
          ctx.lineTo(screenX + 4, screenY + TILE_SIZE - 4);
          ctx.lineTo(screenX + TILE_SIZE - 4, screenY + TILE_SIZE - 4);
          ctx.fill();
        }
      }

      // Explored but not visible: dim overlay
      if (tile.fog === 1) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  // Draw buildings
  for (const entity of state.entities) {
    if (entity.state === 'dead' && entity.deathTimer <= 0) continue;
    if (entity.stats.isUnit) continue;
    if (!isVisible(entity, state, startTileX, startTileY, endTileX, endTileY)) continue;

    const screenX = entity.x - camera.x;
    const screenY = entity.y - camera.y;
    const w = entity.stats.width * TILE_SIZE;
    const h = entity.stats.height * TILE_SIZE;
    const colors = FACTION_COLORS[entity.faction];

    if (entity.state === 'dead') {
      ctx.globalAlpha = entity.deathTimer / 2000;
    }

    ENTITY_SHAPES[entity.type](ctx, screenX, screenY, w, h, colors.primary);

    // HP bar
    if (entity.hp < entity.maxHp) {
      const barW = w;
      const barH = 4;
      ctx.fillStyle = '#400';
      ctx.fillRect(screenX - barW / 2, screenY - h / 2 - 8, barW, barH);
      ctx.fillStyle = '#0c0';
      ctx.fillRect(screenX - barW / 2, screenY - h / 2 - 8, barW * (entity.hp / entity.maxHp), barH);
    }

    // Build progress
    if (entity.state === 'building') {
      const barW = w;
      const barH = 4;
      ctx.fillStyle = '#00f';
      ctx.fillRect(screenX - barW / 2, screenY - h / 2 - 12, barW * (entity.buildProgress / entity.stats.buildTime), barH);
    }

    ctx.globalAlpha = 1;
  }

  // Draw units
  for (const entity of state.entities) {
    if (entity.state === 'dead' && entity.deathTimer <= 0) continue;
    if (!entity.stats.isUnit) continue;
    if (!isVisible(entity, state, startTileX, startTileY, endTileX, endTileY)) continue;

    const screenX = entity.x - camera.x;
    const screenY = entity.y - camera.y;
    const colors = FACTION_COLORS[entity.faction];

    if (entity.state === 'dead') {
      ctx.globalAlpha = entity.deathTimer / 2000;
    }

    ENTITY_SHAPES[entity.type](ctx, screenX, screenY, TILE_SIZE, TILE_SIZE, colors.primary);

    // HP bar
    if (entity.hp < entity.maxHp) {
      ctx.fillStyle = '#400';
      ctx.fillRect(screenX - 8, screenY - 12, 16, 3);
      ctx.fillStyle = '#0c0';
      ctx.fillRect(screenX - 8, screenY - 12, 16 * (entity.hp / entity.maxHp), 3);
    }

    // Carrying indicator
    if (entity.carrying) {
      ctx.fillStyle = entity.carrying === 'gold' ? '#ffd700' : '#8B4513';
      ctx.fillRect(screenX + 4, screenY - 8, 4, 4);
    }

    ctx.globalAlpha = 1;
  }

  // Draw projectiles
  for (const proj of state.projectiles) {
    const screenX = proj.x - camera.x;
    const screenY = proj.y - camera.y;
    ctx.fillStyle = '#ff0';
    ctx.beginPath();
    ctx.arc(screenX, screenY, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw selection indicators
  for (const id of state.selectedEntityIds) {
    const entity = state.entities.find(e => e.id === id);
    if (!entity || entity.state === 'dead') continue;

    const screenX = entity.x - camera.x;
    const screenY = entity.y - camera.y;
    const w = entity.stats.width * TILE_SIZE;
    const h = entity.stats.height * TILE_SIZE;

    ctx.strokeStyle = '#0f0';
    ctx.lineWidth = 2;
    ctx.strokeRect(screenX - w / 2 - 2, screenY - h / 2 - 2, w + 4, h + 4);
    ctx.lineWidth = 1;
  }
}

function isVisible(
  entity: Entity,
  state: GameState,
  startTX: number,
  startTY: number,
  endTX: number,
  endTY: number
): boolean {
  // Check if on screen
  const etx = Math.floor(entity.x / TILE_SIZE);
  const ety = Math.floor(entity.y / TILE_SIZE);
  if (etx < startTX - 2 || etx > endTX + 2 || ety < startTY - 2 || ety > endTY + 2) return false;

  // Fog check for enemy entities
  if (entity.faction !== state.playerFaction) {
    if (state.tiles[ety]?.[etx]?.fog !== 2) return false;
  }
  return true;
}

/** Render minimap */
export function renderMinimap(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  camera: Camera,
  minimapW: number,
  minimapH: number
): void {
  const scaleX = minimapW / state.mapWidth;
  const scaleY = minimapH / state.mapHeight;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, minimapW, minimapH);

  // Terrain
  for (let ty = 0; ty < state.mapHeight; ty++) {
    for (let tx = 0; tx < state.mapWidth; tx++) {
      const tile = state.tiles[ty][tx];
      if (tile.fog === 0) continue;

      const tileType = tile.fog === 1 ? tile.lastSeen : tile.type;
      ctx.fillStyle = TILE_COLORS[tileType];
      if (tile.fog === 1) {
        ctx.globalAlpha = 0.5;
      }
      ctx.fillRect(tx * scaleX, ty * scaleY, Math.ceil(scaleX), Math.ceil(scaleY));
      ctx.globalAlpha = 1;
    }
  }

  // Entities
  for (const entity of state.entities) {
    if (entity.state === 'dead') continue;
    const etx = Math.floor(entity.x / TILE_SIZE);
    const ety = Math.floor(entity.y / TILE_SIZE);
    if (state.tiles[ety]?.[etx]?.fog !== 2 && entity.faction !== state.playerFaction) continue;

    ctx.fillStyle = FACTION_COLORS[entity.faction].primary;
    const size = entity.stats.isUnit ? 2 : 3;
    ctx.fillRect(etx * scaleX, ety * scaleY, size, size);
  }

  // Viewport rectangle
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.strokeRect(
    (camera.x / TILE_SIZE) * scaleX,
    (camera.y / TILE_SIZE) * scaleY,
    (camera.width / TILE_SIZE) * scaleX,
    (camera.height / TILE_SIZE) * scaleY
  );
}
