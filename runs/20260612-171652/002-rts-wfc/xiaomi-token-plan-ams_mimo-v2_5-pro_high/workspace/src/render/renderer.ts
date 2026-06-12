/**
 * Canvas 2D renderer: draws the game world, units, buildings, fog, and HUD.
 */

import type { GameState, Faction, Entity } from '../core/types';
import type { HudLayout } from '../ui/layout';
import { TILE_DEFS } from '../core/tiles';
import { FACTION_STATS } from '../core/stats';
import { getFogState } from '../sim/fog';

const TILE_SIZE = 16;

/**
 * Render the complete game frame.
 */
export function render(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  layout: HudLayout,
  camera: { x: number; y: number },
  selectedEntities: Entity[],
  playerFaction: Faction,
): void {
  const { width, height } = layout.viewport;

  // Clear
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);

  // Draw world
  renderWorld(ctx, state, layout, camera, playerFaction);

  // Draw entities
  renderEntities(ctx, state, layout, camera, selectedEntities, playerFaction);

  // Draw fog overlay
  renderFogOverlay(ctx, state, layout, camera, playerFaction);

  // Draw HUD
  renderHUD(ctx, state, layout, selectedEntities, playerFaction);
}

/**
 * Render the tile map.
 */
function renderWorld(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  layout: HudLayout,
  camera: { x: number; y: number },
  playerFaction: Faction,
): void {
  const map = state.map;
  const startX = Math.floor(camera.x / TILE_SIZE);
  const startY = Math.floor(camera.y / TILE_SIZE);
  const endX = Math.min(map.width, startX + Math.ceil(layout.viewport.width / TILE_SIZE) + 1);
  const endY = Math.min(map.height, startY + Math.ceil(layout.viewport.height / TILE_SIZE) + 1);

  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      if (x < 0 || x >= map.width || y < 0 || y >= map.height) continue;

      const tile = map.tiles[y * map.width + x];
      const def = TILE_DEFS[tile];
      const fog = getFogState(state, playerFaction, x, y);

      if (fog === 'unexplored') continue;

      const screenX = x * TILE_SIZE - camera.x + layout.viewport.x;
      const screenY = y * TILE_SIZE - camera.y + layout.viewport.y;

      // Use dark color for explored but not visible
      ctx.fillStyle = fog === 'visible' ? def.color : def.colorAlt;
      ctx.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE);

      // Add grid lines
      ctx.strokeStyle = 'rgba(0,0,0,0.1)';
      ctx.strokeRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
    }
  }
}

/**
 * Render entities (units and buildings).
 */
function renderEntities(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  layout: HudLayout,
  camera: { x: number; y: number },
  selectedEntities: Entity[],
  playerFaction: Faction,
): void {
  for (const entity of state.entities) {
    if (!entity.alive) continue;

    // Skip if not visible
    const fog = getFogState(state, playerFaction, entity.x, entity.y);
    if (entity.faction !== playerFaction && fog !== 'visible') continue;

    const screenX = entity.x * TILE_SIZE - camera.x + layout.viewport.x;
    const screenY = entity.y * TILE_SIZE - camera.y + layout.viewport.y;

    // Skip if off-screen
    if (screenX + entity.width * TILE_SIZE < layout.viewport.x ||
        screenX > layout.viewport.x + layout.viewport.width ||
        screenY + entity.height * TILE_SIZE < layout.viewport.y ||
        screenY > layout.viewport.y + layout.viewport.height) {
      continue;
    }

    const isSelected = selectedEntities.includes(entity);
    const factionColor = FACTION_STATS[entity.faction].color;

    if (entity.entityType === 'building') {
      renderBuilding(ctx, entity, screenX, screenY, factionColor, isSelected);
    } else {
      renderUnit(ctx, entity, screenX, screenY, factionColor, isSelected);
    }
  }
}

/**
 * Render a building.
 */
function renderBuilding(
  ctx: CanvasRenderingContext2D,
  entity: Entity,
  screenX: number,
  screenY: number,
  color: string,
  isSelected: boolean,
): void {
  const w = entity.width * TILE_SIZE;
  const h = entity.height * TILE_SIZE;

  // Building body
  ctx.fillStyle = color;
  ctx.fillRect(screenX, screenY, w, h);

  // Building outline
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.strokeRect(screenX, screenY, w, h);

  // Selection highlight
  if (isSelected) {
    ctx.strokeStyle = '#0f0';
    ctx.lineWidth = 2;
    ctx.strokeRect(screenX - 1, screenY - 1, w + 2, h + 2);
  }

  // HP bar
  if (entity.hp < entity.maxHp) {
    const hpRatio = entity.hp / entity.maxHp;
    ctx.fillStyle = '#333';
    ctx.fillRect(screenX, screenY - 6, w, 4);
    ctx.fillStyle = hpRatio > 0.5 ? '#0f0' : hpRatio > 0.25 ? '#ff0' : '#f00';
    ctx.fillRect(screenX, screenY - 6, w * hpRatio, 4);
  }

  // Progress bar (for construction)
  if (entity.progressTotal > 0 && entity.progressTicks < entity.progressTotal) {
    const progress = entity.progressTicks / entity.progressTotal;
    ctx.fillStyle = '#333';
    ctx.fillRect(screenX, screenY + h + 2, w, 4);
    ctx.fillStyle = '#0af';
    ctx.fillRect(screenX, screenY + h + 2, w * progress, 4);
  }
}

/**
 * Render a unit.
 */
function renderUnit(
  ctx: CanvasRenderingContext2D,
  entity: Entity,
  screenX: number,
  screenY: number,
  color: string,
  isSelected: boolean,
): void {
  const size = TILE_SIZE * 0.6;
  const centerX = screenX + TILE_SIZE / 2;
  const centerY = screenY + TILE_SIZE / 2;

  // Unit circle
  ctx.beginPath();
  ctx.arc(centerX, centerY, size / 2, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Selection highlight
  if (isSelected) {
    ctx.beginPath();
    ctx.arc(centerX, centerY, size / 2 + 2, 0, Math.PI * 2);
    ctx.strokeStyle = '#0f0';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // HP bar
  if (entity.hp < entity.maxHp) {
    const hpRatio = entity.hp / entity.maxHp;
    ctx.fillStyle = '#333';
    ctx.fillRect(screenX, screenY - 6, TILE_SIZE, 4);
    ctx.fillStyle = hpRatio > 0.5 ? '#0f0' : hpRatio > 0.25 ? '#ff0' : '#f00';
    ctx.fillRect(screenX, screenY - 6, TILE_SIZE * hpRatio, 4);
  }

  // Projectile indicator
  if (entity.isProjectile) {
    ctx.fillStyle = '#ff0';
    ctx.beginPath();
    ctx.arc(centerX, centerY, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Render fog overlay.
 */
function renderFogOverlay(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  layout: HudLayout,
  camera: { x: number; y: number },
  playerFaction: Faction,
): void {
  const map = state.map;
  const startX = Math.floor(camera.x / TILE_SIZE);
  const startY = Math.floor(camera.y / TILE_SIZE);
  const endX = Math.min(map.width, startX + Math.ceil(layout.viewport.width / TILE_SIZE) + 1);
  const endY = Math.min(map.height, startY + Math.ceil(layout.viewport.height / TILE_SIZE) + 1);

  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      if (x < 0 || x >= map.width || y < 0 || y >= map.height) continue;

      const fog = getFogState(state, playerFaction, x, y);
      if (fog === 'visible') continue;

      const screenX = x * TILE_SIZE - camera.x + layout.viewport.x;
      const screenY = y * TILE_SIZE - camera.y + layout.viewport.y;

      if (fog === 'unexplored') {
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
      } else {
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
      }
      ctx.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
    }
  }
}

/**
 * Render the HUD (resource bar, minimap, selection panel).
 */
function renderHUD(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  layout: HudLayout,
  selectedEntities: Entity[],
  playerFaction: Faction,
): void {
  // Resource bar
  renderResourceBar(ctx, state, layout, playerFaction);

  // Minimap
  renderMinimap(ctx, state, layout, playerFaction);

  // Selection panel
  renderSelectionPanel(ctx, layout, selectedEntities);

  // Buttons
  renderButtons(ctx, layout);

  // Speed/Pause buttons
  renderSpeedPause(ctx, state, layout);
}

/**
 * Render the resource bar.
 */
function renderResourceBar(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  layout: HudLayout,
  playerFaction: Faction,
): void {
  const rb = layout.resourceBar;
  ctx.fillStyle = '#222';
  ctx.fillRect(rb.x, rb.y, rb.width, rb.height);

  ctx.fillStyle = '#fff';
  ctx.font = '14px monospace';
  ctx.textBaseline = 'middle';

  const resources = state.resources[playerFaction];
  ctx.fillText(`Gold: ${resources.gold}`, 10, rb.height / 2);
  ctx.fillText(`Wood: ${resources.wood}`, 150, rb.height / 2);
  ctx.fillText(`Supply: ${state.supplyUsed[playerFaction]}/${state.supplyCap[playerFaction]}`, 290, rb.height / 2);
  ctx.fillText(`Seed: ${state.seed}`, 450, rb.height / 2);
}

/**
 * Render the minimap.
 */
function renderMinimap(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  layout: HudLayout,
  playerFaction: Faction,
): void {
  const mm = layout.minimap;
  const map = state.map;

  // Background
  ctx.fillStyle = '#111';
  ctx.fillRect(mm.x, mm.y, mm.width, mm.height);

  // Draw tiles
  const scaleX = mm.width / map.width;
  const scaleY = mm.height / map.height;

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const fog = getFogState(state, playerFaction, x, y);
      if (fog === 'unexplored') continue;

      const tile = map.tiles[y * map.width + x];
      const def = TILE_DEFS[tile];
      ctx.fillStyle = fog === 'visible' ? def.color : def.colorAlt;
      ctx.fillRect(
        mm.x + x * scaleX,
        mm.y + y * scaleY,
        Math.ceil(scaleX),
        Math.ceil(scaleY),
      );
    }
  }

  // Draw entities on minimap
  for (const entity of state.entities) {
    if (!entity.alive) continue;
    const fog = getFogState(state, playerFaction, entity.x, entity.y);
    if (entity.faction !== playerFaction && fog !== 'visible') continue;

    ctx.fillStyle = FACTION_STATS[entity.faction].minimapColor;
    const ex = mm.x + entity.x * scaleX;
    const ey = mm.y + entity.y * scaleY;
    ctx.fillRect(ex, ey, Math.max(2, scaleX), Math.max(2, scaleY));
  }
}

/**
 * Render the selection panel.
 */
function renderSelectionPanel(
  ctx: CanvasRenderingContext2D,
  layout: HudLayout,
  selectedEntities: Entity[],
): void {
  const sp = layout.selectionPanel;
  ctx.fillStyle = '#222';
  ctx.fillRect(sp.x, sp.y, sp.width, sp.height);

  if (selectedEntities.length === 0) return;

  ctx.fillStyle = '#fff';
  ctx.font = '12px monospace';
  ctx.textBaseline = 'top';

  const first = selectedEntities[0];
  let y = sp.y + 10;

  if (selectedEntities.length === 1) {
    ctx.fillText(`ID: ${first.id}`, sp.x + 10, y); y += 16;
    ctx.fillText(`HP: ${first.hp}/${first.maxHp}`, sp.x + 10, y); y += 16;
    ctx.fillText(`Type: ${first.entityType} ${first.unitType ?? first.buildingType}`, sp.x + 10, y); y += 16;
    ctx.fillText(`Faction: ${first.faction}`, sp.x + 10, y); y += 16;
    ctx.fillText(`Order: ${first.order.type}`, sp.x + 10, y); y += 16;
  } else {
    ctx.fillText(`${selectedEntities.length} units selected`, sp.x + 10, y);
  }
}

/**
 * Render action buttons.
 */
function renderButtons(
  ctx: CanvasRenderingContext2D,
  layout: HudLayout,
): void {
  for (const btn of layout.buttons) {
    ctx.fillStyle = '#444';
    ctx.fillRect(btn.rect.x, btn.rect.y, btn.rect.width, btn.rect.height);
    ctx.strokeStyle = '#666';
    ctx.strokeRect(btn.rect.x, btn.rect.y, btn.rect.width, btn.rect.height);

    ctx.fillStyle = '#fff';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(btn.label, btn.rect.x + btn.rect.width / 2, btn.rect.y + btn.rect.height / 2);
    ctx.textAlign = 'left';
  }
}

/**
 * Render speed and pause buttons.
 */
function renderSpeedPause(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  layout: HudLayout,
): void {
  // Speed button
  ctx.fillStyle = '#444';
  ctx.fillRect(layout.speedButton.x, layout.speedButton.y,
    layout.speedButton.width, layout.speedButton.height);
  ctx.fillStyle = '#fff';
  ctx.font = '12px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${state.speed}x`,
    layout.speedButton.x + layout.speedButton.width / 2,
    layout.speedButton.y + layout.speedButton.height / 2);

  // Pause button
  ctx.fillStyle = state.paused ? '#a00' : '#444';
  ctx.fillRect(layout.pauseButton.x, layout.pauseButton.y,
    layout.pauseButton.width, layout.pauseButton.height);
  ctx.fillStyle = '#fff';
  ctx.fillText(state.paused ? '▶' : '⏸',
    layout.pauseButton.x + layout.pauseButton.width / 2,
    layout.pauseButton.y + layout.pauseButton.height / 2);
  ctx.textAlign = 'left';
}
